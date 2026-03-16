// WebCodecsExportMode - Sequential export frame decoding extracted from WebCodecsPlayer
// Manages pre-decoded frame buffer for frame-accurate video export

import { Logger } from '../services/logger';
import type { Sample } from './webCodecsTypes';

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
}

export class WebCodecsExportMode {
  private static readonly INITIAL_LOOKAHEAD_SAMPLES = 90;
  private static readonly DECODE_LOOKAHEAD_SAMPLES = 60;
  private static readonly KEEP_FRAMES_BEHIND = 24;

  private player: ExportModePlayer;

  // Export mode state
  private isActive = false;
  private exportFrameBuffer: Map<number, VideoFrame> = new Map(); // CTS (us) -> VideoFrame
  private exportFramesCts: number[] = []; // Sorted CTS values for index-based lookup
  private exportCurrentIndex = 0;
  private decodeCursorIndex = 0;

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

  private getFrameToleranceUs(multiplier = 1.5): number {
    return (1_000_000 / Math.max(this.player.getFrameRate(), 1)) * multiplier;
  }

  private getSampleTimestampUs(sample: Sample): number {
    return (sample.cts * 1_000_000) / sample.timescale;
  }

  private findClosestSampleIndex(targetTimeSeconds: number): number {
    const timescale = this.player.getVideoTrackTimescale();
    const samples = this.player.getSamples();
    if (timescale === null || samples.length === 0) {
      return 0;
    }

    const targetTimeInTimescale = targetTimeSeconds * timescale;
    let targetSampleIndex = 0;
    let closestDiff = Infinity;

    for (let i = 0; i < samples.length; i++) {
      const diff = Math.abs(samples[i].cts - targetTimeInTimescale);
      if (diff < closestDiff) {
        closestDiff = diff;
        targetSampleIndex = i;
      }
    }

    return targetSampleIndex;
  }

  private findKeyframeBefore(targetSampleIndex: number): number {
    const samples = this.player.getSamples();
    for (let i = Math.min(targetSampleIndex, samples.length - 1); i >= 0; i--) {
      if (samples[i].is_sync) {
        return i;
      }
    }
    return 0;
  }

  private refreshBufferedFrameIndex(): void {
    this.exportFramesCts = Array.from(this.exportFrameBuffer.keys()).sort((a, b) => a - b);
  }

  private findBufferedFrameIndex(targetCtsUs: number, toleranceUs = this.getFrameToleranceUs()): number {
    const bestIndex = this.findClosestFrameIndex(targetCtsUs);
    if (bestIndex < 0 || bestIndex >= this.exportFramesCts.length) {
      return -1;
    }

    const bestCts = this.exportFramesCts[bestIndex];
    return Math.abs(bestCts - targetCtsUs) <= toleranceUs ? bestIndex : -1;
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
      if (this.findBufferedFrameIndex(targetCtsUs, toleranceUs) >= 0) {
        this.refreshBufferedFrameIndex();
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
    const decoder = this.getConfiguredDecoderOrThrow(context);
    const codecConfig = this.player.getCodecConfig();
    if (!codecConfig) {
      throw new Error(`FAST export codec config missing during ${context}`);
    }

    decoder.reset();
    decoder.configure({
      ...codecConfig,
      hardwareAcceleration: 'prefer-software',
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
      const sample = samples[i];
      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: this.getSampleTimestampUs(sample),
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      });

      try {
        decoder.decode(chunk);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
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
      this.getSampleTimestampUs(targetSample)
    );
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

    const keyframeIndex = this.findKeyframeBefore(targetSampleIndex);
    await this.reconfigureDecoderForExport('restartFromKeyframe');
    this.decodeCursorIndex = keyframeIndex;
    this.player.setSampleIndex(keyframeIndex);

    const endIndexExclusive = Math.min(
      samples.length,
      Math.max(
        targetSampleIndex + 1,
        keyframeIndex + WebCodecsExportMode.INITIAL_LOOKAHEAD_SAMPLES
      )
    );

    await this.decodeSampleWindow(
      keyframeIndex,
      endIndexExclusive,
      this.getSampleTimestampUs(targetSample)
    );
  }

  /**
   * Handle decoder output during export mode - buffers all frames by CTS
   */
  handleDecoderOutput(frame: VideoFrame): void {
    const cts = frame.timestamp;
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
    const targetTimeInTimescale = startTimeSeconds * timescale;
    let startSampleIndex = 0;
    let closestDiff = Infinity;
    for (let i = 0; i < allSamples.length; i++) {
      const diff = Math.abs(allSamples[i].cts - targetTimeInTimescale);
      if (diff < closestDiff) {
        closestDiff = diff;
        startSampleIndex = i;
      }
    }

    const keyframeIndex = this.findKeyframeBefore(startSampleIndex);
    const startSample = allSamples[startSampleIndex];
    const decodeEnd = Math.min(
      allSamples.length,
      Math.max(
        startSampleIndex + 1,
        keyframeIndex + WebCodecsExportMode.INITIAL_LOOKAHEAD_SAMPLES
      )
    );

    await this.reconfigureDecoderForExport('prepareForSequentialExport');
    this.decodeCursorIndex = keyframeIndex;
    this.player.setSampleIndex(keyframeIndex);

    log.info(
      `Preparing: keyframe=${keyframeIndex}, start=${startSampleIndex}, decoding ${decodeEnd - keyframeIndex} samples (total: ${allSamples.length})`
    );

    const endDecode = log.time('decodeInitialSamples');
    await this.decodeSampleWindow(
      keyframeIndex,
      decodeEnd,
      this.getSampleTimestampUs(startSample)
    );
    endDecode();

    const startFrameIndex = this.findBufferedFrameIndex(
      this.getSampleTimestampUs(startSample),
      this.getFrameToleranceUs(3)
    );

    if (startFrameIndex >= 0) {
      const startCts = this.exportFramesCts[startFrameIndex];
      this.player.setCurrentFrame(this.exportFrameBuffer.get(startCts) || null);
      this.exportCurrentIndex = startFrameIndex;
    } else if (this.exportFramesCts.length > 0) {
      const fallbackIndex = this.findClosestFrameIndex(this.getSampleTimestampUs(startSample));
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

    const targetCts = timeSeconds * 1_000_000;
    const targetSampleIndex = this.findClosestSampleIndex(timeSeconds);

    let bestIndex = this.findBufferedFrameIndex(targetCts, this.getFrameToleranceUs());
    if (bestIndex >= 0 && bestIndex < this.exportFramesCts.length) {
      const cts = this.exportFramesCts[bestIndex];
      const foundFrame = this.exportFrameBuffer.get(cts);
      if (foundFrame) {
        this.player.setCurrentFrame(foundFrame);
        this.exportCurrentIndex = bestIndex;

        const framesRemaining = this.exportFramesCts.length - bestIndex;
        if (framesRemaining < 30 && this.decodeCursorIndex < this.player.getSamples().length) {
          log.debug(
            `Decoding ahead: ${framesRemaining} frames remaining, sampleIndex=${this.decodeCursorIndex}/${this.player.getSamples().length}`
          );
          await this.warmBufferAroundSample(targetSampleIndex);
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
      `Frame not in buffer: target=${targetCts.toFixed(0)}, range=[${minCtsInBuffer.toFixed(0)}-${maxCtsInBuffer.toFixed(0)}], bufferSize=${this.exportFramesCts.length}`
    );

    if (
      targetCts < minCtsInBuffer ||
      targetSampleIndex < this.decodeCursorIndex - WebCodecsExportMode.KEEP_FRAMES_BEHIND
    ) {
      log.info(`Restarting FAST decode window around ${timeSeconds.toFixed(3)}s`);
      await this.restartFromKeyframe(targetSampleIndex);
    } else {
      if (targetCts > maxCtsInBuffer) {
        log.info(`Decoding more: target ahead of buffer by ${((targetCts - maxCtsInBuffer) / 1000).toFixed(1)}ms`);
      } else {
        log.info('Decoding more: target within current window but frame is not buffered yet');
      }
      await this.warmBufferAroundSample(targetSampleIndex);
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
      bestIndex = this.findClosestFrameIndex(targetCts);
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
   * Binary search to find closest frame index for a target CTS
   */
  private findClosestFrameIndex(targetCts: number): number {
    const arr = this.exportFramesCts;
    if (arr.length === 0) {
      return -1;
    }

    let left = 0;
    let right = arr.length - 1;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (arr[mid] < targetCts) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    if (left > 0 && Math.abs(arr[left - 1] - targetCts) < Math.abs(arr[left] - targetCts)) {
      return left - 1;
    }
    return left;
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
    this.isActive = false;
  }
}
