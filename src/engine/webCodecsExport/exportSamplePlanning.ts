// exportSamplePlanning - pure planning math for WebCodecs FAST export.
// Operates on sample tables and sorted CTS arrays only: presentation-offset
// computation, sample/keyframe index planning, and buffered-frame CTS lookup.
// No decoder, VideoFrame, or other runtime handles live here.

import type { Sample } from '../webCodecsTypes';
import {
  findContainingPresentationIndex,
  getSamplePresentationGrid,
  presentationFrameRule,
} from '../parallelDecode/presentationFrame';

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

/**
 * Index of the sample shown at the target time (parallelDecode/presentationFrame.ts).
 * Constant-rate media, also jittery phone footage, is matched on its nominal
 * frame grid, so a coarse container timescale (1/1000, 1/600) does not shift
 * every third frame and a reversed clip, whose request sits 10 us left of the
 * boundary, shows source frame 119-N instead of 120-N
 * (EXPORT_REVERSE_OFF_BY_ONE). VFR media without a grid takes the nearest
 * sample, or the one before it when the nearest starts 2-20 us after the
 * request (beyond the container's rounding). WebCodecsExportMode (owned by the Fast-export work) matches the
 * resulting CTS exactly, so it inherits the rule.
 */
export function findClosestSampleIndex(
  samples: readonly Sample[],
  targetTimeSeconds: number,
  presentationOffsetUs: number
): number {
  if (samples.length === 0) {
    return 0;
  }
  const timestampUsOf = (sample: Sample) => normalizedSampleTimestampUs(sample, presentationOffsetUs);
  return findContainingPresentationIndex(
    samples.length,
    index => timestampUsOf(samples[index]),
    targetTimeSeconds * 1_000_000,
    index => (samples[index].timescale > 0 ? (samples[index].duration * 1_000_000) / samples[index].timescale : 0),
    presentationFrameRule(
      getSamplePresentationGrid(samples, presentationOffsetUs, timestampUsOf, samples[0].timescale),
      samples[0].timescale,
    ),
  );
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

/** What FAST export knows when the requested frame is not buffered. */
export interface MissingFrameState {
  decoderClosed: boolean;
  targetSampleIndex: number;
  targetCtsUs: number;
  decodeCursorIndex: number;
  /** Oldest buffered CTS, or 0 when nothing is buffered. */
  minBufferedCtsUs: number;
  bufferedFrames: number;
  /** Newest CTS the decoder has put out since its configure (kept or discarded). */
  newestOutputCtsUs: number;
  /** Keyframe at or before the target. */
  keyframeIndex: number;
  /** The target was decoded and closed as skipped by a strided decode. */
  skippedTarget: boolean;
  maxContinuousForwardGap: number;
}

/**
 * Why the decoder must restart from a keyframe for the requested frame, or null to keep decoding
 * forward. An empty buffer with the target behind the cursor is a backward jump only when the
 * decoder already put the target out: after a surface stall released every held frame, the target
 * is still queued in the decoder and a restart would throw that work away.
 */
export function missingFrameRestartReason(state: MissingFrameState): string | null {
  const forwardGap = state.targetSampleIndex - state.decodeCursorIndex;
  if (state.decoderClosed) return 'decoder closed — recovering';
  if (forwardGap > state.maxContinuousForwardGap && state.keyframeIndex > state.decodeCursorIndex) {
    return `forward source jump of ${forwardGap} samples`;
  }
  if (state.skippedTarget) return 'target skipped by strided decode';
  const alreadyPutOut = state.targetCtsUs <= state.newestOutputCtsUs + 1;
  if (state.bufferedFrames > 0 && state.targetCtsUs < state.minBufferedCtsUs) return 'backward source jump';
  if (state.bufferedFrames === 0 && forwardGap < 0 && alreadyPutOut) return 'backward source jump';
  return null;
}
