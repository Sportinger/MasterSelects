import type {
  FlashBoardComposerReferenceRole,
  FlashBoardComposerState,
} from '../../../stores/flashboardStore';
import {
  appendReferenceMediaFileIds,
  clampReferenceMediaFileIds,
} from './FlashBoardReferenceMediaPlanner';

type ReferenceAssignmentPatch = Partial<Pick<
  FlashBoardComposerState,
  'endMediaFileId' | 'referenceMediaFileIds' | 'startMediaFileId'
>>;

interface BuildFlashBoardReferenceRolePatchInput {
  composer: Pick<FlashBoardComposerState, 'endMediaFileId' | 'referenceMediaFileIds' | 'startMediaFileId'>;
  effectiveReferenceMediaFileIds: string[];
  maxReferenceMedia?: number;
  mediaFileId: string;
  role: FlashBoardComposerReferenceRole;
}

export function buildFlashBoardReferenceRolePatch({
  composer,
  effectiveReferenceMediaFileIds,
  maxReferenceMedia,
  mediaFileId,
  role,
}: BuildFlashBoardReferenceRolePatchInput): ReferenceAssignmentPatch {
  let nextReferenceMediaFileIds = effectiveReferenceMediaFileIds.filter((id) => id !== mediaFileId);
  const patch: ReferenceAssignmentPatch = {};

  if (role === 'start') {
    if (composer.startMediaFileId && composer.startMediaFileId !== mediaFileId) {
      nextReferenceMediaFileIds = appendReferenceMediaFileIds(nextReferenceMediaFileIds, [composer.startMediaFileId]);
    }
    if (composer.endMediaFileId === mediaFileId) {
      patch.endMediaFileId = undefined;
    }
    patch.startMediaFileId = mediaFileId;
  } else if (role === 'end') {
    if (composer.endMediaFileId && composer.endMediaFileId !== mediaFileId) {
      nextReferenceMediaFileIds = appendReferenceMediaFileIds(nextReferenceMediaFileIds, [composer.endMediaFileId]);
    }
    if (composer.startMediaFileId === mediaFileId) {
      patch.startMediaFileId = undefined;
    }
    patch.endMediaFileId = mediaFileId;
  } else {
    if (composer.startMediaFileId === mediaFileId) {
      patch.startMediaFileId = undefined;
    }
    if (composer.endMediaFileId === mediaFileId) {
      patch.endMediaFileId = undefined;
    }
    nextReferenceMediaFileIds = appendReferenceMediaFileIds(nextReferenceMediaFileIds, [mediaFileId]);
  }

  return {
    ...patch,
    referenceMediaFileIds: clampReferenceMediaFileIds(nextReferenceMediaFileIds, maxReferenceMedia),
  };
}
