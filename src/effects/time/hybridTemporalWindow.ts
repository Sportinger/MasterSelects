import { surfaceFrameIndex } from '../../services/planarTracking/surfaceFrameReader';
import { sourceTemporalWindow, type SourceTemporalRequest } from './SourceTemporalRuntime';
import { MAX_HYBRID_TEMPORAL_SAMPLES } from './sourceTemporalLimits';
import { temporalSourceTime } from './temporalClipSource';

/** Capacity overflow can use the remaining resident budget. An actual GPU
 * allocation failure retains the conservative streaming ceiling on retries. */
export function hybridTemporalBudget(availableBytes: number, allocationFailed = false): number {
  return allocationFailed ? Math.min(availableBytes, 640 * 1024 * 1024) : availableBytes;
}

/** Keep temporal positions, but give equal decoded PTS one GPU cache identity. */
export function hybridTemporalWindow(request: SourceTemporalRequest, frames: readonly { time: number; duration: number }[]) {
  if (!frames.length) throw new Error('Source video has no indexed frames.');
  const times: number[] = [], groups = new Map<number, number>();
  const samples = [{ age: 0, group: 0, nextGroup: 0, blend: 0 }];
  const groupFor = (time: number) => {
    let group = groups.get(time);
    if (group === undefined) { group = times.length + 1; groups.set(time, group); times.push(time); }
    return group;
  };
  const sourceSample = (sourceTime: number) => {
    const index = Math.max(0, surfaceFrameIndex(frames, sourceTime));
    const time = frames[index].time, next = frames[Math.min(index + 1, frames.length - 1)].time;
    const blend = request.nearest || next <= time ? 0 : Math.max(0, Math.min(1, (sourceTime - time) / (next - time)));
    const group = groupFor(time), nextGroup = blend > 0 ? groupFor(next) : group;
    return { group, nextGroup, blend };
  };
  if (request.sourceOnly) samples[0] = { age: 0, ...sourceSample(temporalSourceTime(request.source, request.source.localTime)) };
  if (request.horizon > 0) for (const item of sourceTemporalWindow(request, MAX_HYBRID_TEMPORAL_SAMPLES)) {
    samples.push({ age: item.age, ...sourceSample(item.time) });
  }
  const metadata = new Float32Array((samples.length + 1) * 4);
  // Normalize ages so graph delay coordinates address the expanded source window.
  samples.forEach((sample, i) => metadata.set([sample.age / (request.timeFactor ?? 1), sample.group, sample.nextGroup, sample.blend], i * 4));
  metadata.set([samples.length, Number(request.nearest), 0, 0], samples.length * 4);
  return { times, samples, metadata };
}

/** Two output/current slots, a demand map and current-branch image; upload scratch is separate. */
export function hybridTemporalMemory(width: number, height: number, sourceWidth: number, sourceHeight: number,
  samples: number, maxLayers: number, budget = 640 * 1024 * 1024, queries = 1) {
  if (!Number.isInteger(queries) || queries < 1) throw new Error('Hybrid requires at least one temporal query.');
  const frameBytes = sourceWidth * sourceHeight * 4;
  const fixedBytes = width * height * (8 + 36 * queries) + frameBytes * 2 + (MAX_HYBRID_TEMPORAL_SAMPLES + 1) * 20 + 16384;
  const capacity = Math.min(maxLayers, Math.max(1, samples - 1), Math.floor((budget - fixedBytes) / frameBytes));
  if (capacity < 1) throw new Error('Hybrid temporal rendering exceeds the available GPU budget at this resolution. Use a smaller output or preview.');
  return { capacity, bytes: fixedBytes + capacity * frameBytes };
}

/** Resident frames are consumed first; subsequent groups are decoded in source order. */
export function hybridTemporalBatches(times: readonly number[], needed: readonly number[], slots: ReadonlyMap<number, number>, capacity: number) {
  const resident = needed.filter(group => group > 0 && slots.has(times[group - 1]));
  const missing = needed.filter(group => group > 0 && !slots.has(times[group - 1]))
    .toSorted((a, b) => times[a - 1] - times[b - 1]);
  const batches = [resident];
  for (let i = 0; i < missing.length; i += capacity) batches.push(missing.slice(i, i + capacity));
  return batches;
}
