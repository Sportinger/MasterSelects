import { requestRenderForVideoFrames } from '../mediaRuntime/liveInputRuntime';

export class VideoSyncFreeRunCoordinator {
  private activeVideos = new Set<HTMLVideoElement>();
  private frameRendering = new Map<HTMLVideoElement, () => void>();

  beginFrame(): void {
    this.activeVideos.clear();
  }

  activate(video: HTMLVideoElement): void {
    this.activeVideos.add(video);
    if (!this.frameRendering.has(video)) {
      this.frameRendering.set(video, requestRenderForVideoFrames(video));
    }
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    if (video.paused) void video.play().catch(() => undefined);
  }

  stop(video: HTMLVideoElement): void {
    this.frameRendering.get(video)?.();
    this.frameRendering.delete(video);
    this.activeVideos.delete(video);
  }

  prune(): void {
    for (const video of this.frameRendering.keys()) {
      if (!this.activeVideos.has(video)) this.stop(video);
    }
  }

  reset(): void {
    for (const stop of this.frameRendering.values()) stop();
    this.frameRendering.clear();
    this.activeVideos.clear();
  }
}
