import { webCodecsTelemetry } from '../webcodecs/webCodecsTelemetry';
import { WEB_CODECS_PLAYER_LIMITS } from './playerConstants';
import { WebCodecsPlayerLoading } from './playerLoading';
import type { PendingSeekEndReason } from './playerTypes';

export abstract class WebCodecsPlayerSeekState extends WebCodecsPlayerLoading {
  /** Binary search for sample index whose CTS is closest to target */
  protected findSampleNearCts(targetCts: number): number {
    return this.sampleTimeline.findSampleNearCts(targetCts);
  }

  /** Find nearest keyframe at or before the given sample index (DTS order) */
  protected findKeyframeBefore(sampleIndex: number): number {
    return this.sampleTimeline.findKeyframeBefore(sampleIndex);
  }

  protected getCurrentFrameSampleIndex(): number | null {
    if (this.currentFrameTimestampUs === null || !this.videoTrack) {
      return null;
    }
    const currentCts = this.getTargetCtsForTimeSeconds(this.currentFrameTimestampUs / 1_000_000);
    return this.findSampleNearCts(currentCts);
  }

  protected getSampleTimestampUs(index: number): number | null {
    const sample = this.samples[index];
    return sample ? this.getSamplePresentationTimestampUs(sample) : null;
  }

  getReverseDecodeWindowForTimeSeconds(timeSeconds: number): {
    readonly targetTimeSeconds: number;
    readonly minTimeSeconds: number;
    readonly maxTimeSeconds: number;
  } | null {
    if (!Number.isFinite(timeSeconds) || !this.videoTrack || this.samples.length === 0) {
      return null;
    }

    const targetCts = this.getTargetCtsForTimeSeconds(timeSeconds);
    const targetIndex = this.findSampleNearCts(targetCts);
    const frameDurationSeconds = 1 / Math.max(this.frameRate, 1);
    const maxLookaheadSeconds = Math.max(0.25, Math.min(1, 30 / Math.max(this.frameRate, 1)));
    const maxCaptureTimeSeconds = timeSeconds + maxLookaheadSeconds;

    let captureIndex = targetIndex;
    for (let index = targetIndex + 1; index < this.samples.length; index += 1) {
      if (this.samples[index]?.is_sync === true) {
        captureIndex = Math.max(targetIndex, index - 1);
        break;
      }
      const timestampUs = this.getSampleTimestampUs(index);
      if (timestampUs !== null && timestampUs / 1_000_000 <= maxCaptureTimeSeconds) {
        captureIndex = index;
      }
      if (timestampUs !== null && timestampUs / 1_000_000 > maxCaptureTimeSeconds + frameDurationSeconds) {
        break;
      }
    }

    const captureTimestampUs = this.getSampleTimestampUs(captureIndex);
    const keyframeIndex = this.findKeyframeBefore(targetIndex);
    const keyframeTimestampUs = this.getSampleTimestampUs(keyframeIndex);
    if (captureTimestampUs === null || keyframeTimestampUs === null) {
      return null;
    }

    const targetTimeSeconds = Math.max(timeSeconds, captureTimestampUs / 1_000_000);
    return {
      targetTimeSeconds,
      minTimeSeconds: keyframeTimestampUs / 1_000_000,
      maxTimeSeconds: targetTimeSeconds,
    };
  }

  getReverseDecodeTargetTimeSeconds(timeSeconds: number): number {
    return this.getReverseDecodeWindowForTimeSeconds(timeSeconds)?.targetTimeSeconds ?? timeSeconds;
  }

  protected beginPendingSeek(kind: 'seek' | 'advance', targetUs: number): void {
    if (!Number.isFinite(targetUs)) {
      return;
    }
    if (this.pendingSeekKind === kind && this.pendingSeekStartedAtMs !== null) {
      this.pendingSeekTargetDebugUs = targetUs;
      return;
    }
    this.endPendingSeek('replaced');
    this.pendingSeekStartedAtMs = performance.now();
    this.pendingSeekKind = kind;
    this.pendingSeekTargetDebugUs = targetUs;
    webCodecsTelemetry.pendingSeekStart(kind, targetUs);
  }

  protected endPendingSeek(reason: PendingSeekEndReason): void {
    if (this.pendingSeekStartedAtMs === null) {
      this.clearPendingSeekFallback();
      this.pendingSeekPreviewMode = 'strict';
      return;
    }
    webCodecsTelemetry.pendingSeekEnd(
      this.pendingSeekKind ?? 'unknown',
      performance.now() - this.pendingSeekStartedAtMs,
      this.pendingSeekTargetDebugUs ?? 0,
      reason
    );
    this.pendingSeekStartedAtMs = null;
    this.pendingSeekKind = null;
    this.pendingSeekTargetDebugUs = null;
    this.pendingSeekPreviewMode = 'strict';
    this.clearPendingSeekFallback();
  }

  protected setPendingAdvanceSeekTarget(targetIdx: number): void {
    this.pendingAdvanceSeekTargetIdx = targetIdx;
    const targetUs = this.getSampleTimestampUs(
      Math.min(targetIdx, this.samples.length - 1)
    );
    if (targetUs !== null) {
      this.beginPendingSeek('advance', targetUs);
    }
  }

  protected recordDecoderReset(reason: 'loop' | 'advance_seek' | 'seek' | 'fast_seek'): void {
    webCodecsTelemetry.decoderReset(reason);
  }

  protected clearAdvanceSeekState(reason: PendingSeekEndReason = 'cleared'): void {
    if (this.pendingAdvanceSeekTargetIdx !== null && this.pendingSeekKind === 'advance') {
      this.endPendingSeek(reason);
    }
    this.pendingAdvanceSeekTargetIdx = null;
  }

  protected clearPendingSeekFeed(): void {
    this.pendingSeekFeedEndIndex = null;
  }

  protected clearPausedPreroll(): void {
    this.pausedPrerollEndIndex = null;
  }

  protected resetDecodeQueueTracking(): void {
    this.trackedDecodeQueueSize = 0;
  }

  protected getEffectiveDecodeQueueSize(): number {
    const reportedQueueSize = this.decoder?.decodeQueueSize ?? 0;
    return this.trackedDecodeQueueSize > 0
      ? this.trackedDecodeQueueSize
      : Math.max(0, reportedQueueSize);
  }

  protected noteDecodeQueued(): number {
    const reportedQueueSize = this.decoder?.decodeQueueSize ?? 0;
    this.trackedDecodeQueueSize = Math.max(
      reportedQueueSize,
      this.trackedDecodeQueueSize + 1
    );
    return this.getEffectiveDecodeQueueSize();
  }

  protected noteDecodeDequeued(): number {
    const reportedQueueSize = this.decoder?.decodeQueueSize ?? 0;
    this.trackedDecodeQueueSize = Math.max(0, this.trackedDecodeQueueSize - 1);
    if (reportedQueueSize >= 0 && reportedQueueSize < this.trackedDecodeQueueSize) {
      this.trackedDecodeQueueSize = reportedQueueSize;
    }
    return this.getEffectiveDecodeQueueSize();
  }

  protected getResumeQueueSize(targetUs: number): number {
    const reportedQueueSize = this.decoder?.decodeQueueSize ?? 0;
    const hasHotCurrentFrame =
      this.currentFrameTimestampUs !== null &&
      Math.abs(this.currentFrameTimestampUs - targetUs) <= (1_000_000 / Math.max(this.frameRate, 1)) * 1.5;
    const pendingTargetUs = this.getPendingSeekTime();
    const isFeedNearCurrentFrame =
      pendingTargetUs == null &&
      this.feedIndex >= this.sampleIndex &&
      this.feedIndex <= this.sampleIndex + WEB_CODECS_PLAYER_LIMITS.FEED_LOOKAHEAD;

    if (hasHotCurrentFrame && isFeedNearCurrentFrame) {
      if (this.trackedDecodeQueueSize > reportedQueueSize) {
        this.trackedDecodeQueueSize = reportedQueueSize;
      }
      return reportedQueueSize;
    }

    return this.getEffectiveDecodeQueueSize();
  }

  protected invalidateStrictPausedSeekFlush(): void {
    this.strictPausedSeekFlushToken++;
  }

  protected abstract clearPendingSeekFallback(exceptFrame?: VideoFrame | null): void;
}
