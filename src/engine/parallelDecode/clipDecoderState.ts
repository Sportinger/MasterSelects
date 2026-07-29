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
