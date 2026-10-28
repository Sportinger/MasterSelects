/**
 * Read-only buffered-frame access for parallel decode. Returns frames still
 * owned by the manager's ClipDecoder buffer — never closes or transfers them.
 * Lookups are exact (the frame containing the target); a neighbour is returned
 * only on request and is always reported.
 */

import { Logger } from '../../services/logger';
const log = Logger.create('ParallelDecode');

import { isTimeInClipRange, timelineToSourceTime } from './clipWindow';
import {
  getFrameLookupResult,
  type ParallelDecodeFrameLookupOptions,
  type ParallelDecodeNeighbourFallback,
} from './frameLookup';
import { getExpectedFrameTimestampUs, type ClipDecoder } from './clipDecoderState';

function getBufferedFrameForSourceTimestamp(
  clipDecoder: ClipDecoder,
  targetTimestamp: number,
  lookupTolerance: number,
  options: ParallelDecodeFrameLookupOptions,
  onNeighbourFallback?: (fallback: ParallelDecodeNeighbourFallback) => void,
): VideoFrame | null {
  // Exact first: the frame whose half-open interval contains the target. A nearest
  // pick returned the next frame for reversed clips and let a stale neighbour stand
  // in while the right frame was still in the decoder (EXPORT_STALE_LAYER_FRAMES).
  const expected = getExpectedFrameTimestampUs(clipDecoder, targetTimestamp / 1_000_000);
  const exactFrame = expected === undefined ? undefined : clipDecoder.frameBuffer.get(expected);
  if (exactFrame) return exactFrame.frame;
  if (!options.allowNeighbourFallback) return null;

  const lookupResult = getFrameLookupResult({
    timestamps: clipDecoder.sortedTimestamps,
    oldestTimestamp: clipDecoder.oldestTimestamp,
    newestTimestamp: clipDecoder.newestTimestamp,
    targetTimestamp,
    tolerance: lookupTolerance,
  });

  if (lookupResult.kind === 'empty') {
    log.warn(`${clipDecoder.clipName}: Buffer empty for target ${(targetTimestamp/1_000_000).toFixed(3)}s`);
    return null;
  }

  if (lookupResult.kind === 'after-newest' || lookupResult.kind === 'before-oldest') {
    log.warn(`${clipDecoder.clipName}: target ${(targetTimestamp/1_000_000).toFixed(3)}s is outside buffered range (${lookupResult.kind}, nearest=${(lookupResult.timestamp/1_000_000).toFixed(3)}s)`);
    return null;
  }

  const decodedFrame = clipDecoder.frameBuffer.get(lookupResult.timestamp);
  if (!decodedFrame || lookupResult.diff >= lookupTolerance) {
    log.warn(`${clipDecoder.clipName}: no frame within tolerance for target ${(targetTimestamp/1_000_000).toFixed(3)}s (nearest diff=${(lookupResult.diff/1000).toFixed(1)}ms, tolerance=${(lookupTolerance/1000).toFixed(1)}ms)`);
    return null;
  }
  const fallback: ParallelDecodeNeighbourFallback = {
    clipId: clipDecoder.clipId,
    clipName: clipDecoder.clipName,
    sourceTime: targetTimestamp / 1_000_000,
    expectedFrameTime: expected === undefined ? null : expected / 1_000_000,
    usedFrameTime: lookupResult.timestamp / 1_000_000,
  };
  if (options.probeOnly) return decodedFrame.frame;
  log.warn(`${clipDecoder.clipName}: frame for ${fallback.sourceTime.toFixed(4)}s is not decoded; showing neighbour ${fallback.usedFrameTime.toFixed(4)}s`, fallback);
  onNeighbourFallback?.(fallback);
  return decodedFrame.frame;
}

/**
 * Get the decoded frame for a clip at a specific timeline time
 * Returns null if frame isn't ready (shouldn't happen if prefetch was called)
 * Optimized: O(log n) binary search instead of O(n) linear scan
 */
export function getBufferedFrameForClip(
  clipDecoder: ClipDecoder,
  timelineTime: number,
  frameToleranceUs: number,
  options: ParallelDecodeFrameLookupOptions = {},
  onNeighbourFallback?: (fallback: ParallelDecodeNeighbourFallback) => void,
): VideoFrame | null {
  const clipInfo = clipDecoder.clipInfo;
  const lookupTolerance = frameToleranceUs * Math.max(1, options.toleranceMultiplier ?? 1);

  // Check if time is within clip range (handles nested clips too)
  if (!isTimeInClipRange(clipInfo, timelineTime)) {
    return null;
  }

  const targetSourceTime = timelineToSourceTime(clipInfo, timelineTime);
  const targetTimestamp = targetSourceTime * 1_000_000;  // Convert to microseconds
  return getBufferedFrameForSourceTimestamp(clipDecoder, targetTimestamp, lookupTolerance, options, onNeighbourFallback);
}

export function getBufferedFrameForClipSourceTime(
  clipDecoder: ClipDecoder,
  sourceTime: number,
  frameToleranceUs: number,
  options: ParallelDecodeFrameLookupOptions = {},
  onNeighbourFallback?: (fallback: ParallelDecodeNeighbourFallback) => void,
): VideoFrame | null {
  const lookupTolerance = frameToleranceUs * Math.max(1, options.toleranceMultiplier ?? 1);
  return getBufferedFrameForSourceTimestamp(
    clipDecoder,
    sourceTime * 1_000_000,
    lookupTolerance,
    options,
    onNeighbourFallback,
  );
}
