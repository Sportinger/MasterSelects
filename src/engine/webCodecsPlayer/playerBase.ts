import { Logger } from '../../services/logger';
import { WebCodecsExportMode } from '../WebCodecsExportMode';
import type { ExportModePlayer } from '../WebCodecsExportMode';
import { HtmlVideoFrameSource } from '../webcodecs/htmlVideoFrameSource';
import { WebCodecsSampleTimeline } from '../webcodecs/sampleTimeline';
import { getVideoTrackRotation, type VideoRotationDegrees } from '../webcodecs/videoTrackOrientation';
import type { MP4File, MP4VideoTrack, Sample } from '../webCodecsTypes';
import type { SeekPreviewMode, WebCodecsPlayerOptions } from './playerTypes';

export const webCodecsPlayerLog = Logger.create('WebCodecsPlayer');

export abstract class WebCodecsPlayerBase implements ExportModePlayer {
  protected mp4FileRef: { current: MP4File | null } = { current: null };
  protected decoder: VideoDecoder | null = null;
  protected currentFrame: VideoFrame | null = null;
  protected samples: Sample[] = [];
  protected sampleIndex = 0;
  protected feedIndex = 0;
  protected _isPlaying = false;
  protected _destroyed = false;
  protected loop: boolean;
  protected frameRate = 30;
  protected frameInterval = 1000 / 30;
  protected lastFrameTime = 0;
  protected animationId: number | null = null;
  protected videoTrack: MP4VideoTrack | null = null;
  protected codecConfig: VideoDecoderConfig | null = null;
  protected currentFrameTimestampUs: number | null = null;
  protected presentationOffsetUs = 0;

  // Frame buffer: decoder outputs go here, display picks from here
  protected frameBuffer: VideoFrame[] = [];

  // Simple mode (VideoFrame from HTMLVideoElement)
  protected useSimpleMode = false;
  protected simpleSource: HtmlVideoFrameSource;

  public width = 0;
  public height = 0;
  public ready = false;

  protected onDecodedFrame?: (frame: VideoFrame) => void;
  protected onFrame?: (frame: VideoFrame) => void;
  protected onReady?: (width: number, height: number) => void;
  protected onError?: (error: Error) => void;
  protected hardwareAcceleration?: VideoDecoderConfig['hardwareAcceleration'];

  // Export mode (delegated to WebCodecsExportMode)
  protected exportMode: WebCodecsExportMode;
  protected frameResolve: (() => void) | null = null;
  protected decoderInitialized = false;
  protected pendingDecodeFirstFrame = false;
  protected loadResolve: (() => void) | null = null;

  protected sampleTimeline = new WebCodecsSampleTimeline(() => this.samples);

  // Seek target filtering: during a seek, intermediate GOP frames are decoded
  // before the target. This prevents the renderer from showing them.
  // Set by seek()/fastSeek(), cleared when target frame arrives in output callback.
  protected seekTargetUs: number | null = null;
  protected seekTargetToleranceUs = 0;
  protected pendingAdvanceSeekTargetIdx: number | null = null;
  protected pendingSeekFeedEndIndex: number | null = null;
  protected pausedPrerollEndIndex: number | null = null;
  protected trackedDecodeQueueSize = 0;
  protected decodeErrorCount = 0;
  protected lastDecodeError: string | null = null;
  protected pendingSeekStartedAtMs: number | null = null;
  protected pendingSeekKind: 'seek' | 'advance' | null = null;
  protected pendingSeekTargetDebugUs: number | null = null;
  protected pendingSeekPreviewMode: SeekPreviewMode = 'strict';
  protected pendingSeekFallbackFrame: VideoFrame | null = null;
  protected pendingSeekFallbackDiffUs = Number.POSITIVE_INFINITY;
  protected strictPausedSeekFlushToken = 0;
  protected lastInteractivePreviewPublishAtMs = Number.NEGATIVE_INFINITY;
  protected playbackStartupWarmupStartedAtMs: number | null = null;
  protected lastRAFTime = 0;
  protected lastSeekPlanDebug: {
    targetIndex: number;
    keyframeIndex: number;
    feedEndIndex: number;
    targetTimeSeconds: number;
    targetSampleTimeSeconds: number | null;
    keyframeTimeSeconds: number | null;
  } | null = null;

  protected abstract initDecoder(): void;
  public abstract loadArrayBuffer(buffer: ArrayBuffer): Promise<void>;
  public abstract play(): void;
  public abstract pause(): void;
  public abstract stop(): void;
  public abstract seek(timeSeconds: number, options?: { previewMode?: SeekPreviewMode }): void;
  public abstract seekAsync(timeSeconds: number): Promise<void>;

  constructor(options: WebCodecsPlayerOptions = {}) {
    this.exportMode = new WebCodecsExportMode(this);
    this.loop = options.loop ?? true;
    this.onDecodedFrame = options.onDecodedFrame;
    this.onFrame = options.onFrame;
    this.onReady = options.onReady;
    this.onError = options.onError;
    this.hardwareAcceleration = options.hardwareAcceleration;
    this.useSimpleMode = options.useSimpleMode ?? false;
    this.simpleSource = new HtmlVideoFrameSource({
      closeCurrentFrame: () => {
        if (this.currentFrame) {
          this.currentFrame.close();
        }
      },
      getIsPlaying: () => this._isPlaying,
      onFrame: (frame) => this.onFrame?.(frame),
      onReady: (width, height) => this.onReady?.(width, height),
      setCurrentFrame: (frame) => {
        this.currentFrame = frame;
        this.currentFrameTimestampUs = frame.timestamp;
      },
      setDimensions: (width, height) => {
        this.width = width;
        this.height = height;
      },
      setFrameRate: (frameRate) => {
        this.frameRate = frameRate;
        this.frameInterval = 1000 / this.frameRate;
      },
      setIsPlaying: (isPlaying) => {
        this._isPlaying = isPlaying;
      },
      setReady: (ready) => {
        this.ready = ready;
      },
    });
  }

  protected recordDecodeError(error: unknown, context: string): void {
    this.decodeErrorCount += 1;
    const message = error instanceof Error ? error.message : String(error);
    this.lastDecodeError = `${context}: ${message}`;
  }

  protected refreshPresentationOffset(): void {
    let firstPresentationUs = Number.POSITIVE_INFINITY;
    for (const sample of this.samples) {
      if (!Number.isFinite(sample.cts) || !Number.isFinite(sample.timescale) || sample.timescale <= 0) {
        continue;
      }
      firstPresentationUs = Math.min(firstPresentationUs, (sample.cts * 1_000_000) / sample.timescale);
    }
    this.presentationOffsetUs = Number.isFinite(firstPresentationUs) ? firstPresentationUs : 0;
  }

  protected getSamplePresentationTimestampUs(sample: Sample): number {
    return Math.max(0, (sample.cts * 1_000_000) / sample.timescale - this.presentationOffsetUs);
  }

  protected getTargetCtsForTimeSeconds(timeSeconds: number): number {
    if (!this.videoTrack) return timeSeconds;
    const offsetSeconds = this.presentationOffsetUs / 1_000_000;
    return (timeSeconds + offsetSeconds) * this.videoTrack.timescale;
  }

  // ExportModePlayer interface implementation
  getDecoder(): VideoDecoder | null { return this.decoder; }
  // Recreate a fresh decoder after the current one errored/closed mid-export, so
  // export can recover from a transient decode failure instead of aborting.
  recreateExportDecoder(): VideoDecoder | null {
    if (this.decoder && this.decoder.state !== 'closed') {
      try { this.decoder.close(); } catch {}
    }
    this.decoder = null;
    this.decoderInitialized = false;
    this.initDecoder();
    return this.decoder;
  }
  getSamples(): Sample[] { return this.samples; }
  getSampleIndex(): number { return this.sampleIndex; }
  setSampleIndex(index: number): void { this.sampleIndex = index; this.feedIndex = index; }
  getVideoTrackTimescale(): number | null { return this.videoTrack?.timescale ?? null; }
  getSourceRotationDegrees(): VideoRotationDegrees { return getVideoTrackRotation(this.videoTrack); }
  getCodecConfig(): VideoDecoderConfig | null { return this.codecConfig; }
  getFrameRate(): number { return this.frameRate; }
  getCurrentFrame(): VideoFrame | null {
    // Keep showing last stable frame while seek traversal is in progress.
    // Intermediate traversal frames are dropped in decoder output callback.
    return this.currentFrame;
  }
  setCurrentFrame(frame: VideoFrame | null): void {
    this.currentFrame = frame;
    this.currentFrameTimestampUs = frame?.timestamp ?? null;
  }
  isSimpleMode(): boolean { return this.useSimpleMode; }
  isFullMode(): boolean { return !this.useSimpleMode && this.ready; }
  isDestroyed(): boolean { return this._destroyed; }
  isSeeking(): boolean { return this.seekTargetUs !== null; }
  scrubSeek(timeSeconds: number): void {
    this.seek(timeSeconds, { previewMode: 'interactive' });
  }
  getPendingSeekTime(): number | null {
    if (this.seekTargetUs !== null) {
      return this.seekTargetUs / 1_000_000;
    }
    if (this.pendingAdvanceSeekTargetIdx !== null && this.samples.length > 0) {
      const sample = this.samples[Math.min(this.pendingAdvanceSeekTargetIdx, this.samples.length - 1)];
      return this.getSamplePresentationTimestampUs(sample) / 1_000_000;
    }
    return null;
  }
  /** True when the decoder has queued work that hasn't produced output yet */
  isDecodePending(): boolean { return this.trackedDecodeQueueSize > 0; }
  /** True when an advance seek is in flight (decoder reset, target frame not yet produced) */
  isAdvanceSeekPending(): boolean { return this.pendingAdvanceSeekTargetIdx !== null; }
  getVideoElement(): HTMLVideoElement | null { return this.simpleSource.getVideoElement(); }

  // Stream mode: Use captureStream + MediaStreamTrackProcessor for best performance
  // This gives us VideoFrames without blocking the main thread
  async attachWithStream(video: HTMLVideoElement): Promise<void> {
    await this.simpleSource.attachWithStream(video);
  }

  async loadFile(file: File): Promise<void> {
    // Check VideoFrame support (needed for both modes)
    if (!('VideoFrame' in window)) {
      throw new Error('VideoFrame API not supported in this browser');
    }

    // Simple mode: use HTMLVideoElement + VideoFrame (no MP4Box parsing needed)
    if (this.useSimpleMode) {
      await this.simpleSource.loadFile(file, this.loop);
      return;
    }

    // Full mode: use MP4Box + VideoDecoder
    if (!('VideoDecoder' in window)) {
      throw new Error('WebCodecs VideoDecoder not supported in this browser');
    }

    const arrayBuffer = await file.arrayBuffer();
    await this.loadArrayBuffer(arrayBuffer);
  }

  // Use an existing video element instead of creating one (for timeline integration)
  attachToVideoElement(video: HTMLVideoElement): void {
    if (!('VideoFrame' in window)) {
      throw new Error('VideoFrame API not supported');
    }

    this.useSimpleMode = true;
    this.simpleSource.attachToVideoElement(video);
  }
}
