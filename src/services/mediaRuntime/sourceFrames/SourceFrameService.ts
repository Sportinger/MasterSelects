import { mediaRuntimeRegistry } from '../registry';
import type { MediaSourceRuntime } from '../types';
import { surfaceFrameIndex } from '../../planarTracking/surfaceFrameReader';
import { openSourceFrameReader, type SourceFrameAsset, type SourceFrameReader, type SourceFrameSurface } from './SourceFrameReader';
import { readSourceProxyFrames, type SourceProxySurface } from './SourceProxyFrames';
import { Logger } from '../../logger';

export type SourceFrameResource = SourceFrameSurface | SourceProxySurface;
const log = Logger.create('SourceFrames');

export interface SourceFrameRequest {
  times: readonly number[];
  priority: 'required' | 'prefetch';
  signal?: AbortSignal;
  /** Only supported JPEG proxies with an unambiguous source-PTS mapping. */
  proxyFps?: number;
  onFrame(surface: SourceFrameResource): void;
}
interface Job extends SourceFrameRequest {
  owner: symbol; remaining: Set<number>; resolve(): void; reject(error: unknown): void; detach(): void;
}
interface Source {
  asset: SourceFrameAsset; abort: AbortController; ready: Promise<SourceFrameReader>; reader?: SourceFrameReader;
  owners: Set<symbol>; jobs: Set<Job>; running: boolean; scheduled: boolean;
  idleTimer?: ReturnType<typeof setTimeout>; runtime: MediaSourceRuntime | null; runtimeOwner: string;
  disposeTimer?: ReturnType<typeof setTimeout>;
}
const superseded = () => new DOMException('Source frame request superseded.', 'AbortError');

/** Shared by temporal consumers and the media runtime's exact frame cache.
 * One background decoder per source, distinct from interactive playback sessions.
 * Callbacks consume borrowed frames immediately, so jobs never retain 64 decoder surfaces. */
export class SourceFrameService {
  private sources = new Map<string, Source>();
  private sequence = 0;

  acquire(asset: SourceFrameAsset) {
    let source = this.sources.get(asset.id);
    if (source && (source.asset.url !== asset.url || source.asset.file !== asset.file)) {
      this.disposeSource(source); source = undefined;
    }
    if (!source) {
      // Short grace period permits quality switches to reuse the same source index.
      if (this.sources.size >= 4) for (const old of this.sources.values()) {
        if (!old.owners.size) { this.disposeSource(old); break; }
      }
      const abort = new AbortController();
      const runtimeOwner = `source-frame-service:${++this.sequence}`;
      const runtime = mediaRuntimeRegistry.retainRuntime({ kind: 'video', mediaFileId: asset.id, file: asset.file }, runtimeOwner);
      source = { asset, abort, owners: new Set(), jobs: new Set(), running: false, scheduled: false, runtime, runtimeOwner,
        ready: openSourceFrameReader(asset, abort.signal) };
      const entry = source;
      void source.ready.then(reader => { entry.reader = reader; }, () => undefined);
      this.sources.set(asset.id, source);
    }
    const owner = Symbol(asset.id), entry = source;
    clearTimeout(entry.disposeTimer);
    entry.owners.add(owner);
    let released = false;
    return {
      ready: entry.ready,
      request: (request: SourceFrameRequest) => {
        if (released) return Promise.reject(superseded());
        return this.request(entry, owner, request);
      },
      cancel: () => this.cancelOwner(entry, owner),
      release: () => {
        if (released) return;
        released = true; this.cancelOwner(entry, owner); entry.owners.delete(owner);
        if (!entry.owners.size) entry.disposeTimer = setTimeout(() => this.disposeSource(entry), 2500);
      },
    };
  }

  private cancelOwner(source: Source, owner: symbol) {
    for (const job of source.jobs) if (job.owner === owner) this.finish(source, job, superseded());
  }
  private finish(source: Source, job: Job, error?: unknown) {
    if (!source.jobs.delete(job)) return;
    job.detach(); if (error) job.reject(error); else job.resolve();
  }
  private request(source: Source, owner: symbol, request: SourceFrameRequest) {
    this.cancelOwner(source, owner);
    return new Promise<void>((resolve, reject) => {
      if (request.signal?.aborted || source.abort.signal.aborted) { reject(superseded()); return; }
      const onAbort = () => this.finish(source, job, superseded());
      const job: Job = { ...request, owner, remaining: new Set(request.times), resolve, reject,
        detach: () => request.signal?.removeEventListener('abort', onAbort) };
      source.jobs.add(job); request.signal?.addEventListener('abort', onAbort, { once: true });
      clearTimeout(source.idleTimer);
      if (!source.running && !source.scheduled) {
        source.scheduled = true;
        queueMicrotask(() => { source.scheduled = false; void this.pump(source); });
      }
    });
  }

  private deliver(source: Source, surface: SourceFrameResource) {
    for (const job of [...source.jobs]) {
      if ('image' in surface && !job.proxyFps) continue; // Original-only requests never receive proxy pixels.
      if (!job.remaining.has(surface.time)) continue;
      try { job.onFrame(surface); job.remaining.delete(surface.time); }
      catch (error) { this.finish(source, job, error); continue; }
      if (!job.remaining.size) this.finish(source, job);
    }
  }

  private async pump(source: Source) {
    if (source.running || source.abort.signal.aborted) return;
    source.running = true;
    const started = performance.now();
    let proxyFrames = 0, decodedFrames = 0;
    try {
      const reader = await source.ready;
      while (source.jobs.size && !source.abort.signal.aborted) {
        // Canonical PTS deduplicates requests from different effects and qualities.
        for (const job of source.jobs) {
          job.remaining = new Set([...job.remaining].map(time => reader.frames[Math.max(0, surfaceFrameIndex(reader.frames, time))].time));
          if (!job.remaining.size) this.finish(source, job);
        }
        // Only exact native frames are admitted; playback's tolerant fallback is
        // intentionally not used for deterministic temporal sampling.
        if (reader.rotation === 0 && typeof VideoFrame !== 'undefined') {
          for (const handle of [...(source.runtime?.frameCache.values() ?? [])]) {
            if (!(handle.frame instanceof VideoFrame) || !handle.frame.codedWidth) continue;
            const frame = handle.frame;
            if (frame.displayWidth !== reader.width || frame.displayHeight !== reader.height) continue;
            const index = Math.max(0, surfaceFrameIndex(reader.frames, frame.timestamp / 1_000_000));
            const stamp = reader.frames[index];
            if (Math.abs(stamp.time - frame.timestamp / 1_000_000) <= 1e-6) this.deliver(source, {
              frame, ...stamp, rotation: 0, width: frame.displayWidth, height: frame.displayHeight,
            });
          }
        }
        const required = [...source.jobs].filter(job => job.priority === 'required');
        const selected = required.length ? required : [...source.jobs];
        const proxyRates = new Set(selected.map(job => job.proxyFps).filter((fps): fps is number => !!fps));
        for (const fps of proxyRates) {
          const proxyJobs = selected.filter(job => job.proxyFps === fps);
          await readSourceProxyFrames({ mediaId: source.asset.id, frames: reader.frames, fps, rotation: reader.rotation,
            times: [...new Set(proxyJobs.flatMap(job => [...job.remaining]))],
            shouldContinue: () => !source.abort.signal.aborted && proxyJobs.some(job => source.jobs.has(job))
              && (required.length > 0 || ![...source.jobs].some(job => job.priority === 'required')),
            onFrame: surface => { proxyFrames++; this.deliver(source, surface); },
          });
        }
        // Proxy callbacks may finish/cancel jobs or admit higher-priority work.
        if (selected.some(job => !source.jobs.has(job))
          || (!required.length && [...source.jobs].some(job => job.priority === 'required'))) continue;
        const times = [...new Set(selected.flatMap(job => [...job.remaining]))].toSorted((a, b) => a - b);
        if (!times.length) continue;
        for await (const surface of reader.read(times)) {
          decodedFrames++;
          if (!source.jobs.size || source.abort.signal.aborted) break;
          // Newly arrived consumers can join a frame already being decoded.
          this.deliver(source, surface);
          // Do not retain decoder output in the raw media cache. Its twelve
          // cloned surfaces plus the codec's reorder queue can exhaust hardware
          // decode surfaces. Consumers retain GPU textures; callbacks share the
          // borrowed frame and the reader closes it immediately afterwards.
          // A seek replaces the remainder immediately; required work preempts prefetch.
          if (!times.some(time => [...source.jobs].some(job => job.remaining.has(time)))
            || (!required.length && [...source.jobs].some(job => job.priority === 'required'))) break;
        }
      }
    } catch (error) {
      for (const job of [...source.jobs]) this.finish(source, job, error);
    } finally {
      if (proxyFrames + decodedFrames >= 8) log.info('Temporal source window prepared', {
        mediaId: source.asset.id, proxyFrames, decodedFrames, elapsedMs: Math.round(performance.now() - started),
      });
      source.running = false;
      if (source.jobs.size && !source.abort.signal.aborted) void this.pump(source);
      else if (!source.abort.signal.aborted) source.idleTimer = setTimeout(() => {
        if (!source.running) void source.reader?.idle().catch(() => undefined);
      }, 750);
    }
  }

  private disposeSource(source: Source) {
    for (const job of [...source.jobs]) this.finish(source, job, superseded());
    clearTimeout(source.idleTimer); clearTimeout(source.disposeTimer); source.abort.abort(); source.reader?.close();
    if (this.sources.get(source.asset.id) === source) this.sources.delete(source.asset.id);
    if (source.runtime) mediaRuntimeRegistry.releaseRuntime(source.runtime.sourceId, source.runtimeOwner);
  }
  destroy() { for (const source of this.sources.values()) this.disposeSource(source); }
}
export type SourceFrameLease = ReturnType<SourceFrameService['acquire']>;
export const sourceFrameService: SourceFrameService = import.meta.hot?.data?.sourceFrameService ?? new SourceFrameService();
if (import.meta.hot) import.meta.hot.dispose?.(data => { data.sourceFrameService = sourceFrameService; });
