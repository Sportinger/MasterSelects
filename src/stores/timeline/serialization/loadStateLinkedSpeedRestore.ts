import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import { clearProcessedAudioAnalysisRefs } from '../helpers/audioAnalysisStateHelpers';
import { normalizeFollowingAudioSpeedState } from '../helpers/linkedClipSpeed';

interface LinkedSpeedRestoreState {
  clips?: TimelineClip[];
  clipKeyframes?: Map<string, Keyframe[]>;
}

export function restoreLoadStateLinkedSpeedState(
  clips: TimelineClip[],
  keyframes: ReadonlyMap<string, Keyframe[]>,
): LinkedSpeedRestoreState {
  const restored = normalizeFollowingAudioSpeedState(clips, keyframes);
  if (restored.changedAudioClipIds.length === 0) return {};
  const changedIds = new Set(restored.changedAudioClipIds);
  return {
    clips: restored.clips.map(clip => changedIds.has(clip.id)
      ? clearProcessedAudioAnalysisRefs(clip)
      : clip),
    clipKeyframes: restored.keyframes,
  };
}
