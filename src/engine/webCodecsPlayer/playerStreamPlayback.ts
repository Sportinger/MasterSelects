import { webCodecsTelemetry } from '../webcodecs/webCodecsTelemetry';
import { WEB_CODECS_PLAYER_LIMITS } from './playerConstants';
import { WebCodecsPlayerAdvancePlayback } from './playerAdvancePlayback';

export interface WorkerStreamPlaybackStartOptions {
  readonly forceRebase?: boolean;
  readonly resetDecoder?: boolean;
}

export abstract class WebCodecsPlayerStreamPlayback extends WebCodecsPlayerAdvancePlayback {
  startWorkerStreamPlayback(
    timeSeconds: number,
    options: WorkerStreamPlaybackStartOptions = {},
  ): void {
    if (
      this.useSimpleMode ||
      !this.decoder ||
      this.samples.length === 0 ||
      !this.videoTrack ||
      !this.ready
    ) {
      return;
    }

    const targetUs = timeSeconds * 1_000_000;
    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const hasPendingPausedSeek = this.pendingSeekKind === 'seek' && this.seekTargetUs !== null;
    const hasNearDisplayedFrame = this.isDisplayedFrameNearTarget(targetUs, 4);
    const hasNearBufferedFrame = this.frameBuffer.some((frame) => (
      Math.abs(frame.timestamp - targetUs) <= frameDurationUs * 4
    ));

    const resetDecoderForRebase = options.forceRebase === true && options.resetDecoder === true;
    if (
      options.forceRebase === true ||
      hasPendingPausedSeek ||
      (!hasNearDisplayedFrame && !hasNearBufferedFrame)
    ) {
      if (options.forceRebase === true) {
        this._isPlaying = false;
        if (!this.isFrameUsableForPlaybackStartup(this.currentFrameTimestampUs, targetUs)) {
          this.clearDisplayedFrame();
        }
      }
      if (resetDecoderForRebase && this.codecConfig) {
        this._isPlaying = true;
        this.playbackStartupWarmupStartedAtMs = performance.now();
        this.invalidateStrictPausedSeekFlush();
        this.endPendingSeek('replaced');
        this.seekTargetUs = null;
        this.seekTargetToleranceUs = 0;
        this.pendingSeekPreviewMode = 'strict';
        this.clearPendingSeekFeed();
        this.clearPausedPreroll();
        this.clearAdvanceSeekState('replaced');
        if (this.animationId !== null) {
          cancelAnimationFrame(this.animationId);
          this.animationId = null;
        }
        const targetCts = this.getTargetCtsForTimeSeconds(timeSeconds);
        const targetIdx = this.findSampleNearCts(targetCts);
        const keyframe = this.findKeyframeBefore(targetIdx);
        this.recordDecoderReset('advance_seek');
        this.decoder.reset();
        this.decoder.configure(this.codecConfig);
        this.resetDecodeQueueTracking();
        this.clearFrameBuffer();
        this.sampleIndex = targetIdx;
        this.feedIndex = keyframe;
        this.setPendingAdvanceSeekTarget(targetIdx);
        this.feedWorkerStreamSamples();
        return;
      }
      if (hasPendingPausedSeek) {
        this.endPendingSeek('replaced');
        this.seekTargetUs = null;
        this.seekTargetToleranceUs = 0;
        this.pendingSeekPreviewMode = 'strict';
        this.clearPendingSeekFeed();
        this.clearPausedPreroll();
      }
      this.advanceToTime(timeSeconds);
      this.feedWorkerStreamSamples();
      return;
    }

    this._isPlaying = true;
    this.playbackStartupWarmupStartedAtMs = performance.now();
    this.clearPausedPreroll();
    this.clearPendingSeekFeed();
    this.seekTargetUs = null;
    this.seekTargetToleranceUs = 0;
    this.pendingSeekPreviewMode = 'strict';

    if (this.feedIndex < this.sampleIndex) {
      this.feedIndex = this.sampleIndex;
    }
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    this.feedWorkerStreamSamples();
  }

  pumpWorkerStreamPlayback(): void {
    if (
      this.useSimpleMode ||
      !this.decoder ||
      this.samples.length === 0 ||
      !this.videoTrack ||
      !this.ready
    ) {
      return;
    }

    this._isPlaying = true;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.feedWorkerStreamSamples();
  }

  takeWorkerStreamPlaybackFrame(
    targetTimeSeconds: number,
    lastPresentedTimestampSeconds: number | null = null,
  ): VideoFrame | null {
    if (
      this.useSimpleMode ||
      !this.decoder ||
      this.samples.length === 0 ||
      !this.videoTrack ||
      !this.ready
    ) {
      return null;
    }

    this.pumpWorkerStreamPlayback();

    const frameDurationUs = 1_000_000 / Math.max(this.frameRate, 1);
    const requestedTargetUs = targetTimeSeconds * 1_000_000;
    const pendingTargetUs = this.pendingAdvanceSeekTargetIdx === null
      ? null
      : this.getSampleTimestampUs(
        Math.min(this.pendingAdvanceSeekTargetIdx, this.samples.length - 1),
      );
    const stalePendingTarget =
      pendingTargetUs !== null &&
      requestedTargetUs > pendingTargetUs + frameDurationUs * 6;
    const targetUs = stalePendingTarget ? requestedTargetUs : pendingTargetUs ?? requestedTargetUs;
    const selectedIndex = this.selectWorkerStreamFrameIndex({
      frameDurationUs,
      lastPresentedTimestampSeconds,
      targetUs,
    });

    if (selectedIndex < 0) {
      this.discardWorkerStreamFramesBefore(targetUs - frameDurationUs * 3);
      this.feedWorkerStreamSamples();
      if (
        lastPresentedTimestampSeconds === null &&
        this.currentFrame &&
        Math.abs(this.currentFrame.timestamp - targetUs) <= frameDurationUs * 2
      ) {
        return this.currentFrame;
      }
      return null;
    }

    for (let index = 0; index < selectedIndex; index++) {
      const staleFrame = this.frameBuffer[index];
      if (staleFrame !== this.currentFrame) {
        staleFrame.close();
      }
    }

    const frame = this.frameBuffer[selectedIndex];
    this.setDisplayedFrame(frame);
    this.sampleIndex = this.findSampleNearCts(
      this.getTargetCtsForTimeSeconds(frame.timestamp / 1_000_000),
    );
    this.frameBuffer.splice(0, selectedIndex + 1);
    this.onFrame?.(frame);

    if (
      pendingTargetUs !== null &&
      (
        Math.abs(frame.timestamp - pendingTargetUs) <= frameDurationUs * 3 ||
        frame.timestamp > pendingTargetUs + frameDurationUs * 3
      )
    ) {
      this.clearAdvanceSeekState('resolved');
      this.playbackStartupWarmupStartedAtMs = null;
    }

    this.feedWorkerStreamSamples();
    return frame;
  }

  private selectWorkerStreamFrameIndex(input: {
    readonly frameDurationUs: number;
    readonly lastPresentedTimestampSeconds: number | null;
    readonly targetUs: number;
  }): number {
    const lastPresentedUs =
      input.lastPresentedTimestampSeconds === null
        ? null
        : input.lastPresentedTimestampSeconds * 1_000_000;
    const minAdvancedUs = Math.max(
      this.currentFrameTimestampUs ?? Number.NEGATIVE_INFINITY,
      lastPresentedUs ?? Number.NEGATIVE_INFINITY,
    ) + input.frameDurationUs * 0.5;
    const maxFutureLeadUs = Math.max(1_000, Math.min(input.frameDurationUs * 0.1, 4_000));
    const maxSelectableTimestampUs = input.targetUs + maxFutureLeadUs;
    let bestIndex = -1;

    for (let index = 0; index < this.frameBuffer.length; index++) {
      const frame = this.frameBuffer[index];
      if (frame.timestamp > maxSelectableTimestampUs) {
        break;
      }
      if (frame.timestamp >= minAdvancedUs) {
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  private discardWorkerStreamFramesBefore(thresholdUs: number): void {
    while (
      this.frameBuffer.length > 0 &&
      this.frameBuffer[0].timestamp < thresholdUs &&
      this.frameBuffer[0] !== this.currentFrame
    ) {
      this.frameBuffer.shift()!.close();
    }
  }

  private feedWorkerStreamSamples(): void {
    if (
      !this.decoder ||
      this.decoder.state !== 'configured' ||
      this.samples.length === 0
    ) {
      return;
    }

    if (this.pendingAdvanceSeekTargetIdx === null && this.feedIndex < this.sampleIndex) {
      this.feedIndex = this.sampleIndex;
    }

    const pendingTargetIdx = this.pendingAdvanceSeekTargetIdx;
    const feedBaseIndex = pendingTargetIdx ?? this.sampleIndex;
    const lookaheadFrames = pendingTargetIdx === null
      ? Math.max(WEB_CODECS_PLAYER_LIMITS.FEED_LOOKAHEAD, Math.ceil(this.frameRate * 0.5))
      : Math.max(WEB_CODECS_PLAYER_LIMITS.FEED_LOOKAHEAD, Math.ceil(this.frameRate * 0.35));
    const queueLimit = pendingTargetIdx === null
      ? Math.max(WEB_CODECS_PLAYER_LIMITS.FEED_QUEUE_TARGET, Math.ceil(this.frameRate * 0.2))
      : WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_QUEUE_TARGET;
    const feedTarget = Math.min(feedBaseIndex + lookaheadFrames, this.samples.length);

    while (
      this.feedIndex < feedTarget &&
      this.getEffectiveDecodeQueueSize() < queueLimit
    ) {
      const sample = this.samples[this.feedIndex];
      if (!sample) {
        break;
      }

      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: this.getSamplePresentationTimestampUs(sample),
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      });

      try {
        this.decoder.decode(chunk);
        const queueSize = this.noteDecodeQueued();
        webCodecsTelemetry.decodeFeed(
          this.feedIndex,
          sample.is_sync ? 'key' : 'delta',
          queueSize,
          pendingTargetIdx === null ? 'advance' : 'advance_pending',
        );
      } catch (error) {
        this.recordDecodeError(error, 'worker_stream.decode');
      }

      this.feedIndex++;
    }
  }
}
