import {
  getNormalizedSampleSourceTime,
  getNormalizedSampleTimestampMicroseconds,
  getSampleDurationMicroseconds,
  type SamplePresentationTiming,
} from './sampleTiming';
import { findContainingPresentationIndex, getSamplePresentationGrid, presentationFrameRule } from './presentationFrame';

export const BUFFER_AHEAD_FRAMES = 60;
export const BACKGROUND_DECODE_MARGIN_FRAMES = 180;
export const MAX_BUFFER_SIZE = 300;
export const DECODE_BATCH_SIZE = 90;
export const SEEK_BATCH_MULTIPLIER = 5;
export const FAR_TARGET_SEEK_THRESHOLD_FRAMES = 30;
export const UPCOMING_CLIP_PREFETCH_SECONDS = 2.0;
export const MAX_PREWARM_CLIP_STARTS = 32;
export const SLOW_BLOCKING_PREFETCH_WARN_MS = 250;

export interface ParallelDecodeSamplePlan extends SamplePresentationTiming {
  is_sync: boolean;
}

export interface DecodeSchedulingPlan {
  backgroundMargin: number;
  decodeTarget: number;
  needsDecodingAhead: boolean;
  needsDecodingBack: boolean;
  needsDecoding: boolean;
  isBehindTarget: boolean;
  targetAheadFrames: number;
  targetBehindFrames: number;
  shouldSeekDirectlyToTarget: boolean;
}

export interface DecodeSeekState {
  isTooFarAhead: boolean;
  isTooFarBehind: boolean;
  needsSeek: boolean;
}

export function binarySearchInsertPosition(arr: readonly number[], target: number): number {
  let left = 0;
  let right = arr.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

export function hasUsableBufferedFrame(
  timestamps: readonly number[],
  oldestTimestamp: number,
  newestTimestamp: number,
  targetTimestamp: number,
  tolerance: number
): boolean {
  if (timestamps.length === 0) {
    return false;
  }

  if (targetTimestamp < oldestTimestamp - tolerance) {
    return false;
  }

  if (targetTimestamp > newestTimestamp + tolerance) {
    return false;
  }

  let left = 0;
  let right = timestamps.length - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (timestamps[mid] < targetTimestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  let closestDiff = Math.abs(timestamps[left] - targetTimestamp);
  if (left > 0) {
    closestDiff = Math.min(closestDiff, Math.abs(timestamps[left - 1] - targetTimestamp));
  }

  return closestDiff < tolerance;
}

export function getBufferedTimeRangeForLog(timestamps: readonly number[]): { start: string; end: string } {
  return {
    start: timestamps.length > 0 ? (timestamps[0] / 1_000_000).toFixed(3) : 'N/A',
    end: timestamps.length > 0 ? (timestamps[timestamps.length - 1] / 1_000_000).toFixed(3) : 'N/A',
  };
}

export function createDecodeSchedulingPlan(params: {
  sampleIndex: number;
  targetSampleIndex: number;
  frameBufferSize: number;
  frameInBuffer: boolean;
}): DecodeSchedulingPlan {
  const backgroundMargin = params.frameInBuffer ? BACKGROUND_DECODE_MARGIN_FRAMES : 0;
  const decodeTarget = params.targetSampleIndex + BUFFER_AHEAD_FRAMES + backgroundMargin;
  const needsDecodingAhead = params.sampleIndex < decodeTarget;
  const needsDecodingBack = !params.frameInBuffer && params.sampleIndex > params.targetSampleIndex + 30;
  const needsDecoding = needsDecodingAhead || needsDecodingBack;
  const isBehindTarget = params.sampleIndex <= params.targetSampleIndex;
  const targetAheadFrames = params.targetSampleIndex - params.sampleIndex;
  const targetBehindFrames = params.sampleIndex - params.targetSampleIndex;
  const shouldSeekDirectlyToTarget =
    !params.frameInBuffer &&
    (
      targetBehindFrames > FAR_TARGET_SEEK_THRESHOLD_FRAMES ||
      (params.frameBufferSize === 0 && targetAheadFrames > FAR_TARGET_SEEK_THRESHOLD_FRAMES)
    );

  return {
    backgroundMargin,
    decodeTarget,
    needsDecodingAhead,
    needsDecodingBack,
    needsDecoding,
    isBehindTarget,
    targetAheadFrames,
    targetBehindFrames,
    shouldSeekDirectlyToTarget,
  };
}

export function getDecodeSeekState(params: {
  forceFlush: boolean;
  sampleIndex: number;
  targetSampleIndex: number;
  seekTargetSampleIndex?: number;
}): DecodeSeekState {
  const isTooFarAhead = params.targetSampleIndex > params.sampleIndex + 30;
  const isTooFarBehind = params.seekTargetSampleIndex !== undefined
    ? params.sampleIndex > params.seekTargetSampleIndex
    : params.sampleIndex > params.targetSampleIndex + 30;

  return {
    isTooFarAhead,
    isTooFarBehind,
    needsSeek: params.forceFlush && (isTooFarAhead || isTooFarBehind),
  };
}

export function getDecodeBatchSize(needsSeek: boolean): number {
  return needsSeek ? DECODE_BATCH_SIZE * SEEK_BATCH_MULTIPLIER : DECODE_BATCH_SIZE;
}

export interface DecodeBatchPlan {
  /** Decode-order index the pass starts at (the keyframe when resetToKeyframe). */
  startSampleIndex: number;
  /** Samples to queue from startSampleIndex; 0 means nothing to decode. */
  framesToDecode: number;
  /** The decoder needs a keyframe first: reset it and start at startSampleIndex. */
  resetToKeyframe: boolean;
}

/**
 * Where one decodeAhead() pass starts and how many samples it queues. After a
 * flush or a decoder reset (pool recycling) the decoder needs a keyframe first,
 * so the start rewinds to the keyframe at or before sampleIndex and the count is
 * taken from that rewound start. Counting before the rewind stopped the pass
 * short of the target by the rewind distance. When sampleIndex already reached
 * the target there is nothing to do, and no rewind re-decodes buffered frames.
 */
export function planDecodeBatch(
  samples: readonly ParallelDecodeSamplePlan[],
  sampleIndex: number,
  targetSampleIndex: number,
  needsKeyframe: boolean,
  batchSize: number,
): DecodeBatchPlan {
  const endIndex = Math.min(targetSampleIndex, samples.length);
  if (endIndex <= sampleIndex) return { startSampleIndex: sampleIndex, framesToDecode: 0, resetToKeyframe: false };
  const startSampleIndex = needsKeyframe ? findKeyframeAtOrBeforeSample(samples, sampleIndex) : sampleIndex;
  return {
    startSampleIndex,
    framesToDecode: Math.min(endIndex - startSampleIndex, batchSize),
    resetToKeyframe: needsKeyframe,
  };
}

export function hasDecodeSeekDistance(sampleIndex: number, targetSampleIndex: number): boolean {
  return targetSampleIndex > sampleIndex + 30 || sampleIndex > targetSampleIndex + 30;
}

/**
 * Decode-order index of the sample shown at sourceTime (presentationFrame.ts):
 * constant-rate media, also jittery phone footage, is matched on its nominal
 * frame grid, so coarse container timescales (1/1000, 1/600) and per-frame
 * jitter do not shift frames; VFR media takes the nearest sample unless the
 * request sits just before a sample (a reversed clip's boundary request). A
 * plain nearest pick made a reversed clip seek to the keyframe at the boundary
 * and never decode the frame left of it.
 */
export function findSampleIndexForSourceTime(
  samples: readonly SamplePresentationTiming[],
  sourceTime: number,
  presentationOffsetSeconds: number
): number {
  if (samples.length === 0) return 0;
  const timestampUsOf = (sample: SamplePresentationTiming) =>
    getNormalizedSampleTimestampMicroseconds(sample, presentationOffsetSeconds);
  return findContainingPresentationIndex(
    samples.length,
    index => timestampUsOf(samples[index]),
    sourceTime * 1_000_000,
    index => getSampleDurationMicroseconds(samples[index]) ?? 0,
    presentationFrameRule(
      getSamplePresentationGrid(samples, presentationOffsetSeconds, timestampUsOf, samples[0].timescale),
      samples[0].timescale,
    ),
  );
}

export function getSeekTargetSampleIndex(
  samplesLength: number,
  targetSampleIndex: number,
  seekTargetSampleIndex?: number
): number {
  return Math.max(0, Math.min(seekTargetSampleIndex ?? targetSampleIndex, samplesLength - 1));
}

export function collectPresentationKeyframeCandidates(
  samples: readonly ParallelDecodeSamplePlan[],
  presentationOffsetSeconds: number,
  targetSourceTime: number
): number[] {
  const keyframeCandidates: number[] = [];

  for (let i = 0; i < samples.length; i++) {
    if (samples[i].is_sync) {
      const sampleSourceTime = getNormalizedSampleSourceTime(samples[i], presentationOffsetSeconds);
      if (sampleSourceTime <= targetSourceTime) {
        keyframeCandidates.push(i);
      } else {
        break;
      }
    }
  }

  if (keyframeCandidates.length === 0) keyframeCandidates.push(0);
  return keyframeCandidates;
}

export function findKeyframeAtOrBeforeSample(
  samples: readonly ParallelDecodeSamplePlan[],
  sampleIndex: number
): number {
  let keyframeIndex = sampleIndex;

  if (!samples[keyframeIndex]?.is_sync) {
    for (let i = keyframeIndex - 1; i >= 0; i--) {
      if (samples[i].is_sync) {
        keyframeIndex = i;
        break;
      }
    }
  }

  return keyframeIndex;
}
