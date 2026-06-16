import { renderHostPort } from '../render/renderHostPort';
import { vfPipelineMonitor } from '../vfPipelineMonitor';

export class VideoSyncForceDecodeManager {
  private inProgress = new Set<string>();

  reset(): void {
    this.inProgress.clear();
  }

  clearClip(clipId: string): void {
    this.inProgress.delete(clipId);
  }

  isInProgress(clipId: string): boolean {
    return this.inProgress.has(clipId);
  }

  getClipIds(): string[] {
    return [...this.inProgress];
  }

  forceVideoFrameDecode(clipId: string, video: HTMLVideoElement): void {
    if (this.inProgress.has(clipId)) return;
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
