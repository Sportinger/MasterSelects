import { surfaceFrameIndex } from '../../services/planarTracking/surfaceFrameReader';
import { sourceFrameService, type SourceFrameLease, type SourceFrameResource } from '../../services/mediaRuntime/sourceFrames/SourceFrameService';
import type { SourceFrameReader } from '../../services/mediaRuntime/sourceFrames/SourceFrameReader';
import { TemporalFrameUploader } from '../../engine/texture/TemporalFrameUploader';
import type { MediaFile } from '../../stores/mediaStore/types';
import { temporalSourceTime, type TemporalClipSource } from './temporalClipSource';
import { recordTemporalPreparation, setTemporalStatus } from './temporalResourcePreparation';
import { SourceProxyDimensions } from './SourceProxyDimensions';
import { SlitScanTrackingGap, slitScanSourceTransform, type SlitScanStabilization } from './slit-scan/stabilization';
import { StabilizedCurrentFrame } from './StabilizedCurrentFrame';
import { MAX_SOURCE_TEMPORAL_SAMPLES, SOURCE_TEMPORAL_METADATA_WIDTH } from './sourceTemporalLimits';

export interface SourceTemporalRequest {
  key: string; effectId: string; media: MediaFile; source: TemporalClipSource;
  horizon: number; samples: number; nearest: boolean; encoder: GPUCommandEncoder;
  /** Explicit delays relative to this output frame, independent of the Slit Scan grid. */
  delays?: readonly number[];
  /** Source lookback expands; graph delay coordinates stay in authored seconds. */
  timeFactor?: number;
  keepPending?: boolean; maxEdge?: number; useProxy?: boolean;
  /** Optional capacity plan for a resident interactive window as playback advances. */
  reserveFrames?: number;
  /** Own the current input when a resident result is held across render frames. */
  retainCurrentInput?: boolean;
  /** Analysis reads decoded source PTS even at zero delay, never the composite input. */
  sourceOnly?: boolean;
  /** Include a real adjacent source frame for cached dense motion analysis. */
  motionPairs?: boolean;
  /** Trajectory consumers need every intermediate PTS and the next endpoint. */
  motionTrajectories?: boolean;
  /** Geometry requires a complete color/query package rather than a partial cache. */
  completeWindow?: boolean;
  stabilization?: SlitScanStabilization;
  currentInput?: { view: GPUTextureView; width: number; height: number };
}

/** Absolute clip-time grid: adjacent output frames share the same historical PTS.
 * Slot -1 is the current input, already decoded by the normal playback pipeline. */
export function sourceTemporalWindow(request: Pick<SourceTemporalRequest, 'source' | 'horizon' | 'samples' | 'delays'>, limit = MAX_SOURCE_TEMPORAL_SAMPLES) {
  if (request.delays) {
    if (request.delays.length >= limit || request.delays.some(age => !Number.isFinite(age) || age <= 0)) {
      throw new Error('Source delays must be finite, positive and fit the temporal sample limit.');
    }
    return [...new Set(request.delays)].toSorted((a, b) => a - b)
      .map(age => ({ age, time: temporalSourceTime(request.source, request.source.localTime - age) }));
  }
  if (request.samples <= 2) return [{ age: request.horizon,
    time: temporalSourceTime(request.source, request.source.localTime - request.horizon) }];
  const count = Math.max(3, Math.min(limit, Math.round(request.samples)));
  const step = Math.max(request.horizon, 0.00001) / (count - 2);
  const time = request.source.localTime;
  const tick = Math.floor(time / step + 1e-8);
  return Array.from({ length: count - 1 }, (_, index) => {
    const localTime = (tick - index) * step;
    return { age: Math.max(0, time - localTime), time: temporalSourceTime(request.source, localTime) };
  });
}

interface Entry {
  media: MediaFile; width: number; height: number; bytes: number; layers: number; prefetchCount: number; proxyFps?: number;
  abort: AbortController; lease: SourceFrameLease; reader?: SourceFrameReader;
  pending?: Promise<void>; pendingKeys?: Set<number>; prefetch?: Promise<void>; error?: Error;
  retryAt?: number; retryTimer?: ReturnType<typeof setTimeout>; currentFrame?: StabilizedCurrentFrame;
  atlas: GPUTexture; ages: GPUTexture; slots: Map<number, number>; proxyTimes: Set<number>; revision: number;
  latest: SourceTemporalRequest; encoder: GPUCommandEncoder;
}

/** Source-frame cache, never a history of what happened to play on screen.
 * The graph samples the resident array directly; no CPU/GPU image baking per frame. */
export class SourceTemporalRuntime {
  private entries = new Map<string, Entry>();
  private readonly budget = 640 * 1024 * 1024;
  private device: GPUDevice;
  private onReady?: () => void;
  private uploader: TemporalFrameUploader;
  private proxyDimensions = new SourceProxyDimensions();
  constructor(device: GPUDevice, onReady?: () => void) {
    this.device = device; this.onReady = onReady; this.uploader = new TemporalFrameUploader(device);
  }

  resolve(request: SourceTemporalRequest) {
    const proxyFps = (request.maxEdge || request.useProxy) && request.media.proxyFormat !== 'mp4-all-intra'
      && ['ready', 'generating'].includes(request.media.proxyStatus ?? '')
      && !/prores|hap/i.test(request.media.codec ?? '') ? request.media.proxyFps : undefined;
    const proxySize = request.useProxy && !request.maxEdge && proxyFps
      ? this.proxyDimensions.resolve(request.media, proxyFps, this.onReady) : undefined;
    if (proxySize === null) { setTemporalStatus(request.effectId, 'Full size · Proxy: reading resolution…'); return undefined; }
    const sourceWidth = proxySize?.width ?? request.media.width!, sourceHeight = proxySize?.height ?? request.media.height!;
    const scale = request.maxEdge ? Math.min(1, request.maxEdge / Math.max(sourceWidth, sourceHeight)) : 1;
    const width = Math.round(sourceWidth * scale), height = Math.round(sourceHeight * scale);
    if (!(width > 0 && height > 0) || Math.max(width, height) > this.device.limits.maxTextureDimension2D) {
      throw new Error('Source dimensions exceed this GPU\'s texture limit. Use Small preview.');
    }
    // Stabilization also owns the current PTS: every temporal sample must share
    // the reference coordinate space, including zero delay and the Mix input.
    const currentCount = request.stabilization && !request.currentInput ? 1 : 0;
    const currentBytes = request.stabilization && request.currentInput ? request.currentInput.width * request.currentInput.height * 4 : 0;
    const zeroDelay = request.horizon === 0 && !!request.currentInput;
    const historyCount = zeroDelay ? 1 : Math.max(2, Math.min(MAX_SOURCE_TEMPORAL_SAMPLES, Math.round(request.samples))) - 1 + currentCount;
    // Reserve only the requested history, plus as much optional prefetch as fits.
    // Two frame-sized allowances cover upload scratch/storage outside the atlas.
    const capacity = Math.min(this.device.limits.maxTextureArrayLayers ?? 256,
      Math.floor((this.budget - currentBytes) / (width * height * 4)) - 2);
    if (historyCount > capacity) {
      this.release(request.key);
      throw new Error(`Full Res ${width} × ${height} with ${historyCount + 1 - currentCount} samples exceeds the 640 MiB source cache. `
        + (capacity >= 1 ? `Choose at most ${capacity + 1 - currentCount} samples or Small preview.` : 'Use Small preview.'));
    }
    const prefetchCount = zeroDelay || request.delays ? 0 : Math.min(4, capacity - historyCount);
    const layers = historyCount + prefetchCount;
    const bytes = width * height * 4 * (layers + 2) + currentBytes;
    let entry = this.entries.get(request.key);
    if (entry?.error && performance.now() >= (entry.retryAt ?? 0)) { this.release(request.key); entry = undefined; }
    if (entry && (entry.media.url !== request.media.url || entry.media.file !== request.media.file
      || entry.width !== width || entry.height !== height || entry.layers !== layers || entry.bytes !== bytes
      || entry.prefetchCount !== prefetchCount || entry.proxyFps !== proxyFps
      || entry.latest.stabilization?.identity !== request.stabilization?.identity)) { this.release(request.key); entry = undefined; }
    if (!entry) {
      for (const [key, old] of this.entries) {
        if (this.residentBytes() + bytes <= this.budget) break;
        if (old.encoder !== request.encoder) this.release(key);
      }
      if (this.residentBytes() + bytes > this.budget) throw new Error('Concurrent source caches exceed the 640 MiB budget.');
      entry = { media: request.media, width, height, bytes, layers, prefetchCount, proxyFps, abort: new AbortController(),
        slots: new Map(), proxyTimes: new Set(), revision: 0,
        lease: sourceFrameService.acquire(request.media),
        atlas: this.device.createTexture({ label: 'source-PTS-cache', size: [width, height, layers], format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT }),
        ages: this.device.createTexture({ size: [SOURCE_TEMPORAL_METADATA_WIDTH, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }),
        latest: request, encoder: request.encoder };
      this.entries.set(request.key, entry);
    }
    entry.latest = request; entry.encoder = request.encoder;
    if (entry.error) throw entry.error;
    let presented = request.currentInput && !request.stabilization
      ? { view: request.currentInput.view, identity: 'current-input' } : undefined;
    if (request.stabilization && request.currentInput) {
      const { view, width: inputWidth, height: inputHeight } = request.currentInput;
      const time = temporalSourceTime(request.source, request.source.localTime);
      const matrix = slitScanSourceTransform(request.stabilization, time);
      if (entry.currentFrame?.width !== inputWidth || entry.currentFrame.height !== inputHeight) {
        entry.currentFrame?.destroy();
        entry.currentFrame = new StabilizedCurrentFrame(this.device, inputWidth, inputHeight);
      }
      presented = { view: entry.currentFrame.encode(request.encoder, view, matrix), identity: `${request.stabilization.identity}:${time}` };
    }
    const wanted = entry.reader ? this.wanted(entry, request) : undefined;
    const ready = wanted?.every(item => entry!.slots.has(item.time));
    if (!ready && entry.prefetch) entry.lease.cancel();
    if (!ready && wanted && entry.pendingKeys && entry.pending
      && !wanted.every(item => entry!.slots.has(item.time) || entry!.pendingKeys!.has(item.time))
      && (!request.keepPending || !wanted.some(item => entry!.pendingKeys!.has(item.time)))) entry.lease.cancel();
    if (!ready && !entry.pending) {
      const owner = entry;
      owner.pending = this.prepare(owner).catch(error => {
        if (owner.abort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
        // Coverage is a property of this requested window, not a permanent decoder failure.
        if (error instanceof SlitScanTrackingGap) throw error;
        owner.error = error instanceof Error ? error : new Error(String(error));
        this.retry(owner);
        setTemporalStatus(request.effectId, owner.error.message); throw owner.error;
      }).finally(() => { owner.pending = undefined; owner.pendingKeys = undefined; this.onReady?.(); });
      void owner.pending.catch(() => undefined);
    }
    if (!ready) recordTemporalPreparation(entry.pending!);
    if (!ready && request.completeWindow) return undefined;
    if (ready && !entry.pending && !entry.prefetch) this.prefetch(entry);
    if ((!wanted || !entry.slots.size) && !presented) return undefined;
    // During a cache miss preview can use only resident source frames. Export waits
    // for the exact window through the preparation barrier above.
    const current = request.stabilization && !presented ? wanted?.[0] : undefined;
    if (current && !entry.slots.has(current.time)) return undefined;
    const available = (current ? wanted!.slice(1) : wanted ?? []).filter(item => entry!.slots.has(item.time));
    const data = new Float32Array(SOURCE_TEMPORAL_METADATA_WIDTH * 4);
    data[1] = -1;
    for (const [i, sample] of available.entries()) {
      data[(i + 1) * 4] = sample.age / (request.timeFactor ?? 1); data[(i + 1) * 4 + 1] = entry.slots.get(sample.time)!;
    }
    const header = MAX_SOURCE_TEMPORAL_SAMPLES * 4;
    data[header] = available.length + 1; data[header + 1] = Number(request.nearest); data[header + 2] = 3;
    this.device.queue.writeTexture({ texture: entry.ages }, data, { bytesPerRow: SOURCE_TEMPORAL_METADATA_WIDTH * 16 }, [SOURCE_TEMPORAL_METADATA_WIDTH, 1]);
    if (ready) {
      const proxyCount = available.filter(sample => entry!.proxyTimes.has(sample.time)).length;
      const source = !available.length && presented ? 'Current input' : proxyCount === available.length ? 'Proxy' : proxyCount ? 'Proxy + original' : 'Original';
      setTemporalStatus(request.effectId, `${request.maxEdge ? 'Small preview' : 'Full size'} · ${source} · ${width} × ${height} · source cache ready`);
    }
    const identity = JSON.stringify([request.key, request.stabilization?.identity, current?.time, entry.revision, available, request.nearest, request.timeFactor]);
    return { current: presented ?? (current ? { view: entry.atlas.createView({ dimension: '2d', baseArrayLayer: entry.slots.get(current.time)!, arrayLayerCount: 1 }), identity } : undefined),
      atlas: { view: entry.atlas.createView({ dimension: '2d-array' }), identity },
      ages: { view: entry.ages.createView(), identity, temporalSamples: {
        interpolation: request.nearest ? 'nearest' as const : 'linear' as const,
        samples: [{ delay: 0, currentInput: true, contributions: [] }, ...available.map(sample => ({
          delay: sample.age / (request.timeFactor ?? 1), currentInput: false,
          contributions: [{ sourceTime: sample.time, weight: 1 }],
        }))],
      } } };
  }

  private wanted(entry: Entry, request: SourceTemporalRequest) {
    const samples = request.currentInput && request.horizon === 0 ? [] : sourceTemporalWindow(request);
    if (request.stabilization && !request.currentInput) samples.unshift({ age: 0, time: temporalSourceTime(request.source, request.source.localTime) });
    const wanted = samples.map(sample => ({ ...sample,
      time: entry.reader!.frames[Math.max(0, surfaceFrameIndex(entry.reader!.frames, sample.time))].time }));
    if (request.stabilization) for (const sample of wanted) slitScanSourceTransform(request.stabilization, sample.time);
    return wanted;
  }

  private async prepare(entry: Entry) {
    const signal = entry.abort.signal;
    entry.reader ??= await entry.lease.ready;
    signal.throwIfAborted();
    const request = entry.latest;
    const proxyFps = entry.proxyFps;
    const keys = new Set(this.wanted(entry, request).map(item => item.time));
    entry.pendingKeys = keys;
    const missing = [...keys].filter(time => !entry.slots.has(time));
    let completed = 0;
    if (missing.length) {
      const label = `${request.maxEdge ? 'Small preview' : 'Full size'} · ${proxyFps ? 'Proxy / original fallback' : 'Original'} · ${entry.width} × ${entry.height}`;
      setTemporalStatus(request.effectId, `${label} · loading (0/${missing.length})…`);
      await entry.lease.request({ times: missing, priority: 'required', signal, proxyFps, onFrame: frame => {
        this.upload(entry, frame, keys); completed++;
        setTemporalStatus(entry.latest.effectId, `${label} · loading (${completed}/${missing.length})…`);
        if (completed % 8 === 0) this.onReady?.();
      } });
    }
    signal.throwIfAborted();
  }

  private prefetch(entry: Entry) {
    const request = entry.latest, signal = entry.abort.signal, proxyFps = entry.proxyFps;
    // Replenish on every advancing window, including fully resident windows.
    // Waiting for the next miss exhausts lookahead in periodic four-frame bursts.
    // Prefetch stays outside the export/seek preparation barrier.
    if (request.keepPending && request.horizon > 0 && request.samples > 2 && entry.prefetchCount) {
      const keys = new Set(this.wanted(entry, request).map(item => item.time));
      const step = Math.max(request.horizon, 0.00001) / (Math.min(MAX_SOURCE_TEMPORAL_SAMPLES, request.samples) - 2);
      const tick = Math.floor(request.source.localTime / step + 1e-8);
      const future = new Set<number>();
      for (let i = 1; i <= entry.prefetchCount; i++) {
        const time = temporalSourceTime(request.source, (tick + i) * step);
        future.add(entry.reader!.frames[Math.max(0, surfaceFrameIndex(entry.reader!.frames, time))].time);
      }
      const pending = [...future].filter(time => {
        if (entry.slots.has(time)) return false;
        try { if (request.stabilization) slitScanSourceTransform(request.stabilization, time); return true; }
        catch (error) { if (error instanceof SlitScanTrackingGap) return false; throw error; }
      });
      if (pending.length) entry.prefetch = entry.lease.request({ times: pending, priority: 'prefetch', signal, proxyFps,
        onFrame: frame => this.upload(entry, frame, new Set([...keys, ...future])),
      }).catch(error => {
        if (!signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) {
          entry.error = error instanceof Error ? error : new Error(String(error));
          this.retry(entry);
        }
      }).finally(() => { entry.prefetch = undefined; this.onReady?.(); });
    }
  }

  private upload(entry: Entry, frame: SourceFrameResource, required: ReadonlySet<number>) {
    if (entry.slots.has(frame.time)) return;
    let slot = Array.from({ length: entry.layers }, (_, i) => i).find(i => ![...entry.slots.values()].includes(i));
    if (slot === undefined) {
      const eviction = [...entry.slots].find(([time]) => !required.has(time));
      if (!eviction) throw new Error('Source cache has no recyclable slot.');
      slot = eviction[1]; entry.slots.delete(eviction[0]); entry.proxyTimes.delete(eviction[0]);
    }
    this.uploader.upload(frame, entry.atlas, slot, entry.latest.stabilization
      ? slitScanSourceTransform(entry.latest.stabilization, frame.time) : undefined);
    if ('image' in frame) entry.proxyTimes.add(frame.time);
    entry.slots.set(frame.time, slot); entry.revision++;
  }

  private residentBytes() { return [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0); }
  private retry(entry: Entry) {
    entry.retryAt = performance.now() + 1000;
    clearTimeout(entry.retryTimer);
    entry.retryTimer = setTimeout(() => this.onReady?.(), 1010);
  }
  release(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    clearTimeout(entry.retryTimer); entry.currentFrame?.destroy();
    entry.abort.abort(); entry.lease.release(); entry.atlas.destroy(); entry.ages.destroy(); this.entries.delete(key);
  }
  destroy() { for (const key of this.entries.keys()) this.release(key); this.uploader.destroy(); this.proxyDimensions.destroy(); }
}
