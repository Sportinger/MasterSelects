import type { MediaFile } from '../../stores/mediaStore/types';
import type { ImageOperatorPlan } from '../../services/operators/imageOperatorGraph';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';
import { ImageGraphPassRuntime } from '../ImageGraphPassRuntime';
import { openSurfaceFrames } from '../../services/planarTracking/surfaceFrameReader';
import { PreparedFrameCache } from './PreparedFrameCache';
import { StreamedTemporalCompositor } from './StreamedTemporalCompositor';
import { TemporalDemandReadback } from './TemporalDemandReadback';
import { preparedTemporalWindow } from './preparedTemporalWindow';
import { temporalSourceTime, type TemporalClipSource } from './temporalClipSource';
import { recordTemporalPreparation, setTemporalStatus } from './temporalResourcePreparation';

interface Entry {
  media: MediaFile; effectId: string; abort: AbortController; reader?: PreparedFrameCache;
  pending?: Promise<void>; signature?: string; error?: Error; output?: GPUTexture;
  requestedSignature?: string; keepPending?: boolean;
  demand?: GPUTexture; upload?: GPUTexture; ages: GPUTexture;
  resources?: { atlas: ResolvedImageGraphExternalResource; ages: ResolvedImageGraphExternalResource };
  encoder: GPUCommandEncoder; reserved: number;
}
export interface NativeTemporalRequest {
  key: string; effectId: string; media: MediaFile; source: TemporalClipSource;
  horizon: number; samples: number; nearest: boolean;
  demandPlan: ImageOperatorPlan; externalResources: ReadonlyMap<string, ResolvedImageGraphExternalResource>;
  encoder: GPUCommandEncoder; inputView: GPUTextureView; sampler: GPUSampler; timelineTime: number;
  keepPending?: boolean;
  maxEdge?: number;
}

/** Stream full-resolution source frames into one result, keeping at most two CPU frames.
 * The native demand image contains exact authored UV/time requests, so no screen-space
 * strip assumption and no reduction in requested temporal samples are necessary.
 */
export class NativeTemporalRuntime {
  private device: GPUDevice;
  private onReady?: () => void;
  private entries = new Map<string, Entry>();
  private demandRenderer: ImageGraphPassRuntime;
  private compositor: StreamedTemporalCompositor;
  private demandReadback: TemporalDemandReadback;
  constructor(device: GPUDevice, onReady?: () => void) {
    this.device = device; this.onReady = onReady;
    this.demandRenderer = new ImageGraphPassRuntime(device);
    this.compositor = new StreamedTemporalCompositor(device);
    this.demandReadback = new TemporalDemandReadback(device);
  }

  resolve(request: NativeTemporalRequest) {
    const { key, media, source, horizon, samples, nearest, encoder, effectId, demandPlan } = request;
    const sourceWidth = media.width ?? 0, sourceHeight = media.height ?? 0;
    const scale = request.maxEdge ? Math.min(1, request.maxEdge / Math.max(sourceWidth, sourceHeight)) : 1;
    const width = Math.round(sourceWidth * scale), height = Math.round(sourceHeight * scale);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || Math.max(width, height) > this.device.limits.maxTextureDimension2D) {
      throw new Error('Full-resolution preparation requires valid source dimensions within the GPU texture limit.');
    }
    // Demand RGBA32F + result RGBA16F + previous result + upload RGBA8 + two CPU RGBA8.
    const reserved = width * height * 44 + 65 * 16;
    const budget = 512 * 1024 * 1024;
    if (reserved > budget) throw new Error('Full-resolution source exceeds the 512 MiB streaming budget.');
    const window = preparedTemporalWindow({ localTime: source.localTime, duration: source.duration,
      horizon, samples, direction: 'past', sourceTimeAt: time => temporalSourceTime(source, time) });
    const signature = JSON.stringify([window, width, height, horizon, nearest, demandPlan.key, demandPlan.values,
      request.timelineTime, [...request.externalResources].filter(([id]) => demandPlan.resourceInputs?.includes(id)).map(([id, resource]) => [id, resource.identity])]);
    let entry = this.entries.get(key);
    if (entry && (entry.media.url !== media.url || entry.media.file !== media.file || entry.media.id !== media.id || entry.reserved !== reserved)) {
      if (entry.encoder === encoder) throw new Error('Native temporal source changed within an unsubmitted render.');
      this.remove(key); entry = undefined;
    }
    if (!entry) {
      for (const [oldKey, old] of this.entries) {
        if ([...this.entries.values()].reduce((sum, item) => sum + item.reserved, 0) + reserved <= budget) break;
        if (old.encoder !== encoder) this.remove(oldKey);
      }
      if ([...this.entries.values()].reduce((sum, item) => sum + item.reserved, 0) + reserved > budget) {
        throw new Error('Simultaneous full-resolution temporal sources exceed the 512 MiB streaming budget.');
      }
      const ages = this.device.createTexture({ size: [65, 1], format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      const metadata = new Float32Array(65 * 4); metadata[256] = 1; metadata[258] = 2;
      this.device.queue.writeTexture({ texture: ages }, metadata, { bytesPerRow: 65 * 16 }, [65, 1]);
      entry = { media: { ...media }, effectId, abort: new AbortController(), ages, encoder, reserved };
      this.entries.set(key, entry);
    }
    entry.encoder = encoder;
    entry.requestedSignature = signature; entry.keepPending = request.keepPending;
    if (entry.error) throw entry.error;
    if (entry.signature === signature && entry.resources) return entry.resources;
    if (!entry.pending) {
      const owner = entry;
      const demand = this.device.createTexture({ label: 'native-temporal-demand', size: [width, height], format: 'rgba32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      owner.demand = demand;
      this.demandRenderer.encode({ encoder, sampler: request.sampler, source: { kind: 'texture', view: request.inputView },
        width, height, timelineTimeSeconds: request.timelineTime,
        plan: demandPlan.passes?.length || demandPlan.resourceInputs?.length ? demandPlan : { ...demandPlan,
          passes: [{ id: 'native-demand-output', program: demandPlan, inputResources: [] }] },
        outputView: demand.createView(), outputFormat: 'rgba32float', instanceId: key,
        externalResources: request.externalResources });
      const readDemand = this.demandReadback.encode(encoder, demand.createView(), width, height, samples, horizon, nearest);
      setTemporalStatus(effectId, `Preparing source frames (0/${samples})…`);
      owner.pending = this.prepare(owner, request, window.map(sample => sample.sourceTime), signature, width, height, readDemand)
        .catch(error => {
          if (owner.abort.signal.aborted) return;
          if (error instanceof DOMException && error.name === 'AbortError') return;
          owner.error = error instanceof Error ? error : new Error(String(error));
          setTemporalStatus(effectId, owner.error.message); throw owner.error;
        }).finally(() => { owner.demand?.destroy(); owner.demand = undefined; owner.pending = undefined; this.onReady?.(); });
      void owner.pending.catch(() => undefined);
    }
    recordTemporalPreparation(entry.pending!);
    // Preview holds the last completed effect image during a new seek/decode.
    // Export still observes the pending promise and retries before capture.
    return entry.resources;
  }

  private async prepare(owner: Entry, request: NativeTemporalRequest, times: number[], signature: string, width: number, height: number,
    readDemand: () => Promise<number[]>) {
    // Let the caller submit the demand pass before any streamed contribution.
    await Promise.resolve();
    const requestedIndices = await readDemand();
    const signal = owner.abort.signal;
    const check = () => {
      signal.throwIfAborted();
      if (!owner.keepPending && owner.requestedSignature !== signature) throw new DOMException('Temporal request superseded.', 'AbortError');
    };
    check();
    if (!owner.reader) {
      const reader = await openSurfaceFrames(request.media.url, signal, request.media.file, Math.max(width, height));
      signal.throwIfAborted();
      owner.reader = new PreparedFrameCache(reader, width * height * 8, width * height * 4);
    }
    check();
    const device = this.device;
    const output = device.createTexture({ label: 'native-temporal-result', size: [width, height], format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const upload = device.createTexture({ label: 'native-temporal-stream', size: [width, height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    owner.upload = upload;
    const outputView = output.createView(), uploadView = upload.createView(), demandView = owner.demand!.createView();
    try {
      // Decode in source order to avoid repeatedly seeking backwards through GOPs.
      const ordered = requestedIndices.map(index => ({ time: times[index], index })).toSorted((a, b) => a.time - b.time);
      for (const [completed, item] of ordered.entries()) {
        check();
        const [frame] = await owner.reader.prepare([item.time], signal);
        check();
        if (frame.pixels.width !== width || frame.pixels.height !== height) throw new Error('Decoded native dimensions do not match source metadata.');
        device.queue.writeTexture({ texture: upload }, frame.pixels.data as Uint8ClampedArray<ArrayBuffer>, { bytesPerRow: width * 4 }, [width, height]);
        await this.compositor.accumulate(uploadView, demandView, outputView, request.sampler, item.index,
          times.length, request.horizon, request.nearest, completed === 0);
        check();
        setTemporalStatus(owner.effectId, `Preparing source frames (${completed + 1}/${ordered.length})…`);
      }
      owner.output?.destroy(); owner.output = output; owner.signature = signature;
      owner.resources = { atlas: { view: output.createView({ dimension: '2d-array' }), identity: `${request.key}:${signature}:native` },
        ages: { view: owner.ages.createView(), identity: 'native-temporal-result' } };
      setTemporalStatus(owner.effectId, `${request.maxEdge ? 'Preview' : 'Full resolution'}: ${width} × ${height} · ${requestedIndices.length}/${times.length} samples needed`);
    } catch (error) { output.destroy(); throw error; }
    finally { upload.destroy(); owner.upload = undefined; owner.demand?.destroy(); owner.demand = undefined; }
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.abort.abort(); entry.reader?.close(); entry.output?.destroy(); entry.demand?.destroy(); entry.upload?.destroy(); entry.ages.destroy();
    this.entries.delete(key); setTemporalStatus(entry.effectId, '');
  }
  release(key: string) { this.remove(key); }
  destroy() { for (const key of this.entries.keys()) this.remove(key); this.demandRenderer.dispose(); }
}
