import type { PlanarTrack } from '../../types/planarTracking';

/** Merge only covered frame intervals; never fill reconstruction gaps. */
export function trackingCoverage(track: PlanarTrack): { from: number; to: number }[] {
  const frames = track.terrain?.cameras.length ? track.terrain.cameras : track.samples;
  const ranges: { from: number; to: number }[] = [];
  for (const frame of frames) {
    const to = frame.time + (frame.duration && frame.duration > 0 ? frame.duration : 1 / track.fps);
    const last = ranges.at(-1);
    if (last && frame.time <= last.to + 1e-5) last.to = Math.max(last.to, to);
    else ranges.push({ from: frame.time, to });
  }
  return ranges;
}
