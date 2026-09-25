import { surfaceFrameIndex } from '../../services/planarTracking/surfaceFrameReader';
import type { SourceTemporalRequest } from './SourceTemporalRuntime';
import { temporalSourceTime } from './temporalClipSource';
import { slitScanPlaybackLookahead } from './slit-scan/playbackLookahead';
import { explicitTemporalLookahead } from './explicitTemporalLookahead';

/** Only the leading grid positions are new as the absolute window advances.
 * Do not rebuild thousands of historical samples for every speculative frame. */
export function residentTemporalLookahead(request: SourceTemporalRequest,
  frames: readonly { time: number; duration: number }[], required: ReadonlySet<number>,
  resident: ReadonlyMap<number, number>, capacity: number): number[] {
  if (request.delays) return explicitTemporalLookahead(request, frames, required, capacity);
  const rate = request.source.clockRate ?? 1;
  const count = Math.min(192, Math.ceil(12 * rate), capacity - required.size);
  if (count <= 0 || !request.horizon || !frames.length) return [];
  const step = Math.max(request.horizon, .00001) / Math.max(1, request.samples - 2);
  const tick = Math.floor(request.source.localTime / step + 1e-8);
  const lead = request.samples <= 2 ? 12 / 30 * rate : Math.max(12 / 30 * rate, step);
  const ticks = Math.ceil(lead / step);
  // Extremely dense grids need adjacent source PTS, not millions of grid visits.
  if (ticks > 8192) return slitScanPlaybackLookahead(request.source, frames, required, resident, count);
  const future = new Set<number>();
  const add = (index: number) => {
    const time = frames[index]?.time;
    if (time !== undefined && !required.has(time) && !resident.has(time) && future.size < count) future.add(time);
  };
  const steps = request.samples <= 2 ? 12 : ticks;
  for (let i = 1; i <= steps && future.size < count; i++) {
    const local = request.samples <= 2
      ? request.source.localTime + lead * i / steps - request.horizon : (tick + i) * step;
    const time = temporalSourceTime(request.source, local);
    const index = Math.max(0, surfaceFrameIndex(frames, time));
    add(index);
    if (!request.nearest && time > frames[index].time) add(index + 1);
  }
  return [...future];
}
