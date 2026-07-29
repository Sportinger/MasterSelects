import { renderHostPort } from '../render/renderHostPort';
import { vfPipelineMonitor } from '../vfPipelineMonitor';

export class VideoSyncForceDecodeManager {
  private static readonly RETRY_COOLDOWN_MS = 2000;

  private inProgress = new Set<string>();
  private lastAttemptAt = new Map<string, number>();

  reset(): void {
    this.inProgress.clear();
    this.lastAttemptAt.clear();
  }

  clearClip(clipId: string): void {
    this.inProgress.delete(clipId);
    this.lastAttemptAt.delete(clipId);
  }

  isInProgress(clipId: string): boolean {
    return this.inProgress.has(clipId);
  }

  getClipIds(): string[] {
    return [...this.inProgress];
  }

  forceVideoFrameDecode(clipId: string, video: HTMLVideoElement): void {
    const now = performance.now();
    const lastAttemptAt = this.lastAttemptAt.get(clipId);
    if (
      this.inProgress.has(clipId) ||
      (
        lastAttemptAt !== undefined &&
        now - lastAttemptAt < VideoSyncForceDecodeManager.RETRY_COOLDOWN_MS
      )
    ) {
      return;
    }

    this.lastAttemptAt.set(clipId, now);
    this.inProgress.add(clipId);

    const currentTime = video.currentTime;
    video.muted = true;
    video.play()
      .then(() => {
        video.pause();
        video.currentTime = currentTime;
        this.inProgress.delete(clipId);
        renderHostPort.requestRender();
      })
      .catch(() => {
        video.currentTime = currentTime + 0.001;
        this.inProgress.delete(clipId);
        renderHostPort.requestRender();
      });
  }

  forceColdScrubFrame(clipId: string, video: HTMLVideoElement): void {
    if (this.inProgress.has(clipId)) return;
    this.inProgress.add(clipId);
    vfPipelineMonitor.record('vf_gpu_cold', { clipId, scrub: 'true' });
    void renderHostPort
      .preCacheVideoFrame(video, clipId)
      .finally(() => {
        this.inProgress.delete(clipId);
        renderHostPort.requestNewFrameRender();
      });
  }
}
