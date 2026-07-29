/**
 * Prewarm/prefetch scheduling for parallel decode: decides which clips need
 * frames for a timeline time, fires decode-ahead, and runs the escalating
 * blocking-wait strategy until frames land in the buffer.
 *
 * Decoder configure/reset/close and VideoFrame close() calls stay in
 * ParallelDecodeManager — this module only schedules via the injected
 * decodeAhead and reads/flushes decoders it does not own.
 */

import { Logger } from '../../services/logger';
const log = Logger.create('ParallelDecode');

import {
  getClipMainTimelineStart,
  getPrefetchTargetForClip,
  timelineToSourceTime,
} from './clipWindow';
import {
  BUFFER_AHEAD_FRAMES,
  MAX_PREWARM_CLIP_STARTS,
  SLOW_BLOCKING_PREFETCH_WARN_MS,
  UPCOMING_CLIP_PREFETCH_SECONDS,
  createDecodeSchedulingPlan,
  findSampleIndexForSourceTime,
  getBufferedTimeRangeForLog,
  hasUsableBufferedFrame,
} from './scheduling';
import type { ClipDecoder } from './clipDecoderState';

/**
 * Host surface the manager exposes to the coordinator. Handles (decoders,
 * frame buffers) stay referenced through the manager-owned ClipDecoder map.
 */
export interface ParallelDecodePrefetchDeps {
  isActive(): boolean;
  clipDecoders: ReadonlyMap<string, ClipDecoder>;
  frameToleranceUs: number;
  ensureDecoder(clipDecoder: ClipDecoder): Promise<VideoDecoder>;
  decodeAhead(
    clipDecoder: ClipDecoder,
    targetSampleIndex: number,
    forceFlush?: boolean,
    recursionDepth?: number,
    seekTargetSampleIndex?: number
  ): Promise<void>;
}

export async function prewarmClipStarts(
  deps: ParallelDecodePrefetchDeps,
  startTime: number,
  endTime: number,
  maxStarts: number = MAX_PREWARM_CLIP_STARTS
): Promise<number> {
  if (!deps.isActive() || deps.clipDecoders.size === 0) {
    return 0;
  }

  const clipStartTimes = new Map<number, number>();
  for (const [, clipDecoder] of deps.clipDecoders) {
    const clipStart = getClipMainTimelineStart(clipDecoder.clipInfo);
    if (clipStart <= startTime + 0.0005 || clipStart >= endTime) {
      continue;
    }

    clipStartTimes.set(Math.round(clipStart * 1000), clipStart);
  }

  const prewarmTimes = Array.from(clipStartTimes.values())
    .sort((a, b) => a - b)
    .slice(0, maxStarts);

  for (const clipStart of prewarmTimes) {
    await prefetchFramesForTime(deps, clipStart);
  }

  return prewarmTimes.length;
}

/**
 * Pre-decode frames for a specific timeline time across all clips
 * Optimized for speed: fires decode ahead in background, only waits if frame is missing
 */
export async function prefetchFramesForTime(
  deps: ParallelDecodePrefetchDeps,
  timelineTime: number
): Promise<void> {
  log.debug(`prefetchFramesForTime(${timelineTime.toFixed(3)}) - isActive=${deps.isActive()}, decoders=${deps.clipDecoders.size}`);
  if (!deps.isActive()) return;

  const clipsNeedingFlush: ClipDecoder[] = [];

  for (const [, clipDecoder] of deps.clipDecoders) {
    const clipInfo = clipDecoder.clipInfo;
    const prefetchTarget = getPrefetchTargetForClip(
      clipInfo,
      timelineTime,
      UPCOMING_CLIP_PREFETCH_SECONDS
    );

    if (!prefetchTarget) {
      log.debug(`"${clipInfo.clipName}": Skipped - not in range (start=${clipInfo.startTime}, dur=${clipInfo.duration}, nested=${clipInfo.isNested})`);
      continue;
    }

    log.debug(`"${clipInfo.clipName}": Processing at time ${prefetchTarget.timelineTime.toFixed(3)}s - samples=${clipDecoder.samples.length}, buffer=${clipDecoder.frameBuffer.size}, decoderState=${clipDecoder.decoder?.state ?? 'dormant'}, blocking=${prefetchTarget.shouldBlock}`);

    // Wait for samples if lazy loading hasn't delivered them yet
    if (clipDecoder.samples.length === 0) {
      log.debug(`"${clipInfo.clipName}": Waiting for samples...`);
      const maxWaitMs = 10000; // 10 second max wait per clip (increased for large files)
      const startWait = performance.now();
      while (clipDecoder.samples.length === 0 && performance.now() - startWait < maxWaitMs) {
        await new Promise(r => setTimeout(r, 50));
      }
      if (clipDecoder.samples.length === 0) {
        const errorMsg = `"${clipInfo.clipName}" has no samples after waiting ${maxWaitMs}ms`;
        log.error(errorMsg);
        throw new Error(`Parallel decode initialization failed: ${errorMsg}`);
      }
      log.info(`"${clipInfo.clipName}" samples ready: ${clipDecoder.samples.length} (waited ${(performance.now() - startWait).toFixed(0)}ms)`);
    }

    // Calculate target source time and sample index
    const sourceTime = timelineToSourceTime(clipInfo, prefetchTarget.timelineTime);
    const targetSampleIndex = findSampleIndexForSourceTime(
      clipDecoder.samples,
      sourceTime,
      clipDecoder.presentationOffsetSeconds
    );

    // Check if frame is already in buffer (fast path)
    const targetTimestamp = sourceTime * 1_000_000;
    const checkTolerance = deps.frameToleranceUs * 2; // Double tolerance for buffer check

    // Get buffer time range for logging
    const { start: bufferStart, end: bufferEnd } = getBufferedTimeRangeForLog(
      clipDecoder.sortedTimestamps
    );
    const frameInBuffer = hasUsableBufferedFrame(
      clipDecoder.sortedTimestamps,
      clipDecoder.oldestTimestamp,
      clipDecoder.newestTimestamp,
      targetTimestamp,
      checkTolerance
    );

    log.debug(`"${clipInfo.clipName}": Frame check - target=${(targetTimestamp/1_000_000).toFixed(3)}s, buffer=${clipDecoder.frameBuffer.size} frames [${bufferStart}s-${bufferEnd}s], frameInBuffer=${frameInBuffer}, tolerance=${(checkTolerance/1000).toFixed(1)}ms`);

    // Trigger decode ahead - ALWAYS await if we're behind the target sample
    // Also need to decode if frame is not in buffer (we might be too far ahead and need to seek back)
    const decodePlan = createDecodeSchedulingPlan({
      sampleIndex: clipDecoder.sampleIndex,
      targetSampleIndex,
      frameBufferSize: clipDecoder.frameBuffer.size,
      frameInBuffer,
    });
    const {
      decodeTarget,
      needsDecoding,
      needsDecodingBack,
      isBehindTarget,
      shouldSeekDirectlyToTarget,
    } = decodePlan;

    if (needsDecoding && !clipDecoder.isDecoding) {
      log.debug(`"${clipInfo.clipName}": Triggering decode - samples=${clipDecoder.samples.length}, targetIdx=${targetSampleIndex}, currentIdx=${clipDecoder.sampleIndex}, decodeTarget=${decodeTarget}, frameInBuffer=${frameInBuffer}, isBehindTarget=${isBehindTarget}, needsBackSeek=${needsDecodingBack}, directSeek=${shouldSeekDirectlyToTarget}`);

      // Decode WITHOUT flush first — let output callback deliver frames async.
      // This avoids the expensive flush→needsKeyframe→reset→re-decode-from-keyframe cycle.
      // The retry loop below will flush only if the frame hasn't appeared.
      if (!frameInBuffer) {
        const decodePromise = deps.decodeAhead(
          clipDecoder,
          decodeTarget,
          shouldSeekDirectlyToTarget,
          0,
          targetSampleIndex
        );
        if (prefetchTarget.shouldBlock) {
          const directDecodeStart = performance.now();
          await decodePromise;
          const directDecodeMs = performance.now() - directDecodeStart;
          if (directDecodeMs >= SLOW_BLOCKING_PREFETCH_WARN_MS) {
            log.warn(`${clipDecoder.clipName}: slow direct prefetch decode`, {
              timelineTime: Number(prefetchTarget.timelineTime.toFixed(3)),
              sourceTime: Number(sourceTime.toFixed(3)),
              targetSampleIndex,
              decodeTarget,
              sampleIndex: clipDecoder.sampleIndex,
              directDecodeMs: Number(directDecodeMs.toFixed(1)),
              directSeek: shouldSeekDirectlyToTarget,
              decodeQueueSize: clipDecoder.decoder?.decodeQueueSize ?? 0,
              bufferSize: clipDecoder.frameBuffer.size,
              bufferedStart: Number.isFinite(clipDecoder.oldestTimestamp)
                ? Number((clipDecoder.oldestTimestamp / 1_000_000).toFixed(3))
                : null,
              bufferedEnd: Number.isFinite(clipDecoder.newestTimestamp)
                ? Number((clipDecoder.newestTimestamp / 1_000_000).toFixed(3))
                : null,
            });
          }
        } else {
          void decodePromise.catch(error => {
            log.warn(`"${clipDecoder.clipName}": upcoming-frame prefetch failed`, error);
          });
        }
      } else {
        // Frame already in buffer - background decode for future frames
        log.debug(`"${clipInfo.clipName}": Background decode (frame in buffer)`);
        void deps.decodeAhead(clipDecoder, decodeTarget, false).catch(error => {
          log.warn(`"${clipDecoder.clipName}": background decode failed`, error);
        });
      }
    }

    // Track clips that still need their frames
    if (prefetchTarget.shouldBlock && !frameInBuffer) {
      clipsNeedingFlush.push(clipDecoder);
    }
  }

  // Wait for clips that still need their frame — escalating strategy:
  // 1. Wait for async output callback (no flush)
  // 2. Flush only if frame hasn't appeared
  // 3. Re-decode with flush as last resort
  for (const clipDecoder of clipsNeedingFlush) {
    const clipInfo = clipDecoder.clipInfo;
    const sourceTime = timelineToSourceTime(clipInfo, timelineTime);
    const targetTimestamp = sourceTime * 1_000_000;
    const targetSampleIndex = findSampleIndexForSourceTime(
      clipDecoder.samples,
      sourceTime,
      clipDecoder.presentationOffsetSeconds
    );
    const blockingStart = performance.now();
    let attemptsUsed = 0;

    for (let attempt = 0; attempt < 10; attempt++) {
      if (!deps.isActive()) return;
      attemptsUsed = attempt + 1;
      // Wait for pending decode to complete
      if (clipDecoder.pendingDecode) {
        await clipDecoder.pendingDecode;
      }

      // Check if frame is now in buffer
      const frameFound = hasUsableBufferedFrame(
        clipDecoder.sortedTimestamps,
        clipDecoder.oldestTimestamp,
        clipDecoder.newestTimestamp,
        targetTimestamp,
        deps.frameToleranceUs * 2
      );

      if (frameFound) {
        if (attempt > 0) {
          log.debug(`"${clipDecoder.clipName}": Frame found after ${attempt + 1} attempts`);
        }
        break;
      }

      // Escalating strategy
      if (attempt < 2) {
        // First 2 attempts: just wait briefly for async output callback
        await new Promise(r => setTimeout(r, 8));
      } else if ((clipDecoder.decoder?.decodeQueueSize ?? 0) > 0) {
        // Flush decoder queue to force output
        const decoder = await deps.ensureDecoder(clipDecoder);
        log.debug(`"${clipDecoder.clipName}": Flushing decoder (attempt ${attempt + 1}, queue=${decoder.decodeQueueSize})`);
        await decoder.flush();
        clipDecoder.needsKeyframe = true;
      } else if (!clipDecoder.isDecoding) {
        // Queue is empty but frame not found — re-decode with forceFlush
        log.debug(`"${clipDecoder.clipName}": Re-decode with flush (attempt ${attempt + 1}, queue empty)`);
        const decodeTarget = Math.max(targetSampleIndex + BUFFER_AHEAD_FRAMES, BUFFER_AHEAD_FRAMES);
        await deps.decodeAhead(clipDecoder, decodeTarget, true, 0, targetSampleIndex);
      } else {
        // Decoder is busy, wait for it
        await new Promise(r => setTimeout(r, 10));
      }
    }

    // Final check - strict export should fail instead of using a nearby frame.
    const finalTolerance = deps.frameToleranceUs * 3; // 3x tolerance for final check
    const finalCheck = hasUsableBufferedFrame(
      clipDecoder.sortedTimestamps,
      clipDecoder.oldestTimestamp,
      clipDecoder.newestTimestamp,
      targetTimestamp,
      finalTolerance
    );
    const blockingMs = performance.now() - blockingStart;
    if (blockingMs >= SLOW_BLOCKING_PREFETCH_WARN_MS) {
      log.warn(`${clipDecoder.clipName}: slow blocking prefetch`, {
        timelineTime: Number(timelineTime.toFixed(3)),
        sourceTime: Number(sourceTime.toFixed(3)),
        targetSampleIndex,
        sampleIndex: clipDecoder.sampleIndex,
        attempts: attemptsUsed,
        blockingMs: Number(blockingMs.toFixed(1)),
        decodeQueueSize: clipDecoder.decoder?.decodeQueueSize ?? 0,
        bufferSize: clipDecoder.frameBuffer.size,
        bufferedStart: Number.isFinite(clipDecoder.oldestTimestamp)
          ? Number((clipDecoder.oldestTimestamp / 1_000_000).toFixed(3))
          : null,
        bufferedEnd: Number.isFinite(clipDecoder.newestTimestamp)
          ? Number((clipDecoder.newestTimestamp / 1_000_000).toFixed(3))
          : null,
        finalCheck,
      });
    }
    if (!finalCheck) {
      const availableFrames = Array.from(clipDecoder.frameBuffer.values())
        .map(f => (f.timestamp / 1_000_000).toFixed(3))
        .sort()
        .slice(0, 10)
        .join(', ');

      throw new Error(`FAST export failed: "${clipDecoder.clipName}" has no decoded frame at ${(targetTimestamp/1_000_000).toFixed(3)}s after all attempts (buffer: ${clipDecoder.frameBuffer.size} frames, decoderState: ${clipDecoder.decoder?.state ?? 'dormant'}, nearby: [${availableFrames}...]).`);
    }
  }
}
