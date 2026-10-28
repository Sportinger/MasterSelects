/**
 * Per-clip decoder state for parallel decode: the ClipDecoder record plus
 * frame-buffer bookkeeping math (sorted-timestamp index, bounds, snapshots).
 *
 * No frame teardown or decoder lifecycle calls live here — frame and decoder
 * handles are owned by ParallelDecodeManager; these helpers only maintain the
 * lookup structures around them.
 */

import type { ParallelDecodeClipInfo as ClipInfo } from './clipWindow';
import type { MP4VideoTrack } from './decoderConfig';
import type { ParallelDecodeSample } from './mp4Parsing';
import { binarySearchInsertPosition } from './scheduling';
import { getNormalizedSampleTimestampMicroseconds, getSampleDurationMicroseconds } from './sampleTiming';
import {
  derivePresentationGrid,
  findContainingSortedTimestamp,
  presentationFrameRule,
  type PresentationGrid,
} from './presentationFrame';
import {
  estimateDecodedFrameBytes,
  secondsFromTimestamp,
  type ParallelDecodeClipRuntimeSnapshot,
} from './runtimeSnapshot';

export interface DecodedFrame {
  frame: VideoFrame;
  sourceTime: number;     // Normalized time in source video (seconds)
  timestamp: number;      // Normalized timestamp from VideoFrame (microseconds)
}

export interface ClipDecoder {
  clipId: string;
  clipName: string;
  /**
   * Decoder handles are leased from the manager's fixed-size pool. Clip
   * metadata and buffered frames remain registered while the handle is
   * dormant, so long timelines do not consume one native decoder per clip.
   */
  decoder: VideoDecoder | null;
  decoderUseSerial: number;
  samples: ParallelDecodeSample[];
  sampleIndex: number;
  videoTrack: MP4VideoTrack;
  codecConfig: VideoDecoderConfig;
  presentationOffsetSeconds: number;
  frameBuffer: Map<number, DecodedFrame>;  // timestamp (μs) -> decoded frame
  sortedTimestamps: number[];              // Sorted list for O(log n) lookup
  oldestTimestamp: number;                 // Track bounds for quick rejection
  newestTimestamp: number;                 // Track bounds for quick rejection
  lastDecodedTimestamp: number;            // Track last decoded timestamp
  clipInfo: ClipInfo;
  isDecoding: boolean;
  pendingDecode: Promise<void> | null;
  needsKeyframe: boolean;                  // True after flush - must start from keyframe
  /** Ascending, de-duplicated sample presentation timestamps (us), built lazily from samples. */
  presentationTimestampsUs?: number[];
  presentationTimestampsSampleCount?: number;
  /** Duration (us) per presentation timestamp; locates VFR gaps (presentationFrame.ts). */
  presentationDurationsUs?: Map<number, number>;
  /** First decode-order sample index per presentation timestamp (us). */
  presentationSampleIndexUs?: Map<number, number>;
  /** Nominal frame grid of constant-rate or jittery media, null for VFR, which uses the nearest rule (presentationFrame.ts). */
  presentationGrid?: PresentationGrid | null;
  /** Source time of the last advanceToTime(); its direction decides which buffered side is stale. */
  lastAdvanceSourceTime?: number;
  /**
   * The export walks this clip's source backward (reversed clip): prune and evict the
   * high end. Seeded from a constant mapping at registration, then learned from the
   * advance direction; undefined while unknown, and nothing is pruned then.
   */
  advancingBackward?: boolean;
}

/** Sample presentation timestamps (us, rounded exactly like the decoded chunks), ascending. */
export function getPresentationTimestampsUs(clipDecoder: ClipDecoder): number[] {
  if (clipDecoder.presentationTimestampsUs && clipDecoder.presentationTimestampsSampleCount === clipDecoder.samples.length) {
    return clipDecoder.presentationTimestampsUs;
  }
  const durations = new Map<number, number>();
  const firstIndex = new Map<number, number>();
  clipDecoder.samples.forEach((sample, index) => {
    const timestamp = getNormalizedSampleTimestampMicroseconds(sample, clipDecoder.presentationOffsetSeconds);
    if (durations.has(timestamp)) return;
    durations.set(timestamp, getSampleDurationMicroseconds(sample) ?? 0);
    firstIndex.set(timestamp, index);
  });
  clipDecoder.presentationSampleIndexUs = firstIndex;
  clipDecoder.presentationTimestampsUs = [...durations.keys()].toSorted((a, b) => a - b);
  clipDecoder.presentationDurationsUs = durations;
  clipDecoder.presentationGrid = derivePresentationGrid(clipDecoder.presentationTimestampsUs, clipDecoder.samples[0]?.timescale ?? 0);
  clipDecoder.presentationTimestampsSampleCount = clipDecoder.samples.length;
  return clipDecoder.presentationTimestampsUs;
}

/** Timestamp (us) of the decoded frame that must be shown at sourceTime, or undefined without samples. */
export function getExpectedFrameTimestampUs(clipDecoder: ClipDecoder, sourceTime: number): number | undefined {
  const timestamps = getPresentationTimestampsUs(clipDecoder);
  return findContainingSortedTimestamp(timestamps, sourceTime * 1_000_000,
    timestamp => clipDecoder.presentationDurationsUs?.get(timestamp),
    presentationFrameRule(clipDecoder.presentationGrid, clipDecoder.samples[0]?.timescale ?? 0));
}

/** True when exactly the frame shown at sourceTime is buffered (no neighbour stands in for it). */
export function hasExpectedBufferedFrame(clipDecoder: ClipDecoder, sourceTime: number): boolean {
  const expected = getExpectedFrameTimestampUs(clipDecoder, sourceTime);
  return expected !== undefined && clipDecoder.frameBuffer.has(expected);
}

/**
 * True when the frame shown at sourceTime was already queued on the live decoder
 * but has not come out yet. decodeAhead() queues a whole batch synchronously, so
 * sampleIndex counts submitted chunks, not output frames; when a decode-bound
 * export catches up with the decoder's output edge, the target is still in the
 * decoder. Treating it as missing made the scheduler seek: decoder.reset() dropped
 * exactly that frame and every other queued one, and the GOP was decoded again.
 * Output arrives in presentation order, so a target at or before the newest output
 * that is not buffered was dropped or pruned and is really missing. After a flush,
 * configure or pool reset (needsKeyframe) the decoder holds nothing any more.
 */
export function isExpectedFrameInFlight(
  clipDecoder: ClipDecoder,
  sourceTime: number,
  targetSampleIndex: number,
): boolean {
  if (clipDecoder.decoder?.state !== 'configured' || clipDecoder.needsKeyframe) return false;
  if (targetSampleIndex >= clipDecoder.sampleIndex) return false;
  const expected = getExpectedFrameTimestampUs(clipDecoder, sourceTime);
  return expected !== undefined
    && !clipDecoder.frameBuffer.has(expected)
    && expected > clipDecoder.newestTimestamp;
}

/**
 * Decode-order index to resume from after the decoder handle was reset (pool
 * recycling). reset() drops every chunk that was queued but not yet output, so
 * resuming at the old sampleIndex silently skipped those frames, while resuming
 * at 0 re-decoded the whole clip. Resume at the first sample presented after the
 * newest buffered frame; decodeAhead() rewinds that to its keyframe.
 */
export function getResumeSampleIndexAfterReset(clipDecoder: ClipDecoder): number {
  if (!Number.isFinite(clipDecoder.newestTimestamp) || clipDecoder.samples.length === 0) return 0;
  // Binary search over the cached ascending timestamps: this runs on every pool
  // recycle, several times per exported frame in large mosaics.
  const timestamps = getPresentationTimestampsUs(clipDecoder);
  let left = 0;
  let right = timestamps.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (timestamps[mid] <= clipDecoder.newestTimestamp) left = mid + 1;
    else right = mid;
  }
  if (left >= timestamps.length) return clipDecoder.samples.length;
  return clipDecoder.presentationSampleIndexUs?.get(timestamps[left]) ?? clipDecoder.samples.length;
}

export function refreshBufferedTimestampBounds(clipDecoder: ClipDecoder): void {
  clipDecoder.oldestTimestamp = clipDecoder.sortedTimestamps[0] ?? Infinity;
  clipDecoder.newestTimestamp = clipDecoder.sortedTimestamps[clipDecoder.sortedTimestamps.length - 1] ?? -Infinity;
}

/**
 * Drop a buffered timestamp from the map and sorted index.
 * The caller is responsible for closing the frame BEFORE calling this.
 */
export function removeBufferedTimestamp(clipDecoder: ClipDecoder, timestamp: number): void {
  clipDecoder.frameBuffer.delete(timestamp);
  clipDecoder.sortedTimestamps = clipDecoder.sortedTimestamps.filter(ts => ts !== timestamp);
  refreshBufferedTimestampBounds(clipDecoder);
}

/**
 * Store a decoded frame by timestamp and maintain the sorted index/bounds.
 * Maintains sorted timestamp list with binary insertion - O(log n).
 */
export function storeDecodedFrame(
  clipDecoder: ClipDecoder,
  frame: VideoFrame,
  timestamp: number,
  sourceTime: number
): void {
  clipDecoder.frameBuffer.set(timestamp, {
    frame,
    sourceTime,
    timestamp,
  });

  const insertIdx = binarySearchInsertPosition(clipDecoder.sortedTimestamps, timestamp);
  clipDecoder.sortedTimestamps.splice(insertIdx, 0, timestamp);

  // Update bounds - O(1)
  if (timestamp < clipDecoder.oldestTimestamp) {
    clipDecoder.oldestTimestamp = timestamp;
  }
  if (timestamp > clipDecoder.newestTimestamp) {
    clipDecoder.newestTimestamp = timestamp;
  }

  clipDecoder.lastDecodedTimestamp = timestamp;
}

/**
 * Buffered timestamp to evict when the frame buffer is over MAX_BUFFER_SIZE.
 * Forward: the oldest frame (already passed). A reversed clip walks the source
 * backward but still decodes forward from a keyframe, so the newest frame is
 * usually the one that just arrived and the one the export needs now; popping it
 * blindly lost the target whenever the keyframe-to-target span exceeded the
 * buffer. Evict the end farthest from the current target time instead.
 */
export function selectEvictionTimestamp(clipDecoder: ClipDecoder): number | undefined {
  const timestamps = clipDecoder.sortedTimestamps;
  if (timestamps.length === 0) return undefined;
  const oldest = timestamps[0];
  const newest = timestamps[timestamps.length - 1];
  if (!clipDecoder.advancingBackward || clipDecoder.lastAdvanceSourceTime === undefined) return oldest;
  const targetUs = clipDecoder.lastAdvanceSourceTime * 1_000_000;
  return Math.abs(oldest - targetUs) >= Math.abs(newest - targetUs) ? oldest : newest;
}

/**
 * Reset the frame-buffer bookkeeping to empty.
 * The caller is responsible for closing all buffered frames BEFORE calling this.
 */
export function clearFrameBufferState(clipDecoder: ClipDecoder): void {
  clipDecoder.frameBuffer.clear();
  clipDecoder.sortedTimestamps = [];
  clipDecoder.oldestTimestamp = Infinity;
  clipDecoder.newestTimestamp = -Infinity;
}

export function buildClipRuntimeSnapshot(clipDecoder: ClipDecoder): ParallelDecodeClipRuntimeSnapshot {
  const estimatedBufferedFrameBytes = estimateDecodedFrameBytes(
    clipDecoder.videoTrack.video.width,
    clipDecoder.videoTrack.video.height,
    clipDecoder.frameBuffer.size
  );
  return {
    clipId: clipDecoder.clipId,
    clipName: clipDecoder.clipName,
    codec: clipDecoder.codecConfig.codec,
    decoderState: clipDecoder.decoder?.state ?? 'dormant',
    decodeQueueSize: clipDecoder.decoder?.decodeQueueSize ?? 0,
    hardwareAcceleration: clipDecoder.codecConfig.hardwareAcceleration,
    dimensions: {
      width: clipDecoder.videoTrack.video.width,
      height: clipDecoder.videoTrack.video.height,
    },
    sampleCount: clipDecoder.samples.length,
    sampleIndex: clipDecoder.sampleIndex,
    isDecoding: clipDecoder.isDecoding,
    hasPendingDecode: Boolean(clipDecoder.pendingDecode),
    frameBufferSize: clipDecoder.frameBuffer.size,
    estimatedBufferedFrameBytes,
    oldestBufferedTimeSeconds: secondsFromTimestamp(clipDecoder.oldestTimestamp),
    newestBufferedTimeSeconds: secondsFromTimestamp(clipDecoder.newestTimestamp),
    lastDecodedTimeSeconds: secondsFromTimestamp(clipDecoder.lastDecodedTimestamp),
    isNested: clipDecoder.clipInfo.isNested,
    parentClipId: clipDecoder.clipInfo.parentClipId,
  } satisfies ParallelDecodeClipRuntimeSnapshot;
}
