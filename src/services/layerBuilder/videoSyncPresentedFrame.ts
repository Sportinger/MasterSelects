import { Logger } from '../logger';
import { presentedFrameCallbackIsLate } from '../videoSourceFrameRate';

const log = Logger.create('VideoSyncWarmup');

/** How many late frame callbacks a warmup skips before it labels the capture anyway (and warns). */
export const WARMUP_MAX_LATE_FRAME_CALLBACKS = 3;

type FrameCallbackMetadata = { mediaTime?: number };
type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (callback: (now: number, metadata?: FrameCallbackMetadata) => void) => number;
};

function hasVideoFrameCallback(video: HTMLVideoElement): video is VideoFrameCallbackVideo {
  return 'requestVideoFrameCallback' in video;
}

export type OnTimePresentedFrameRequest = {
  clipId: string;
  /** False once the warmup attempt was superseded; the callback chain then stops silently. */
  isCurrent: () => boolean;
  /** Receives the PTS of the presented frame the element shows (undefined when the browser omits it). */
  onFrame: (mediaTime: number | undefined) => void;
};

/**
 * Waits for a presented frame whose requestVideoFrameCallback report still names the picture on
 * screen. A late callback (currentTime already half a frame past the reported PTS, see
 * presentedFrameCallbackIsLate) is skipped and the next presented frame is awaited instead, up to
 * WARMUP_MAX_LATE_FRAME_CALLBACKS times; after that the last report is used and a warning is logged.
 * Returns false when the element has no requestVideoFrameCallback, so the caller can fall back.
 */
export function requestOnTimePresentedFrame(video: HTMLVideoElement, request: OnTimePresentedFrameRequest): boolean {
  if (!hasVideoFrameCallback(video)) return false;
  let lateCallbacks = 0;
  const onPresented = (_now: number, metadata?: FrameCallbackMetadata) => {
    if (!request.isCurrent()) return;
    if (presentedFrameCallbackIsLate(video, metadata?.mediaTime, video.currentTime)) {
      if (lateCallbacks < WARMUP_MAX_LATE_FRAME_CALLBACKS) {
        lateCallbacks++;
        video.requestVideoFrameCallback(onPresented);
        return;
      }
      log.warn('Warmup frame callbacks kept running late; the warmed frame may be labelled one frame early', {
        clipId: request.clipId, mediaTime: metadata?.mediaTime, currentTime: video.currentTime,
      });
    }
    request.onFrame(metadata?.mediaTime);
  };
  video.requestVideoFrameCallback(onPresented);
  return true;
}
