import { openSurfaceFrames, surfaceFrameIndex, type SurfaceFrameReader } from '../../services/planarTracking/surfaceFrameReader';
import type { NativeTemporalRequest } from './NativeTemporalRuntime';
import { temporalSourceTime } from './temporalClipSource';
import { recordTemporalPreparation, setTemporalStatus } from './temporalResourcePreparation';
import { mediaRuntimeRegistry } from '../../services/mediaRuntime/registry';

/** Absolute clip-time grid: adjacent output frames share the same historical PTS.
 * Slot -1 is the current input, already decoded by the normal playback pipeline. */
export function sourceTemporalWindow(request: Pick<NativeTemporalRequest, 'source' | 'horizon' | 'samples'>) {
  if (request.samples <= 2) return [{ age: request.horizon,
    time: temporalSourceTime(request.source, request.source.localTime - request.horizon) }];
  const count = Math.max(3, Math.min(64, Math.round(request.samples)));
  const step = Math.max(request.horizon, 0.00001) / (count - 2);
  const time = request.source.localTime;
  const tick = Math.floor(time / step + 1e-8);
  return Array.from({ length: count - 1 }, (_, index) => {
    const localTime = (tick - index) * step;
    return { age: Math.max(0, time - localTime), time: temporalSourceTime(request.source, localTime) };
  });
}

interface Entry {
  media: NativeTemporalRequest['media']; width: number; height: number; bytes: number;
  abort: AbortController; reader?: SurfaceFrameReader; pending?: Promise<void>; error?: Error;
  atlas: GPUTexture; ages: GPUTexture; slots: Map<number, number>; revision: number;
  latest: NativeTemporalRequest; encoder: GPUCommandEncoder;
}

/** Source-frame cache, never a history of what happened to play on screen.
 * The graph samples the resident array directly; no CPU/GPU image baking per frame. */
export class SourceTemporalRuntime {
  private entries = new Map<string, Entry>();
  private readonly budget = 640 * 1024 * 1024;
  private readonly layers = 68;
  private device: GPUDevice;
  private onReady?: () => void;
  constructor(device: GPUDevice, onReady?: () => void) { this.device = device; this.onReady = onReady; }

  resolve(request: NativeTemporalRequest) {
    const scale = request.maxEdge ? Math.min(1, request.maxEdge / Math.max(request.media.width!, request.media.height!)) : 1;
    const width = Math.round(request.media.width! * scale), height = Math.round(request.media.height! * scale);
    const bytes = width * height * 4 * (this.layers + 2);
    if (!(width > 0 && height > 0) || Math.max(width, height) > this.device.limits.maxTextureDimension2D
      || bytes > this.budget) throw new Error('Source frame cache exceeds the 640 MiB GPU/pixel budget. Use Small preview for this source.');
    let entry = this.entries.get(request.key);
    if (entry && (entry.media.url !== request.media.url || entry.media.file !== request.media.file
      || entry.width !== width || entry.height !== height)) { this.release(request.key); entry = undefined; }
    if (!entry) {
      for (const [key, old] of this.entries) {
        if (this.residentBytes() + bytes <= this.budget) break;
        if (old.encoder !== request.encoder) this.release(key);
      }
      if (this.residentBytes() + bytes > this.budget) throw new Error('Concurrent source caches exceed the 640 MiB budget.');
      entry = { media: request.media, width, height, bytes, abort: new AbortController(), slots: new Map(), revision: 0,
        atlas: this.device.createTexture({ label: 'source-PTS-cache', size: [width, height, this.layers], format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT }),
        ages: this.device.createTexture({ size: [65, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }),
        latest: request, encoder: request.encoder };
      this.entries.set(request.key, entry);
    }
    entry.latest = request; entry.encoder = request.encoder;
    if (entry.error) throw entry.error;
    const wanted = entry.reader ? this.wanted(entry, request) : undefined;
    const ready = wanted?.every(item => entry!.slots.has(item.time));
    if (!ready && !entry.pending) {
      const owner = entry;
      owner.pending = this.prepare(owner).catch(error => {
        if (owner.abort.signal.aborted) return;
        owner.error = error instanceof Error ? error : new Error(String(error));
        setTemporalStatus(request.effectId, owner.error.message); throw owner.error;
      }).finally(() => { owner.pending = undefined; this.onReady?.(); });
      void owner.pending.catch(() => undefined);
    }
    if (!ready) recordTemporalPreparation(entry.pending!);
    if (!wanted || !entry.slots.size) return undefined;
    // During a cache miss preview can use only resident source frames. Export waits
    // for the exact window through the preparation barrier above.
    const available = wanted.filter(item => entry!.slots.has(item.time));
    const data = new Float32Array(65 * 4);
    data[1] = -1;
    for (const [i, sample] of available.entries()) {
      data[(i + 1) * 4] = sample.age; data[(i + 1) * 4 + 1] = entry.slots.get(sample.time)!;
    }
    data[256] = available.length + 1; data[257] = Number(request.nearest); data[258] = 3;
    this.device.queue.writeTexture({ texture: entry.ages }, data, { bytesPerRow: 65 * 16 }, [65, 1]);
    if (ready) setTemporalStatus(request.effectId, `${request.maxEdge ? 'Preview' : 'Full resolution'}: ${width} × ${height} · source cache ready`);
    const identity = `${request.key}:${entry.revision}:${JSON.stringify(available)}:${request.nearest}`;
    return { atlas: { view: entry.atlas.createView({ dimension: '2d-array' }), identity },
      ages: { view: entry.ages.createView(), identity } };
  }

  private wanted(entry: Entry, request: NativeTemporalRequest) {
    return sourceTemporalWindow(request).map(sample => ({ ...sample,
      time: entry.reader!.frames[Math.max(0, surfaceFrameIndex(entry.reader!.frames, sample.time))].time }));
  }

  private async prepare(entry: Entry) {
    const signal = entry.abort.signal;
    if (!entry.reader) entry.reader = await openSurfaceFrames(entry.media.url, signal, entry.media.file, Math.max(entry.width, entry.height));
    signal.throwIfAborted();
    const request = entry.latest;
    const keys = new Set(this.wanted(entry, request).map(item => item.time));
    // Four future grid positions fit in the spare slots. Decode them in this same
    // batch so playback does not start another decoder for each advancing sample.
    if (request.keepPending && request.samples > 2) {
      const step = Math.max(request.horizon, 0.00001) / (Math.min(64, request.samples) - 2);
      const tick = Math.floor(request.source.localTime / step + 1e-8);
      for (let i = 1; i <= 4; i++) {
        const time = temporalSourceTime(request.source, (tick + i) * step);
        keys.add(entry.reader.frames[Math.max(0, surfaceFrameIndex(entry.reader.frames, time))].time);
      }
    }
    // Borrow exact native frames already held by the media runtime. This is a
    // read-only lookup: never seek or take ownership of the playback decoder.
    const sourceId = mediaRuntimeRegistry.resolveSourceId({ kind: 'video', mediaFileId: entry.media.id });
    const runtime = sourceId ? mediaRuntimeRegistry.getRuntime(sourceId) : null;
    if (runtime && entry.reader.rotation === 0 && typeof VideoFrame !== 'undefined') {
      for (const handle of runtime.frameCache.values()) {
        const frame = handle.frame;
        if (!(frame instanceof VideoFrame) || frame.displayWidth !== entry.width || frame.displayHeight !== entry.height) continue;
        const time = [...keys].find(time => Math.abs(time - frame.timestamp / 1_000_000) <= 1e-6);
        if (time !== undefined && !entry.slots.has(time)) this.upload(entry, time, keys, frame);
      }
    }
    const missing = [...keys].filter(time => !entry.slots.has(time)).toSorted((a, b) => a - b);
    let completed = 0;
    if (!missing.length) return;
    for await (const frame of entry.reader.readGpuTimes(missing)) {
      signal.throwIfAborted();
      // Interrupt a superseded seek, while keeping samples useful for playback.
      const current = new Set(this.wanted(entry, entry.latest).map(item => item.time));
      if (![...current].some(time => keys.has(time))) break;
      const time = missing[completed];
      if (Math.abs(frame.time - time) > 1e-6) throw new Error('Decoder returned the wrong source timestamp.');
      if (frame.width !== entry.width || frame.height !== entry.height) throw new Error('Source frame dimensions changed.');
      this.upload(entry, time, keys, frame.source); completed++;
      setTemporalStatus(entry.latest.effectId, `Loading source cache (${completed}/${missing.length})…`);
      if (completed % 8 === 0) this.onReady?.();
    }
  }

  private upload(entry: Entry, time: number, required: ReadonlySet<number>, source: VideoFrame | HTMLCanvasElement) {
    let slot = Array.from({ length: this.layers }, (_, i) => i).find(i => ![...entry.slots.values()].includes(i));
    if (slot === undefined) {
      const eviction = [...entry.slots].find(([time]) => !required.has(time));
      if (!eviction) throw new Error('Source cache has no recyclable slot.');
      slot = eviction[1]; entry.slots.delete(eviction[0]);
    }
    this.device.queue.copyExternalImageToTexture({ source },
      { texture: entry.atlas, origin: [0, 0, slot] }, [entry.width, entry.height]);
    entry.slots.set(time, slot); entry.revision++;
  }

  private residentBytes() { return [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0); }
  release(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.abort.abort(); entry.reader?.close(); entry.atlas.destroy(); entry.ages.destroy(); this.entries.delete(key);
  }
  destroy() { for (const key of this.entries.keys()) this.release(key); }
}
