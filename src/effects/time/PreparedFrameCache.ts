import { surfaceFrameIndex, type SurfaceDecodedFrame, type SurfaceFrameStamp } from '../../services/planarTracking/surfaceFrameReader';

export interface PreparedFrameSource {
  readonly frames: readonly SurfaceFrameStamp[];
  read(time: number): Promise<SurfaceDecodedFrame>;
  close(): void;
}

export type PreparedFrameStatus =
  | { state: 'idle' | 'cancelled' | 'closed'; completed: number; total: number }
  | { state: 'preparing' | 'ready'; completed: number; total: number }
  | { state: 'error'; completed: number; total: number; message: string };

/** CPU pixels only. GPU atlas allocations must have their own budget.
 * Returned frames are borrowed until the next prepare/cancel/close operation.
 * A decoder is serialized even when an earlier request is superseded mid-decode.
 */
export class PreparedFrameCache {
  private entries = new Map<number, SurfaceDecodedFrame>();
  private bytes = 0;
  private generation = 0;
  private closed = false;
  private pending: Promise<unknown> = Promise.resolve();
  private currentStatus: PreparedFrameStatus = { state: 'idle', completed: 0, total: 0 };
  private readonly source: PreparedFrameSource;
  readonly budgetBytes: number;
  readonly maxFrameBytes: number;

  constructor(source: PreparedFrameSource, budgetBytes: number, maxFrameBytes: number) {
    if (!Number.isSafeInteger(budgetBytes) || !Number.isSafeInteger(maxFrameBytes)
      || maxFrameBytes < 4 || budgetBytes < maxFrameBytes) throw new Error('Invalid prepared frame memory budget.');
    if (!source.frames.length || source.frames.some((frame, i, all) => !Number.isFinite(frame.time)
      || !Number.isFinite(frame.duration) || frame.duration <= 0 || (i > 0 && frame.time <= all[i - 1].time))) {
      throw new Error('Prepared source requires ordered, unique PTS and positive frame durations.');
    }
    this.source = source; this.budgetBytes = budgetBytes; this.maxFrameBytes = maxFrameBytes;
  }

  get status(): PreparedFrameStatus { return { ...this.currentStatus }; }
  get residentBytes(): number { return this.bytes; }

  /** Requests use source seconds, with first/last presented frame hold at boundaries. */
  prepare(times: readonly number[], signal?: AbortSignal): Promise<readonly SurfaceDecodedFrame[]> {
    if (this.closed) return Promise.reject(new Error('Prepared frame cache is closed.'));
    const generation = ++this.generation;
    this.currentStatus = { state: 'preparing', completed: 0, total: times.length };
    const check = () => {
      signal?.throwIfAborted();
      if (generation !== this.generation || this.closed) throw new DOMException('Preparation superseded.', 'AbortError');
    };
    const run = async () => {
      let completed = 0;
      try {
        check();
        if (!times.length || times.some(time => !Number.isFinite(time))) throw new Error('Preparation requires finite source times.');
        const stamps = times.map(time => this.source.frames[Math.max(0, surfaceFrameIndex(this.source.frames, time))]);
        const keys = new Set(stamps.map(stamp => stamp.time));
        // Reserve for the worst case before decoding. This includes the new decoded frame,
        // so insertion does not briefly exceed the pixel budget while evicting old frames.
        if (keys.size * this.maxFrameBytes > this.budgetBytes) {
          throw new Error('Prepared window exceeds the pixel budget. Reduce samples or resolution, or increase the budget.');
        }
        this.currentStatus = { state: 'preparing', completed, total: keys.size };
        for (const key of keys) {
          check();
          if (!this.entries.has(key)) {
            for (const [oldKey, oldFrame] of this.entries) {
              if (this.bytes + this.maxFrameBytes <= this.budgetBytes) break;
              if (!keys.has(oldKey)) { this.entries.delete(oldKey); this.bytes -= oldFrame.pixels.data.byteLength; }
            }
            const frame = await this.source.read(key);
            check();
            if (Math.abs(frame.time - key) > 1e-6 || !Number.isFinite(frame.duration) || frame.duration <= 0) {
              throw new Error(`Decoder returned the wrong source frame for PTS ${key}.`);
            }
            const size = frame.pixels.data.byteLength;
            if (size > this.maxFrameBytes || size < 4 || size !== frame.pixels.width * frame.pixels.height * 4) {
              throw new Error('Decoded frame exceeds its reserved pixel budget or has invalid dimensions.');
            }
            this.entries.set(key, frame); this.bytes += size;
          }
          completed++;
          this.currentStatus = { state: 'preparing', completed, total: keys.size };
        }
        check();
        this.currentStatus = { state: 'ready', completed, total: keys.size };
        return stamps.map(stamp => this.entries.get(stamp.time)!);
      } catch (error) {
        if (generation === this.generation && !this.closed) {
          this.currentStatus = signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')
            ? { state: 'cancelled', completed, total: times.length }
            : { state: 'error', completed, total: times.length, message: error instanceof Error ? error.message : String(error) };
        }
        throw error;
      }
    };
    const result = this.pending.then(run, run);
    this.pending = result.catch(() => undefined);
    return result;
  }

  cancel() {
    if (this.closed) return;
    this.generation++;
    this.currentStatus = { state: 'cancelled', completed: 0, total: 0 };
  }

  close() {
    if (this.closed) return;
    this.closed = true; this.generation++;
    this.entries.clear(); this.bytes = 0; this.source.close();
    this.currentStatus = { state: 'closed', completed: 0, total: 0 };
  }
}
