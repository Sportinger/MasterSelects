import type { TimelineClip } from '../types';
import type { useMediaStore } from '../../mediaStore';
import type { NestedMediaRestoreEvent } from '../nestedCompositionLoader';

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

export function canBatchGeneratedComposition(
  composition: MediaStoreState['compositions'][number],
  compositions: MediaStoreState['compositions'],
  path: ReadonlySet<string> = new Set(),
): boolean {
  if (!composition.timelineData || path.has(composition.id)) return false;
  const nextPath = new Set(path).add(composition.id);
  return composition.timelineData.clips.every(clip => {
    if (clip.isComposition && clip.compositionId) {
      const child = compositions.find(candidate => candidate.id === clip.compositionId);
      return !!child && canBatchGeneratedComposition(child, compositions, nextPath);
    }
    return clip.sourceType === 'text' || clip.sourceType === 'motion-shape' || clip.sourceType === 'flock';
  });
}

export function createLoadStateMissingNestedRuntimeSource(
  event: NestedMediaRestoreEvent,
): TimelineClip['source'] | undefined {
  const { serializedClip, sourceType } = event;
  if (!sourceType) return undefined;
  return {
    type: sourceType as NonNullable<TimelineClip['source']>['type'],
    naturalDuration: serializedClip.naturalDuration || serializedClip.duration,
    mediaFileId: serializedClip.mediaFileId,
    threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
    ...(serializedClip.meshType ? { meshType: serializedClip.meshType } : {}),
    ...(serializedClip.text3DProperties ? { text3DProperties: { ...serializedClip.text3DProperties } } : {}),
  };
}

export function restoreNestedVideoSourceThumbnails(
  nestedClips: readonly TimelineClip[],
  restoreSourceThumbnails: (mediaFileId: string | undefined) => void,
  mediaStore: MediaStoreState,
): void {
  for (const nestedClip of nestedClips) {
    const mediaFileId = nestedClip.source?.type === 'video' ? nestedClip.source.mediaFileId : undefined;
    if (mediaFileId && mediaStore.files.find(file => file.id === mediaFileId)?.file) {
      restoreSourceThumbnails(mediaFileId);
    }
    if (nestedClip.nestedClips?.length) {
      restoreNestedVideoSourceThumbnails(nestedClip.nestedClips, restoreSourceThumbnails, mediaStore);
    }
  }
}
