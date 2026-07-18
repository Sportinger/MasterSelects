import type { TimelineClip } from '../../types/timeline';

export function clipTreeContainsLiveInput(clip: TimelineClip, depth = 0): boolean {
  if (clip.source?.liveInputId) return true;
  if (depth >= 8) return false;
  return clip.nestedClips?.some((nestedClip) => clipTreeContainsLiveInput(nestedClip, depth + 1)) ?? false;
}

export function clipTreeNeedsLiveVideoElement(clip: TimelineClip, depth = 0): boolean {
  if (clip.freeRun || clip.source?.liveInputId) return true;
  if (depth >= 8) return false;
  return clip.nestedClips?.some((nestedClip) => clipTreeNeedsLiveVideoElement(nestedClip, depth + 1)) ?? false;
}
