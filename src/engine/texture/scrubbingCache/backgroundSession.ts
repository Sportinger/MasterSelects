export type ScrubDirection = -1 | 0 | 1;

export interface BackgroundPreloadSession {
  videoSrc: string;
  video: HTMLVideoElement;
  queue: number[];
  queuedFrames: Set<number>;
  processing: boolean;
  disposed: boolean;
  direction: ScrubDirection;
  lastRequestedFrame: number;
  lastScheduleAt: number;
  duration: number;
  windowStart: number;
  windowEnd: number;
  attemptedFrames: Set<number>;
}
