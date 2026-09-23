import { proxyFrameCache } from '../../proxyFrameCache';
import { surfaceFrameIndex, type SurfaceFrameStamp } from '../../planarTracking/surfaceFrameReader';

export interface SourceProxySurface extends SurfaceFrameStamp {
  image: HTMLImageElement; rotation: number; width: number; height: number;
}

/** JPEG generation rounds normalized source PTS onto its proxy grid. An index
 * shared by multiple source frames has no reliable inverse in legacy caches. */
export function exactProxyFrameIndex(frames: readonly SurfaceFrameStamp[], time: number, fps: number): number | undefined {
  if (!frames.length || !(fps > 0) || !Number.isFinite(fps)) return undefined;
  const i = surfaceFrameIndex(frames, time);
  if (i < 0 || Math.abs(frames[i].time - time) > 1e-6) return undefined;
  const indexAt = (index: number) => Math.round((frames[index].time - frames[0].time) * fps);
  const index = indexAt(i);
  if ((i > 0 && indexAt(i - 1) === index) || (i + 1 < frames.length && indexAt(i + 1) === index)) return undefined;
  return index;
}

/** Reuses the editor's JPEG cache and its coalesced disk/image loads. Never uses
 * the nearest-frame fallback or timeline preloading. At most four loads survive
 * a seek; historical lookups never move the interactive preload position. */
export async function readSourceProxyFrames(options: {
  mediaId: string; frames: readonly SurfaceFrameStamp[]; times: readonly number[]; fps: number; rotation: number;
  shouldContinue(): boolean; onFrame(frame: SourceProxySurface): void;
}) {
  let next = 0;
  const worker = async () => {
    while (options.shouldContinue() && next < options.times.length) {
      const time = options.times[next++];
      const index = exactProxyFrameIndex(options.frames, time, options.fps);
      if (index === undefined) continue;
      let image: HTMLImageElement | null;
      try {
        image = proxyFrameCache.getNearestCachedFrameEntry(options.mediaId, index, 0)?.image
          // getFrame accepts seconds and floors the index; stay inside this bin
          // to avoid floating-point underflow at e.g. 29.97 fps.
          ?? await proxyFrameCache.getFrame(options.mediaId, (index + 0.1) / options.fps, options.fps, false);
      } catch { continue; } // Missing/corrupt proxy: the source decoder supplies it.
      if (!options.shouldContinue()) return;
      if (!image?.complete || !image.naturalWidth || !image.naturalHeight) continue;
      const stamp = options.frames[Math.max(0, surfaceFrameIndex(options.frames, time))];
      options.onFrame({ image, ...stamp, rotation: options.rotation, width: image.naturalWidth, height: image.naturalHeight });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, options.times.length) }, worker));
}
