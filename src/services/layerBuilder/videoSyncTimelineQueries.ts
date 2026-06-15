import type { TimelineClip } from '../../types';
import type { FrameContext } from './types';

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
