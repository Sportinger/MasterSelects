import type { ImageOperatorExternalResource } from '../../services/operators/imageOperatorExternalResources';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { ResidentTemporalRuntime } from './ResidentTemporalRuntime';
import type { TemporalClipSource } from './temporalClipSource';
import { getTemporalStatus, isCollectingTemporalPreparations, recordTemporalPreparation, setTemporalStatus } from './temporalResourcePreparation';
import { DisMotionCache } from './DisMotionCache';
import { useTrackingStore } from '../../stores/trackingStore';
import { SlitScanTrackingGap, slitScanStabilization } from './slit-scan/stabilization';

/** Shared source access, separate small analysis images. The caller owns render
 * context; each graph node declares its history window instead of using playback
 * state as the previous frame. Original source frames only, including export. */
export class SourceMotionHistory {
  private runtime: ResidentTemporalRuntime;
  private disRuntime: ResidentTemporalRuntime;
  private dis = new Map<string, DisMotionCache>();
  private sampleLimit: number;
  private owners = new Map<string, Set<string>>();
  private analysisRequests = new Map<string, string>();
  private device: GPUDevice;
  private onReady?: () => void;
  constructor(device: GPUDevice, onReady?: () => void) {
    this.device = device; this.onReady = onReady;
    this.runtime = new ResidentTemporalRuntime(device, onReady);
    this.disRuntime = new ResidentTemporalRuntime(device, onReady);
    this.sampleLimit = Math.min(8192, device.limits.maxTextureDimension2D - 1);
  }

  resolve(resources: Map<string, ResolvedImageGraphExternalResource>, descriptors: readonly ImageOperatorExternalResource[],
    scopeId: string, effect: { id: string; type?: string; params: Record<string, unknown> }, source: TemporalClipSource | undefined,
    encoder: GPUCommandEncoder, input: { view: GPUTextureView; width: number; height: number } | undefined) {
    let ready = true, requiredPending = false;
    const owner = JSON.stringify([scopeId, effect.id]);
    const keys = new Set(descriptors.flatMap(resource => resource.kind === 'source-motion' ? [JSON.stringify([scopeId, effect.id, resource.owner])] : []));
    // A folded preview/smoothing branch is not an invalidation of measured
    // source motion. Keep a bounded warm cache when the eye/radius is off.
    for (const key of this.owners.get(owner) ?? []) {
      const node = JSON.parse(key)[2];
      const geometryDisabled = node === '__slit_geometry_motion'
        && (!['motion-band', 'motion-surface'].includes(String(effect.params.geometryMode))
          && (effect.params.geometryMode !== 'time-surface' || Number(effect.params.geometryFlowDepth ?? 0) === 0));
      const smoothingDisabled = node === 'motion-scan-dis-source'
        && !(Number(effect.params.scanSmoothing) > 0) && effect.params.scanSmoothingPreview !== true;
      // Geometry query passes share this owner with color. A missing descriptor
      // alone is therefore not a bypass; consult the feature's actual state.
      if (!keys.has(key) && (!this.dis.has(key) || geometryDisabled
        || (smoothingDisabled && this.dis.get(key)?.pending))) this.release(key);
    }
    const retained = new Set([...(this.owners.get(owner) ?? []), ...keys]);
    if (retained.size) this.owners.set(owner, retained); else this.owners.delete(owner);
    const seen = new Set<string>();
    for (const descriptor of descriptors) {
      if (descriptor.kind !== 'source-motion' || seen.has(descriptor.owner)) continue;
      seen.add(descriptor.owner);
      const key = JSON.stringify([scopeId, effect.id, descriptor.owner]);
      const dense = descriptor.denseInverseSearch === true;
      const band = ['motion-band', 'motion-surface'].includes(String(effect.params.geometryMode)) && descriptor.owner === '__slit_geometry_motion';
      const statusId = dense ? `${effect.id}:dis` : effect.id;
      const runtime = dense ? this.disRuntime : this.runtime;
      let dis = this.dis.get(key);
      const analysisRequest = JSON.stringify([descriptor, band, source?.mediaId, source?.duration,
        source?.inPoint, source?.outPoint, source?.speed, source?.speedKeyframes, source?.sourceMap, source?.sourceOverride]);
      // Playback changes localTime continuously, so it must not cancel a useful
      // in-flight window. Authored window/source changes must replace it, however.
      if (dense && dis?.pending && this.analysisRequests.get(key) !== analysisRequest) {
        this.release(key); dis = undefined;
        const owners = this.owners.get(owner) ?? new Set<string>(); owners.add(key); this.owners.set(owner, owners);
      }
      this.analysisRequests.set(key, analysisRequest);
      if (!dense && dis) { dis.destroy(); this.dis.delete(key); this.disRuntime.release(key); dis = undefined; }
      if (dense) {
        this.runtime.release(key);
        if (!dis) {
          // Two recent owners at most; each has its own bounded field volume.
          if (this.dis.size >= 2) this.release(this.dis.keys().next().value!);
          dis = new DisMotionCache(this.device, this.onReady, status => setTemporalStatus(statusId, status));
        }
        this.dis.delete(key); this.dis.set(key, dis);
        if (dis.pending) {
          recordTemporalPreparation(dis.pending); setTemporalStatus(statusId, dis.progress);
          ready = false; requiredPending ||= descriptor.required === true; continue;
        }
      }
      if (!source || !input) throw new Error('Source Motion needs a source video clip.');
      const media = useMediaStore.getState().files.find(file => file.id === source.mediaId);
      if (!media || media.type !== 'video') throw new Error('Source Motion video is unavailable.');
      const fps = media.fps && media.fps > 0 ? media.fps : 30;
      // Source Motion bounds its interval to one graph second beyond the delay.
      // Plan for the complete clip window, not its growing played prefix. This
      // keeps the sampling grid, image size and reserved capacity stable during
      // playback. Older delays hold the boundary without extra source frames.
      const horizon = Math.min(descriptor.lookback * descriptor.timeFactor + (dense ? 1 / fps : descriptor.timeFactor), Math.max(1 / fps, source.duration));
      const speed = Math.max(Math.abs(source.speed), ...source.speedKeyframes.map(frame => Math.abs(frame.value)));
      const sourceFrames = Math.ceil(Math.min(source.outPoint - source.inPoint, horizon * speed) * fps) + 3;
      const samples = Math.min(this.sampleLimit, Math.max(3, sourceFrames * 2));
      const distinct = Math.min(sourceFrames, samples * 2) + (dense ? 2 : 0);
      let edge = 320;
      const aspect = Math.min(media.width!, media.height!) / Math.max(media.width!, media.height!);
      while (edge > 20 && edge * edge * aspect * 4 * distinct * 1.25 > (dense ? band ? 24 : 48 : 192) * 1024 * 1024) edge /= 2;
      const stabilization = (descriptor.stabilize || descriptor.owner === 'motion-scan-source')
        ? slitScanStabilization(effect.params, useTrackingStore.getState().assets, source.mediaId, media.width!, media.height!) : undefined;
      let result;
      const sourceStatusId = dense ? `${statusId}:source` : statusId;
      try { result = runtime.resolve({ key, effectId: sourceStatusId, media, source, encoder, horizon, stabilization,
        timeFactor: descriptor.timeFactor, samples, nearest: dense && effect.params.temporalInterpolation === 'nearest', maxEdge: edge,
        sourceOnly: true, motionPairs: dense, motionTrajectories: band, currentInput: input,
        reserveFrames: Math.ceil(distinct * 1.25), keepPending: !descriptor.required && useTimelineStore.getState().isPlaying,
      }, dense ? band ? 32 : 64 : 256); } catch (error) {
        if (!(error instanceof SlitScanTrackingGap)) {
          if (!dense || descriptor.required || isCollectingTemporalPreparations()) throw error;
          setTemporalStatus(statusId, `DIS unavailable: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        // No raw/stabilized coordinate mixing: leave the field invalid if its
        // frame pair is outside the tracking coverage. The scan can still render.
        this.release(key); continue;
      }
      if (!result) {
        if (dense) setTemporalStatus(statusId, getTemporalStatus(sourceStatusId));
        ready = false; requiredPending ||= descriptor.required === true; continue;
      }
      if (dense && dis && result.motion) {
        let field;
        try { field = dis.resolve(result.motion, band); }
        catch (error) {
          if (descriptor.required || isCollectingTemporalPreparations()) throw error;
          // Optional refinement failure must not take the whole Slit Scan down.
          setTemporalStatus(statusId, `DIS unavailable: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        if (!field) {
          if (dis.pending) { runtime.pin(key, dis.pending); recordTemporalPreparation(dis.pending); }
          setTemporalStatus(statusId, dis.progress); ready = false; requiredPending ||= descriptor.required === true; continue;
        }
        for (const part of descriptors) if (part.kind === 'source-motion' && part.owner === descriptor.owner) resources.set(part.id, field[part.part]);
        setTemporalStatus(statusId, dis.progress || 'DIS · ready');
        continue;
      }
      for (const part of descriptors) if (part.kind === 'source-motion' && part.owner === descriptor.owner) resources.set(part.id, result[part.part]);
    }
    // Refinement must not hold the entire Slit Scan preview while its source
    // history catches up. Missing fields remain invalid; onReady requests a new
    // render. Export still waits for complete, deterministic analysis resources.
    return ready || (!requiredPending && !isCollectingTemporalPreparations());
  }
  private release(key: string) {
    this.analysisRequests.delete(key);
    this.dis.get(key)?.destroy(); this.dis.delete(key); this.runtime.release(key); this.disRuntime.release(key);
    for (const [owner, keys] of this.owners) { keys.delete(key); if (!keys.size) this.owners.delete(owner); }
  }
  destroy() {
    for (const dis of this.dis.values()) dis.destroy(); this.dis.clear();
    this.runtime.destroy(); this.disRuntime.destroy(); this.owners.clear(); this.analysisRequests.clear();
  }
}
