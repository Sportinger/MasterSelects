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
import { hasExpectedBufferedFrame, isExpectedFrameInFlight, type ClipDecoder } from './clipDecoderState';
import { FAST_EXPORT_NEIGHBOUR_TOLERANCE_MULTIPLIER } from './frameLookup';

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
  timelineTime: number,
  sourceTimeOverrides?: ReadonlyMap<string, number>,
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
    const sourceTime = sourceTimeOverrides?.get(clipDecoder.clipId)
      ?? timelineToSourceTime(clipInfo, prefetchTarget.timelineTime);
    const targetSampleIndex = findSampleIndexForSourceTime(
      clipDecoder.samples,
      sourceTime,
      clipDecoder.presentationOffsetSeconds
    );

    // Fast path only when exactly the frame shown at sourceTime is buffered. A
    // neighbour within a tolerance used to count as ready, so a frame still held in
    // the decoder (or dropped by a pool reset) was replaced by the previous one
    // without any fallback being counted (EXPORT_STALE_LAYER_FRAMES).
    const { start: bufferStart, end: bufferEnd } = getBufferedTimeRangeForLog(
      clipDecoder.sortedTimestamps
    );
    const frameInBuffer = hasExpectedBufferedFrame(clipDecoder, sourceTime);
    // A target already queued on the decoder is coming: never seek (reset) for it.
    // The blocking wait below waits for its output and escalates only when it stalls.
    const frameInFlight = !frameInBuffer && isExpectedFrameInFlight(clipDecoder, sourceTime, targetSampleIndex);
    const frameReady = frameInBuffer || frameInFlight;

    log.debug(`"${clipInfo.clipName}": Frame check - target=${sourceTime.toFixed(3)}s, buffer=${clipDecoder.frameBuffer.size} frames [${bufferStart}s-${bufferEnd}s], frameInBuffer=${frameInBuffer}, inFlight=${frameInFlight}`);

    // Trigger decode ahead - ALWAYS await if we're behind the target sample
    // Also need to decode if frame is not in buffer (we might be too far ahead and need to seek back)
    const decodePlan = createDecodeSchedulingPlan({
      sampleIndex: clipDecoder.sampleIndex,
      targetSampleIndex,
      frameBufferSize: clipDecoder.frameBuffer.size,
      frameInBuffer: frameReady,
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
      if (!frameReady) {
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
        // Frame buffered or still decoding - background decode for future frames
        log.debug(`"${clipInfo.clipName}": Background decode (frame ${frameInBuffer ? 'in buffer' : 'in flight'})`);
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
    const sourceTime = sourceTimeOverrides?.get(clipDecoder.clipId)
      ?? timelineToSourceTime(clipInfo, timelineTime);
    const targetTimestamp = sourceTime * 1_000_000;
    const targetSampleIndex = findSampleIndexForSourceTime(
      clipDecoder.samples,
      sourceTime,
      clipDecoder.presentationOffsetSeconds
    );
    const blockingStart = performance.now();
    const wait = await waitForExactBufferedFrame(deps, clipDecoder, sourceTime, targetSampleIndex);
    if (wait.aborted) return;
    const attemptsUsed = wait.attempts;

    // Final check: without the exact frame, a neighbour within 3x tolerance still
    // lets the export continue, but the frame lookup reports that substitution as a
    // previous-frame fallback (frameAccess.ts). Nothing nearby fails the export.
    const exactFound = wait.exactFound;
    const finalCheck = exactFound || wait.neighbourFound;
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
        exactFound,
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

/** Longest time an in-flight target may go without decoder progress before the wait flushes. */
export const IN_FLIGHT_STALL_MS = 750;
/** Longest total wait for an in-flight target before the flush/re-decode escalation. */
export const IN_FLIGHT_WAIT_BUDGET_MS = 3_000;
const IN_FLIGHT_POLL_MS = 4;

type InFlightWaitOutcome = 'aborted' | 'done' | 'stalled';

/**
 * Wait for a target that is still queued on the decoder, as long as the decoder
 * makes progress (queue shrinks or new frames arrive). A flush waits for the whole
 * queue as well and then forces a keyframe rewind on the next pass, and a seek
 * drops the queued frames; both are only right once the decoder has stalled or the
 * budget is spent. Frames held back for reordering with an empty queue need the
 * flush, so this only waits while chunks are queued.
 */
async function waitForInFlightFrame(
  deps: ParallelDecodePrefetchDeps,
  clipDecoder: ClipDecoder,
  sourceTime: number,
  targetSampleIndex: number,
): Promise<InFlightWaitOutcome> {
  const started = performance.now();
  let lastProgressAt = started;
  let lastNewest = clipDecoder.newestTimestamp;
  let lastQueue = clipDecoder.decoder?.decodeQueueSize ?? 0;
  while (
    (clipDecoder.decoder?.decodeQueueSize ?? 0) > 0
    && isExpectedFrameInFlight(clipDecoder, sourceTime, targetSampleIndex)
  ) {
    if (!deps.isActive()) return 'aborted';
    const now = performance.now();
    if (now - lastProgressAt >= IN_FLIGHT_STALL_MS || now - started >= IN_FLIGHT_WAIT_BUDGET_MS) {
      log.warn(`"${clipDecoder.clipName}": frame at ${sourceTime.toFixed(4)}s is still queued after ${(now - started).toFixed(0)}ms (queue=${lastQueue}); escalating to flush`);
      return 'stalled';
    }
    await new Promise(r => setTimeout(r, IN_FLIGHT_POLL_MS));
    const queue = clipDecoder.decoder?.decodeQueueSize ?? 0;
    if (queue !== lastQueue || clipDecoder.newestTimestamp !== lastNewest) {
      lastProgressAt = performance.now();
      lastQueue = queue;
      lastNewest = clipDecoder.newestTimestamp;
    }
  }
  return 'done';
}

export interface ExactFrameWaitResult {
  /** The active export stopped while waiting. */
  aborted: boolean;
  exactFound: boolean;
  /** No exact frame, but a neighbour within NEIGHBOUR_FALLBACK_TOLERANCE_MULTIPLIER × frame tolerance is buffered. */
  neighbourFound: boolean;
  attempts: number;
}

/** Same window as the export layer lookup and the first-frame check (frameLookup.ts). */
export const NEIGHBOUR_FALLBACK_TOLERANCE_MULTIPLIER = FAST_EXPORT_NEIGHBOUR_TOLERANCE_MULTIPLIER;
export const EXACT_FRAME_WAIT_ATTEMPTS = 10;

/**
 * Blocking wait for exactly the frame shown at sourceTime, with an escalating
 * strategy: wait for a target still queued on the decoder while it makes progress
 * (bounded by IN_FLIGHT_STALL_MS / IN_FLIGHT_WAIT_BUDGET_MS), wait for the async
 * output callback, flush (queued chunks, and once
 * frames the decoder holds back for reordering even with an empty queue), then
 * re-decode from the keyframe. Shared by the per-time prefetch and the per-clip
 * source-time prefetch so both treat a sample that never decodes the same way:
 * after the attempts a buffered neighbour lets the export continue (the export
 * layer lookup logs and counts that substitution through
 * recordNeighbourFrameFallback); only when nothing is nearby does the caller fail.
 */
export async function waitForExactBufferedFrame(
  deps: ParallelDecodePrefetchDeps,
  clipDecoder: ClipDecoder,
  sourceTime: number,
  targetSampleIndex: number,
): Promise<ExactFrameWaitResult> {
  let flushedHeldFrames = false;
  let attempts = 0;
  if (clipDecoder.pendingDecode) {
    await clipDecoder.pendingDecode;
  }
  if (await waitForInFlightFrame(deps, clipDecoder, sourceTime, targetSampleIndex) === 'aborted') {
    return { aborted: true, exactFound: false, neighbourFound: false, attempts };
  }
  for (let attempt = 0; attempt < EXACT_FRAME_WAIT_ATTEMPTS; attempt++) {
    if (!deps.isActive()) return { aborted: true, exactFound: false, neighbourFound: false, attempts };
    attempts = attempt + 1;
    if (clipDecoder.pendingDecode) {
      await clipDecoder.pendingDecode;
    }
    if (hasExpectedBufferedFrame(clipDecoder, sourceTime)) {
      if (attempt > 0) log.debug(`"${clipDecoder.clipName}": Frame found after ${attempt + 1} attempts`);
      return { aborted: false, exactFound: true, neighbourFound: false, attempts };
    }
    if (attempt < 2) {
      // First 2 attempts: just wait briefly for async output callback
      await new Promise(r => setTimeout(r, 8));
    } else if (
      (clipDecoder.decoder?.decodeQueueSize ?? 0) > 0
      || (!flushedHeldFrames && !clipDecoder.isDecoding && clipDecoder.decoder?.state === 'configured')
    ) {
      const decoder = await deps.ensureDecoder(clipDecoder);
      log.debug(`"${clipDecoder.clipName}": Flushing decoder (attempt ${attempt + 1}, queue=${decoder.decodeQueueSize})`);
      flushedHeldFrames = true;
      await decoder.flush();
      clipDecoder.needsKeyframe = true;
    } else if (!clipDecoder.isDecoding) {
      log.debug(`"${clipDecoder.clipName}": Re-decode with flush (attempt ${attempt + 1}, queue empty)`);
      const decodeTarget = Math.max(targetSampleIndex + BUFFER_AHEAD_FRAMES, BUFFER_AHEAD_FRAMES);
      await deps.decodeAhead(clipDecoder, decodeTarget, true, 0, targetSampleIndex);
    } else {
      await new Promise(r => setTimeout(r, 10));
    }
  }
  if (hasExpectedBufferedFrame(clipDecoder, sourceTime)) {
    return { aborted: false, exactFound: true, neighbourFound: false, attempts };
  }
  const neighbourFound = hasUsableBufferedFrame(
    clipDecoder.sortedTimestamps,
    clipDecoder.oldestTimestamp,
    clipDecoder.newestTimestamp,
    sourceTime * 1_000_000,
    deps.frameToleranceUs * NEIGHBOUR_FALLBACK_TOLERANCE_MULTIPLIER,
  );
  if (neighbourFound) {
    log.warn(`"${clipDecoder.clipName}": frame at ${sourceTime.toFixed(4)}s did not decode after ${attempts} attempts; a buffered neighbour stands in (counted as a neighbour-frame fallback)`);
  }
  return { aborted: false, exactFound: false, neighbourFound, attempts };
}
