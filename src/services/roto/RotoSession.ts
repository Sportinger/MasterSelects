import { openSurfaceFrames, surfaceFrameIndex, type SurfaceFrameReader, type SurfaceDecodedFrame } from '../planarTracking/surfaceFrameReader';
import { rotoRuntime } from './rotoRuntime';
import type { RotoMask, RotoPoint } from './rotoTypes';

/** Owns decoding and source-space masks outside durable application stores. */
export class RotoSession {
  private reader?: SurfaceFrameReader;
  private sourceController = new AbortController();
  private ownedUrl?: string;
  private maskBytes = 0;
  readonly masks = new Map<number, RotoMask>();
  readonly anchors = new Map<number, RotoPoint[]>();
  current?: SurfaceDecodedFrame;
  readonly url: string; readonly file: Blob | undefined; readonly from: number; readonly to: number;
  constructor(url: string, file: Blob | undefined, from: number, to: number) {
    this.url = url; this.file = file; this.from = from; this.to = to;
  }
  async open() {
    if (this.reader) return;
    this.ownedUrl = this.file?.size ? URL.createObjectURL(this.file) : undefined;
    this.reader = await openSurfaceFrames(this.ownedUrl ?? this.url, this.sourceController.signal, this.file, 1024);
  }
  async show(time: number) {
    await this.open();
    const frame = await this.reader!.read(Math.max(this.from, Math.min(this.to - 1e-6, time)));
    this.current = frame; return frame;
  }
  async read(time: number) { await this.open(); return this.reader!.read(time); }
  stepTime(direction: number) {
    if (!this.reader || !this.current) return this.from;
    const index = surfaceFrameIndex(this.reader.frames, this.current.time);
    return this.reader.frames[Math.max(0, Math.min(this.reader.frames.length - 1, index + direction))].time;
  }
  private save(frame: SurfaceDecodedFrame, data: Uint8Array) {
    const old = this.masks.get(frame.time);
    if (this.maskBytes - (old?.data.length ?? 0) + data.length > 256 * 1024 * 1024) throw new Error('Mask memory limit reached. Export this range before starting another.');
    this.maskBytes += data.length - (old?.data.length ?? 0);
    const mask = { time: frame.time, duration: frame.duration, width: frame.pixels.width, height: frame.pixels.height, data };
    this.masks.set(frame.time, mask); return mask;
  }
  async select(points: RotoPoint[], signal: AbortSignal, progress: (value: number, message: string) => void) {
    if (!this.current) throw new Error('Load a source frame first.');
    const frame = this.current;
    await rotoRuntime.prepare(signal, progress);
    const result = await rotoRuntime.seed(frame.pixels, points, this.reader!.frames.length, signal);
    signal.throwIfAborted();
    this.anchors.set(frame.time, points.map(p => ({ ...p })));
    return this.save(frame, result.mask!);
  }
  async track(direction: 1 | -1, seconds: number, signal: AbortSignal,
    update: (frame: SurfaceDecodedFrame, mask: RotoMask, fraction: number) => void,
    progress: (value: number, message: string) => void) {
    const start = this.current, points = start && this.anchors.get(start.time);
    if (!start || !points?.some(p => p.label === 1)) throw new Error('Add a foreground point on this frame before tracking.');
    await rotoRuntime.prepare(signal, progress);
    const end = Math.max(this.from, Math.min(this.to - 1e-6, start.time + direction * seconds));
    const frames = this.reader!.frames.filter(f => direction === 1 ? f.time >= start.time && f.time <= end : f.time <= start.time && f.time >= end);
    const ordered = direction === 1 ? frames : frames.toReversed();
    let i = 0;
    for await (const frame of this.reader!.readTimes(ordered.map(f => f.time))) {
      signal.throwIfAborted();
      const correction = this.anchors.get(frame.time);
      const result = i === 0 || correction
        ? await rotoRuntime.seed(frame.pixels, correction ?? points, ordered.length - i, signal)
        : await rotoRuntime.step(frame.pixels, signal);
      signal.throwIfAborted();
      const mask = this.save(frame, result.mask!); this.current = frame;
      update(frame, mask, ++i / ordered.length);
    }
  }
  clearCurrentPoints() {
    if (!this.current) return;
    this.anchors.delete(this.current.time);
    const previous = this.masks.get(this.current.time);
    if (previous) this.maskBytes -= previous.data.length;
    this.masks.delete(this.current.time);
  }
  dispose() { this.sourceController.abort(); this.reader?.close(); if (this.ownedUrl) URL.revokeObjectURL(this.ownedUrl); }
}
