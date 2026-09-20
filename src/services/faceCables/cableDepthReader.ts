import { depthRuntime } from '../depthEstimation/depthRuntime';
import { openSurfaceFrames, surfaceFrameIndex } from '../planarTracking/surfaceFrameReader';
import type { DepthFrame } from '../depthEstimation/depthMath';

/** One independent decoder and at most one inference at a time; holds only the last source frame. */
export async function openCableDepthReader(url: string, file: Blob | undefined, signal: AbortSignal,
  report: (message: string) => void) {
  await depthRuntime.prepare(signal, (_, message) => report(message));
  const reader = await openSurfaceFrames(url, signal, file);
  let index = -1, last: DepthFrame | undefined;
  return {
    close: reader.close,
    async read(time: number) {
      signal.throwIfAborted();
      const next = Math.max(0, surfaceFrameIndex(reader.frames, time));
      if (next !== index || !last) {
        const frame = await reader.read(time);
        last = await depthRuntime.infer(frame.pixels, 280, signal);
        signal.throwIfAborted(); index = next;
      }
      return last;
    },
  };
}
