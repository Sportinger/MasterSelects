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
  'light',
  'gaussian-avatar',
  'gaussian-splat',
  'splat-effector',
  'math-scene',
  'transition-overlay',
  'motion-shape',
  'motion-null',
  'motion-adjustment',
  'storyboard',
  'flock',
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

interface ResolveClipDragPointerTrackTargetInput {
  activeNewTrackType: ClipDragNewTrackType | null;
  clip: TimelineClip | undefined;
  currentTrackId: string;
  getRenderedTrackHeight: (track: TimelineTrack) => number;
  hoveredTrack: TimelineTrack | undefined;
  originalTrackId: string;
  pointerTrack: TimelineTrack | undefined;
  timelineY: number;
  trackChangeAllowed: boolean;
  tracks: TimelineTrack[];
}

export function resolveClipDragPointerTrackTarget({
  activeNewTrackType,
  clip,
  currentTrackId,
  getRenderedTrackHeight,
  hoveredTrack,
  originalTrackId,
  pointerTrack,
  timelineY,
  trackChangeAllowed,
  tracks,
}: ResolveClipDragPointerTrackTargetInput): {
  trackId: string;
  newTrackType: ClipDragNewTrackType | null;
} {
  const requirement = getClipDragTrackRequirement(clip, tracks);
  let trackId = resolveCompatibleClipDragTrackId(currentTrackId, originalTrackId, clip, tracks);
  const newTrackType = trackChangeAllowed && !hoveredTrack
    ? getClipDragNewTrackType(
        tracks,
        timelineY,
        getRenderedTrackHeight,
        requirement,
        24,
        activeNewTrackType,
      )
    : null;

  if (newTrackType) {
    return { trackId: getClipDragNewTrackId(newTrackType), newTrackType };
  }

  if (
    hoveredTrack
    && (trackChangeAllowed || hoveredTrack.id === originalTrackId)
    && isClipDragTrackCompatible(hoveredTrack, requirement)
  ) {
    trackId = hoveredTrack.id;
  } else if (
    !hoveredTrack
    && pointerTrack
    && (trackChangeAllowed || pointerTrack.id === originalTrackId)
    && isClipDragTrackCompatible(pointerTrack, requirement)
  ) {
    trackId = pointerTrack.id;
  }

  const pointerTrackId = pointerTrack?.id;
  const pointerTrackType = pointerTrack?.type;
  if (pointerTrackId && pointerTrack && !isClipDragTrackCompatible(pointerTrack, requirement)) {
    const crossedTrackTypeBoundary = requirement !== null && pointerTrackType !== requirement;
    const nearestCompatibleTrackId = crossedTrackTypeBoundary
      ? resolveCompatibleClipDragTrackId(pointerTrackId, originalTrackId, clip, tracks)
      : trackChangeAllowed
        ? findNearestCompatibleClipDragTrackId(tracks, timelineY, getRenderedTrackHeight, requirement)
        : null;
    if (nearestCompatibleTrackId) trackId = nearestCompatibleTrackId;
  }

  return { trackId, newTrackType: null };
}

export function resolveCompatibleClipDragTrackId(
  trackId: string,
  originalTrackId: string,
  clip: TimelineClip | undefined,
  tracks: TimelineTrack[],
): string {
  const requirement = getClipDragTrackRequirement(clip, tracks);
  const currentTrackIndex = tracks.findIndex(track => track.id === trackId);
  const currentTrack = tracks.find(track => track.id === trackId);
  if (isClipDragTrackCompatible(currentTrack, requirement)) {
    return currentTrack.id;
  }

  if (currentTrackIndex >= 0) {
    let nearestTrackId: string | null = null;
    let nearestTrackDistance = Infinity;
    tracks.forEach((track, index) => {
      if (!isClipDragTrackCompatible(track, requirement)) return;
      const distance = Math.abs(index - currentTrackIndex);
      if (distance < nearestTrackDistance) {
        nearestTrackId = track.id;
        nearestTrackDistance = distance;
      }
    });
    if (nearestTrackId) return nearestTrackId;
  }

  const originalTrack = tracks.find(track => track.id === originalTrackId);
  if (isClipDragTrackCompatible(originalTrack, requirement)) {
    return originalTrack.id;
  }

  return tracks.find(track => isClipDragTrackCompatible(track, requirement))?.id ?? trackId;
}
