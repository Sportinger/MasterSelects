import type { ClipMask } from '../../types/masks';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';
import { useMediaStore } from '../../stores/mediaStore';
import { SLIT_SCAN_PROTECTION_RESOURCE } from '../../services/operators/slitScanProtectionGraph';
import { SLIT_SCAN_TIME_MAP_RESOURCE } from '../../services/operators/slitScanTimeMapGraph';
import { SlitScanMaskRuntime } from './SlitScanMaskRuntime';
import { TimeMapMediaRuntime } from './TimeMapMediaRuntime';
import { isCollectingTemporalPreparations, setTemporalStatus } from './temporalResourcePreparation';
import { temporalSourceTime, type TemporalClipSource } from './temporalClipSource';
import { SourceTemporalRuntime, sourceTemporalWindow } from './SourceTemporalRuntime';
import { useTimelineStore } from '../../stores/timeline';
import { useTrackingStore } from '../../stores/trackingStore';
import { SlitScanTrackingGap, slitScanSourceTransform, slitScanStabilization } from './slit-scan/stabilization';
import type { SourceTemporalRequest } from './SourceTemporalRuntime';
import { HybridTemporalRuntime, type HybridTemporalContext } from './HybridTemporalRuntime';
import { hybridTemporalSampleLimit } from './sourceTemporalLimits';

/** Device-local resource ownership for temporal graphs and their node previews. */
export class TemporalEffectResources {
  private masks: SlitScanMaskRuntime;
  private maps: TimeMapMediaRuntime;
  private native: SourceTemporalRuntime;
  private hybrid?: HybridTemporalRuntime;
  private device: GPUDevice;
  private onReady?: () => void;
  constructor(device: GPUDevice, onReady?: () => void) {
    this.masks = new SlitScanMaskRuntime(device);
    this.maps = new TimeMapMediaRuntime(device, onReady);
    this.native = new SourceTemporalRuntime(device, onReady);
    this.device = device; this.onReady = onReady;
  }

  resolveNative(effect: { id: string; type: string; params: Record<string, unknown> },
    scopeId: string, source: TemporalClipSource | undefined, encoder: GPUCommandEncoder,
    currentInput?: { view: GPUTextureView; width: number; height: number }, hybridContext?: HybridTemporalContext) {
    if (!source) throw new Error('Full-resolution temporal sampling requires a source video clip.');
    const media = useMediaStore.getState().files.find(file => file.id === source.mediaId);
    if (!media || media.type !== 'video') throw new Error('Full-resolution source video is unavailable.');
    const limit = effect.params.temporalStorage === 'hybrid' ? hybridTemporalSampleLimit(media.width, media.height) : 256;
    const request: SourceTemporalRequest = { key: JSON.stringify([scopeId, effect.id]), effectId: effect.id, media, source,
      horizon: Math.max(0, Math.min(4, Number(effect.params.delay ?? 1))), samples: Math.max(2, Math.min(limit, Math.round(Number(effect.params.temporalSamples ?? 32)) || 32)),
      nearest: effect.params.temporalInterpolation === 'nearest', encoder, currentInput, keepPending: useTimelineStore.getState().isPlaying,
      useProxy: useMediaStore.getState().proxyEnabled && !isCollectingTemporalPreparations(),
      stabilization: slitScanStabilization(effect.params, useTrackingStore.getState().assets, source.mediaId, media.width!, media.height!),
      maxEdge: effect.params.temporalResolution === 'native' ? undefined : 160 };
    const hybrid = effect.params.temporalStorage === 'hybrid';
    if (hybrid) this.native.release(request.key); else this.hybrid?.release(request.key);
    const resolve = (input: SourceTemporalRequest) => {
      if (!hybrid) return this.native.resolve(input);
      if (!hybridContext) throw new Error('Hybrid graph context is unavailable.');
      this.hybrid ??= new HybridTemporalRuntime(this.device, this.onReady);
      return this.hybrid.resolve(input, hybridContext);
    };
    try {
      // Validate before replacing the cache, so an unavailable track does not
      // evict the working, unstabilized history on every preview frame.
      if (request.stabilization) {
        slitScanSourceTransform(request.stabilization, temporalSourceTime(source, source.localTime));
        if (request.horizon > 0) for (const sample of sourceTemporalWindow(request, limit)) {
          slitScanSourceTransform(request.stabilization, sample.time);
        }
      }
      return resolve(request);
    }
    catch (error) {
      if (!(error instanceof SlitScanTrackingGap)) throw error;
      // One coordinate space for the whole window: never mix corrected and raw
      // frames. Preview and export use the same fallback for tracking gaps;
      // export still waits for every requested source frame in the collector.
      const history = resolve({ ...request, stabilization: undefined });
      setTemporalStatus(effect.id, `Stabilization paused: ${error.message} Slit Scan remains active.`);
      return history ? { ...history, current: currentInput ? { view: currentInput.view, identity: 'unstabilized-input' } : undefined } : undefined;
    }
  }

  resolveNamed(resources: Map<string, ResolvedImageGraphExternalResource>, requested: readonly string[],
    effect: { id: string; params: Record<string, unknown> }, scopeId: string,
    time: number, masks: readonly ClipMask[] | undefined, width: number, height: number, encoder: GPUCommandEncoder) {
    const key = JSON.stringify([scopeId, effect.id]);
    if (requested.includes(SLIT_SCAN_TIME_MAP_RESOURCE)) {
      const mediaId = effect.params.mapMediaId;
      let map: ResolvedImageGraphExternalResource | undefined;
      if (typeof mediaId === 'string' && mediaId) {
        const media = useMediaStore.getState().files.find(file => file.id === mediaId);
        if (!media) {
          setTemporalStatus(effect.id, 'Time map asset is missing. Select an available image or video.');
          throw new Error('Time map asset is missing.');
        }
        map = this.maps.resolve(key, effect.id, media, time - Number(effect.params.mapStart ?? 0), encoder);
      }
      resources.set(SLIT_SCAN_TIME_MAP_RESOURCE, map ?? this.masks.resolve('empty-map', '', undefined, width, height, encoder));
    }
    if (requested.includes(SLIT_SCAN_PROTECTION_RESOURCE)) {
      resources.set(SLIT_SCAN_PROTECTION_RESOURCE,
        this.masks.resolve(key, effect.params.protectionMask, masks, width, height, encoder));
    }
  }

  destroy() { this.native.destroy(); this.hybrid?.destroy(); this.maps.destroy(); this.masks.destroy(); }
}
