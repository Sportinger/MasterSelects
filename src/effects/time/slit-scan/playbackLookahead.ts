import { surfaceFrameIndex } from '../../../services/planarTracking/surfaceFrameReader';
import { temporalSourceTime, type TemporalClipSource } from '../temporalClipSource';

/** Maintain a bounded wall-clock lead when accelerated playback consumes history. */
export function slitScanPlaybackLookahead(source: TemporalClipSource, frames: readonly { time: number; duration: number }[],
  occupied: ReadonlySet<number>, resident: ReadonlyMap<number, number>, spareSlots: number): number[] {
  const limit = Math.min(spareSlots, 192, Math.ceil(12 * (source.clockRate ?? 1)));
  const now = temporalSourceTime(source, source.localTime);
  const next = temporalSourceTime(source, source.localTime + 1 / 30);
  const direction = next >= now ? 1 : -1;
  const start = Math.max(0, surfaceFrameIndex(frames, now));
  const times: number[] = [];
  for (let offset = 0; offset <= limit && times.length < limit; offset++) {
    const time = frames[start + offset * direction]?.time;
    if (time === undefined || time < source.inPoint || time > source.outPoint) break;
    if (!occupied.has(time) && !resident.has(time)) times.push(time);
  }
  return times;
}
