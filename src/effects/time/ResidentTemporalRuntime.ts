import { sourceFrameService, type SourceFrameLease } from '../../services/mediaRuntime/sourceFrames/SourceFrameService';
import { temporalSampleMetadata } from './TemporalSampleMetadata';
import type { SourceFrameReader } from '../../services/mediaRuntime/sourceFrames/SourceFrameReader';
import { TemporalFrameUploader } from '../../engine/texture/TemporalFrameUploader';
import type { SourceTemporalRequest } from './SourceTemporalRuntime';
import { hybridTemporalWindow } from './hybridTemporalWindow';
import { ResidentTemporalCapacityError, residentTemporalLayout, residentTemporalMetadata } from './residentTemporalLayout';
import { isCollectingTemporalPreparations, recordTemporalPreparation, setTemporalStatus } from './temporalResourcePreparation';
import { StabilizedCurrentFrame } from './StabilizedCurrentFrame';
import { slitScanSourceTransform } from './slit-scan/stabilization';
import { temporalSourceTime } from './temporalClipSource';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';
import { slitScanPlaybackLookahead } from './slit-scan/playbackLookahead';
import { adjacentMotionPairs, disMotionMetadata, type ResidentMotionFrames } from './residentMotionFrames';

interface ResidentResult {
  current: ResolvedImageGraphExternalResource;
  atlas: ResolvedImageGraphExternalResource;
  ages: ResolvedImageGraphExternalResource;
  motion?: ResidentMotionFrames;
}

interface Cache {
  atlas: GPUTexture; ages: GPUTexture; metadataWidth: number;
  columns: number; rows: number; layers: number; capacity: number; bytes: number;
  slots: Map<number, number>; revision: number; current?: StabilizedCurrentFrame;
}
interface Entry {
  identity: string; lease: SourceFrameLease; abort: AbortController; reader?: SourceFrameReader; cache?: Cache;
  pending?: Promise<void>; pendingKeys?: Set<number>; prefetch?: Promise<void>; prefetchKeys?: Set<number>; error?: Error;
  noHeadroom?: boolean;
  retryAt?: number; retryTimer?: ReturnType<typeof setTimeout>;
  latest: SourceTemporalRequest; encoder: GPUCommandEncoder;
  pinned?: Promise<void>;
}

/** TouchDesigner-style resident video history. Keep source PTS on the GPU and
 * recycle only slots outside the active window. Never stream partial windows
 * through repeated output passes; fail explicitly when the full window cannot fit.
 */
export class ResidentTemporalRuntime {
  private device: GPUDevice;
  private uploader: TemporalFrameUploader;
  private entries = new Map<string, Entry>();
  private onReady?: () => void;
  constructor(device: GPUDevice, onReady?: () => void) {
    this.device = device; this.onReady = onReady; this.uploader = new TemporalFrameUploader(device);
  }

  resolve(request: SourceTemporalRequest, memoryMiB: number): ResidentResult | undefined {
    if (!request.currentInput) throw new Error('GPU history requires the current source input.');
    const scale = request.maxEdge ? Math.min(1, request.maxEdge / Math.max(request.media.width!, request.media.height!)) : 1;
    const width = Math.round(request.media.width! * scale), height = Math.round(request.media.height! * scale);
    const budget = memoryMiB * 1024 * 1024;
    const identity = JSON.stringify([request.media.id, request.media.url, width, height, memoryMiB,
      request.sourceOnly ? null : [request.currentInput.width, request.currentInput.height],
      request.stabilization?.identity, request.retainCurrentInput, request.sourceOnly, request.motionPairs]);
    let entry = this.entries.get(request.key);
    if (entry && (entry.identity !== identity || entry.latest.media.file !== request.media.file)) { this.release(request.key); entry = undefined; }
    if (entry?.error && !(entry.error instanceof ResidentGpuMemoryError) && performance.now() >= (entry.retryAt ?? Infinity)) {
      if (!entry.reader) { this.release(request.key); entry = undefined; }
      else { entry.error = undefined; clearTimeout(entry.retryTimer); }
    }
    if (!entry) {
      entry = { identity, lease: sourceFrameService.acquire(request.media), abort: new AbortController(), latest: request, encoder: request.encoder };
      this.entries.set(request.key, entry);
    }
    entry.latest = request; entry.encoder = request.encoder;
    if (entry.error && (!entry.reader || !entry.cache || entry.error instanceof ResidentGpuMemoryError
      || isCollectingTemporalPreparations())) throw entry.error;
    if (!entry.reader) {
      const owner = entry;
      owner.pending ??= this.pending(owner, owner.lease.ready.then(reader => { owner.reader = reader; }));
      setTemporalStatus(request.effectId, 'GPU history · indexing source…');
      recordTemporalPreparation(owner.pending); return undefined;
    }
    const window = hybridTemporalWindow(request, entry.reader.frames);
    const pairs = request.motionPairs ? adjacentMotionPairs(window.times, entry.reader.frames, request.source, request.motionTrajectories) : undefined;
    if (pairs) {
      const indexed = new Set(window.times);
      for (const [from, to] of pairs) for (const time of [from, to]) {
        if (!indexed.has(time)) { window.times.push(time); indexed.add(time); }
      }
    }
    if (request.stabilization) for (const time of window.times) slitScanSourceTransform(request.stabilization, time);
    const metadataWidth = window.metadata.length / 4;
    if (metadataWidth > this.device.limits.maxTextureDimension2D) throw new Error('GPU history metadata exceeds the device texture dimension limit.');
    if (!entry.cache) {
      const fixedBytes = width * height * 8 + (8192 + 1) * 32 +
        (!request.sourceOnly && (request.stabilization || request.retainCurrentInput) ? request.currentInput.width * request.currentInput.height * 4 : 0);
      const layout = residentTemporalLayout(width, height, window.times.length,
        Math.min(entry.reader.frames.length, entry.noHeadroom ? window.times.length : Math.max(request.reserveFrames ?? 0,
          window.times.length + Math.max(4, Math.ceil(window.times.length / 4)))),
        budget, fixedBytes, this.device.limits.maxTextureDimension2D, this.device.limits.maxTextureArrayLayers);
      for (const [key, old] of this.entries) {
        if (this.bytes() + layout.bytes <= budget) break;
        if (old !== entry && !old.pinned && old.encoder !== request.encoder) this.release(key);
      }
      if (this.bytes() + layout.bytes > budget) throw new ResidentTemporalCapacityError('Concurrent GPU histories exceed History memory.');
      const owner = entry;
      owner.pending = this.pending(owner, this.checkedGpuOperation(() => {
        owner.cache = { ...layout, slots: new Map(), revision: 0, metadataWidth,
          atlas: this.device.createTexture({ label: 'resident-video-volume', size: [width * layout.columns, height * layout.rows, layout.layers],
            format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
          ages: this.metadataTexture(metadataWidth) };
      }).catch(async error => {
        if (!(error instanceof ResidentGpuMemoryError) || owner.noHeadroom) throw error;
        owner.noHeadroom = true;
        if (owner.cache) await this.disposeCache(owner.cache);
        owner.cache = undefined;
      }));
      setTemporalStatus(request.effectId, 'GPU history · allocating source window…');
      recordTemporalPreparation(owner.pending); return undefined;
    }
    const cache = entry.cache;
    if (window.times.length > cache.capacity) {
      // A changed sample count can need a larger allocation. Replan without losing
      // the reader/lease; allocation still has to satisfy the explicit budget.
      if (entry.pending || entry.prefetch) { entry.lease.cancel(); recordTemporalPreparation(entry.pending ?? entry.prefetch!); return undefined; }
      const owner = entry;
      owner.pending = this.pending(owner, this.disposeCache(cache).then(() => { owner.cache = undefined; }));
      recordTemporalPreparation(owner.pending); return undefined;
    }
    const keys = new Set(window.times);
    const ready = window.times.every(time => cache.slots.has(time));
    if (!ready && entry.prefetch && !window.times.every(time => cache.slots.has(time) || entry!.prefetchKeys?.has(time))) {
      entry.lease.cancel();
    }
    if (!ready && entry.pending && entry.pendingKeys && !request.keepPending &&
      !window.times.every(time => cache.slots.has(time) || entry!.pendingKeys!.has(time))) entry.lease.cancel();
    if (!ready && !entry.pending && !entry.prefetch && !entry.error) {
      const owner = entry;
      owner.pendingKeys = keys;
      owner.pending = this.pending(owner, this.load(owner, keys, keys, width, height, 'required'));
    }
    const preparing = entry.pending ?? (!ready ? entry.prefetch : undefined);
    if (preparing) recordTemporalPreparation(preparing);
    if (!ready || preparing) {
      // Removing missing grid points creates large time jumps and hard seams.
      // Presentation holds an owned, completed output while this window loads.
      setTemporalStatus(request.effectId, entry.error ? 'GPU history · cached preview · retrying source load…'
        : `GPU history · holding preview · loading ${window.times.filter(time => !cache.slots.has(time)).length} source frames…`);
      return undefined;
    }

    if (cache.metadataWidth !== metadataWidth) {
      const retired = cache.ages; cache.ages = this.metadataTexture(metadataWidth); cache.metadataWidth = metadataWidth;
      void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone()).finally(() => retired.destroy());
    }
    const data = residentTemporalMetadata(window.metadata, window.times, cache.slots, cache.columns, cache.rows);
    this.device.queue.writeTexture({ texture: cache.ages }, data, { bytesPerRow: metadataWidth * 16, rowsPerImage: 2 }, [metadataWidth, 2]);
    let current = request.currentInput.view;
    if (!request.sourceOnly && (request.stabilization || request.retainCurrentInput)) {
      cache.current ??= new StabilizedCurrentFrame(this.device, request.currentInput.width, request.currentInput.height);
      current = cache.current.encode(request.encoder, current, request.stabilization
        ? slitScanSourceTransform(request.stabilization, temporalSourceTime(request.source, request.source.localTime))
        : [1, 0, 0, 0, 1, 0]);
    }
    if (ready && !preparing) this.prefetch(entry, keys, width, height);
    const resultIdentity = JSON.stringify([identity, cache.revision, request.source, request.horizon, request.timeFactor, request.nearest, request.samples]);
    if (ready && !preparing) setTemporalStatus(request.effectId, `GPU history · resident · ${width} × ${height} · ${request.samples} samples · ${window.times.length} source frames · ${Math.ceil(cache.bytes / 1024 / 1024)} MiB`);
    return { current: { view: current, identity: resultIdentity },
      atlas: { view: cache.atlas.createView({ dimension: '2d-array' }), identity: resultIdentity },
      ages: { view: cache.ages.createView(), identity: resultIdentity,
        temporalSamples: temporalSampleMetadata(window, request.timeFactor ?? 1, request.nearest) },
      ...(pairs ? { motion: { atlas: cache.atlas, width, height, columns: cache.columns, rows: cache.rows,
        layers: cache.layers, slots: new Map(cache.slots), pairs,
        metadata: disMotionMetadata(data, request), identity: resultIdentity,
        cacheSource: { mediaId: request.media.id, file: request.media.file, fileHash: request.media.fileHash,
          stabilization: request.stabilization?.identity },
      } } : {}) };
  }

  private pending(entry: Entry, operation: Promise<void>) {
    const pending = operation.catch(error => {
      if (entry.abort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      entry.error = error instanceof Error ? error : new Error(String(error));
      // Let the next resolve route memory pressure into Hybrid, including after
      // an export preparation barrier. Rejecting here would abort export first.
      if (entry.error instanceof ResidentGpuMemoryError) return;
      entry.retryAt = performance.now() + 1000;
      clearTimeout(entry.retryTimer);
      entry.retryTimer = setTimeout(() => this.onReady?.(), 1010);
      throw entry.error;
    }).finally(() => { entry.pending = undefined; entry.pendingKeys = undefined; this.onReady?.(); });
    void pending.catch(() => undefined); return pending;
  }

  private async load(entry: Entry, wanted: ReadonlySet<number>, required: ReadonlySet<number>, width: number, height: number,
    priority: 'required' | 'prefetch') {
    const cache = entry.cache!;
    const times = [...wanted].filter(time => !cache.slots.has(time)).toSorted((a, b) => a - b);
    if (!times.length) return;
    let completed = 0;
    let uploadValidation: Promise<void> | undefined;
    if (priority === 'required') setTemporalStatus(entry.latest.effectId, `GPU history · loading 0/${times.length} source frames…`);
    await entry.lease.request({ times, priority, signal: entry.abort.signal, onFrame: frame => {
      entry.abort.signal.throwIfAborted();
      let slot: number | undefined;
      if (cache.slots.has(frame.time)) return;
      const used = new Set(cache.slots.values());
      for (let i = 0; i < cache.capacity; i++) if (!used.has(i)) { slot = i; break; }
      if (slot === undefined) {
        const victim = [...cache.slots].find(([time]) => !required.has(time));
        if (!victim) throw new Error('GPU history has no recyclable source slot.');
        slot = victim[1]; cache.slots.delete(victim[0]);
      }
      const page = cache.columns * cache.rows;
      const upload = () => this.uploader.upload(frame, cache.atlas, Math.floor(slot! / page), entry.latest.stabilization
        ? slitScanSourceTransform(entry.latest.stabilization, frame.time) : undefined,
      { x: slot! % cache.columns * width, y: Math.floor(slot! % page / cache.columns) * height, width, height });
      // Validate the upload pipeline and atlas before reporting this window ready.
      if (!uploadValidation) {
        uploadValidation = this.checkedGpuOperation(upload);
        void uploadValidation.catch(() => undefined);
      } else upload();
      cache.slots.set(frame.time, slot); cache.revision++; completed++;
      if (priority === 'required' && (completed % 8 === 0 || completed === times.length)) {
        setTemporalStatus(entry.latest.effectId, `GPU history · loading ${completed}/${times.length} source frames…`); this.onReady?.();
      }
    } });
    await uploadValidation;
  }

  private async checkedGpuOperation(operation: () => void) {
    this.device.pushErrorScope('out-of-memory'); this.device.pushErrorScope('validation');
    let failure: unknown;
    try { operation(); } catch (error) { failure = error; }
    // Pop synchronously; never leave scopes installed across unrelated renders.
    const errors = await Promise.all([this.device.popErrorScope(), this.device.popErrorScope()]);
    if (failure) throw failure;
    if (errors[1]) throw new ResidentGpuMemoryError(`GPU history: ${errors[1].message}`);
    const error = errors[0];
    if (error) throw new Error(`GPU history: ${error.message}`);
  }

  private prefetch(entry: Entry, required: Set<number>, width: number, height: number) {
    const request = entry.latest, cache = entry.cache!;
    if (request.motionPairs || isCollectingTemporalPreparations() || entry.pending || entry.prefetch || entry.error || !request.horizon) return;
    const count = Math.min(192, Math.ceil(12 * (request.source.clockRate ?? 1)), cache.capacity - required.size);
    if (count <= 0) return;
    const step = Math.max(request.horizon / Math.max(1, request.samples - 2), entry.reader!.frames[0].duration);
    // Prime several advancing windows even while paused. A one-frame lookahead
    // starts too late, and cancelling it when playback reaches it starves refill.
    const accelerated = (request.source.clockRate ?? 1) > 1;
    const future = new Set<number>(accelerated ? slitScanPlaybackLookahead(request.source, entry.reader!.frames,
      required, cache.slots, cache.capacity - required.size) : []);
    for (let i = 1; !accelerated && i <= count && future.size < count; i++) {
      const next = hybridTemporalWindow({ ...request, source: { ...request.source, localTime: request.source.localTime + step * i } }, entry.reader!.frames);
      for (const time of next.times) if (!required.has(time) && !cache.slots.has(time)) future.add(time);
    }
    const times = [...future].slice(0, count);
    if (!times.length) return;
    try { if (request.stabilization) for (const time of times) slitScanSourceTransform(request.stabilization, time); }
    catch { return; } // Speculative coverage never fails the requested frame.
    entry.prefetchKeys = new Set(times);
    entry.prefetch = this.load(entry, entry.prefetchKeys, new Set([...required, ...times]), width, height, 'prefetch')
      .catch(() => undefined).finally(() => { entry.prefetch = undefined; entry.prefetchKeys = undefined; this.onReady?.(); });
  }

  private metadataTexture(width: number) {
    return this.device.createTexture({ label: 'resident-video-time-index', size: [width, 2], format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  }
  private bytes() { return [...this.entries.values()].reduce((sum, entry) => sum + (entry.cache?.bytes ?? 0), 0); }
  get allocatedBytes() { return this.bytes(); }
  pin(key: string, operation: Promise<void>) {
    const entry = this.entries.get(key); if (!entry) return;
    entry.pinned = operation;
    void operation.catch(() => undefined).finally(() => { if (entry.pinned === operation) entry.pinned = undefined; });
  }
  private disposeCache(cache: Cache) {
    return Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone()).finally(() => {
      cache.atlas.destroy(); cache.ages.destroy(); cache.current?.destroy();
    });
  }
  release(key: string) {
    const entry = this.entries.get(key); if (!entry) return;
    clearTimeout(entry.retryTimer); entry.abort.abort(); entry.lease.release(); this.entries.delete(key);
    const cache = entry.cache;
    if (cache) void (entry.pinned ?? Promise.resolve()).catch(() => undefined).then(() => this.disposeCache(cache)).catch(() => undefined);
  }
  destroy() { for (const key of this.entries.keys()) this.release(key); this.uploader.destroy(); }
}

export class ResidentGpuMemoryError extends Error {}
