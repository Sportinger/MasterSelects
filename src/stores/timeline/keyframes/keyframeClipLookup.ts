import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

export function findClipById(clips: TimelineClip[], clipId: string): TimelineClip | undefined {
  for (const clip of clips) {
    if (clip.id === clipId) {
      return clip;
    }
    if (clip.nestedClips?.length) {
      const nestedClip = findClipById(clip.nestedClips, clipId);
      if (nestedClip) {
        return nestedClip;
      }
    }
  }
  return undefined;
}

export function isClipOnLockedTrack(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  clipId: string,
): boolean {
  const clip = clips.find(c => c.id === clipId);
  return !!clip && tracks.find(t => t.id === clip.trackId)?.locked === true;
}

export function isAnyKeyframeOnLockedTrack(
  clipKeyframes: Map<string, Keyframe[]>,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  keyframeIds: Iterable<string>,
): boolean {
  const targets = new Set(keyframeIds);
  if (targets.size === 0) return false;

  for (const [clipId, keyframes] of clipKeyframes) {
    if (!keyframes.some(keyframe => targets.has(keyframe.id))) continue;
    if (isClipOnLockedTrack(clips, tracks, clipId)) return true;
  }
  return false;
}
