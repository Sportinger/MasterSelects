import type { TimelineClip } from '../../types';
import {
  createTransitionSourceClip,
  DEFAULT_TRANSITION_PLACEMENT,
  planTransition,
} from '../../stores/timeline/editOperations/transitionPlanner';
import type { FrameContext } from './types';
import {
  getVisibleVideoTrackClipsAtTime,
  isVisibleVideoTrackClip,
} from './videoSyncTimelineQueries';

export function getVisibleVideoTrackPlaybackClipsAtTime(ctx: FrameContext): TimelineClip[] {
  const clipsById = new Map<string, TimelineClip>();
  for (const clip of getVisibleVideoTrackClipsAtTime(ctx)) {
    clipsById.set(clip.id, clip);
  }
  for (const clip of getVisibleVideoTrackTransitionClipsInWindow(
    ctx,
    ctx.playheadPosition,
    ctx.playheadPosition,
  )) {
    clipsById.set(clip.id, clip);
  }
  return [...clipsById.values()];
}

export function getVisibleVideoTrackTransitionClipsInWindow(
  ctx: FrameContext,
  windowStart: number,
  windowEnd: number,
): TimelineClip[] {
  const clipsById = new Map<string, TimelineClip>();
  const sampleWindowStart = Math.min(windowStart, windowEnd);
  const sampleWindowEnd = Math.max(windowStart, windowEnd);
  const getMediaDuration = (mediaFileId: string) => ctx.mediaFileById.get(mediaFileId)?.duration;

  for (const outgoingClip of ctx.clips) {
    const transition = outgoingClip.transitionOut;
    if (!transition || !isVisibleVideoTrackClip(ctx, outgoingClip)) continue;

    const incomingClip = ctx.clips.find((clip) => clip.id === transition.linkedClipId);
    if (!incomingClip || !isVisibleVideoTrackClip(ctx, incomingClip)) continue;

    const junctionTime = outgoingClip.startTime + outgoingClip.duration;
    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: transition.type,
      requestedDuration: transition.duration,
      params: transition.params,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      junctionTime,
      bodyOffset: transition.offset ?? 0,
      getMediaDuration,
    });
    if (!plan) continue;
    if (plan.bodyEnd <= sampleWindowStart || plan.bodyStart > sampleWindowEnd) continue;

    const sampleTime = Math.max(
      plan.bodyStart,
      Math.min(
        ctx.playheadPosition < plan.bodyStart ? plan.bodyStart : ctx.playheadPosition,
        plan.bodyEnd - 1 / 120,
      ),
    );

    clipsById.set(
      outgoingClip.id,
      createTransitionSourceClip(outgoingClip, plan.outgoing, sampleTime),
    );
    clipsById.set(
      incomingClip.id,
      createTransitionSourceClip(incomingClip, plan.incoming, sampleTime),
    );
  }

  return [...clipsById.values()];
}
