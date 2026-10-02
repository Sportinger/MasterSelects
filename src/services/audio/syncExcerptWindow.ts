// Picks the sync excerpt of a long target from its saved waveform pyramid, so
// only that window is read from the source instead of the whole recording.
// Scoring matches audioSync's active-excerpt choice: loudness plus onsets.

import type { TimelineWaveformPyramid } from '../../components/timeline/utils/waveformLod';

/** Coarsest pyramid resolution that still separates musical phrases. */
const MAX_CURVE_BUCKET_SECONDS = 1;
const WINDOW_STEP_SECONDS = 10;
const ONSET_WEIGHT = 0.8;

export interface EnergyCurve {
  /** Mean RMS over all channels, one value per bucket from source second 0. */
  values: Float32Array;
  bucketSeconds: number;
}

export function energyCurveFromPyramid(pyramid: TimelineWaveformPyramid): EnergyCurve | null {
  const usable = pyramid.levels.filter((level) => level.channels.length > 0 && level.bucketCount > 0);
  const fine = usable.filter((level) => level.bucketDuration <= MAX_CURVE_BUCKET_SECONDS);
  const level = fine.toSorted((a, b) => b.bucketDuration - a.bucketDuration)[0]
    ?? usable.toSorted((a, b) => a.bucketDuration - b.bucketDuration)[0];
  if (!level) return null;
  const values = new Float32Array(level.bucketCount);
  for (const channel of level.channels) {
    for (let index = 0; index < level.bucketCount; index += 1) values[index] += Number(channel.rms[index] ?? 0);
  }
  for (let index = 0; index < values.length; index += 1) values[index] /= level.channels.length;
  return { values, bucketSeconds: level.bucketDuration };
}

/**
 * Source second where the most active `windowSeconds` inside
 * [rangeStart, rangeStart + rangeSeconds) begins, or null when the curve has no
 * signal there (silence or a curve that does not cover the range).
 */
export function chooseExcerptWindow(
  curve: EnergyCurve,
  rangeStart: number,
  rangeSeconds: number,
  windowSeconds: number,
): number | null {
  if (rangeSeconds <= windowSeconds) return rangeStart;
  const first = Math.max(0, Math.floor(rangeStart / curve.bucketSeconds));
  const last = Math.min(curve.values.length, Math.floor((rangeStart + rangeSeconds) / curve.bucketSeconds));
  const windowBuckets = Math.max(1, Math.round(windowSeconds / curve.bucketSeconds));
  const step = Math.max(1, Math.round(WINDOW_STEP_SECONDS / curve.bucketSeconds));
  let bestStart = -1;
  let bestScore = 0;
  for (let start = first; start + windowBuckets <= last; start += step) {
    let level = 0;
    let onset = 0;
    for (let index = start; index < start + windowBuckets; index += 1) {
      level += curve.values[index];
      if (index > start) onset += Math.abs(curve.values[index] - curve.values[index - 1]);
    }
    const score = level / windowBuckets + ONSET_WEIGHT * (onset / Math.max(1, windowBuckets - 1));
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  return bestStart < 0 ? null : bestStart * curve.bucketSeconds;
}
