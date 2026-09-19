import {
  DEFAULT_TRANSITION_PLACEMENT,
  findActiveTransitionPlanForTrack,
} from '../../stores/timeline/editOperations/transitionPlanner';
import type { TimelineClip } from '../../types/timeline';
import {
  getNestedClipSourceTime,
} from './layerBuilderNestedSourceTiming';
import { resolveTransitionCompositionRuntime } from './layerBuilderTransitionComposition';
import type { FrameContext } from './types';
import { getVisibleVideoTrackTransitionPlansInWindow } from './videoSyncTransitionQueries';

export interface TransitionCompositionVideoWarmupTarget {
  clip: TimelineClip;
  sourceTime: number;
}

export function getUpcomingBakedTransitionVideoWarmupTargets(input: {
  ctx: FrameContext;
  windowStart: number;
  windowEnd: number;
}): TransitionCompositionVideoWarmupTarget[] {
  const { ctx, windowStart, windowEnd } = input;
  const targets = new Map<string, TransitionCompositionVideoWarmupTarget>();

  for (const activeTransition of getVisibleVideoTrackTransitionPlansInWindow(ctx, windowStart, windowEnd)) {
    if (activeTransition.plan.bodyStart <= ctx.playheadPosition + 1e-6) continue;

    const runtime = resolveTransitionCompositionRuntime(activeTransition, {
      ...ctx,
      playheadPosition: activeTransition.plan.bodyStart,
    });
    if (runtime?.composition.transitionComp?.templateType !== 'datamosh-baked') continue;

    const visibleVideoTrackIds = new Set(
      runtime.nestedTimeline.tracks
        .filter(track => track.type === 'video' && track.visible !== false)
        .map(track => track.id),
    );
    for (const clip of runtime.nestedTimeline.clips) {
      const clipEnd = clip.startTime + clip.duration;
      if (
        clip.source?.type !== 'video'
        || !visibleVideoTrackIds.has(clip.trackId)
        || runtime.compositionTime < clip.startTime
        || runtime.compositionTime >= clipEnd
      ) continue;

      const sourceTime = getNestedClipSourceTime(
        clip,
        runtime.compositionTime - clip.startTime,
      );
      targets.set(clip.id, { clip, sourceTime });
    }
  }

  return [...targets.values()];
}

export function syncActiveTransitionCompositionVideos(input: {
  ctx: FrameContext;
  syncNestedComposition: (clip: TimelineClip, compositionTime: number) => void;
}): void {
  const { ctx, syncNestedComposition } = input;
  for (const track of ctx.videoTracks) {
    if (!ctx.visibleVideoTrackIds.has(track.id)) continue;
    const activeTransition = findActiveTransitionPlanForTrack({
      clips: ctx.clips,
      trackId: track.id,
      time: ctx.playheadPosition,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      getMediaDuration: (mediaFileId) => ctx.mediaFileById.get(mediaFileId)?.duration,
    });
    if (!activeTransition) continue;

    const runtime = resolveTransitionCompositionRuntime(activeTransition, ctx);
    if (!runtime) continue;
    syncNestedComposition(runtime.syntheticClip, runtime.compositionTime);
  }
}

export function syncActiveTransitionCompositionVideosWithCoordinator(
  ctx: FrameContext,
  coordinator: {
    syncNestedCompVideos(
      clip: TimelineClip,
      ctx: FrameContext,
      depth: number,
      compositionTime: number,
    ): void;
  },
): void {
  syncActiveTransitionCompositionVideos({
    ctx,
    syncNestedComposition: (clip, compositionTime) => {
      coordinator.syncNestedCompVideos(clip, ctx, 0, compositionTime);
    },
  });
}
