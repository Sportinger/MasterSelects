import type { TimelineClip } from '../../types/timeline';
import { flags } from '../../engine/featureFlags';
import type { FrameContext } from './types';
import { getUpcomingBakedTransitionVideoWarmupTargets } from './videoSyncTransitionCompositionCoordinator';
import type { VideoSyncWarmupState } from './videoSyncWarmupState';

const WARMUP_RETRY_COOLDOWN_MS = 2000;

interface BakedTransitionWarmupDeps {
  warmups: Pick<VideoSyncWarmupState, 'isWarming' | 'getRetryCooldown'>;
  getClipHtmlVideoElement: (clip: TimelineClip) => HTMLVideoElement | null;
  isVideoGpuReady: (video: HTMLVideoElement) => boolean;
  prewarmUpcomingWebCodecsClip: (ctx: FrameContext, clip: TimelineClip, clipTime: number) => void;
  usesFullWebCodecsPreview: (clip: TimelineClip) => boolean;
  startTargetedWarmup: (clipId: string, video: HTMLVideoElement, targetTime: number, options?: {
    proactive?: boolean; requestRender?: boolean; resumeAfterWarmup?: boolean;
  }) => void;
  positionWarmedUpcomingVideo: (ctx: FrameContext, clip: TimelineClip, video: HTMLVideoElement, targetTime: number) => void;
}

/**
 * Warms the source videos that an upcoming baked (datamosh) transition
 * composition will sample at its body start, so the transition does not open
 * on a stale or black frame.
 */
export function warmUpcomingBakedTransitionVideos(input: {
  ctx: FrameContext;
  deps: BakedTransitionWarmupDeps;
  isInteractivePreview: boolean;
  windowEnd: number;
  windowStart: number;
}): void {
  const { ctx, deps, isInteractivePreview, windowEnd, windowStart } = input;

  for (const { clip, sourceTime } of getUpcomingBakedTransitionVideoWarmupTargets({ ctx, windowStart, windowEnd })) {
    if (flags.useFullWebCodecsPlayback) {
      deps.prewarmUpcomingWebCodecsClip(ctx, clip, sourceTime);
    }

    const video = deps.getClipHtmlVideoElement(clip);
    if (!video || deps.usesFullWebCodecsPreview(clip)) continue;
    if (deps.warmups.isWarming(video)) continue;
    if (!video.src && !video.currentSrc) continue;

    if (deps.isVideoGpuReady(video)) {
      deps.positionWarmedUpcomingVideo(ctx, clip, video, sourceTime);
      continue;
    }
    if (isInteractivePreview) continue;

    const warmupCooldown = deps.warmups.getRetryCooldown(video);
    if (warmupCooldown && performance.now() - warmupCooldown < WARMUP_RETRY_COOLDOWN_MS) continue;

    deps.startTargetedWarmup(clip.id, video, sourceTime, {
      proactive: true,
      requestRender: false,
    });
  }
}
