import type { TimelineClip } from '../../types/timeline';
import type { FrameContext } from './types';
import { isVisibleVideoTrackClip } from './videoSyncTimelineQueries';
import type { VideoSyncWarmupState } from './videoSyncWarmupState';

interface NestedCompWarmupDeps {
  warmups: Pick<VideoSyncWarmupState, 'isWarming'>;
  getClipHtmlVideoElement: (clip: TimelineClip) => HTMLVideoElement | null;
  safeSeekTime: (video: HTMLVideoElement, time: number) => number;
}

export function preBufferUpcomingNestedCompVideos(
  ctx: FrameContext,
  deps: NestedCompWarmupDeps,
  lookaheadSeconds: number,
): void {
  if (!ctx.isPlaying || ctx.isDraggingPlayhead) return;

  const lookaheadEnd = ctx.playheadPosition + lookaheadSeconds;
  for (const compClip of ctx.clips) {
    if (!isVisibleVideoTrackClip(ctx, compClip)) continue;
    if (
      !compClip.isComposition
      || !compClip.nestedClips?.length
      || compClip.startTime <= ctx.playheadPosition
      || compClip.startTime > lookaheadEnd
    ) continue;

    const compStartTime = compClip.inPoint;
    for (const nestedClip of compClip.nestedClips) {
      const video = deps.getClipHtmlVideoElement(nestedClip);
      if (!video) continue;

      const nestedClipEnd = nestedClip.startTime + nestedClip.duration;
      if (compStartTime < nestedClip.startTime || compStartTime >= nestedClipEnd) continue;

      const nestedLocalTime = compStartTime - nestedClip.startTime;
      const targetTime = nestedClip.reversed
        ? nestedClip.outPoint - nestedLocalTime
        : nestedLocalTime + nestedClip.inPoint;
      if (deps.warmups.isWarming(video) || video.seeking) continue;

      if (video.preload !== 'auto') video.preload = 'auto';
      if (Math.abs(video.currentTime - targetTime) > 0.1) {
        video.currentTime = deps.safeSeekTime(video, targetTime);
      }
    }
  }
}
