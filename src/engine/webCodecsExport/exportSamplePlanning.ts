// exportSamplePlanning - pure planning math for WebCodecs FAST export.
// Operates on sample tables and sorted CTS arrays only: presentation-offset
// computation, sample/keyframe index planning, and buffered-frame CTS lookup.
// No decoder, VideoFrame, or other runtime handles live here.

import type { Sample } from '../webCodecsTypes';

/** Earliest valid presentation timestamp (us) across all samples, or 0. */
export function computePresentationOffsetUs(samples: readonly Sample[]): number {
  let firstPresentationUs = Infinity;
  for (const sample of samples) {
    if (!Number.isFinite(sample.cts) || !Number.isFinite(sample.timescale) || sample.timescale <= 0) {
      continue;
    }
    firstPresentationUs = Math.min(firstPresentationUs, (sample.cts * 1_000_000) / sample.timescale);
  }

  return Number.isFinite(firstPresentationUs) ? firstPresentationUs : 0;
}

export function sampleTimestampUs(sample: Sample): number {
  return (sample.cts * 1_000_000) / sample.timescale;
}

export function normalizedSampleTimestampUs(sample: Sample, presentationOffsetUs: number): number {
  return Math.max(0, sampleTimestampUs(sample) - presentationOffsetUs);
}

/** Frame-duration based tolerance (us) for CTS matching. */
export function frameToleranceUs(frameRate: number, multiplier = 1.5): number {
  // Guard Infinity/NaN frame rates (duration=0 track metadata): Math.max alone
  // passes them through and the resulting 0/NaN tolerance rejects every frame.
  const safeRate = Number.isFinite(frameRate) && frameRate > 0 ? Math.min(frameRate, 480) : 30;
  return (1_000_000 / safeRate) * multiplier;
}

/** Index of the sample whose normalized timestamp is closest to the target time. */
export function findClosestSampleIndex(
  samples: readonly Sample[],
  targetTimeSeconds: number,
  presentationOffsetUs: number
): number {
  if (samples.length === 0) {
    return 0;
  }

  const targetUs = targetTimeSeconds * 1_000_000;
  let targetSampleIndex = 0;
  let closestDiff = Infinity;

  for (let i = 0; i < samples.length; i++) {
    const diff = Math.abs(normalizedSampleTimestampUs(samples[i], presentationOffsetUs) - targetUs);
    if (diff < closestDiff) {
      closestDiff = diff;
      targetSampleIndex = i;
    }
  }

  return targetSampleIndex;
}

/** Nearest keyframe index at or before the target sample index. */
export function findKeyframeBefore(samples: readonly Sample[], targetSampleIndex: number): number {
  for (let i = Math.min(targetSampleIndex, samples.length - 1); i >= 0; i--) {
    if (samples[i].is_sync) {
      return i;
    }
  }
  return 0;
}

/** Binary search for the closest CTS index in a sorted CTS array (-1 when empty). */
export function findClosestFrameIndex(sortedCts: readonly number[], targetCts: number): number {
  if (sortedCts.length === 0) {
    return -1;
  }

  let left = 0;
  let right = sortedCts.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (sortedCts[mid] < targetCts) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  if (left > 0 && Math.abs(sortedCts[left - 1] - targetCts) < Math.abs(sortedCts[left] - targetCts)) {
    return left - 1;
  }
  return left;
}

/** Closest CTS index within tolerance, or -1 when no buffered frame qualifies. */
export function findBufferedFrameIndex(
  sortedCts: readonly number[],
  targetCtsUs: number,
  toleranceUs: number
): number {
  const bestIndex = findClosestFrameIndex(sortedCts, targetCtsUs);
  if (bestIndex < 0 || bestIndex >= sortedCts.length) {
    return -1;
  }

  return Math.abs(sortedCts[bestIndex] - targetCtsUs) <= toleranceUs ? bestIndex : -1;
}
