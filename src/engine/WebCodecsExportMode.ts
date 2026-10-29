// WebCodecsExportMode - Sequential export frame decoding extracted from WebCodecsPlayer
// Manages pre-decoded frame buffer for frame-accurate video export

import { Logger } from '../services/logger';
import { exportDiagnostics } from '../services/export/exportDiagnostics';
import type { Sample } from './webCodecsTypes';
import {
  computePresentationOffsetUs,
  normalizedSampleTimestampUs,
  frameToleranceUs,
  findClosestSampleIndex,
  findKeyframeBefore,
  findClosestFrameIndex,
  findBufferedFrameIndex as findBufferedCtsIndex,
  missingFrameRestartReason,
} from './webCodecsExport/exportSamplePlanning';

import { ExportDecoderPump } from './webCodecsExport/exportDecoderPump';
import { ExportSourceStride } from './webCodecsExport/exportSourceStride';
import { ExportSurfaceBudget, countHeldFrames, releaseHeldFrames } from './webCodecsExport/exportSurfaceBudget';

const log = Logger.create('WebCodecsExportMode');

/**
 * Interface for the player internals that export mode needs access to.
 * WebCodecsPlayer implements this to expose its internal state.
 */
export interface ExportModePlayer {
  getDecoder(): VideoDecoder | null;
  getSamples(): Sample[];
  /** Loads sample bytes for a decode window when the source is read on demand (fileSampleData.ts). */
  ensureSampleData?(startIndex: number, endIndexExclusive: number): Promise<void>;
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
  // Chromium on Android can report decodeQueueSize=0 for a 4K HEVC hardware
  // decoder before its first VideoFrame callback reaches JavaScript. The
  // normal rolling-window wait exits early once the queue looks stable, so
  // allow one bounded startup-only grace period after all initial samples have
  // been submitted. This keeps FAST export on WebCodecs without weakening the
  // steady-state backpressure policy.
  private static readonly INITIAL_FRAME_OUTPUT_WAIT_MS = 4000;
  private static readonly RECOVERY_FRAME_SEARCH_SAMPLES = 32;
  private static readonly DECODE_LOOKAHEAD_SAMPLES = 4;
  private static readonly MAX_CONTINUOUS_FORWARD_GAP_SAMPLES = 16;
  private static readonly KEEP_FRAMES_BEHIND = 1;
  // Start the background decode-ahead while the buffer is still half full, so it
  // finishes before the export catches the buffer edge (otherwise the export
  // briefly freezes at every decode-window boundary).
  private static readonly WARM_AHEAD_THRESHOLD_SAMPLES = 2;
  private player: ExportModePlayer;
  private decoderPump: ExportDecoderPump;

  // Export mode state
  private isActive = false;
  private exportFrameBuffer: Map<number, VideoFrame> = new Map(); // CTS (us) -> VideoFrame
  private exportFramesCts: number[] = []; // Sorted CTS values for index-based lookup
  private exportCurrentIndex = 0;
  private decodeCursorIndex = 0;
  private presentationOffsetUs = 0;
  private pendingWarmBuffer: Promise<void> | null = null;
  private discardOutputBeforeCtsUs: number | null = null;
  private sourceStride = new ExportSourceStride();
  private surfaceBudget = new ExportSurfaceBudget();
  // The frame a foreground seek waits for: everything before it is done with (the shown frame
  // was rendered), so a surface stall may release it. Null while only background work runs.
  private foregroundTargetCtsUs: number | null = null;
  private newestOutputCtsUs = Number.NEGATIVE_INFINITY;

  constructor(player: ExportModePlayer) {
    this.player = player;
    this.decoderPump = new ExportDecoderPump(player, {
      sampleTimestampUs: sample => this.getNormalizedSampleTimestampUs(sample),
      onSamplesSubmitted: endIndex => (this.decodeCursorIndex = Math.max(this.decodeCursorIndex, endIndex)),
      submittedEnd: () => this.decodeCursorIndex,
      findBufferedFrameIndex: (target, tolerance) => this.findBufferedFrameIndex(target, tolerance),
      refreshBufferedFrameIndex: () => this.refreshBufferedFrameIndex(),
      getBufferedFrameCount: () => this.exportFrameBuffer.size,
      relieveSurfaceStall: stalled => this.relieveSurfaceStall(stalled),
      surfacesFull: () => !this.surfaceBudget.hasFreeSurface(this.heldFrameCount()),
    });
  }

  private get keepFramesBehind(): number {
    return this.surfaceBudget.keepBehind(WebCodecsExportMode.KEEP_FRAMES_BEHIND);
  }

  /** Decoded frames the export holds open, i.e. decoder output surfaces it occupies. */
  private heldFrameCount(): number {
    return countHeldFrames(this.exportFrameBuffer, this.player.getCurrentFrame());
  }

  private learnSurfaceBudget(held: number): void {
    if (!this.surfaceBudget.learn(held)) return;
    exportDiagnostics.recordDecoder({ surfaceBudget: this.surfaceBudget.value ?? held });
    log.info(`FAST export decoder ran out of output surfaces with ${held} decoded frame(s) held; `
      + `keeping at most ${this.surfaceBudget.value} open from now on`);
  }

  /**
   * The decoder holds pending samples but emits nothing while the export holds decoded frames.
   * Closes what is no longer needed: behind the shown frame, or (during a foreground seek)
   * everything before the requested frame.
   */
  private relieveSurfaceStall(stalled: boolean): 'released' | 'exhausted' | 'idle' {
    const { held, released, shownReleased } = releaseHeldFrames(this.exportFrameBuffer,
      this.player.getCurrentFrame(), this.foregroundTargetCtsUs, this.getFrameToleranceUs(0.5));
    if (held === 0) return 'idle';
    if (stalled) exportDiagnostics.recordDecoder({ surfaceStalls: 1, heldFrames: held });
    if (shownReleased) this.player.setCurrentFrame(null);
    if (released === 0) {
      if (stalled) this.learnSurfaceBudget(held);
      return 'exhausted';
    }
    const shownCts = this.player.getCurrentFrame()?.timestamp;
    this.refreshBufferedFrameIndex();
    this.exportCurrentIndex = shownCts === undefined ? 0 : Math.max(0, this.exportFramesCts.indexOf(shownCts));
    if (stalled) this.surfaceBudget.probeAfterRelease(held);
    return 'released';
  }

  private getFrameToleranceUs(multiplier = 1.5): number {
    return frameToleranceUs(this.player.getFrameRate(), multiplier);
  }

  private getNormalizedSampleTimestampUs(sample: Sample): number {
    return normalizedSampleTimestampUs(sample, this.presentationOffsetUs);
  }

  private getRetainedHistoryStartCtsUs(targetCtsUs: number): number {
    const frameDurationUs = 1_000_000 / Math.max(1, this.player.getFrameRate());
    // Half a frame of slack: frame timestamps are whole microseconds, a requested CTS is not.
    return targetCtsUs - (this.keepFramesBehind + 0.5) * frameDurationUs;
  }

  private async decodeWindowDiscardingDistantPreroll(
    startIndex: number,
    endIndexExclusive: number,
    targetCtsUs: number,
    awaitTargetOutput = true,
    discardBeforeCtsUs = this.getRetainedHistoryStartCtsUs(targetCtsUs),
  ): Promise<void> {
    const previousDiscardBoundary = this.discardOutputBeforeCtsUs;
    this.discardOutputBeforeCtsUs = discardBeforeCtsUs;
    try {
      await this.decoderPump.decodeSampleWindow(
        startIndex,
        endIndexExclusive,
        targetCtsUs,
        awaitTargetOutput,
      );
    } finally {
      this.discardOutputBeforeCtsUs = previousDiscardBoundary;
    }
  }

  private refreshBufferedFrameIndex(): void {
    this.exportFramesCts = Array.from(this.exportFrameBuffer.keys()).toSorted((a, b) => a - b);
  }

  private findBufferedFrameIndex(targetCtsUs: number, toleranceUs = this.getFrameToleranceUs()): number {
    return findBufferedCtsIndex(this.exportFramesCts, targetCtsUs, toleranceUs);
  }

  /** Shows the buffered frame at bestIndex and releases older history. */
  private presentBufferedFrame(bestIndex: number): void {
    this.player.setCurrentFrame(this.exportFrameBuffer.get(this.exportFramesCts[bestIndex]) || null);
    this.exportCurrentIndex = bestIndex;
    this.cleanupOldFrames(bestIndex - this.keepFramesBehind);
  }

  private closeCurrentFrame(): void {
    const currentFrame = this.player.getCurrentFrame();
    if (!currentFrame) {
      return;
    }
    try { currentFrame.close(); } catch {}
    this.player.setCurrentFrame(null);
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

    log.debug('FAST decode window', {
      targetSampleIndex, decodeCursorIndex: this.decodeCursorIndex, endIndexExclusive,
      bufferedFrames: this.exportFrameBuffer.size,
      targetCtsUs: this.getNormalizedSampleTimestampUs(targetSample),
    });

    await this.decoderPump.decodeSampleWindow(
      this.decodeCursorIndex,
      endIndexExclusive,
      this.getNormalizedSampleTimestampUs(targetSample)
    );
  }

  private async decodeAheadForExactFrame(targetSampleIndex: number, targetCtsUs: number): Promise<void> {
    const searchEnd = Math.min(
      this.player.getSamples().length,
      targetSampleIndex + WebCodecsExportMode.RECOVERY_FRAME_SEARCH_SAMPLES,
    );
    const retainFromCtsUs = this.getRetainedHistoryStartCtsUs(targetCtsUs);
    const retainThroughCtsUs = targetCtsUs + this.getFrameToleranceUs(2);

    while (this.findBufferedFrameIndex(targetCtsUs, 1) < 0 && this.decodeCursorIndex < searchEnd) {
      // A decoder may withhold a B-frame until several later samples arrive.
      // Drop older outputs as the window grows so a hardware surface pool does
      // not fill while we wait for the requested frame.
      const currentFrame = this.player.getCurrentFrame();
      for (const [cts, frame] of this.exportFrameBuffer) {
        if ((cts >= retainFromCtsUs && cts <= retainThroughCtsUs) || frame === currentFrame) continue;
        try { frame.close(); } catch {}
        this.exportFrameBuffer.delete(cts);
      }
      this.refreshBufferedFrameIndex();

      const nextEnd = Math.min(
        searchEnd,
        this.decodeCursorIndex + WebCodecsExportMode.DECODE_LOOKAHEAD_SAMPLES,
      );
      const cursorBefore = this.decodeCursorIndex;
      await this.decodeWindowDiscardingDistantPreroll(
        this.decodeCursorIndex,
        nextEnd,
        targetCtsUs,
        false,
      );
      // A decoder out of surfaces takes no more samples; the caller's output wait handles it.
      if (this.decodeCursorIndex === cursorBefore) break;
    }
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

  /** Speed-ramped clips: decode the predicted next source frame in the background. */
  private scheduleStridedWarm(targetSampleIndex: number, targetCtsUs: number): void {
    if (this.pendingWarmBuffer) return;
    const plan = this.sourceStride.plan(
      targetSampleIndex,
      targetCtsUs,
      this.decodeCursorIndex,
      this.player.getSamples().length,
    );
    if (!plan) return;
    this.pendingWarmBuffer = this.decodeWindowDiscardingDistantPreroll(
      this.decodeCursorIndex,
      plan.endIndexExclusive,
      plan.nextTargetCtsUs,
      true,
      targetCtsUs,
    )
      .catch((error) => {
        log.warn('Background strided export decode failed', error);
      })
      .finally(() => {
        this.pendingWarmBuffer = null;
      });
  }

  private maybeContinueWarming(): void {
    // A foreground seek feeds the decoder itself; a second feeder would race it.
    if (this.pendingWarmBuffer || !this.isActive || this.sourceStride.isStrided || this.foregroundTargetCtsUs !== null) {
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
    // Counts the shown frame too; a learnt surface budget keeps a surface free for the next frame.
    const bufferedAhead = this.exportFramesCts.length - this.exportCurrentIndex;
    const warmWindow = this.surfaceBudget.warmWindow(WebCodecsExportMode.DECODE_LOOKAHEAD_SAMPLES, WebCodecsExportMode.KEEP_FRAMES_BEHIND);
    if (bufferedAhead >= warmWindow || !this.surfaceBudget.hasFreeSurface(this.heldFrameCount())) {
      return;
    }
    this.scheduleWarmBufferAroundSample(this.decodeCursorIndex);
  }

  private async restartFromKeyframe(targetSampleIndex: number, reason: string): Promise<void> {
    const samples = this.player.getSamples();
    const targetSample = samples[targetSampleIndex];
    if (!targetSample) {
      return;
    }
    exportDiagnostics.recordDecoder({ restartReason: reason });

    this.closeCurrentFrame();
    this.cleanupExportBuffer();
    this.exportFramesCts = [];
    this.exportCurrentIndex = 0;

    const keyframeIndex = findKeyframeBefore(samples, targetSampleIndex);
    this.sourceStride.clearDiscarded();
    await this.decoderPump.reconfigureDecoderForExport('restartFromKeyframe');
    this.newestOutputCtsUs = Number.NEGATIVE_INFINITY;
    this.decodeCursorIndex = keyframeIndex;
    this.player.setSampleIndex(keyframeIndex);

    const targetCtsUs = this.getNormalizedSampleTimestampUs(targetSample);
    await this.decodeWindowDiscardingDistantPreroll(
      keyframeIndex,
      Math.min(samples.length, targetSampleIndex + WebCodecsExportMode.TARGET_LOOKAHEAD_SAMPLES),
      targetCtsUs
    );
    // B-frame-heavy streams can withhold the target until more future samples
    // arrive; grow the recovery window in bounded chunks.
    await this.decodeAheadForExactFrame(targetSampleIndex, targetCtsUs);
  }

  /**
   * Handle decoder output during export mode - buffers all frames by CTS
   */
  handleDecoderOutput(frame: VideoFrame): void {
    const cts = frame.timestamp;
    this.newestOutputCtsUs = Math.max(this.newestOutputCtsUs, cts);
    if (
      (this.discardOutputBeforeCtsUs !== null && cts < this.discardOutputBeforeCtsUs) ||
      !this.sourceStride.shouldRetain(cts, 1_000_000 / Math.max(1, this.player.getFrameRate()))
    ) {
      try { frame.close(); } catch {}
      this.sourceStride.noteDiscarded(cts);
      exportDiagnostics.recordDecoder({ framesDiscarded: 1 });
      this.noteDecoderOutput();
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
    exportDiagnostics.recordDecoder({ framesBuffered: 1, heldFrames: this.exportFrameBuffer.size });
    this.noteDecoderOutput();
  }

  private noteDecoderOutput(): void {
    // An output right after a stall released frames: the decoder was out of surfaces.
    const confirmed = this.surfaceBudget.confirmOnOutput();
    if (confirmed !== null) this.learnSurfaceBudget(confirmed);
    this.decoderPump.notifyDecoderOutput();
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

    // Lazy loading means samples might not be ready yet.
    if (!(await this.decoderPump.waitForSamples(10000))) {
      endPrepare();
      return;
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
    this.sourceStride.reset();

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

    await this.decoderPump.reconfigureDecoderForExport('prepareForSequentialExport', true);
    this.newestOutputCtsUs = Number.NEGATIVE_INFINITY;
    this.decodeCursorIndex = keyframeIndex;
    this.player.setSampleIndex(keyframeIndex);

    log.info(
      `Preparing: keyframe=${keyframeIndex}, start=${startSampleIndex}, decoding ${decodeEnd - keyframeIndex} samples (total: ${allSamples.length})`
    );

    const endDecode = log.time('decodeInitialSamples');
    await this.decodeWindowDiscardingDistantPreroll(
      keyframeIndex,
      decodeEnd,
      startCtsUs,
      false,
    );
    endDecode();

    // Some H.264/H.265 streams reorder more than four frames before emitting
    // the first presentation frame. Grow the initial window in small chunks
    // without pausing after each chunk: Android hardware decoders can report an
    // empty queue while withholding their first callback, and per-chunk idle
    // waits made the submitted sample count depend on event-loop contention.
    // The cap keeps a genuinely broken decoder bounded.
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
      await this.decodeWindowDiscardingDistantPreroll(
        decodeEnd,
        nextDecodeEnd,
        startCtsUs,
        false,
      );
      decodeEnd = nextDecodeEnd;
    }

    if (this.exportFramesCts.length === 0) {
      log.debug('Initial samples submitted; waiting for the first decoder output');
      await this.decoderPump.waitForFirstBufferedFrame(
        WebCodecsExportMode.INITIAL_FRAME_OUTPUT_WAIT_MS
      );
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
    this.sourceStride.observe(targetSampleIndex, targetCts);

    // CTS is already resolved to the desired source sample. Permit only integer
    // microsecond rounding, never a neighboring frame that happens to be ready.
    const bestIndex = this.findBufferedFrameIndex(targetCts, 1);
    if (bestIndex >= 0 && bestIndex < this.exportFramesCts.length) {
      const cts = this.exportFramesCts[bestIndex];
      const foundFrame = this.exportFrameBuffer.get(cts);
      if (foundFrame) {
        this.player.setCurrentFrame(foundFrame);
        this.exportCurrentIndex = bestIndex;

        const framesRemaining = this.exportFramesCts.length - bestIndex;
        if (this.sourceStride.isStrided) {
          this.scheduleStridedWarm(targetSampleIndex, targetCts);
        } else if (
          framesRemaining < WebCodecsExportMode.WARM_AHEAD_THRESHOLD_SAMPLES &&
          this.decodeCursorIndex < this.player.getSamples().length
        ) {
          log.debug(
            `Decoding ahead: ${framesRemaining} frames remaining, sampleIndex=${this.decodeCursorIndex}/${this.player.getSamples().length}`
          );
          this.scheduleWarmBufferAroundSample(targetSampleIndex);
        }

        this.cleanupOldFrames(bestIndex - this.keepFramesBehind);
        return;
      }
    }

    this.foregroundTargetCtsUs = targetCts;
    try {
      await this.decodeMissingFrame(timeSeconds, requestedTargetCts, targetSampleIndex, targetCts);
    } finally {
      this.foregroundTargetCtsUs = null;
    }
  }

  /** The requested frame is not buffered: wait for, decode up to or restart around it. */
  private async decodeMissingFrame(
    timeSeconds: number,
    requestedTargetCts: number,
    targetSampleIndex: number,
    targetCts: number,
  ): Promise<void> {
    const samples = this.player.getSamples();
    let bestIndex: number;
    const maxCtsInBuffer = this.exportFramesCts.length > 0
      ? this.exportFramesCts[this.exportFramesCts.length - 1]
      : 0;
    const minCtsInBuffer = this.exportFramesCts.length > 0
      ? this.exportFramesCts[0]
      : 0;

    log.debug(
      `Frame not in buffer: requested=${requestedTargetCts.toFixed(0)}, sample=${targetCts.toFixed(0)}, range=[${minCtsInBuffer.toFixed(0)}-${maxCtsInBuffer.toFixed(0)}], bufferSize=${this.exportFramesCts.length}`
    );

    if (this.pendingWarmBuffer) {
      await this.pendingWarmBuffer;
      bestIndex = this.findBufferedFrameIndex(targetCts, 1);
      if (bestIndex >= 0 && bestIndex < this.exportFramesCts.length) {
        this.presentBufferedFrame(bestIndex);
        this.scheduleStridedWarm(targetSampleIndex, targetCts);
        return;
      }
    }

    // A closed decoder restarts from a keyframe (which recreates it). Forward jumps keep decoder
    // context while discarding skipped outputs, unless a keyframe inside the gap is cheaper.
    const forwardGapSamples = targetSampleIndex - this.decodeCursorIndex;
    const reason = missingFrameRestartReason({
      decoderClosed: (this.player.getDecoder()?.state ?? 'closed') === 'closed',
      targetSampleIndex, targetCtsUs: targetCts, decodeCursorIndex: this.decodeCursorIndex,
      minBufferedCtsUs: minCtsInBuffer, bufferedFrames: this.exportFramesCts.length,
      newestOutputCtsUs: this.newestOutputCtsUs, keyframeIndex: findKeyframeBefore(samples, targetSampleIndex),
      skippedTarget: this.sourceStride.wasDiscarded(targetCts),
      maxContinuousForwardGap: WebCodecsExportMode.MAX_CONTINUOUS_FORWARD_GAP_SAMPLES,
    });
    let restarted = reason !== null;
    try {
      if (reason) {
        log.info(`Restarting FAST decode window around ${timeSeconds.toFixed(3)}s (${reason})`);
        await this.restartFromKeyframe(targetSampleIndex, reason);
      } else {
        if (targetCts > maxCtsInBuffer) {
          log.info(`Decoding more: target ahead of buffer by ${((targetCts - maxCtsInBuffer) / 1000).toFixed(1)}ms`);
        } else {
          log.info('Decoding more: target within current window but frame is not buffered yet');
        }
        if (forwardGapSamples > 0) {
          await this.decodeWindowDiscardingDistantPreroll(
            this.decodeCursorIndex,
            Math.min(samples.length, targetSampleIndex + WebCodecsExportMode.DECODE_LOOKAHEAD_SAMPLES),
            targetCts,
          );
        } else {
          await this.warmBufferAroundSample(targetSampleIndex);
        }
      }
      await this.decodeAheadForExactFrame(targetSampleIndex, targetCts);
      // The browser can reclaim a decoder after submission while its exact
      // output is still pending. Keep that wait inside the same bounded recovery.
      await this.decoderPump.waitForBufferedTarget(targetCts, 1200, 1, false);
    } catch (error) {
      if (!this.decoderPump.isRecoverableDecoderFailure(error)) {
        throw error;
      }
      log.warn(
        `FAST export decoder failed near ${timeSeconds.toFixed(3)}s; restarting from the previous keyframe`,
        error
      );
      await this.restartFromKeyframe(targetSampleIndex, 'decoder failure');
      await this.decoderPump.waitForBufferedTarget(targetCts, 1200, 1, false);
      restarted = true;
    }

    bestIndex = this.findBufferedFrameIndex(targetCts, 1);
    if (bestIndex < 0 && !restarted) {
      // The decoder never put the frame out (a lost output): one keyframe restart before failing.
      log.warn(`FAST export frame at ${timeSeconds.toFixed(3)}s never came out of the decoder; restarting from its keyframe`);
      await this.restartFromKeyframe(targetSampleIndex, 'frame never decoded');
      await this.decoderPump.waitForBufferedTarget(targetCts, 1200, 1, false);
      bestIndex = this.findBufferedFrameIndex(targetCts, 1);
    }
    if (bestIndex >= 0 && bestIndex < this.exportFramesCts.length) {
      this.presentBufferedFrame(bestIndex);
      this.scheduleStridedWarm(targetSampleIndex, targetCts);
      return;
    }

    log.error(`Exact frame unavailable for seek to ${timeSeconds.toFixed(3)}s`, {
      targetSampleIndex, targetCts: Math.round(targetCts), decodeCursorIndex: this.decodeCursorIndex,
      bufferedFrames: this.exportFrameBuffer.size,
      bufferedCts: [...this.exportFrameBuffer.keys()].map(Math.round).join(','),
      shownCts: this.player.getCurrentFrame()?.timestamp ?? null,
      surfaceBudget: this.surfaceBudget.value,
      decoderState: this.player.getDecoder()?.state,
      decodeQueueSize: this.player.getDecoder()?.decodeQueueSize,
    });
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
    this.sourceStride.reset();
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
