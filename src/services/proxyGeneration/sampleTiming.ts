import type { Sample } from '../../engine/webCodecsTypes';

const FRAME_COUNT_EPSILON = 1e-3;

export function ceilFrameCount(value: number): number {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) <= FRAME_COUNT_EPSILON) {
    return rounded;
  }
  return Math.ceil(value);
}

export function getFirstPresentationCts(samples: Sample[]): number {
  let firstPresentationCts = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    if (Number.isFinite(sample.cts) && sample.cts < firstPresentationCts) {
      firstPresentationCts = sample.cts;
    }
  }
  return Number.isFinite(firstPresentationCts) ? firstPresentationCts : 0;
}

export function getNormalizedSampleTimestampUs(sample: Sample, firstPresentationCts: number): number {
  const normalizedCts = Math.max(0, sample.cts - firstPresentationCts);
  return (normalizedCts / sample.timescale) * 1_000_000;
}

export function getDurationSecondsFromSamples(samples: Sample[]): number {
  let firstPresentationSeconds = Number.POSITIVE_INFINITY;
  let lastPresentationEndSeconds = 0;

  for (const sample of samples) {
    if (
      !Number.isFinite(sample.cts) ||
      !Number.isFinite(sample.duration) ||
      !Number.isFinite(sample.timescale) ||
      sample.timescale <= 0
    ) {
      continue;
    }

    const startSeconds = sample.cts / sample.timescale;
    const endSeconds = (sample.cts + Math.max(0, sample.duration)) / sample.timescale;
    firstPresentationSeconds = Math.min(firstPresentationSeconds, startSeconds);
    lastPresentationEndSeconds = Math.max(lastPresentationEndSeconds, endSeconds);
  }

  if (!Number.isFinite(firstPresentationSeconds) || lastPresentationEndSeconds <= firstPresentationSeconds) {
    return 0;
  }

  return lastPresentationEndSeconds - firstPresentationSeconds;
}

export function getMaxFrameIndex(frameIndices: Set<number>): number {
  let maxFrameIndex = -1;
  for (const frameIndex of frameIndices) {
    if (frameIndex > maxFrameIndex) maxFrameIndex = frameIndex;
  }
  return maxFrameIndex;
}
