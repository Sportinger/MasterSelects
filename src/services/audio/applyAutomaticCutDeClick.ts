import { createAudioEditOperationId } from '../../stores/timeline/audioEdit/audioEditHelpers';
import { clearProcessedAudioAnalysisRefs } from '../../stores/timeline/helpers/audioAnalysisStateHelpers';
import { useTimelineStore } from '../../stores/timeline';
import type { ClipAudioEditOperation } from '../../types/audio';
import { invalidateTimelineRuntimeCache } from '../timeline/timelineRuntimeCoordinator';
import {
  createAutomaticCutDeClickOperation,
  type AutomaticAudioFadeEdge,
  type AutomaticAudioFadeTarget,
} from './automaticCutDeClick';

export function applyAutomaticAudioFades(
  targets: readonly AutomaticAudioFadeTarget[],
  requestedDuration: number,
): number {
  if (targets.length === 0 || requestedDuration <= 0) return 0;
  const targetByClipId = new Map<string, AutomaticAudioFadeEdge[]>();
  for (const target of targets) {
    const edges = targetByClipId.get(target.clipId) ?? [];
    edges.push(target.edge);
    targetByClipId.set(target.clipId, edges);
  }

  let applied = 0;
  useTimelineStore.setState(state => ({
    clips: state.clips.map(clip => {
      const edges = targetByClipId.get(clip.id);
      if (!edges) return clip;
      const operations = edges
        .map(edge => createAutomaticCutDeClickOperation(
          clip,
          edge,
          requestedDuration,
          { createdAt: Date.now(), id: createAudioEditOperationId() },
        ))
        .filter((operation): operation is ClipAudioEditOperation => operation !== null);
      if (operations.length === 0) return clip;
      applied += operations.length;
      return clearProcessedAudioAnalysisRefs({
        ...clip,
        audioState: {
          ...(clip.audioState ?? {}),
          editStack: [...(clip.audioState?.editStack ?? []), ...operations],
        },
      });
    }),
  }));
  if (applied > 0) invalidateTimelineRuntimeCache();
  return applied;
}
