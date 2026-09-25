import { surfaceFrameIndex } from '../../services/planarTracking/surfaceFrameReader';
import type { SourceTemporalRequest } from './SourceTemporalRuntime';
import { temporalSourceTime } from './temporalClipSource';

/** Warm the continuous source interval when it fits. Otherwise spread the spare
 * slots across all delayed instances, so one leading tap cannot starve the rest.
 * Only cache residency changes; every output still samples its exact source PTS. */
export function explicitTemporalLookahead(request: SourceTemporalRequest,
  frames: readonly { time: number; duration: number }[], required: ReadonlySet<number>,
  capacity: number): number[] {
  if (!request.delays?.length || !frames.length || capacity <= required.size) return [];
  const rate = request.source.clockRate ?? 1;
  const delays = [0, ...request.delays];
  const at = (age: number, advance: number) => Math.max(0, surfaceFrameIndex(frames,
    temporalSourceTime(request.source, request.source.localTime + advance * rate - age)));
  const ends = delays.flatMap(age => [at(age, 0), at(age, 0.4)]);
  const first = Math.min(...ends), last = Math.max(...ends);
  // A continuous cache avoids repeated GOP decoding between sparse taps.
  if (last - first + 1 <= capacity) return frames.slice(first, last + 1)
    .map(frame => frame.time).filter(time => !required.has(time));

  const predicted = new Set<number>();
  const spare = capacity - required.size;
  for (let tick = 1; tick <= 12 && predicted.size < spare; tick++) {
    for (const age of delays) {
      const time = frames[at(age, tick / 30)].time;
      if (!required.has(time)) predicted.add(time);
      if (predicted.size >= spare) break;
    }
  }
  // Resident predicted frames also consume spare slots and must be budgeted.
  return [...predicted];
}
