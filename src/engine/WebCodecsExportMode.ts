// WebCodecsExportMode - Sequential export frame decoding extracted from WebCodecsPlayer
// Manages pre-decoded frame buffer for frame-accurate video export

import { Logger } from '../services/logger';
import type { Sample } from './webCodecsTypes';
import {
  computePresentationOffsetUs,
  normalizedSampleTimestampUs,
  frameToleranceUs,
  findClosestSampleIndex,
  findKeyframeBefore,
  findClosestFrameIndex,
  findBufferedFrameIndex as findBufferedCtsIndex,
} from './webCodecsExport/exportSamplePlanning';

const log = Logger.create('WebCodecsExportMode');

/**
 * Interface for the player internals that export mode needs access to.
 * WebCodecsPlayer implements this to expose its internal state.
 */
export interface ExportModePlayer {
  getDecoder(): VideoDecoder | null;
  getSamples(): Sample[];
  getSampleIndex(): number;
  setSampleIndex(index: number): void;
  getVideoTrackTimescale(): number | null;
  getCodecConfig(): VideoDecoderConfig | null;
  getFrameRate(): number;
  getCurrentFrame(): VideoFrame | null;
  setCurrentFrame(frame: VideoFrame | null): void;
  isSimpleMode(): boolean;
  seekAsync(time: number): Promise<void>;
  // Recreate a fresh VideoDecoder after the current one errored/closed mid-export.
  recreateExportDecoder?(): VideoDecoder | null;
}

export class WebCodecsExportMode {
  // A decoded 1080p VideoFrame can occupy several MB of GPU memory. The old
  // 120/90-frame windows allowed a single export to retain hundreds of MB (or
  // more, depending on the decoder's backing format) and could crash Chrome's
  // GPU process on long, densely-cut timelines. Keep a small rolling window;
  // sequential export only needs enough headroom to hide decoder latency.
  // Hardware decoders commonly expose only a small surface pool. Retaining a
  // 24-36 frame window can exhaust that pool and stall decode completely.
  // Keep the rolling window below the usual surface limit so FAST export can
  // use hardware decode without deadlocking.
  private static readonly TARGET_LOOKAHEAD_SAMPLES = 4;
  private static readonly INITIAL_FRAME_SEARCH_SAMPLES = 32;
  private static readonly RECOVERY_FRAME_SEARCH_SAMPLES = 32;
  private static readonly DECODE_LOOKAHEAD_SAMPLES = 4;
  private static readonly KEEP_FRAMES_BEHIND = 1;
  // Start the background decode-ahead while the buffer is still half full, so it
  // finishes before the export catches the buffer edge (otherwise the export
  // briefly freezes at every decode-window boundary).
  private static readonly WARM_AHEAD_THRESHOLD_SAMPLES = 2;
  // Timeline cuts may jump minutes forward inside one source. Beyond two
  // normal lookahead windows, restart at the target keyframe instead of
  // decoding every intermediate sample.
  private static readonly MAX_SEQUENTIAL_FORWARD_GAP_SAMPLES = 48;
  // Max pending decodes before applying backpressure. Software decoders can throw
  // a generic "Decoding error" (EncodingError) when fed far ahead, which closes
  // the decoder and forces a slow keyframe restart — pacing the feed avoids that.
  // Kept well above the old unbounded feed (whole window at once) but high enough
  // that the decode-ahead stays comfortably in front of the export.
  private static readonly MAX_DECODE_QUEUE = 2;

  private player: ExportModePlayer;

  // Export mode state
  private isActive = false;
  private exportFrameBuffer: Map<number, VideoFrame> = new Map(); // CTS (us) -> VideoFrame
  private exportFramesCts: number[] = []; // Sorted CTS values for index-based lookup
  private exportCurrentIndex = 0;
  private decodeCursorIndex = 0;
  private presentationOffsetUs = 0;
  private pendingWarmBuffer: Promise<void> | null = null;
  private discardOutputBeforeCtsUs: number | null = null;

  constructor(player: ExportModePlayer) {
    this.player = player;
  }

  private getConfiguredDecoderOrThrow(context: string): VideoDecoder {
    const decoder = this.player.getDecoder();
    if (!decoder) {
      throw new Error(`FAST export decoder missing during ${context}`);
    }
    if (decoder.state === 'closed') {
      throw new Error(`FAST export decoder closed during ${context}`);
    }
    return decoder;
  }

  private isRecoverableDecoderFailure(error: unknown): boolean {
    if ((this.player.getDecoder()?.state ?? 'closed') === 'closed') {
      return true;
    }

    const record = typeof error === 'object' && error !== null
      ? error as { name?: unknown; message?: unknown }
      : null;
    const name = typeof record?.name === 'string' ? record.name : '';
    const message = typeof record?.message === 'string'
      ? record.message.toLowerCase()
      : String(error).toLowerCase();

    return name === 'FastExportDecoderClosedError'
      || name === 'InvalidStateError'
      || name === 'EncodingError'
      || message.includes('decoder closed')
      || message.includes('closed codec')
      || message.includes('decoding error');
  }

  private getFrameToleranceUs(multiplier = 1.5): number {
    return frameToleranceUs(this.player.getFrameRate(), multiplier);
  }

  private getNormalizedSampleTimestampUs(sample: Sample): number {
    return normalizedSampleTimestampUs(sample, this.presentationOffsetUs);
  }

  private getRetainedHistoryStartCtsUs(targetCtsUs: number): number {
    const frameDurationUs = 1_000_000 / Math.max(1, this.player.getFrameRate());
    return targetCtsUs - WebCodecsExportMode.KEEP_FRAMES_BEHIND * frameDurationUs;
  }

  private async decodeWindowDiscardingDistantPreroll(
    startIndex: number,
    endIndexExclusive: number,
    targetCtsUs: number
  ): Promise<void> {
    const previousDiscardBoundary = this.discardOutputBeforeCtsUs;
    this.discardOutputBeforeCtsUs = this.getRetainedHistoryStartCtsUs(targetCtsUs);
    try {
      await this.decodeSampleWindow(startIndex, endIndexExclusive, targetCtsUs);
    } finally {
      this.discardOutputBeforeCtsUs = previousDiscardBoundary;
    }
  }

  private refreshBufferedFrameIndex(): void {
    this.exportFramesCts = Array.from(this.exportFrameBuffer.keys()).sort((a, b) => a - b);
  }

  private findBufferedFrameIndex(targetCtsUs: number, toleranceUs = this.getFrameToleranceUs()): number {
    return findBufferedCtsIndex(this.exportFramesCts, targetCtsUs, toleranceUs);
  }

  private async waitForBufferedTarget(
    targetCtsUs: number,
    timeoutMs: number,
    toleranceUs = this.getFrameToleranceUs(2.5)
  ): Promise<void> {
    const startTime = performance.now();
    let previousBufferSize = this.exportFrameBuffer.size;
    let stablePolls = 0;

    while (performance.now() - startTime < timeoutMs) {
      this.refreshBufferedFrameIndex();
      if (this.findBufferedFrameIndex(targetCtsUs, toleranceUs) >= 0) {
        return;
      }

      const decoder = this.getConfiguredDecoderOrThrow('waitForBufferedTarget');
      const bufferSize = this.exportFrameBuffer.size;
      const queueSize = decoder.decodeQueueSize;

      if (bufferSize !== previousBufferSize || queueSize > 0) {
        previousBufferSize = bufferSize;
        stablePolls = 0;
      } else {
        stablePolls += 1;
        if (stablePolls >= 4) {
          break;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.refreshBufferedFrameIndex();
  }

  private closeCurrentFrame(): void {
    const currentFrame = this.player.getCurrentFrame();
    if (!currentFrame) {
      return;
    }
    try { currentFrame.close(); } catch {}
    this.player.setCurrentFrame(null);
  }

  private async reconfigureDecoderForExport(context: string): Promise<void> {
    let decoder = this.player.getDecoder();
    // Recover from a decoder that errored out (closed) mid-export by recreating
    // it, instead of throwing — one bad warmup decode shouldn't kill the export.
    if (!decoder || decoder.state === 'closed') {
      decoder = this.player.recreateExportDecoder?.() ?? null;
      if (!decoder || decoder.state === 'closed') {
        throw new Error(`FAST export decoder unavailable during ${context}`);
      }
      log.warn(`Recreated FAST export decoder after it closed (${context})`);
    }

    const codecConfig = this.player.getCodecConfig();
    if (!codecConfig) {
      throw new Error(`FAST export codec config missing during ${context}`);
    }

    decoder.reset();
    decoder.configure({
      ...codecConfig,
      hardwareAcceleration: 'prefer-hardware',
    });
  }

  private async decodeSampleWindow(
    startIndex: number,
    endIndexExclusive: number,
    targetCtsUs: number
  ): Promise<void> {
    const samples = this.player.getSamples();
    if (startIndex >= endIndexExclusive || startIndex >= samples.length) {
      return;
    }

    const decoder = this.getConfiguredDecoderOrThrow(`decodeSampleWindow ${startIndex}-${endIndexExclusive}`);

    for (let i = startIndex; i < endIndexExclusive; i++) {
      // Backpressure: wait for the decode queue to drain before queuing more, so
      // a software decoder isn't overwhelmed (the main cause of mid-export
      // "Decoding error" closes and the periodic 1fps keyframe restarts).
      let backpressureGuard = 0;
      while (decoder.decodeQueueSize >= WebCodecsExportMode.MAX_DECODE_QUEUE && backpressureGuard < 500) {
        if (decoder.state === 'closed') {
          throw new Error(`FAST export decoder closed during decodeSampleWindow ${startIndex}-${endIndexExclusive}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2));
        backpressureGuard++;
      }

      const sample = samples[i];
      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: this.getNormalizedSampleTimestampUs(sample),
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      });

      try {
        decoder.decode(chunk);
      } catch (e) {
        const errorRecord = typeof e === 'object' && e !== null
          ? e as { name?: unknown; message?: unknown }
          : null;
        const message = typeof errorRecord?.message === 'string'
          ? errorRecord.message
          : String(e);
        const errorName = typeof errorRecord?.name === 'string' ? errorRecord.name : '';
        if (
          decoder.state === 'closed' ||
          errorName === 'InvalidStateError' ||
          errorName === 'EncodingError'
        ) {
          const decoderError = new Error(
            `FAST export decoder closed while decoding sample ${i}: ${message}`
          );
          decoderError.name = 'FastExportDecoderClosedError';
          throw decoderError;
        }
        if (message.includes('key frame')) {
          throw new Error(`FAST export lost keyframe context near sample ${i}`);
        }
        throw e instanceof Error
          ? e
          : new Error(`FAST export decode failed at sample ${i}: ${message}`);
      }
    }

    this.decodeCursorIndex = Math.max(this.decodeCursorIndex, endIndexExclusive);
    this.player.setSampleIndex(this.decodeCursorIndex);

    // Flushing mid-stream can cut a GOP and trigger a decoder failure.
    // Only drain with flush when we truly reached the end of the source.
    if (endIndexExclusive >= samples.length) {
      await this.waitForDecoderFlush(Math.max(4000, (endIndexExclusive - startIndex) * 10));
    } else {
      await this.waitForBufferedTarget(
        targetCtsUs,
        Math.max(1200, (endIndexExclusive - startIndex) * 12)
      );
    }

    this.refreshBufferedFrameIndex();
  }

  private async warmBufferAroundSample(targetSampleIndex: number): Promise<void> {
    const samples = this.player.getSamples();
    const targetSample = samples[targetSampleIndex];
    if (!targetSample) {
      return;
    }

    const endIndexExclusive = Math.min(
      samples.length,
      Math.max(
        targetSampleIndex + 1,
        this.decodeCursorIndex + WebCodecsExportMode.DECODE_LOOKAHEAD_SAMPLES
      )
    );

    await this.decodeSampleWindow(
      this.decodeCursorIndex,
      endIndexExclusive,
      this.getNormalizedSampleTimestampUs(targetSample)
    );
  }

  private scheduleWarmBufferAroundSample(targetSampleIndex: number): void {
    if (this.pendingWarmBuffer) {
      return;
    }

    this.pendingWarmBuffer = this.warmBufferAroundSample(targetSampleIndex)
      .catch((error) => {
        log.warn('Background export decode warmup failed', error);
      })
      .finally(() => {
        this.pendingWarmBuffer = null;
        // Keep the decode pipeline continuously ahead of the export so it never
        // catches the buffer edge (which caused a brief freeze at every window
        // boundary). Decode the next window right away while the buffer is shallow.
        this.maybeContinueWarming();
      });
  }

  private maybeContinueWarming(): void {
    if (this.pendingWarmBuffer || !this.isActive) {
      return;
    }
    const decoder = this.player.getDecoder();
    if (!decoder || decoder.state === 'closed') {
      return;
    }
    const samples = this.player.getSamples();
    if (this.decodeCursorIndex >= samples.length) {
      return;
    }
    const bufferedAhead = this.exportFramesCts.length - this.exportCurrentIndex;
    if (bufferedAhead >= WebCodecsExportMode.DECODE_LOOKAHEAD_SAMPLES) {
      return;
    }
    this.scheduleWarmBufferAroundSample(this.decodeCursorIndex);
  }

  private async restartFromKeyframe(targetSampleIndex: number): Promise<void> {
    const samples = this.player.getSamples();
    const targetSample = samples[targetSampleIndex];
    if (!targetSample) {
      return;
    }

    this.closeCurrentFrame();
    this.cleanupExportBuffer();
    this.exportFramesCts = [];
    this.exportCurrentIndex = 0;

    const keyframeIndex = findKeyframeBefore(samples, targetSampleIndex);
    await this.reconfigureDecoderForExport('restartFromKeyframe');
    this.decodeCursorIndex = keyframeIndex;
    this.player.setSampleIndex(keyframeIndex);

    let endIndexExclusive = Math.min(
      samples.length,
      targetSampleIndex + WebCodecsExportMode.TARGET_LOOKAHEAD_SAMPLES
    );
    const targetCtsUs = this.getNormalizedSampleTimestampUs(targetSample);

    await this.decodeWindowDiscardingDistantPreroll(
      keyframeIndex,
      endIndexExclusive,
      targetCtsUs
    );

    // Four samples are normally enough to make the target frame available, but
    // B-frame-heavy H.264/H.265 streams can retain it until more future samples
    // have been submitted. Grow the recovery window in bounded chunks instead
    // of returning with an empty buffer after the keyframe reset.
    const recoverySearchEnd = Math.min(
      samples.length,
      targetSampleIndex + WebCodecsExportMode.RECOVERY_FRAME_SEARCH_SAMPLES
    );
    while (
      this.findBufferedFrameIndex(targetCtsUs, this.getFrameToleranceUs()) < 0 &&
      endIndexExclusive < recoverySearchEnd
    ) {
      const nextEndIndexExclusive = Math.min(
        recoverySearchEnd,
        endIndexExclusive + WebCodecsExportMode.DECODE_LOOKAHEAD_SAMPLES
      );
      log.debug(
        `Recovery target still pending; extending decode window to sample ${nextEndIndexExclusive}`
      );
      await this.decodeWindowDiscardingDistantPreroll(
        endIndexExclusive,
        nextEndIndexExclusive,
        targetCtsUs
      );
      endIndexExclusive = nextEndIndexExclusive;
    }
  }

  /**
   * Handle decoder output during export mode - buffers all frames by CTS
   */
  handleDecoderOutput(frame: VideoFrame): void {
    const cts = frame.timestamp;
    if (
      this.discardOutputBeforeCtsUs !== null &&
      cts < this.discardOutputBeforeCtsUs
    ) {
      try { frame.close(); } catch {}
      return;
    }
    const existingFrame = this.exportFrameBuffer.get(cts);
    if (existingFrame && existingFrame !== frame) {
      if (existingFrame === this.player.getCurrentFrame()) {
        this.player.setCurrentFrame(frame);
      }
      try { existingFrame.close(); } catch {}
    }
    this.exportFrameBuffer.set(cts, frame);
  }

  /**
   * Check if currently in export mode
   */
  get isInExportMode(): boolean {
    return this.isActive;
  }

  /**
   * Prepare for sequential export - pre-decodes frames for the export range.
   */
  async prepareForSequentialExport(startTimeSeconds: number): Promise<void> {
    const endPrepare = log.time('prepareForSequentialExport');

    // Simple mode: browser handles decoding
    if (this.player.isSimpleMode()) {
      this.isActive = true;
      endPrepare();
      return;
    }

    const samples = this.player.getSamples();

    // Wait for samples to load (lazy loading means they might not be ready yet)
    if (samples.length === 0) {
      const endWaitSamples = log.time('waitForSamples');
      log.info('Waiting for samples to load...');
      const maxWaitMs = 10000;
      const startWait = performance.now();
      while (this.player.getSamples().length === 0 && performance.now() - startWait < maxWaitMs) {
        await new Promise(r => setTimeout(r, 50));
      }
      endWaitSamples();
      const loadedSamples = this.player.getSamples();
      if (loadedSamples.length === 0) {
        log.error('Timeout waiting for samples');
        endPrepare();
        return;
      }
      log.info(`Samples ready: ${loadedSamples.length} (waited ${(performance.now() - startWait).toFixed(0)}ms)`);
    } else {
      log.info(`Samples already loaded: ${samples.length}`);
    }

    const timescale = this.player.getVideoTrackTimescale();
    if (timescale === null) {
      endPrepare();
      return;
    }

    this.cleanupExportBuffer();
    this.exportFramesCts = [];
    this.exportCurrentIndex = 0;
    this.decodeCursorIndex = 0;
    this.closeCurrentFrame();

    this.isActive = true;

    const allSamples = this.player.getSamples();
    this.presentationOffsetUs = computePresentationOffsetUs(allSamples);
    const startSampleIndex = findClosestSampleIndex(allSamples, startTimeSeconds, this.presentationOffsetUs);

    const keyframeIndex = findKeyframeBefore(allSamples, startSampleIndex);
    const startSample = allSamples[startSampleIndex];
    let decodeEnd = Math.min(
      allSamples.length,
      startSampleIndex + WebCodecsExportMode.TARGET_LOOKAHEAD_SAMPLES
    );
    const startCtsUs = this.getNormalizedSampleTimestampUs(startSample);

    await this.reconfigureDecoderForExport('prepareForSequentialExport');
    this.decodeCursorIndex = keyframeIndex;
    this.player.setSampleIndex(keyframeIndex);

    log.info(
      `Preparing: keyframe=${keyframeIndex}, start=${startSampleIndex}, decoding ${decodeEnd - keyframeIndex} samples (total: ${allSamples.length})`
    );

    const endDecode = log.time('decodeInitialSamples');
    await this.decodeWindowDiscardingDistantPreroll(
      keyframeIndex,
      decodeEnd,
      startCtsUs
    );
    endDecode();

    // Some H.264/H.265 streams reorder more than four frames before emitting
    // the first presentation frame. Grow the initial window in small chunks so
    // FAST export does not fail merely because the decoder is still holding its
    // startup frames. The cap keeps a genuinely broken decoder bounded.
    const initialSearchEnd = Math.min(
      allSamples.length,
      startSampleIndex + WebCodecsExportMode.INITIAL_FRAME_SEARCH_SAMPLES
    );
    while (this.exportFramesCts.length === 0 && decodeEnd < initialSearchEnd) {
      const nextDecodeEnd = Math.min(
        initialSearchEnd,
        decodeEnd + WebCodecsExportMode.DECODE_LOOKAHEAD_SAMPLES
      );
      log.debug(`Initial frame still pending; extending decode window to sample ${nextDecodeEnd}`);
      await this.decodeWindowDiscardingDistantPreroll(decodeEnd, nextDecodeEnd, startCtsUs);
      decodeEnd = nextDecodeEnd;
    }

    const startFrameIndex = this.findBufferedFrameIndex(
      startCtsUs,
      this.getFrameToleranceUs(3)
    );

    if (startFrameIndex >= 0) {
      const startCts = this.exportFramesCts[startFrameIndex];
      this.player.setCurrentFrame(this.exportFrameBuffer.get(startCts) || null);
      this.exportCurrentIndex = startFrameIndex;
    } else if (this.exportFramesCts.length > 0) {
      const fallbackIndex = findClosestFrameIndex(this.exportFramesCts, startCtsUs);
      const fallbackCts = this.exportFramesCts[Math.max(0, fallbackIndex)];
      this.player.setCurrentFrame(this.exportFrameBuffer.get(fallbackCts) || null);
      this.exportCurrentIndex = Math.max(0, fallbackIndex);
    }

    if (!this.player.getCurrentFrame()) {
      throw new Error('FAST export could not buffer the initial frame');
    }

    log.info(
      `Ready: ${this.exportFrameBuffer.size} frames buffered, CTS range: ${this.exportFramesCts[0]?.toFixed(0)} - ${this.exportFramesCts[this.exportFramesCts.length - 1]?.toFixed(0)}`
    );
    endPrepare();
  }

  /**
   * Wait for decoder to flush with timeout fallback.
   * Only safe to use when we actually reached the end of the source.
   */
  private async waitForDecoderFlush(timeoutMs: number): Promise<void> {
    const decoder = this.getConfiguredDecoderOrThrow('waitForDecoderFlush');

    const startTime = performance.now();
    const startBufferSize = this.exportFrameBuffer.size;
    let flushError: unknown = null;

    const flushPromise = decoder.flush().catch(e => {
      flushError = e;
      log.warn(`Flush error: ${e}`);
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });

    await Promise.race([flushPromise, timeoutPromise]);

    const decoderAfter = this.player.getDecoder();
    if (!decoderAfter || decoderAfter.state === 'closed') {
      throw new Error('FAST export decoder closed during flush');
    }

    if (decoderAfter.decodeQueueSize > 0) {
      log.warn(`Flush timeout, waiting for queue (${decoderAfter.decodeQueueSize} remaining)...`);
      let waitCount = 0;
      while (
        this.player.getDecoder() &&
        this.player.getDecoder()!.state !== 'closed' &&
        this.player.getDecoder()!.decodeQueueSize > 0 &&
        waitCount < 100
      ) {
        await new Promise(r => setTimeout(r, 20));
        waitCount++;
      }
    }

    const decoderFinal = this.player.getDecoder();
    if (!decoderFinal || decoderFinal.state === 'closed') {
      throw new Error('FAST export decoder closed during queue drain');
    }

    if (flushError) {
      throw flushError instanceof Error
        ? flushError
        : new Error(`FAST export flush failed: ${String(flushError)}`);
    }

    const elapsed = performance.now() - startTime;
    const framesOutput = this.exportFrameBuffer.size - startBufferSize;
    log.debug(
      `Flush complete: ${framesOutput} frames output in ${elapsed.toFixed(0)}ms, buffer now ${this.exportFrameBuffer.size}`
    );
  }

  /**
   * Clean up export frame buffer
   */
  cleanupExportBuffer(): void {
    const currentFrame = this.player.getCurrentFrame();
    for (const frame of this.exportFrameBuffer.values()) {
      if (frame !== currentFrame) {
        try { frame.close(); } catch {}
      }
    }
    this.exportFrameBuffer.clear();
  }

  /**
   * Get frame for export at specified time.
   * Uses a rolling decode window and only resets the decoder on genuine backward jumps.
   */
  async seekDuringExport(timeSeconds: number): Promise<void> {
    if (this.player.isSimpleMode()) {
      await this.player.seekAsync(timeSeconds);
      return;
    }

    if (!this.isActive) {
      log.warn(`seekDuringExport: not in export mode at ${timeSeconds.toFixed(3)}s`);
      return;
    }

    const timescale = this.player.getVideoTrackTimescale();
    if (timescale === null) {
      log.warn(`seekDuringExport: missing videoTrack/decoder at ${timeSeconds.toFixed(3)}s`);
      return;
    }

    const requestedTargetCts = timeSeconds * 1_000_000;
    const samples = this.player.getSamples();
    const targetSampleIndex = findClosestSampleIndex(
      samples,
      timeSeconds,
      this.presentationOffsetUs
    );
    const targetSample = samples[targetSampleIndex];
    // Export times are sampled at the composition frame rate, but VFR media can
    // have substantially larger gaps between encoded presentation timestamps.
    // findClosestSampleIndex() already resolves the requested time to the frame
    // that should be shown, so buffer matching must use that sample's real CTS.
    // Matching the raw request time can reject the correct buffered frame, clear
    // it during an unnecessary keyframe restart, and leave reordered codecs with
    // no output at all.
    const targetCts = targetSample
      ? this.getNormalizedSampleTimestampUs(targetSample)
      : requestedTargetCts;

    let bestIndex = this.findBufferedFrameIndex(targetCts, this.getFrameToleranceUs());
    if (bestIndex >= 0 && bestIndex < this.exportFramesCts.length) {
      const cts = this.exportFramesCts[bestIndex];
      const foundFrame = this.exportFrameBuffer.get(cts);
      if (foundFrame) {
        this.player.setCurrentFrame(foundFrame);
        this.exportCurrentIndex = bestIndex;

        const framesRemaining = this.exportFramesCts.length - bestIndex;
        if (
          framesRemaining < WebCodecsExportMode.WARM_AHEAD_THRESHOLD_SAMPLES &&
          this.decodeCursorIndex < this.player.getSamples().length
        ) {
          log.debug(
            `Decoding ahead: ${framesRemaining} frames remaining, sampleIndex=${this.decodeCursorIndex}/${this.player.getSamples().length}`
          );
          this.scheduleWarmBufferAroundSample(targetSampleIndex);
        }

        this.cleanupOldFrames(bestIndex - WebCodecsExportMode.KEEP_FRAMES_BEHIND);
        return;
      }
    }

    const maxCtsInBuffer = this.exportFramesCts.length > 0
      ? this.exportFramesCts[this.exportFramesCts.length - 1]
      : 0;
    const minCtsInBuffer = this.exportFramesCts.length > 0
      ? this.exportFramesCts[0]
      : 0;

    log.warn(
      `Frame not in buffer: requested=${requestedTargetCts.toFixed(0)}, sample=${targetCts.toFixed(0)}, range=[${minCtsInBuffer.toFixed(0)}-${maxCtsInBuffer.toFixed(0)}], bufferSize=${this.exportFramesCts.length}`
    );

    if (this.pendingWarmBuffer) {
      await this.pendingWarmBuffer;
      bestIndex = this.findBufferedFrameIndex(targetCts, this.getFrameToleranceUs(3));
      if (bestIndex >= 0 && bestIndex < this.exportFramesCts.length) {
        const cts = this.exportFramesCts[bestIndex];
        this.player.setCurrentFrame(this.exportFrameBuffer.get(cts) || null);
        this.exportCurrentIndex = bestIndex;
        this.cleanupOldFrames(bestIndex - WebCodecsExportMode.KEEP_FRAMES_BEHIND);
        return;
      }
    }

    // A closed decoder must restart from a keyframe (which recreates it) — decoding
    // more samples on a dead decoder would just keep throwing.
    const decoderClosed = (this.player.getDecoder()?.state ?? 'closed') === 'closed';
    const largeForwardJump =
      targetSampleIndex >
      this.decodeCursorIndex + WebCodecsExportMode.MAX_SEQUENTIAL_FORWARD_GAP_SAMPLES;
    try {
      if (
        decoderClosed ||
        targetCts < minCtsInBuffer ||
        targetSampleIndex < this.decodeCursorIndex - WebCodecsExportMode.KEEP_FRAMES_BEHIND ||
        largeForwardJump
      ) {
        const reason = decoderClosed
          ? 'decoder closed — recovering'
          : largeForwardJump
            ? `forward source jump of ${targetSampleIndex - this.decodeCursorIndex} samples`
            : 'backward source jump';
        log.info(`Restarting FAST decode window around ${timeSeconds.toFixed(3)}s (${reason})`);
        await this.restartFromKeyframe(targetSampleIndex);
      } else {
        if (targetCts > maxCtsInBuffer) {
          log.info(`Decoding more: target ahead of buffer by ${((targetCts - maxCtsInBuffer) / 1000).toFixed(1)}ms`);
        } else {
          log.info('Decoding more: target within current window but frame is not buffered yet');
        }
        await this.warmBufferAroundSample(targetSampleIndex);
      }
    } catch (error) {
      if (!this.isRecoverableDecoderFailure(error)) {
        throw error;
      }
      log.warn(
        `FAST export decoder failed near ${timeSeconds.toFixed(3)}s; restarting from the previous keyframe`,
        error
      );
      await this.restartFromKeyframe(targetSampleIndex);
    }

    bestIndex = this.findBufferedFrameIndex(targetCts, this.getFrameToleranceUs(3));
    if (bestIndex >= 0 && bestIndex < this.exportFramesCts.length) {
      const cts = this.exportFramesCts[bestIndex];
      this.player.setCurrentFrame(this.exportFrameBuffer.get(cts) || null);
      this.exportCurrentIndex = bestIndex;
      this.cleanupOldFrames(bestIndex - WebCodecsExportMode.KEEP_FRAMES_BEHIND);
      return;
    }

    if (this.exportFramesCts.length > 0) {
      bestIndex = findClosestFrameIndex(this.exportFramesCts, targetCts);
      const fallbackCts = this.exportFramesCts[Math.max(0, bestIndex)];
      this.player.setCurrentFrame(this.exportFrameBuffer.get(fallbackCts) || null);
      this.exportCurrentIndex = Math.max(0, bestIndex);
      log.warn(`Using fallback frame at CTS ${fallbackCts.toFixed(0)} for target ${targetCts.toFixed(0)}`);
      return;
    }

    log.error(`No frames in buffer for seek to ${timeSeconds.toFixed(3)}s`);
    throw new Error(`FAST export could not decode frame at ${timeSeconds.toFixed(3)}s`);
  }

  /**
   * Clean up frames before a certain index to free memory
   */
  private cleanupOldFrames(keepFromIndex: number): void {
    if (keepFromIndex <= 0) {
      return;
    }

    const currentFrame = this.player.getCurrentFrame();
    const toRemove = this.exportFramesCts.slice(0, keepFromIndex);
    for (const cts of toRemove) {
      const frame = this.exportFrameBuffer.get(cts);
      if (frame && frame !== currentFrame) {
        try { frame.close(); } catch {}
      }
      this.exportFrameBuffer.delete(cts);
    }
    this.exportFramesCts = this.exportFramesCts.slice(keepFromIndex);
    this.exportCurrentIndex = Math.max(0, this.exportCurrentIndex - keepFromIndex);
  }

  /**
   * End sequential export mode and clean up
   */
  endSequentialExport(): void {
    this.isActive = false;
    this.cleanupExportBuffer();
    this.exportFramesCts = [];
    this.exportCurrentIndex = 0;
    this.decodeCursorIndex = 0;
    this.pendingWarmBuffer = null;
    this.discardOutputBeforeCtsUs = null;
    log.info('Export mode ended');
  }

  /**
   * Destroy and clean up all export buffers
   */
  destroy(): void {
    for (const frame of this.exportFrameBuffer.values()) {
      try { frame.close(); } catch {}
    }
    this.exportFrameBuffer.clear();
    this.exportFramesCts = [];
    this.exportCurrentIndex = 0;
    this.decodeCursorIndex = 0;
    this.pendingWarmBuffer = null;
    this.discardOutputBeforeCtsUs = null;
    this.isActive = false;
  }
}
