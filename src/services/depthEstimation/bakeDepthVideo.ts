import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeVideo } from 'mediabunny';
import { openSurfaceFrames } from '../planarTracking/surfaceFrameReader';
import { depthRuntime } from './depthRuntime';
import { depthImage, normalizeDepth, type DepthRange } from './depthMath';

export interface DepthBakeOptions {
  url: string; file?: Blob; from: number; to: number; fps: number; edge: number;
  smoothing: number; invert: boolean; signal: AbortSignal;
  progress: (fraction: number, message: string) => void;
}
export function validateDepthBakeRange(from: number, to: number, fps: number) {
  if (![from, to, fps].every(Number.isFinite) || from < 0 || to <= from || to - from > 120 || ![10, 15, 30].includes(fps)) {
    throw new Error('Choose a depth range of up to 120 seconds and 10, 15 or 30 fps.');
  }
  return Math.max(1, Math.ceil((to - from) * fps - 1e-8));
}
/** Explicit timestamps and sequential inference: exports never consume live-preview state. */
export async function bakeDepthVideo(options: DepthBakeOptions): Promise<Blob> {
  const { from, to, fps, edge, signal, progress } = options;
  const count = validateDepthBakeRange(from, to, fps);
  if (!await canEncodeVideo('avc')) throw new Error('This browser cannot encode H.264 depth video.');
  await depthRuntime.prepare(signal, progress);
  const reader = await openSurfaceFrames(options.url, signal, options.file);
  let output: Output | undefined;
  let finished = false;
  try {
    const last = reader.frames.at(-1)!;
    if (to > last.time + last.duration + 0.01) throw new Error('Depth range extends beyond the source video.');
    const canvas = document.createElement('canvas'), map = document.createElement('canvas');
    const context = canvas.getContext('2d')!, mapContext = map.getContext('2d')!;
    const target = new BufferTarget();
    let video: CanvasSource | undefined, range: DepthRange | undefined;
    for (let frame = 0; frame < count; frame++) {
      signal.throwIfAborted();
      const decoded = await reader.read(from + frame / fps);
      const depth = await depthRuntime.infer(decoded.pixels, edge, signal);
      const normalized = normalizeDepth(depth.values, range, options.smoothing); range = normalized.range;
      if (!output) {
        const scale = edge / Math.max(decoded.pixels.width, decoded.pixels.height);
        canvas.width = Math.max(2, Math.round(decoded.pixels.width * scale / 2) * 2);
        canvas.height = Math.max(2, Math.round(decoded.pixels.height * scale / 2) * 2);
        output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
        video = new CanvasSource(canvas, { codec: 'avc', bitrate: 2_000_000, keyFrameInterval: 1 });
        output.addVideoTrack(video, { frameRate: fps });
        await output.start();
      }
      map.width = depth.width; map.height = depth.height;
      mapContext.putImageData(depthImage(normalized.pixels, depth.width, depth.height, options.invert), 0, 0);
      context.drawImage(map, 0, 0, canvas.width, canvas.height);
      await video!.add(frame / fps, Math.min(1 / fps, to - from - frame / fps));
      progress((frame + 1) / count, `Baking depth: ${frame + 1} / ${count} frames`);
    }
    signal.throwIfAborted();
    await output!.finalize(); finished = true;
    if (!target.buffer?.byteLength) throw new Error('Depth video encoder produced no data.');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally { reader.close(); if (output && !finished) await output.cancel().catch(() => {}); }
}
