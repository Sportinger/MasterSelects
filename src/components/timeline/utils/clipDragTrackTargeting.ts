import type { TimelineClip, TimelineTrack } from '../../../types';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';

type TrackType = TimelineTrack['type'];
export type ClipDragTrackRequirement = TrackType | null;
export type ClipDragNewTrackType = Extract<TrackType, 'video' | 'audio'>;

export const CLIP_DRAG_NEW_VIDEO_TRACK_ID = '__clip_drag_new_video_track__';
export const CLIP_DRAG_NEW_AUDIO_TRACK_ID = '__clip_drag_new_audio_track__';

const VISUAL_SOURCE_TYPES = new Set([
  'video',
  'image',
  'text',
  'solid',
  'model',
  'camera',
  'gaussian-avatar',
  'gaussian-splat',
  'splat-effector',
  'math-scene',
  'motion-shape',
  'motion-null',
  'motion-adjustment',
]);

export function getClipDragTrackRequirement(
  clip: TimelineClip | undefined,
  tracks: TimelineTrack[],
): ClipDragTrackRequirement {
  const sourceType = clip?.source?.type;
  if (sourceType === 'audio') return 'audio';
  if (sourceType && (VISUAL_SOURCE_TYPES.has(sourceType) || isVectorAnimationSourceType(sourceType))) {
    return 'video';
  }

  return clip ? tracks.find(track => track.id === clip.trackId)?.type ?? null : null;
}

export function isClipDragTrackCompatible(
  track: TimelineTrack | undefined,
  requirement: ClipDragTrackRequirement,
): track is TimelineTrack {
  return !!track && !track.locked && (!requirement || track.type === requirement);
}

export function findNearestCompatibleClipDragTrackId(
  tracks: TimelineTrack[],
  timelineY: number,
  getRenderedTrackHeight: (track: TimelineTrack) => number,
  requirement: ClipDragTrackRequirement,
  timelineContentTop = 24,
): string | null {
  let currentY = timelineContentTop;
  let nearestTrackId: string | null = null;
  let nearestDistance = Infinity;

  for (const track of tracks) {
    const trackHeight = getRenderedTrackHeight(track);
    if (isClipDragTrackCompatible(track, requirement)) {
      const centerY = currentY + trackHeight / 2;
      const distance = Math.abs(timelineY - centerY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestTrackId = track.id;
      }
    }
    currentY += trackHeight;
  }

  return nearestTrackId;
}

export function getClipDragNewTrackId(type: ClipDragNewTrackType): string {
  return type === 'video' ? CLIP_DRAG_NEW_VIDEO_TRACK_ID : CLIP_DRAG_NEW_AUDIO_TRACK_ID;
}

export function getClipDragNewTrackType(
  tracks: TimelineTrack[],
  timelineY: number,
  getRenderedTrackHeight: (track: TimelineTrack) => number,
  requirement: ClipDragTrackRequirement,
  timelineContentTop = 24,
  activeNewTrackType: ClipDragNewTrackType | null = null,
  videoPreviewHeight = 60,
): ClipDragNewTrackType | null {
  if (requirement !== 'video' && requirement !== 'audio') {
    return null;
  }

  let currentY = timelineContentTop;
  let firstCompatibleTop: number | null = null;
  let lastCompatibleBottom: number | null = null;

  for (const track of tracks) {
    const trackHeight = getRenderedTrackHeight(track);
    if (isClipDragTrackCompatible(track, requirement)) {
      firstCompatibleTop ??= currentY;
      lastCompatibleBottom = currentY + trackHeight;
    }
    currentY += trackHeight;
  }

  if (firstCompatibleTop === null || lastCompatibleBottom === null) {
    return requirement;
  }

  const videoThreshold = activeNewTrackType === 'video'
    ? firstCompatibleTop + videoPreviewHeight
    : firstCompatibleTop;

  if (requirement === 'video' && timelineY < videoThreshold) {
    return 'video';
  }

  if (requirement === 'audio' && timelineY > lastCompatibleBottom) {
    return 'audio';
  }

  return null;
}

export function resolveCompatibleClipDragTrackId(
  trackId: string,
  originalTrackId: string,
  clip: TimelineClip | undefined,
  tracks: TimelineTrack[],
): string {
  const requirement = getClipDragTrackRequirement(clip, tracks);
  const currentTrack = tracks.find(track => track.id === trackId);
  if (isClipDragTrackCompatible(currentTrack, requirement)) {
    return currentTrack.id;
  }

  const originalTrack = tracks.find(track => track.id === originalTrackId);
  if (isClipDragTrackCompatible(originalTrack, requirement)) {
    return originalTrack.id;
  }

  return tracks.find(track => isClipDragTrackCompatible(track, requirement))?.id ?? trackId;
}
