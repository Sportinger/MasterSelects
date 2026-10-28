import { WebCodecsPlayerSeekingControls } from './playerSeekingControls';

export abstract class WebCodecsPlayerExportLifecycle extends WebCodecsPlayerSeekingControls {
  // ==================== EXPORT MODE (delegated to WebCodecsExportMode) ====================

  async prepareForSequentialExport(startTimeSeconds: number): Promise<void> {
    return this.exportMode.prepareForSequentialExport(startTimeSeconds);
  }

  async seekDuringExport(timeSeconds: number): Promise<void> {
    return this.exportMode.seekDuringExport(timeSeconds);
  }

  getCurrentSampleIndex(): number {
    return this.sampleIndex;
  }

  isExportMode(): boolean {
    return this.exportMode.isInExportMode;
  }

  endSequentialExport(): void {
    this.exportMode.endSequentialExport();
  }

  get duration(): number {
    const videoElement = this.simpleSource.getVideoElement();
    if (this.useSimpleMode && videoElement) {
      return videoElement.duration || 0;
    }
    if (!this.videoTrack) return 0;
    return this.videoTrack.duration / this.videoTrack.timescale;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get currentTime(): number {
    const videoElement = this.simpleSource.getVideoElement();
    if (this.useSimpleMode && videoElement) {
      return videoElement.currentTime;
    }
    if (this.currentFrameTimestampUs !== null) {
      return this.currentFrameTimestampUs / 1_000_000;
    }
    if (!this.videoTrack || this.samples.length === 0) return 0;
    const sample = this.samples[Math.min(this.sampleIndex, this.samples.length - 1)];
    return this.getSamplePresentationTimestampUs(sample) / 1_000_000;
  }

  destroy(): void {
    this._destroyed = true;
    this.stop();
    this.invalidateStrictPausedSeekFlush();

    this.simpleSource.destroy();

    // Full mode cleanup
    if (this.decoder) {
      this.decoder.close();
      this.decoder = null;
      this.resetDecodeQueueTracking();
    }

    // Clean up export mode
    this.exportMode.destroy();

    if (this.currentFrame) {
      // Only close if not already closed in buffer cleanup
      try {
        this.currentFrame.close();
      } catch {
        // Already closed
      }
      this.currentFrame = null;
    }
    this.currentFrameTimestampUs = null;

    this.mp4FileRef.current = null;
    this.samples = [];
    this.sampleData = null;
    this.ready = false;
  }
}
