/**
 * ParallelDecodeManager - Parallel video decoding for multi-clip exports
 *
 * Problem: Sequential decoding of multiple videos is slow because each video
 * waits for the previous one to decode before proceeding.
 *
 * Solution: Pre-decode frames in parallel using separate VideoDecoder instances
 * per clip, with a frame buffer that stays ahead of the render position.
 *
 * Every decoder state transition and VideoFrame teardown happens in this
 * file; parallelDecode/** holds the handle-free planning and buffering math.
 */

import { Logger } from '../services/logger';
import { getVideoTrackRotation, type VideoRotationDegrees } from './webcodecs/videoTrackOrientation';
const log = Logger.create('ParallelDecode');

import {
  createHardwareDecoderConfig,
  HARDWARE_ACCELERATION_MODES,
} from './parallelDecode/decoderConfig';
import { isDecoderResetAbort } from './parallelDecode/decoderErrors';
import {
  getClipMainTimelineDuration,
  getClipMainTimelineStart,
  getPrefetchTargetForClip,
  isTimeInClipRange,
  timelineToSourceTime,
  type ParallelDecodeClipInfo as ClipInfo,
} from './parallelDecode/clipWindow';
import { type ParallelDecodeFrameLookupOptions } from './parallelDecode/frameLookup';
import { getNormalizedSampleSourceTime, getPresentationOffsetSeconds } from './parallelDecode/sampleTiming';
import {
  BUFFER_AHEAD_FRAMES,
  MAX_BUFFER_SIZE,
  UPCOMING_CLIP_PREFETCH_SECONDS,
  collectPresentationKeyframeCandidates,
  createDecodeSchedulingPlan,
  findKeyframeAtOrBeforeSample,
  findSampleIndexForSourceTime,
  getDecodeBatchSize,
  getDecodeSeekState,
  getSeekTargetSampleIndex,
  hasDecodeSeekDistance,
  hasUsableBufferedFrame,
} from './parallelDecode/scheduling';
import {
  createParallelDecodeRuntimeSnapshot,
  type ParallelDecodeRuntimeSnapshot,
} from './parallelDecode/runtimeSnapshot';
import { createEncodedChunkForSample, parseMP4TrackInfo } from './parallelDecode/mp4Parsing';
import {
  buildClipRuntimeSnapshot,
  clearFrameBufferState,
  refreshBufferedTimestampBounds,
  removeBufferedTimestamp,
  storeDecodedFrame,
  type ClipDecoder,
  type DecodedFrame,
} from './parallelDecode/clipDecoderState';
import {
  prefetchFramesForTime as runPrefetchFramesForTime,
  type ParallelDecodePrefetchDeps,
} from './parallelDecode/prefetchCoordinator';
import {
  getBufferedFrameForClip,
  getBufferedFrameForClipSourceTime,
} from './parallelDecode/frameAccess';

export type { ParallelDecodeClipInfo } from './parallelDecode/clipWindow';
export type { ParallelDecodeFrameLookupOptions } from './parallelDecode/frameLookup';
export type { SamplePresentationTiming } from './parallelDecode/sampleTiming';
export {
  getNormalizedSampleSourceTime,
  getNormalizedSampleTimestampMicroseconds,
  getPresentationOffsetSeconds,
} from './parallelDecode/sampleTiming';
export type {
  ParallelDecodeClipRuntimeSnapshot,
  ParallelDecodeRuntimeSnapshot,
} from './parallelDecode/runtimeSnapshot';

export const MAX_PARALLEL_DECODE_POOL_SIZE = 8;

export class ParallelDecodeManager {
  private clipDecoders: Map<string, ClipDecoder> = new Map();
  private clipInfos: Map<string, ClipInfo> = new Map();
  private clipInitializationPromises: Map<string, Promise<ClipDecoder>> = new Map();
  private isActive = false;
  private decodePromises: Map<string, Promise<void>> = new Map();
  private frameTolerance = 50_000;  // Default 50ms in microseconds
  private decoderUseSerial = 0;

  /**
   * Initialize the manager with clips to decode
   */
  async initialize(clips: ClipInfo[], exportFps: number): Promise<void> {
    const endInit = log.time('initialize');
    this.isActive = true;
    // FPS-based tolerance: 1.5 frame duration
    this.frameTolerance = Math.round((1_000_000 / exportFps) * 1.5);

    this.clipInfos = new Map(clips.map(clip => [clip.clipId, clip]));
    log.info(`Registered ${clips.length} clips for sliding-window decode`);
    endInit();
  }

  /**
   * Register a clip and parse its MP4 samples. The native decoder is leased
   * later, when the sliding export window reaches this clip.
   */
  private async initializeClip(clipInfo: ClipInfo): Promise<ClipDecoder> {
    const fileData = clipInfo.fileData ?? await clipInfo.loadFileData?.();
    if (!fileData) {
      throw new Error(`FAST export failed: Could not load file data for clip "${clipInfo.clipName}".`);
    }
    const parseResult = await parseMP4TrackInfo({ ...clipInfo, fileData });
    const hwAccel = await this.findSupportedHwAccel(parseResult.baseConfig, clipInfo.clipName);
    const codecConfig = createHardwareDecoderConfig(parseResult.baseConfig, hwAccel);

    const presentationOffsetSeconds = getPresentationOffsetSeconds(parseResult.samples);
    if (Math.abs(presentationOffsetSeconds) > 0.0005) {
      log.info(`"${clipInfo.clipName}": normalizing MP4 presentation offset ${presentationOffsetSeconds.toFixed(3)}s so source starts at 0.000s`);
    }
    if (!this.isActive || !this.clipInfos.has(clipInfo.clipId)) {
      throw new DOMException(
        `FAST export initialization was cancelled for "${clipInfo.clipName}".`,
        'AbortError',
      );
    }

    const clipDecoder: ClipDecoder = {
      clipId: clipInfo.clipId,
      clipName: clipInfo.clipName,
      decoder: null,
      decoderUseSerial: 0,
      samples: parseResult.samples,
      sampleIndex: 0,
      videoTrack: parseResult.videoTrack,
      codecConfig,
      presentationOffsetSeconds,
      frameBuffer: new Map(),
      sortedTimestamps: [],
      oldestTimestamp: Infinity,
      newestTimestamp: -Infinity,
      lastDecodedTimestamp: 0,
      clipInfo,
      isDecoding: false,
      pendingDecode: null,
      needsKeyframe: true, // Decoder was just configure()'d — first chunk must be a keyframe
    };

    this.clipDecoders.set(clipInfo.clipId, clipDecoder);
    log.info(`Clip "${clipInfo.clipName}" registered dormant: ${parseResult.videoTrack.video.width}x${parseResult.videoTrack.video.height} (${parseResult.samples.length} samples ready, hwAccel=${hwAccel})`);
    return clipDecoder;
  }

  private async ensureClipInitialized(clipInfo: ClipInfo): Promise<ClipDecoder> {
    const existing = this.clipDecoders.get(clipInfo.clipId);
    if (existing) return existing;

    let pending = this.clipInitializationPromises.get(clipInfo.clipId);
    if (!pending) {
      pending = this.initializeClip(clipInfo);
      this.clipInitializationPromises.set(clipInfo.clipId, pending);
      const clearPending = () => {
        if (this.clipInitializationPromises.get(clipInfo.clipId) === pending) {
          this.clipInitializationPromises.delete(clipInfo.clipId);
        }
      };
      void pending.then(clearPending, clearPending);
    }
    return pending;
  }

  private async ensureWindowClipsInitialized(timelineTime: number): Promise<void> {
    const windowClips = Array.from(this.clipInfos.values()).filter(clipInfo =>
      getPrefetchTargetForClip(
        clipInfo,
        timelineTime,
        UPCOMING_CLIP_PREFETCH_SECONDS
      ) !== null
    );
    await Promise.all(windowClips.map(clipInfo => this.ensureClipInitialized(clipInfo)));
  }

  private touchDecoder(clipDecoder: ClipDecoder): void {
    clipDecoder.decoderUseSerial = ++this.decoderUseSerial;
  }

  private createConfiguredDecoder(clipDecoder: ClipDecoder): VideoDecoder {
    const decoder = new VideoDecoder({
      output: (frame) => {
        if (!this.isActive) {
          frame.close();
          return;
        }
        const current = this.clipDecoders.get(clipDecoder.clipId);
        if (current) {
          this.handleDecodedFrame(current, frame);
        } else {
          frame.close();
        }
      },
      error: (e) => {
        if (!this.isActive) {
          if (isDecoderResetAbort(e)) {
            log.debug(`Decoder reset cancelled pending work for ${clipDecoder.clipName}`);
          }
          return;
        }
        log.error(`Decoder error for ${clipDecoder.clipName}: ${e.message || e}`);
      },
    });

    try {
      decoder.configure(clipDecoder.codecConfig);
    } catch (error) {
      try { decoder.close(); } catch { /* configure may already have closed it */ }
      throw error;
    }
    clipDecoder.decoder = decoder;
    clipDecoder.needsKeyframe = true;
    clipDecoder.sampleIndex = 0;
    this.touchDecoder(clipDecoder);
    log.info(
      `Decoder leased to "${clipDecoder.clipName}" ` +
      `(${this.getActiveDecoderCount()}/${MAX_PARALLEL_DECODE_POOL_SIZE} active)`
    );
    return decoder;
  }

  private getActiveDecoderCount(): number {
    let count = 0;
    for (const clipDecoder of this.clipDecoders.values()) {
      if (clipDecoder.decoder && clipDecoder.decoder.state !== 'closed') {
        count += 1;
      }
    }
    return count;
  }

  private releaseDecoderHandle(clipDecoder: ClipDecoder): void {
    const decoder = clipDecoder.decoder;
    if (!decoder) return;

    try {
      if (decoder.state !== 'closed') {
        decoder.reset();
        decoder.close();
      }
    } catch {
      // A codec error may already have closed the handle.
    }
    clipDecoder.decoder = null;
    clipDecoder.needsKeyframe = true;
    clipDecoder.sampleIndex = 0;
  }

  private async ensureDecoder(clipDecoder: ClipDecoder): Promise<VideoDecoder> {
    const existing = clipDecoder.decoder;
    if (existing?.state === 'configured') {
      this.touchDecoder(clipDecoder);
      return existing;
    }
    if (existing) {
      this.releaseDecoderHandle(clipDecoder);
    }

    while (this.getActiveDecoderCount() >= MAX_PARALLEL_DECODE_POOL_SIZE) {
      const candidate = Array.from(this.clipDecoders.values())
        .filter(item =>
          item !== clipDecoder &&
          item.decoder !== null &&
          !item.isDecoding &&
          !item.pendingDecode
        )
        .sort((a, b) => a.decoderUseSerial - b.decoderUseSerial)[0];

      if (candidate) {
        log.debug(`Recycling decoder from "${candidate.clipName}" to "${clipDecoder.clipName}"`);
        this.releaseDecoderHandle(candidate);
        break;
      }

      const pending = Array.from(this.clipDecoders.values())
        .filter(item => item !== clipDecoder)
        .map(item => item.pendingDecode)
        .filter((promise): promise is Promise<void> => promise !== null);
      if (pending.length === 0) {
        throw new Error(
          `FAST export decoder pool is saturated (${MAX_PARALLEL_DECODE_POOL_SIZE} active decoders).`
        );
      }
      await Promise.race(pending);
    }

    if (!this.isActive) {
      throw new DOMException('FAST export decoder pool is no longer active.', 'AbortError');
    }

    return this.createConfiguredDecoder(clipDecoder);
  }

  /**
   * Handle a decoded frame from VideoDecoder output callback
   * Uses the frame's timestamp directly for accurate time mapping
   * Optimized: maintains sorted timestamp list for O(log n) lookups
   */
  private handleDecodedFrame(clipDecoder: ClipDecoder, frame: VideoFrame): void {
    // If cleanup has started, immediately close the frame
    if (!this.isActive) {
      frame.close();
      return;
    }

    const timestamp = frame.timestamp;  // microseconds
    const sourceTime = timestamp / 1_000_000;  // convert to seconds

    const existingFrame = clipDecoder.frameBuffer.get(timestamp);
    if (existingFrame) {
      this.closeDecodedFrame(existingFrame);
      removeBufferedTimestamp(clipDecoder, timestamp);
    }

    // Log first 5 frames for debugging
    if (clipDecoder.frameBuffer.size < 5) {
      log.debug(`"${clipDecoder.clipName}": Frame ${clipDecoder.frameBuffer.size + 1} decoded at ${sourceTime.toFixed(3)}s (timestamp=${timestamp}µs)`);
    }

    // Store frame by its timestamp and maintain sorted index + bounds
    storeDecodedFrame(clipDecoder, frame, timestamp, sourceTime);

    // Cleanup if buffer too large - remove oldest (no sorting needed)
    while (clipDecoder.frameBuffer.size > MAX_BUFFER_SIZE && clipDecoder.sortedTimestamps.length > 0) {
      const oldestTs = clipDecoder.sortedTimestamps.shift()!;
      const oldFrame = clipDecoder.frameBuffer.get(oldestTs);
      if (oldFrame) {
        this.closeDecodedFrame(oldFrame);
        clipDecoder.frameBuffer.delete(oldestTs);
      }
    }

    refreshBufferedTimestampBounds(clipDecoder);
  }

  private closeDecodedFrame(decodedFrame: DecodedFrame): void {
    try {
      decodedFrame.frame.close();
    } catch {
      // The frame may already be closed after decoder reset/cleanup.
    }
  }

  /**
   * Pre-decode frames for a specific timeline time across all clips
   * Optimized for speed: fires decode ahead in background, only waits if frame is missing
   */
  async prefetchFramesForTime(timelineTime: number): Promise<void> {
    await this.ensureWindowClipsInitialized(timelineTime);
    return runPrefetchFramesForTime(this.prefetchDeps(), timelineTime);
  }

  async prefetchFrameForClipSourceTime(clipId: string, sourceTime: number): Promise<void> {
    if (!this.isActive) return;

    let clipDecoder = this.clipDecoders.get(clipId);
    if (!clipDecoder) {
      const clipInfo = this.clipInfos.get(clipId);
      if (!clipInfo) return;
      clipDecoder = await this.ensureClipInitialized(clipInfo);
    }

    if (clipDecoder.samples.length === 0) {
      const maxWaitMs = 10000;
      const startWait = performance.now();
      while (clipDecoder.samples.length === 0 && performance.now() - startWait < maxWaitMs) {
        await new Promise(r => setTimeout(r, 50));
      }
      if (clipDecoder.samples.length === 0) {
        throw new Error(`Parallel decode initialization failed: "${clipDecoder.clipName}" has no samples after waiting ${maxWaitMs}ms`);
      }
    }

    const clampedSourceTime = Math.max(
      clipDecoder.clipInfo.inPoint,
      Math.min(sourceTime, clipDecoder.clipInfo.outPoint - 0.001)
    );
    const targetTimestamp = clampedSourceTime * 1_000_000;
    const targetSampleIndex = findSampleIndexForSourceTime(
      clipDecoder.samples,
      clampedSourceTime,
      clipDecoder.presentationOffsetSeconds
    );
    const frameInBuffer = hasUsableBufferedFrame(
      clipDecoder.sortedTimestamps,
      clipDecoder.oldestTimestamp,
      clipDecoder.newestTimestamp,
      targetTimestamp,
      this.frameTolerance * 2
    );

    if (!frameInBuffer && !clipDecoder.isDecoding) {
      const decodePlan = createDecodeSchedulingPlan({
        sampleIndex: clipDecoder.sampleIndex,
        targetSampleIndex,
        frameBufferSize: clipDecoder.frameBuffer.size,
        frameInBuffer,
      });
      await this.decodeAhead(
        clipDecoder,
        decodePlan.decodeTarget,
        decodePlan.shouldSeekDirectlyToTarget,
        0,
        targetSampleIndex
      );
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      if (!this.isActive) return;
      if (clipDecoder.pendingDecode) {
        await clipDecoder.pendingDecode;
      }
      const frameFound = hasUsableBufferedFrame(
        clipDecoder.sortedTimestamps,
        clipDecoder.oldestTimestamp,
        clipDecoder.newestTimestamp,
        targetTimestamp,
        this.frameTolerance * 3
      );
      if (frameFound) return;

      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 8));
      } else if ((clipDecoder.decoder?.decodeQueueSize ?? 0) > 0) {
        const decoder = await this.ensureDecoder(clipDecoder);
        await decoder.flush();
        clipDecoder.needsKeyframe = true;
      } else if (!clipDecoder.isDecoding) {
        const decodeTarget = Math.max(targetSampleIndex + BUFFER_AHEAD_FRAMES, BUFFER_AHEAD_FRAMES);
        await this.decodeAhead(clipDecoder, decodeTarget, true, 0, targetSampleIndex);
      } else {
        await new Promise(r => setTimeout(r, 10));
      }
    }

    throw new Error(`FAST export failed: "${clipDecoder.clipName}" has no decoded frame at ${clampedSourceTime.toFixed(3)}s after source-time prefetch.`);
  }

  /** Host surface for the prefetch coordinator; decoder/frame handles and decode-ahead stay owned here. */
  private prefetchDeps(): ParallelDecodePrefetchDeps {
    return {
      isActive: () => this.isActive,
      clipDecoders: this.clipDecoders,
      frameToleranceUs: this.frameTolerance,
      ensureDecoder: (clipDecoder) => this.ensureDecoder(clipDecoder),
      decodeAhead: (clipDecoder, targetSampleIndex, forceFlush, recursionDepth, seekTargetSampleIndex) =>
        this.decodeAhead(clipDecoder, targetSampleIndex, forceFlush, recursionDepth, seekTargetSampleIndex),
    };
  }

  /**
   * Recreate a decoder that has entered the permanent 'closed' state due to an error.
   * WebCodecs decoders cannot be reset() once closed - a full recreate is needed.
   * Re-checks hardware acceleration support since the original mode may have been the cause.
   */
  private async recreateDecoder(clipDecoder: ClipDecoder): Promise<VideoDecoder> {
    log.warn(`${clipDecoder.clipName}: Recreating closed decoder`);

    // Re-check hardware acceleration — the original mode may have caused the failure
    const hwAccel = await this.findSupportedHwAccel(clipDecoder.codecConfig, clipDecoder.clipName);
    const newConfig = createHardwareDecoderConfig(clipDecoder.codecConfig, hwAccel);

    // Create new decoder with same callbacks
    const newDecoder = new VideoDecoder({
      output: (frame) => {
        if (!this.isActive) {
          frame.close();
          return;
        }
        const cd = this.clipDecoders.get(clipDecoder.clipId);
        if (cd) {
          this.handleDecodedFrame(cd, frame);
        } else {
          frame.close();
        }
      },
      error: (e) => {
        if (!this.isActive) {
          if (isDecoderResetAbort(e)) {
            log.debug(`Decoder reset cancelled pending work for ${clipDecoder.clipName}`);
          }
          return;
        }
        log.error(`Decoder error for ${clipDecoder.clipName}: ${e.message || e}`);
      },
    });

    // Configure with updated codec config
    try {
      newDecoder.configure(newConfig);
    } catch (e) {
      log.error(`${clipDecoder.clipName}: Failed to configure recreated decoder: ${e}`);
      throw e;
    }

    // Replace decoder and config
    clipDecoder.decoder = newDecoder;
    clipDecoder.codecConfig = newConfig;
    clipDecoder.needsKeyframe = true;
    clipDecoder.sampleIndex = 0;

    // Clear stale buffer
    for (const [, decodedFrame] of clipDecoder.frameBuffer) {
      try { decodedFrame.frame.close(); } catch (_) { /* already closed */ }
    }
    clearFrameBufferState(clipDecoder);

    log.info(`${clipDecoder.clipName}: Decoder recreated successfully (hwAccel=${hwAccel})`);
    this.touchDecoder(clipDecoder);
    return newDecoder;
  }

  /**
   * Decode frames ahead to fill buffer - optimized for throughput
   * Does NOT flush after every batch - frames arrive via output callback asynchronously
   * @param seekTargetSampleIndex - If provided, use this for seek keyframe calculation instead of targetSampleIndex
   *                                This is important when targetSampleIndex includes buffer-ahead frames
   */
  private async decodeAhead(clipDecoder: ClipDecoder, targetSampleIndex: number, forceFlush: boolean = false, recursionDepth: number = 0, seekTargetSampleIndex?: number): Promise<void> {
    // Prevent infinite recursion
    if (recursionDepth > 3) {
      log.warn(`${clipDecoder.clipName}: Max recursion depth reached (${recursionDepth}), stopping`);
      return;
    }

    if (clipDecoder.isDecoding) {
      log.debug(`${clipDecoder.clipName}: Already decoding, skipping`);
      return; // Let current decode continue, don't wait
    }

    clipDecoder.isDecoding = true;

    clipDecoder.pendingDecode = (async () => {
      try {
        let decoder = await this.ensureDecoder(clipDecoder);
        if (decoder.state === 'closed') {
          decoder = await this.recreateDecoder(clipDecoder);
        }
        // Check if we need to seek (target is far from current position - either ahead OR behind)
        // But ONLY seek if forceFlush is true (we actually need the frame now)
        // Background decodes should just continue forward, not seek
        const { isTooFarAhead, isTooFarBehind, needsSeek } = getDecodeSeekState({
          forceFlush,
          sampleIndex: clipDecoder.sampleIndex,
          targetSampleIndex,
          seekTargetSampleIndex,
        });

        // IMPORTANT: Do seek FIRST before calculating framesToDecode
        // Otherwise if we're past the target, framesToDecode will be negative and we'll return early
        if (needsSeek) {
          // Need to seek - find nearest keyframe before the ACTUAL target we need
          const seekTarget = getSeekTargetSampleIndex(
            clipDecoder.samples.length,
            targetSampleIndex,
            seekTargetSampleIndex
          );
          // Find keyframe candidates by CTS (display time), not decode order.
          // Due to B-frame reordering, a keyframe earlier in decode order
          // can have a LATER CTS than the target, causing wrong frames to be decoded.
          const targetSourceTime = getNormalizedSampleSourceTime(
            clipDecoder.samples[seekTarget],
            clipDecoder.presentationOffsetSeconds
          );
          const keyframeCandidates = collectPresentationKeyframeCandidates(
            clipDecoder.samples,
            clipDecoder.presentationOffsetSeconds,
            targetSourceTime
          );

          const exportConfig = clipDecoder.codecConfig;

          // Try keyframes from closest to earliest - some samples marked is_sync
          // by MP4Box aren't real IDR keyframes (e.g. open-GOP recovery points).
          // The decoder rejects these, so we fall back to earlier keyframes.
          const maxAttempts = Math.min(keyframeCandidates.length, 5);
          for (let k = keyframeCandidates.length - 1; k >= keyframeCandidates.length - maxAttempts; k--) {
            const candidateIndex = keyframeCandidates[k];
            const candidateSample = clipDecoder.samples[candidateIndex];
            const candidateSourceTime = getNormalizedSampleSourceTime(
              candidateSample,
              clipDecoder.presentationOffsetSeconds
            ).toFixed(3);

            decoder.reset();
            decoder.configure(exportConfig);

            const chunk = createEncodedChunkForSample(
              candidateSample,
              clipDecoder.presentationOffsetSeconds,
              'key'
            );

            try {
              decoder.decode(chunk);
              clipDecoder.sampleIndex = candidateIndex + 1; // Already decoded this one
              log.debug(`${clipDecoder.clipName}: Seek keyframe accepted at sample ${candidateIndex} (source=${candidateSourceTime}s, targetSource=${targetSourceTime.toFixed(3)}s, bufferTarget=${targetSampleIndex})`);
              break;
            } catch (e) {
              log.debug(`${clipDecoder.clipName}: Seek keyframe REJECTED at sample ${candidateIndex} (source=${candidateSourceTime}s) - not a real IDR, trying earlier`);
              if (k === keyframeCandidates.length - maxAttempts) {
                // Last attempt failed - reset and start from first sample
                decoder.reset();
                decoder.configure(exportConfig);
                clipDecoder.sampleIndex = 0;
                log.warn(`${clipDecoder.clipName}: No valid keyframe found after ${maxAttempts} attempts, starting from sample 0`);
              }
            }
          }

          clipDecoder.needsKeyframe = false;

          // Clear buffer since we're seeking
          for (const [, decodedFrame] of clipDecoder.frameBuffer) {
            decodedFrame.frame.close();
          }
          clearFrameBufferState(clipDecoder);
        }

        // Calculate frames to decode AFTER potential seek (sampleIndex may have changed)
        const endIndex = Math.min(targetSampleIndex, clipDecoder.samples.length);
        let framesToDecode = endIndex - clipDecoder.sampleIndex;

        if (framesToDecode <= 0) {
          log.debug(`${clipDecoder.clipName}: No frames to decode (sampleIndex=${clipDecoder.sampleIndex}, target=${targetSampleIndex})`);
          return;
        }

        // Decode in larger batches for throughput
        // Use much larger batch for seeks to reach target in one go
        const batchSize = getDecodeBatchSize(needsSeek);
        framesToDecode = Math.min(framesToDecode, batchSize);

        log.debug(`${clipDecoder.clipName}: Decoding ${framesToDecode} frames (from sample ${clipDecoder.sampleIndex} to ${clipDecoder.sampleIndex + framesToDecode}), forceFlush=${forceFlush}, needsSeek=${needsSeek} (ahead=${isTooFarAhead}, behind=${isTooFarBehind}), batchSize=${batchSize}`);

        // After flush/configure, decoder requires next chunk to be a keyframe.
        // Reset decoder and start from nearest keyframe (same approach as seek path).
        if (clipDecoder.needsKeyframe && !needsSeek) {
          const keyframeIndex = findKeyframeAtOrBeforeSample(
            clipDecoder.samples,
            clipDecoder.sampleIndex
          );
          // Reset decoder to clean state and start from keyframe
          decoder.reset();
          decoder.configure(clipDecoder.codecConfig);
          clipDecoder.sampleIndex = keyframeIndex;
          clipDecoder.needsKeyframe = false;
          log.debug(`${clipDecoder.clipName}: needsKeyframe - reset decoder, starting from keyframe at sample ${keyframeIndex}`);
        }

        // Queue frames for decode (non-blocking - output callback handles results)
        let decodedCount = 0;
        let needsKeyframeRecovery = false;
        for (let i = 0; i < framesToDecode && clipDecoder.sampleIndex < clipDecoder.samples.length; i++) {
          const sample = clipDecoder.samples[clipDecoder.sampleIndex];

          // Safety: if decoder rejected a delta frame, skip until next keyframe
          if (needsKeyframeRecovery && !sample.is_sync) {
            clipDecoder.sampleIndex++;
            continue;
          }
          if (needsKeyframeRecovery && sample.is_sync) {
            // Found a keyframe — reset decoder to clean state before feeding it
            decoder.reset();
            decoder.configure(clipDecoder.codecConfig);
            needsKeyframeRecovery = false;
            log.debug(`${clipDecoder.clipName}: keyframe recovery at sample ${clipDecoder.sampleIndex}`);
          }

          clipDecoder.sampleIndex++;

          const chunk = createEncodedChunkForSample(
            sample,
            clipDecoder.presentationOffsetSeconds,
            sample.is_sync ? 'key' : 'delta'
          );

          try {
            decoder.decode(chunk);
            decodedCount++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes('key frame')) {
              // Decoder needs a keyframe — skip delta frames until we find one
              needsKeyframeRecovery = true;
              log.debug(`${clipDecoder.clipName}: key frame required at sample ${clipDecoder.sampleIndex - 1}, scanning for next keyframe`);
            } else {
              log.warn(`${clipDecoder.clipName}: decode error at sample ${clipDecoder.sampleIndex - 1}: ${e}`);
            }
          }
        }

        log.debug(`${clipDecoder.clipName}: Queued ${decodedCount} chunks to decoder, decodeQueueSize=${decoder.decodeQueueSize}`);

        // Only flush if explicitly requested (when we need frames NOW)
        if (forceFlush) {
          await decoder.flush();
          clipDecoder.needsKeyframe = true; // After flush, next decode needs keyframe
        }
      } catch (e) {
        if (!this.isActive && isDecoderResetAbort(e)) {
          log.debug(`${clipDecoder.clipName}: pending decode cancelled by decoder reset during cleanup`);
          return;
        }
        log.error(`Decode error for ${clipDecoder.clipName}: ${e}`);
        throw e;
      } finally {
        clipDecoder.isDecoding = false;
        clipDecoder.pendingDecode = null;
      }
    })();

    await clipDecoder.pendingDecode;

    // If we're still behind target after the batch, decode more recursively
    // BUT: Don't recurse if we just did a seek (needsSeek), as the seek resets sampleIndex
    // and would cause infinite recursion. Instead, let the next prefetch call handle it.
    const stillBehind = clipDecoder.sampleIndex < targetSampleIndex;
    // Check if a seek happened (either direction) - recompute same logic as above
    const didSeek = hasDecodeSeekDistance(clipDecoder.sampleIndex, targetSampleIndex);

    if (forceFlush && stillBehind && !didSeek && recursionDepth < 3) {
      const remainingFrames = targetSampleIndex - clipDecoder.sampleIndex;
      log.debug(`${clipDecoder.clipName}: Still behind target (sampleIndex=${clipDecoder.sampleIndex}, targetIdx=${targetSampleIndex}, remaining=${remainingFrames}), decoding additional batch (recursion ${recursionDepth + 1}/3)`);
      await this.decodeAhead(clipDecoder, targetSampleIndex, true, recursionDepth + 1);
    } else if (stillBehind) {
      log.debug(`${clipDecoder.clipName}: Still behind target (sampleIndex=${clipDecoder.sampleIndex}, targetIdx=${targetSampleIndex}), stopping (${didSeek ? 'after seek' : 'max recursion'})`);
    }
  }

  /**
   * Get the decoded frame for a clip at a specific timeline time
   * Returns null if frame isn't ready (shouldn't happen if prefetch was called)
   */
  getFrameForClip(
    clipId: string,
    timelineTime: number,
    options: ParallelDecodeFrameLookupOptions = {}
  ): VideoFrame | null {
    const clipDecoder = this.clipDecoders.get(clipId);
    if (!clipDecoder) return null;

    const frame = getBufferedFrameForClip(clipDecoder, timelineTime, this.frameTolerance, options);
    if (frame) this.touchDecoder(clipDecoder);
    return frame;
  }

  getFrameForClipSourceTime(
    clipId: string,
    sourceTime: number,
    options: ParallelDecodeFrameLookupOptions = {}
  ): VideoFrame | null {
    const clipDecoder = this.clipDecoders.get(clipId);
    if (!clipDecoder) return null;

    const clampedSourceTime = Math.max(
      clipDecoder.clipInfo.inPoint,
      Math.min(sourceTime, clipDecoder.clipInfo.outPoint - 0.001)
    );
    const frame = getBufferedFrameForClipSourceTime(
      clipDecoder,
      clampedSourceTime,
      this.frameTolerance,
      options,
    );
    if (frame) this.touchDecoder(clipDecoder);
    return frame;
  }

  /**
   * Get all frames for the current timeline time
   * Returns Map of clipId -> VideoFrame
   */
  async getFramesAtTime(timelineTime: number): Promise<Map<string, VideoFrame>> {
    // First prefetch to ensure frames are decoded
    await this.prefetchFramesForTime(timelineTime);

    const frames = new Map<string, VideoFrame>();

    for (const [clipId] of this.clipDecoders) {
      const frame = this.getFrameForClip(clipId, timelineTime);
      if (frame) {
        frames.set(clipId, frame);
      }
    }

    return frames;
  }

  /**
   * Advance buffer position after rendering a frame
   * Call this after successfully rendering to clean up old frames
   */
  advanceToTime(timelineTime: number): void {
    for (const [, clipDecoder] of this.clipDecoders) {
      const clipInfo = clipDecoder.clipInfo;
      const clipEnd =
        getClipMainTimelineStart(clipInfo) +
        getClipMainTimelineDuration(clipInfo);

      // Once the sequential export window has passed a clip, retire its
      // decoder and buffered frames. Later clips can reuse the same pool slot.
      if (timelineTime > clipEnd + 0.25 && !clipDecoder.isDecoding) {
        this.releaseDecoderHandle(clipDecoder);
        for (const [, decodedFrame] of clipDecoder.frameBuffer) {
          this.closeDecodedFrame(decodedFrame);
        }
        clearFrameBufferState(clipDecoder);
        this.clipDecoders.delete(clipDecoder.clipId);
        continue;
      }

      // Skip if time is not in this clip's range
      if (!isTimeInClipRange(clipInfo, timelineTime)) {
        continue;
      }

      const sourceTime = timelineToSourceTime(clipInfo, timelineTime);
      const currentTimestamp = sourceTime * 1_000_000;  // Convert to microseconds

      // Clean up frames that are significantly behind current position (> 200ms behind)
      const timestampsToRemove: number[] = [];
      for (const [timestamp, decodedFrame] of clipDecoder.frameBuffer) {
        if (timestamp < currentTimestamp - 200_000) {  // 200ms behind
          decodedFrame.frame.close();
          timestampsToRemove.push(timestamp);
        }
      }

      for (const timestamp of timestampsToRemove) {
        clipDecoder.frameBuffer.delete(timestamp);
      }

      if (timestampsToRemove.length > 0) {
        const removedTimestamps = new Set(timestampsToRemove);
        clipDecoder.sortedTimestamps = clipDecoder.sortedTimestamps.filter(timestamp => !removedTimestamps.has(timestamp));
        refreshBufferedTimestampBounds(clipDecoder);
      }
    }
  }

  /**
   * Check if a clip is managed by this decoder
   */
  hasClip(clipId: string): boolean {
    return this.clipInfos.has(clipId);
  }

  getSourceRotationDegreesForClip(clipId: string): VideoRotationDegrees {
    return getVideoTrackRotation(this.clipDecoders.get(clipId)?.videoTrack);
  }

  getRuntimeSnapshot(): ParallelDecodeRuntimeSnapshot {
    return createParallelDecodeRuntimeSnapshot({
      isActive: this.isActive,
      frameToleranceUs: this.frameTolerance,
      clips: Array.from(this.clipDecoders.values()).map(buildClipRuntimeSnapshot),
      registeredClipIds: Array.from(this.clipInfos.keys()),
    });
  }

  /**
   * Find a supported hardwareAcceleration mode for the given config.
   * Tries prefer-software first (most reliable for export), then prefer-hardware, then no-preference.
   */
  private async findSupportedHwAccel(
    baseConfig: VideoDecoderConfig,
    clipName: string
  ): Promise<HardwareAcceleration> {
    for (const mode of HARDWARE_ACCELERATION_MODES) {
      try {
        const result = await VideoDecoder.isConfigSupported({ ...baseConfig, hardwareAcceleration: mode });
        if (result.supported) {
          if (mode !== 'prefer-software') {
            log.info(`"${clipName}": prefer-software not supported, using ${mode}`);
          }
          return mode;
        }
      } catch {
        // isConfigSupported threw — skip this mode
      }
    }

    // None explicitly supported — fall back to no-preference and let configure() decide
    log.warn(`"${clipName}": No hwAccel mode reported as supported for codec ${baseConfig.codec}, trying no-preference`);
    return 'no-preference';
  }

  /**
   * Cleanup all resources
   */
  cleanup(): void {
    // Set inactive first - this ensures handleDecodedFrame closes any new frames
    this.isActive = false;

    for (const [, clipDecoder] of this.clipDecoders) {
      // Reset decoder first to stop any pending decode operations
      // This will cause output callback to fire for any buffered frames
      try {
        if (clipDecoder.decoder && clipDecoder.decoder.state !== 'closed') {
          clipDecoder.decoder.reset();
        }
      } catch (e) {
        // Ignore reset errors
      }

      // Close all buffered frames
      for (const [, decodedFrame] of clipDecoder.frameBuffer) {
        try {
          decodedFrame.frame.close();
        } catch (e) {
          // Frame may already be closed
        }
      }
      clipDecoder.frameBuffer.clear();
      clipDecoder.sortedTimestamps = [];

      // Close decoder
      try {
        if (clipDecoder.decoder && clipDecoder.decoder.state !== 'closed') {
          clipDecoder.decoder.close();
        }
      } catch (e) {
        // Ignore close errors
      }
    }

    this.clipDecoders.clear();
    this.clipInfos.clear();
    this.clipInitializationPromises.clear();
    this.decodePromises.clear();
    log.info('Cleaned up');
  }
}
