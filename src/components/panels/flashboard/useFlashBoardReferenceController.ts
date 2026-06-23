import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';
import type {
  FlashBoardComposerState,
  FlashBoardHoveredComposerReference,
} from '../../../stores/flashboardStore';
import type { MediaFile } from '../../../stores/mediaStore';
import {
  getSeedanceReferenceValidationError,
  isSeedance2ProviderId,
} from '../../../services/flashboard/seedanceReferenceRules';
import type { CatalogEntry } from '../../../services/flashboard/types';
import { buildFlashBoardReferenceBadges } from './FlashBoardReferenceBadgePlanner';
import {
  appendReferenceMediaFileIds,
  clampReferenceMediaFileIds,
  isReferenceableMediaType,
} from './FlashBoardReferenceMediaPlanner';
import { useFlashBoardReferenceCommands } from './useFlashBoardReferenceCommands';
import { useFlashBoardReferenceDrop } from './useFlashBoardReferenceDrop';
import { useFlashBoardReferenceFocus } from './useFlashBoardReferenceFocus';

type ReferenceControllerEntry = Pick<
  CatalogEntry,
  'maxReferenceImages' | 'maxReferenceMedia' | 'supportsImageToVideo'
> | null | undefined;

const EMPTY_REFERENCE_MEDIA_FILE_IDS: string[] = [];

interface UseFlashBoardReferenceValidationControllerInput {
  composer: FlashBoardComposerState;
  mediaFiles: MediaFile[];
  providerId: string;
}

interface UseFlashBoardReferenceControllerInput {
  composer: FlashBoardComposerState;
  isAudioMode: boolean;
  mediaFiles: MediaFile[];
  multiShots: boolean;
  selectedEntry: ReferenceControllerEntry;
  setHoveredComposerReference: (reference: FlashBoardHoveredComposerReference | null) => void;
  updateComposer: (patch: Partial<FlashBoardComposerState>) => void;
}

function buildMediaFilesById(mediaFiles: MediaFile[]): ReadonlyMap<string, MediaFile> {
  return new Map(mediaFiles.map((file) => [file.id, file]));
}

export function useFlashBoardReferenceValidationController({
  composer,
  mediaFiles,
  providerId,
}: UseFlashBoardReferenceValidationControllerInput) {
  const mediaFilesById = useMemo(() => buildMediaFilesById(mediaFiles), [mediaFiles]);
  const hasSeedanceAudioReferenceInput = useMemo(
    () => (composer.referenceMediaFileIds ?? []).some((mediaFileId) => (
      mediaFilesById.get(mediaFileId)?.type === 'audio'
    )),
    [composer.referenceMediaFileIds, mediaFilesById],
  );
  const hasSeedanceVisualReferenceInput = useMemo(
    () => Boolean(composer.startMediaFileId || composer.endMediaFileId)
      || (composer.referenceMediaFileIds ?? []).some((mediaFileId) => {
        const mediaType = mediaFilesById.get(mediaFileId)?.type;
        return mediaType === 'image' || mediaType === 'video';
      }),
    [
      composer.endMediaFileId,
      composer.referenceMediaFileIds,
      composer.startMediaFileId,
      mediaFilesById,
    ],
  );
  const hasImageReferenceInput = useMemo(
    () => [composer.startMediaFileId, composer.endMediaFileId, ...(composer.referenceMediaFileIds ?? [])]
      .some((mediaFileId) => mediaFilesById.get(mediaFileId ?? '')?.type === 'image'),
    [
      composer.endMediaFileId,
      composer.referenceMediaFileIds,
      composer.startMediaFileId,
      mediaFilesById,
    ],
  );
  const hasVideoReferenceInput = useMemo(
    () => (composer.referenceMediaFileIds ?? []).some((mediaFileId) => (
      mediaFilesById.get(mediaFileId)?.type === 'video'
    )),
    [composer.referenceMediaFileIds, mediaFilesById],
  );
  const seedanceReferenceModeActive = isSeedance2ProviderId(providerId)
    && (composer.referenceMediaFileIds ?? []).length > 0;
  const seedanceReferenceValidationError = getSeedanceReferenceValidationError({
    hasAudioReference: hasSeedanceAudioReferenceInput,
    hasVisualReference: hasSeedanceVisualReferenceInput,
    providerId,
  });

  return {
    hasAudioReferenceInput: hasSeedanceAudioReferenceInput,
    hasImageReferenceInput,
    hasVisualReferenceInput: hasSeedanceVisualReferenceInput,
    hasVideoReferenceInput,
    seedanceReferenceModeActive,
    seedanceReferenceValidationError,
  };
}

export function useFlashBoardReferenceController({
  composer,
  isAudioMode,
  mediaFiles,
  multiShots,
  selectedEntry,
  setHoveredComposerReference,
  updateComposer,
}: UseFlashBoardReferenceControllerInput) {
  const referenceMediaFileIds = composer.referenceMediaFileIds ?? EMPTY_REFERENCE_MEDIA_FILE_IDS;
  const currentReferenceMediaFileIdsRef = useRef(referenceMediaFileIds);
  useLayoutEffect(() => {
    currentReferenceMediaFileIdsRef.current = referenceMediaFileIds;
  }, [referenceMediaFileIds]);

  const {
    handleReferenceStripPointerLeave,
    referenceStripRef,
    updateReferenceCardFocus,
  } = useFlashBoardReferenceFocus();
  const mediaFilesById = useMemo(() => buildMediaFilesById(mediaFiles), [mediaFiles]);
  const maxReferenceMedia = selectedEntry?.maxReferenceMedia ?? selectedEntry?.maxReferenceImages;
  const effectiveReferenceMediaFileIds = useMemo(
    () => clampReferenceMediaFileIds(referenceMediaFileIds, maxReferenceMedia),
    [maxReferenceMedia, referenceMediaFileIds],
  );
  const supportsTimelineReferenceRoles = !isAudioMode && selectedEntry?.supportsImageToVideo === true;
  const supportsEndFrameReference = supportsTimelineReferenceRoles && !multiShots;

  const getCurrentReferenceMediaFileIds = useCallback(
    () => currentReferenceMediaFileIdsRef.current,
    [],
  );
  const updateReferenceMediaFileIds = useCallback((nextReferenceMediaFileIds: string[]) => {
    updateComposer({ referenceMediaFileIds: nextReferenceMediaFileIds });
  }, [updateComposer]);
  const {
    handleReferenceDragLeave,
    handleReferenceDragOver,
    handleReferenceDrop,
    isReferenceDragOver,
  } = useFlashBoardReferenceDrop({
    appendReferenceMediaFileIds,
    clampReferenceMediaFileIds,
    getCurrentReferenceMediaFileIds,
    isReferenceableMediaType,
    maxReferenceMedia,
    mediaFilesById,
    updateReferenceMediaFileIds,
  });
  const {
    handleComposerReferenceRoleChange,
    handleRemoveComposerReference,
  } = useFlashBoardReferenceCommands({
    clampReferenceMediaFileIds,
    composerEndMediaFileId: composer.endMediaFileId,
    composerStartMediaFileId: composer.startMediaFileId,
    effectiveReferenceMediaFileIds,
    maxReferenceMedia,
    setHoveredComposerReference,
    supportsEndFrameReference,
    supportsTimelineReferenceRoles,
    updateComposer,
  });
  const composerReferenceBadges = useMemo(() => buildFlashBoardReferenceBadges({
    endMediaFileId: composer.endMediaFileId,
    isReferenceableMediaType,
    mediaFilesById,
    referenceMediaFileIds: effectiveReferenceMediaFileIds,
    startMediaFileId: composer.startMediaFileId,
  }), [
    composer.endMediaFileId,
    composer.startMediaFileId,
    effectiveReferenceMediaFileIds,
    mediaFilesById,
  ]);
  const getPromptRefineMediaFile = useCallback(
    (mediaFileId: string) => mediaFilesById.get(mediaFileId),
    [mediaFilesById],
  );
  const showComposerReferences = composerReferenceBadges.length > 0;
  const composerStyle = useMemo<CSSProperties | undefined>(() => (
    showComposerReferences
      ? ({ '--fb-reference-strip-width': `${Math.max(80, composerReferenceBadges.length * 80 + 4)}px` } as CSSProperties)
      : undefined
  ), [composerReferenceBadges.length, showComposerReferences]);

  return {
    composerReferenceBadges,
    composerStyle,
    effectiveReferenceMediaFileIds,
    getPromptRefineMediaFile,
    handleComposerReferenceRoleChange,
    handleReferenceDragLeave,
    handleReferenceDragOver,
    handleReferenceDrop,
    handleReferenceStripPointerLeave,
    handleRemoveComposerReference,
    isReferenceDragOver,
    maxReferenceMedia,
    referenceStripRef,
    showComposerReferences,
    supportsEndFrameReference,
    supportsTimelineReferenceRoles,
    updateReferenceCardFocus,
  };
}
