import { webCodecsTelemetry } from '../webcodecs/webCodecsTelemetry';
import { WEB_CODECS_PLAYER_LIMITS } from './playerConstants';
import { WebCodecsPlayerStreamPlayback } from './playerStreamPlayback';
import type { SeekPreviewMode } from './playerTypes';

export abstract class WebCodecsPlayerSeekingControls extends WebCodecsPlayerStreamPlayback {
  seek(timeSeconds: number, options?: { previewMode?: SeekPreviewMode }): void {
    // Simple mode: direct seek on video element
    if (this.useSimpleMode && this.simpleSource.hasVideoElement()) {
      this.simpleSource.seek(timeSeconds);
      return;
    }

    // Full mode: decode from keyframe
    if (!this.videoTrack || this.samples.length === 0 || !this.decoder) return;

    const seekStart = performance.now();
    const targetTime = this.getTargetCtsForTimeSeconds(timeSeconds);

    // Binary search for closest CTS match (O(log n) instead of O(n))
    const targetIndex = this.findSampleNearCts(targetTime);
    const keyframeIndex = this.findKeyframeBefore(targetIndex);
    const framesDecoded = targetIndex - keyframeIndex + 1;
    const targetSampleTimeUs = this.getSampleTimestampUs(targetIndex);
    const resolvedTargetUs = targetSampleTimeUs ?? timeSeconds * 1_000_000;
    const keyframeTimeUs = this.getSampleTimestampUs(keyframeIndex);

    // Set seek target. Intermediate GOP traversal frames are dropped in output callback
    // so the renderer keeps showing the last stable frame until the target arrives.
    this.seekTargetUs = resolvedTargetUs;
    this.seekTargetToleranceUs = this.computeSeekToleranceUs(targetIndex);
    this.clearAdvanceSeekState('replaced');
    this.clearPausedPreroll();
    const previewMode = options?.previewMode ?? 'strict';
    const canExtendPendingSeek = this.canExtendPendingPausedSeek(targetIndex, previewMode);
    const canReusePipeline = canExtendPendingSeek || this.canReusePausedSeekPipeline(targetIndex, previewMode);
    const feedEndIndex = this.getPausedSeekFeedEndIndex(targetIndex, previewMode);
    this.lastSeekPlanDebug = {
      targetIndex,
      keyframeIndex,
      feedEndIndex,
      targetTimeSeconds: timeSeconds,
      targetSampleTimeSeconds: targetSampleTimeUs === null ? null : targetSampleTimeUs / 1_000_000,
      keyframeTimeSeconds: keyframeTimeUs === null ? null : keyframeTimeUs / 1_000_000,
    };
    this.invalidateStrictPausedSeekFlush();
    if (!canReusePipeline) {
      this.clearPendingSeekFeed();
    }
    this.beginPendingSeek('seek', this.seekTargetUs);
    this.pendingSeekPreviewMode = previewMode;

    webCodecsTelemetry.seekStart(timeSeconds, framesDecoded);
    this.sampleIndex = targetIndex;
    if (this.resolvePendingSeekWithDisplayedFrame(this.seekTargetUs, {
      resetQueuedDecode: this.getEffectiveDecodeQueueSize() >= WEB_CODECS_PLAYER_LIMITS.ADVANCE_SEEK_QUEUE_TARGET ||
        this.pendingSeekFeedEndIndex !== null,
    })) {
      webCodecsTelemetry.seekEnd(timeSeconds, framesDecoded, performance.now() - seekStart);
      return;
    }

    if (canReusePipeline) {
      if (this.promoteBufferedFrameForPausedSeekTarget(this.seekTargetUs, this.seekTargetToleranceUs)) {
        webCodecsTelemetry.seekEnd(timeSeconds, framesDecoded, performance.now() - seekStart);
        return;
      }
    }

    if (canReusePipeline) {
      webCodecsTelemetry.seekSkipReuse(
        canExtendPendingSeek ? 'seek_extend_pending' : 'seek_reuse_pipeline',
        targetIndex,
        this.getCurrentFrameSampleIndex() ?? -1,
        this.feedIndex
      );

      this.sampleIndex = targetIndex;
      if (!canExtendPendingSeek) {
        this.feedIndex = Math.max(this.feedIndex, (this.getCurrentFrameSampleIndex() ?? targetIndex) + 1);
      }
      this.pendingSeekFeedEndIndex = Math.max(
        this.pendingSeekFeedEndIndex ?? this.feedIndex - 1,
        feedEndIndex
      );
      this.feedPendingSeekSamples('seek');
    } else {
      // Reset decoder
      this.recordDecoderReset('seek');
      this.decoder.reset();
      this.decoder.configure(this.codecConfig!);
      this.resetDecodeQueueTracking();

      this.sampleIndex = targetIndex;
      this.feedIndex = keyframeIndex;
      this.pendingSeekFeedEndIndex = feedEndIndex;
      this.clearFrameBuffer();
      this.feedPendingSeekSamples('seek');
    }

    // Don't flush here - the initial feed may only queue a subset of
    // the required samples (limited by ADVANCE_SEEK_QUEUE_TARGET).
    // Flushing now would block decoder.decode() for continuation feeds,
    // preventing the seek from ever reaching its target.  The flush is
    // triggered later by feedPendingSeekSamples once all samples are fed.

    webCodecsTelemetry.seekEnd(timeSeconds, framesDecoded, performance.now() - seekStart);
  }

  decodeReverseWindowForTimeSeconds(timeSeconds: number): void {
    if (this.useSimpleMode || !this.videoTrack || this.samples.length === 0 || !this.decoder || !this.codecConfig) {
      return;
    }

    const window = this.getReverseDecodeWindowForTimeSeconds(timeSeconds);
    const targetTimeSeconds = window?.targetTimeSeconds ?? timeSeconds;
    const targetCts = this.getTargetCtsForTimeSeconds(targetTimeSeconds);
    const targetIndex = this.findSampleNearCts(targetCts);
    const keyframeIndex = this.findKeyframeBefore(targetIndex);
    const feedEndIndex = this.getPausedSeekFeedEndIndex(targetIndex, 'strict');
    const targetSampleTimeUs = this.getSampleTimestampUs(targetIndex);
    const keyframeTimeUs = this.getSampleTimestampUs(keyframeIndex);

    this.lastSeekPlanDebug = {
      targetIndex,
      keyframeIndex,
      feedEndIndex,
      targetTimeSeconds,
      targetSampleTimeSeconds: targetSampleTimeUs === null ? null : targetSampleTimeUs / 1_000_000,
      keyframeTimeSeconds: keyframeTimeUs === null ? null : keyframeTimeUs / 1_000_000,
    };
    this.seekTargetUs = null;
    this.seekTargetToleranceUs = 0;
    this.pendingSeekPreviewMode = 'strict';
    this.invalidateStrictPausedSeekFlush();
    this.endPendingSeek('replaced');
    this.clearPendingSeekFeed();
    this.clearPausedPreroll();
    this.clearAdvanceSeekState('replaced');
    this.recordDecoderReset('seek');
    this.decoder.reset();
    this.decoder.configure(this.codecConfig);
    this.resetDecodeQueueTracking();
    this.clearFrameBuffer();

    for (let index = keyframeIndex; index <= feedEndIndex; index += 1) {
      const sample = this.samples[index];
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
          index,
          sample.is_sync ? 'key' : 'delta',
          queueSize,
          'seek',
        );
      } catch (error) {
        this.recordDecodeError(error, 'reverse_window.decode');
      }
    }

    this.sampleIndex = targetIndex;
    this.feedIndex = Math.min(feedEndIndex + 1, this.samples.length);
  }

  /**
   * Fast seek: decode only the nearest keyframe (1 frame instead of N).
   * Use during fast scrubbing for instant feedback - shows nearest I-frame.
   */
  fastSeek(timeSeconds: number): void {
    if (this.useSimpleMode && this.simpleSource.hasVideoElement()) {
      this.simpleSource.fastSeek(timeSeconds);
      return;
    }

    if (!this.videoTrack || this.samples.length === 0 || !this.decoder) return;

    const targetTime = this.getTargetCtsForTimeSeconds(timeSeconds);

    // Find nearest keyframe: check before AND after target for closest match
    const targetIdx = this.findSampleNearCts(targetTime);
    const kfBefore = this.findKeyframeBefore(targetIdx);
    let bestKeyframe = kfBefore;
    // Check if a keyframe after target is closer
    for (let i = targetIdx + 1; i < this.samples.length; i++) {
      if (this.samples[i].is_sync) {
        if (Math.abs(this.samples[i].cts - targetTime) < Math.abs(this.samples[kfBefore].cts - targetTime)) {
          bestKeyframe = i;
        }
        break;
      }
    }

    // fastSeek shows keyframe directly - no GOP traversal, so no seekTargetUs needed
    this.seekTargetUs = null;
    this.seekTargetToleranceUs = 0;
    this.pendingSeekPreviewMode = 'strict';
    this.invalidateStrictPausedSeekFlush();
    this.endPendingSeek('replaced');
    this.clearPendingSeekFeed();
    this.clearPausedPreroll();
    this.clearAdvanceSeekState('replaced');

    // Reset decoder and decode just the keyframe
    this.recordDecoderReset('fast_seek');
    this.decoder.reset();
    this.decoder.configure(this.codecConfig!);
    this.resetDecodeQueueTracking();

    const sample = this.samples[bestKeyframe];
    const chunk = new EncodedVideoChunk({
      type: 'key',
      timestamp: this.getSamplePresentationTimestampUs(sample),
      duration: (sample.duration * 1_000_000) / sample.timescale,
      data: sample.data,
    });

    try {
      this.decoder.decode(chunk);
      this.noteDecodeQueued();
    } catch (error) {
      this.recordDecodeError(error, 'fastSeek.decode');
    }

    this.sampleIndex = bestKeyframe;
    this.feedIndex = bestKeyframe + 1;
    this.clearFrameBuffer();
  }

  /**
   * Async seek that waits for the frame to be decoded
   * Use this for export where we need guaranteed frame accuracy
   */
  async seekAsync(timeSeconds: number): Promise<void> {
    // Simple mode: seek video element and wait for frame
    if (this.useSimpleMode && this.simpleSource.hasVideoElement()) {
      return this.simpleSource.seekAsync(timeSeconds);
    }

    // Full mode: decode and flush
    if (!this.videoTrack || this.samples.length === 0 || !this.decoder) {
      return;
    }

    this.seekTargetUs = null;
    this.seekTargetToleranceUs = 0;
    this.pendingSeekPreviewMode = 'strict';
    this.invalidateStrictPausedSeekFlush();
    this.clearPendingSeekFeed();
    this.clearAdvanceSeekState();

    const targetTime = this.getTargetCtsForTimeSeconds(timeSeconds);

    // Binary search for closest CTS match
    const targetIndex = this.findSampleNearCts(targetTime);
    const keyframeIndex = this.findKeyframeBefore(targetIndex);

    // Reset decoder
    this.decoder.reset();
    this.decoder.configure(this.codecConfig!);
    this.resetDecodeQueueTracking();

    // Decode from keyframe up to target frame
    for (let i = keyframeIndex; i <= targetIndex; i++) {
      const sample = this.samples[i];
      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: this.getSamplePresentationTimestampUs(sample),
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      });
      try {
        this.decoder.decode(chunk);
        this.noteDecodeQueued();
      } catch (error) {
        this.recordDecodeError(error, 'seekAsync.decode');
      }
    }

    // Flush to ensure all frames are decoded
    await this.decoder.flush();

    this.sampleIndex = targetIndex;
    this.feedIndex = targetIndex + 1;
    this.clearFrameBuffer();
  }
}
