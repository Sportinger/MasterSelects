import type { TimelineClip, TimelineTrack } from '../../../types';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';

export type ResolvedMoveFallbackTrackType = 'video' | 'audio';

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
]);

function getTrackRequirement(clip: TimelineClip): TimelineTrack['type'] | null {
  const sourceType = clip.source?.type;
  if (sourceType === 'audio') return 'audio';
  if (sourceType && (VISUAL_SOURCE_TYPES.has(sourceType) || isVectorAnimationSourceType(sourceType))) {
    return 'video';
  }
  return null;
}

export function isTrackCompatible(clip: TimelineClip, track: TimelineTrack | undefined): track is TimelineTrack {
  if (!track || track.locked) return false;
  const requirement = getTrackRequirement(clip);
  return !requirement || track.type === requirement;
}

export function isNewTrackTypeCompatible(clip: TimelineClip, trackType: ResolvedMoveFallbackTrackType): boolean {
  const requirement = getTrackRequirement(clip);
  return !requirement || requirement === trackType;
}
