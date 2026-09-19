export type VideoSyncUpcomingPreplayState = {
  clipId: string;
  startTime: number;
};

export class VideoSyncWarmupState {
  // Videos currently being warmed up (brief play to activate GPU surface).
  private warmingVideos = new WeakSet<HTMLVideoElement>();
  private retryCooldowns = new WeakMap<HTMLVideoElement, number>();
  private attemptIds = new WeakMap<HTMLVideoElement, number>();
  private watchdogs = new WeakMap<HTMLVideoElement, ReturnType<typeof setTimeout>>();
  private clipIds = new WeakMap<HTMLVideoElement, string>();
  private targetTimes = new WeakMap<HTMLVideoElement, number>();
  private gpuReadyVideos = new WeakSet<HTMLVideoElement>();
  private nextAttemptId = 1;
  private upcomingPreplays = new Map<HTMLVideoElement, VideoSyncUpcomingPreplayState>();

  reset(): void {
    this.pauseAndClearUpcomingPreplays();
    this.warmingVideos = new WeakSet();
    this.retryCooldowns = new WeakMap();
    this.attemptIds = new WeakMap();
    this.watchdogs = new WeakMap();
    this.clipIds = new WeakMap();
    this.targetTimes = new WeakMap();
    this.gpuReadyVideos = new WeakSet();
    this.nextAttemptId = 1;
  }

  pauseAndClearUpcomingPreplays(): void {
    for (const video of this.upcomingPreplays.keys()) {
      if (!video.paused) {
        video.pause();
      }
      if (video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
    }
    this.upcomingPreplays.clear();
  }

  beginAttempt(video: HTMLVideoElement, clipId: string, targetTime: number): number {
    const attemptId = this.nextAttemptId++;
    this.attemptIds.set(video, attemptId);
    this.warmingVideos.add(video);
    this.clipIds.set(video, clipId);
    this.targetTimes.set(video, targetTime);
    return attemptId;
  }

  isAttemptCurrent(video: HTMLVideoElement, attemptId: number): boolean {
    return this.attemptIds.get(video) === attemptId;
  }

  clearActiveWarmup(video: HTMLVideoElement): void {
    this.attemptIds.delete(video);
    this.warmingVideos.delete(video);
    this.clipIds.delete(video);
    this.targetTimes.delete(video);
  }

  completeAttempt(video: HTMLVideoElement): void {
    this.clearActiveWarmup(video);
    this.gpuReadyVideos.add(video);
  }

  clearVideo(video: HTMLVideoElement): void {
    this.clearWatchdog(video);
    this.clearActiveWarmup(video);
    this.gpuReadyVideos.delete(video);
    this.retryCooldowns.delete(video);
    this.upcomingPreplays.delete(video);
  }

  isWarming(video: HTMLVideoElement): boolean {
    return this.warmingVideos.has(video);
  }

  getClipId(video: HTMLVideoElement): string | undefined {
    return this.clipIds.get(video);
  }

  getTargetTime(video: HTMLVideoElement): number | undefined {
    return this.targetTimes.get(video);
  }

  setRetryCooldown(video: HTMLVideoElement, now: number): void {
    this.retryCooldowns.set(video, now);
  }

  getRetryCooldown(video: HTMLVideoElement): number | undefined {
    return this.retryCooldowns.get(video);
  }

  isGpuReady(video: HTMLVideoElement): boolean {
    return this.gpuReadyVideos.has(video);
  }

  setWatchdog(video: HTMLVideoElement, watchdog: ReturnType<typeof setTimeout>): void {
    this.watchdogs.set(video, watchdog);
  }

  clearWatchdog(video: HTMLVideoElement): void {
    const watchdog = this.watchdogs.get(video);
    if (watchdog) {
      clearTimeout(watchdog);
      this.watchdogs.delete(video);
    }
  }

  listUpcomingPreplays(): Array<[HTMLVideoElement, VideoSyncUpcomingPreplayState]> {
    return [...this.upcomingPreplays];
  }

  hasUpcomingPreplay(video: HTMLVideoElement): boolean {
    return this.upcomingPreplays.has(video);
  }

  setUpcomingPreplay(video: HTMLVideoElement, state: VideoSyncUpcomingPreplayState): void {
    this.upcomingPreplays.set(video, state);
  }

  deleteUpcomingPreplay(video: HTMLVideoElement): void {
    this.upcomingPreplays.delete(video);
  }
}
