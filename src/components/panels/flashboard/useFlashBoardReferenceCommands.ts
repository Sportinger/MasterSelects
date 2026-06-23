import { useCallback } from 'react';
import type {
  FlashBoardComposerReferenceRole,
  FlashBoardComposerState,
} from '../../../stores/flashboardStore';
import type { ComposerReferenceBadge } from './FlashBoardReferenceStrip';

interface UseFlashBoardReferenceCommandsOptions {
  clampReferenceMediaFileIds: (referenceMediaFileIds: string[], maxReferenceMedia?: number) => string[];
  composerEndMediaFileId?: string;
  composerStartMediaFileId?: string;
  effectiveReferenceMediaFileIds: string[];
  maxReferenceMedia?: number;
  setHoveredComposerReference: (reference: { mediaFileId: string; role: FlashBoardComposerReferenceRole } | null) => void;
  supportsEndFrameReference: boolean;
  supportsTimelineReferenceRoles: boolean;
  updateComposer: (patch: Partial<FlashBoardComposerState>) => void;
}

function moveMediaFileIdToReferences(
  currentIds: string[],
  mediaFileId: string,
  maxReferenceMedia: number | undefined,
  clampReferenceMediaFileIds: (referenceMediaFileIds: string[], maxReferenceMedia?: number) => string[],
): string[] {
  const nextIds = [...currentIds.filter((id) => id !== mediaFileId), mediaFileId];
  const limitedIds = clampReferenceMediaFileIds(nextIds, maxReferenceMedia);

  if (limitedIds.includes(mediaFileId)) {
    return limitedIds;
  }

  return clampReferenceMediaFileIds(
    [mediaFileId, ...currentIds.filter((id) => id !== mediaFileId)],
    maxReferenceMedia,
  );
}

export function useFlashBoardReferenceCommands({
  clampReferenceMediaFileIds,
  composerEndMediaFileId,
  composerStartMediaFileId,
  effectiveReferenceMediaFileIds,
  maxReferenceMedia,
  setHoveredComposerReference,
  supportsEndFrameReference,
  supportsTimelineReferenceRoles,
  updateComposer,
}: UseFlashBoardReferenceCommandsOptions) {
  const handleRemoveComposerReference = useCallback((badge: ComposerReferenceBadge) => {
    setHoveredComposerReference(null);

    if (badge.role === 'start') {
      updateComposer({ startMediaFileId: undefined });
      return;
    }

    if (badge.role === 'end') {
      updateComposer({ endMediaFileId: undefined });
      return;
    }

    updateComposer({
      referenceMediaFileIds: effectiveReferenceMediaFileIds.filter((id) => id !== badge.mediaFileId),
    });
  }, [effectiveReferenceMediaFileIds, setHoveredComposerReference, updateComposer]);

  const handleComposerReferenceRoleChange = useCallback((
    badge: ComposerReferenceBadge,
    role: FlashBoardComposerReferenceRole,
  ) => {
    if (role !== 'reference' && !supportsTimelineReferenceRoles) {
      return;
    }

    if (role === 'end' && !supportsEndFrameReference) {
      return;
    }

    const mediaFileId = badge.mediaFileId;
    let nextReferenceMediaFileIds = effectiveReferenceMediaFileIds.filter((id) => id !== mediaFileId);
    const patch: Partial<Pick<FlashBoardComposerState, 'endMediaFileId' | 'referenceMediaFileIds' | 'startMediaFileId'>> = {};

    if (role === 'reference') {
      nextReferenceMediaFileIds = moveMediaFileIdToReferences(
        nextReferenceMediaFileIds,
        mediaFileId,
        maxReferenceMedia,
        clampReferenceMediaFileIds,
      );

      if (composerStartMediaFileId === mediaFileId) {
        patch.startMediaFileId = undefined;
      }
      if (composerEndMediaFileId === mediaFileId) {
        patch.endMediaFileId = undefined;
      }
    } else if (role === 'start') {
      if (composerStartMediaFileId && composerStartMediaFileId !== mediaFileId) {
        nextReferenceMediaFileIds = moveMediaFileIdToReferences(
          nextReferenceMediaFileIds,
          composerStartMediaFileId,
          maxReferenceMedia,
          clampReferenceMediaFileIds,
        );
      }

      patch.startMediaFileId = mediaFileId;
    } else {
      if (composerEndMediaFileId && composerEndMediaFileId !== mediaFileId) {
        nextReferenceMediaFileIds = moveMediaFileIdToReferences(
          nextReferenceMediaFileIds,
          composerEndMediaFileId,
          maxReferenceMedia,
          clampReferenceMediaFileIds,
        );
      }

      patch.endMediaFileId = mediaFileId;
    }

    updateComposer({
      ...patch,
      referenceMediaFileIds: clampReferenceMediaFileIds(nextReferenceMediaFileIds, maxReferenceMedia),
    });

    setHoveredComposerReference({ mediaFileId, role });
  }, [
    clampReferenceMediaFileIds,
    composerEndMediaFileId,
    composerStartMediaFileId,
    effectiveReferenceMediaFileIds,
    maxReferenceMedia,
    setHoveredComposerReference,
    supportsEndFrameReference,
    supportsTimelineReferenceRoles,
    updateComposer,
  ]);

  return {
    handleComposerReferenceRoleChange,
    handleRemoveComposerReference,
  };
}
