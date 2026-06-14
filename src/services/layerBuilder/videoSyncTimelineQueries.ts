import type { TimelineClip } from '../../types';
import type { FrameContext } from './types';
import {
  createTransitionSourceClip,
  DEFAULT_TRANSITION_PLACEMENT,
  planTransition,
} from '../../stores/timeline/editOperations/transitionPlanner';

export function isVisibleVideoTrackClip(ctx: FrameContext, clip: TimelineClip): boolean {
  if (!clip.trackId) return false;

  const visibleIds = (ctx as Partial<FrameContext>).visibleVideoTrackIds;
  if (visibleIds) {
    return visibleIds.has(clip.trackId);
  }

  const partialCtx = ctx as Partial<FrameContext>;
  const allTracks = partialCtx.tracks ?? [];
  const videoTracks = partialCtx.videoTracks?.length
    ? partialCtx.videoTracks
    : allTracks.filter((track) => track.type === 'video');
  if (videoTracks.length === 0 && allTracks.length === 0) {
    return true;
  }
  const track = videoTracks.find((candidate) => candidate.id === clip.trackId);
  if (!track || track.visible === false) return false;

  const anySolo = videoTracks.some((candidate) => candidate.solo);
  return !anySolo || !!track.solo;
}

export function getVisibleVideoTrackClipsAtTime(ctx: FrameContext): TimelineClip[] {
  return ctx.clipsAtTime.filter((clip) => isVisibleVideoTrackClip(ctx, clip));
}

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

export function getClipStartTime(ctx: FrameContext, clip: TimelineClip): number {
  const initialSpeed = ctx.getInterpolatedSpeed(clip.id, 0);
  const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
  let sourceTime = 0;
  try {
    sourceTime = ctx.getSourceTimeForClip(clip.id, 0);
  } catch {
    sourceTime = 0;
  }
  return Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));
}

export function getWarmupClipTime(ctx: FrameContext, clip: TimelineClip): number {
  if (!ctx.isDraggingPlayhead) {
    return getClipStartTime(ctx, clip);
  }

  return getClipSampleTimeNearPlayhead(ctx, clip);
}

export function getClipSampleTimeNearPlayhead(ctx: FrameContext, clip: TimelineClip): number {
  const clipEnd = clip.startTime + clip.duration;
  const sampleTimelineTime = Math.max(
    clip.startTime,
    Math.min(Math.max(ctx.playheadPosition, clip.startTime), clipEnd - 1 / 120),
  );
  const clipLocalTime = Math.max(0, sampleTimelineTime - clip.startTime);
  const speed = ctx.getInterpolatedSpeed(clip.id, clipLocalTime);
  const startPoint = speed >= 0 ? clip.inPoint : clip.outPoint;

  let sourceTime = 0;
  try {
    sourceTime = ctx.getSourceTimeForClip(clip.id, clipLocalTime);
  } catch {
    sourceTime = 0;
  }

  return Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));
}

export function getActiveClipsAtTime(ctx: FrameContext, time: number): TimelineClip[] {
  return ctx.clips.filter((clip) =>
    time >= clip.startTime &&
    time < clip.startTime + clip.duration,
  );
}
