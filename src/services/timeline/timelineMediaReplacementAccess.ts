import { useMediaStore } from '../../stores/mediaStore';
import type { Composition, MediaFile } from '../../stores/mediaStore/types';

interface TimelineCompositionReplacementContext {
  activeCompositionId: string | null;
  composition: Composition | undefined;
  compositions: Composition[];
}

export function findTimelineReplacementMediaFile(mediaFileId: string): MediaFile | undefined {
  return useMediaStore.getState().files.find((candidate) => candidate.id === mediaFileId);
}

export function getTimelineCompositionReplacementContext(
  compositionId: string,
): TimelineCompositionReplacementContext {
  const { activeCompositionId, compositions } = useMediaStore.getState();
  return {
    activeCompositionId,
    composition: compositions.find((candidate) => candidate.id === compositionId),
    compositions,
  };
}
