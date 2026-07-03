import {
  useCallback,
  type DragEvent as ReactDragEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import type { ComposerReferenceSlot } from './FlashBoardReferenceStrip';
import {
  appendReferenceMediaFileIds,
  clampReferenceMediaFileIds,
  isReferenceableMediaType,
} from './FlashBoardReferenceMediaPlanner';
import { buildFlashBoardReferenceRolePatch } from './FlashBoardReferenceAssignmentPlanner';
import { runFlashBoardReferenceTransition } from './FlashBoardReferenceTransition';
import { useFlashBoardReferenceCommands } from './useFlashBoardReferenceCommands';
import { useFlashBoardReferenceDrop } from './useFlashBoardReferenceDrop';
import { useFlashBoardReferenceFocus } from './useFlashBoardReferenceFocus';

type ReferenceControllerEntry = Pick<
  CatalogEntry,
  | 'maxReferenceImages'
  | 'maxReferenceMedia'
  | 'referenceInputKinds'
  | 'requiredReferenceMediaType'
  | 'supportsImageToVideo'
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

function findNearestReferenceSlotKey(container: ParentNode, clientX: number, clientY: number): string | null {
  for (const element of container.querySelectorAll<HTMLElement>('[data-slot-key]')) {
    const rect = element.getBoundingClientRect();
    if (
      clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
    ) {
      return element.dataset.slotKey ?? null;
    }
  }

  return null;
}

function buildReferenceSlots({
  hasEndFrame,
  hasStartFrame,
  multiShots,
  selectedEntry,
  supportsEndFrameReference,
  supportsTimelineReferenceRoles,
}: {
  hasEndFrame: boolean;
  hasStartFrame: boolean;
  multiShots: boolean;
  selectedEntry: ReferenceControllerEntry;
  supportsEndFrameReference: boolean;
  supportsTimelineReferenceRoles: boolean;
}): ComposerReferenceSlot[] {
  if (!selectedEntry) {
    return [];
  }

  const inputKinds = selectedEntry.referenceInputKinds ?? (
    selectedEntry.requiredReferenceMediaType === 'video'
      ? ['video-input' as const]
      : selectedEntry.supportsImageToVideo
        ? ['start-frame' as const, 'end-frame' as const]
        : []
  );
  const slots: ComposerReferenceSlot[] = [];

  const addSlot = (slot: ComposerReferenceSlot) => {
    if (!slots.some((existing) => existing.key === slot.key)) {
      slots.push(slot);
    }
  };

  if (
    inputKinds.includes('start-frame')
    && supportsTimelineReferenceRoles
    && !hasStartFrame
  ) {
    addSlot({
      key: 'start-frame',
      role: 'start',
      roleLabel: 'IN',
      title: 'Start frame input',
      displayName: 'Start frame',
      accepts: ['image'],
    });
  }

  if (
    inputKinds.includes('end-frame')
    && supportsEndFrameReference
    && !multiShots
    && !hasEndFrame
  ) {
    addSlot({
      key: 'end-frame',
      role: 'end',
      roleLabel: 'OUT',
      title: 'End frame input',
      displayName: 'End frame',
      accepts: ['image'],
    });
  }

  if (inputKinds.includes('image-reference')) {
    addSlot({
      key: 'image-reference',
      role: 'reference',
      roleLabel: 'REF',
      title: 'Image reference input',
      displayName: 'Image reference',
      accepts: ['image'],
    });
  }

  if (inputKinds.includes('video-reference')) {
    addSlot({
      key: 'video-reference',
      role: 'reference',
      roleLabel: 'VID',
      title: 'Video reference input',
      displayName: 'Video reference',
      className: 'video-reference',
      accepts: ['video'],
    });
  }

  if (inputKinds.includes('audio-reference')) {
    addSlot({
      key: 'audio-reference',
      role: 'reference',
      roleLabel: 'AUD',
      title: 'Audio reference input',
      displayName: 'Audio reference',
      className: 'audio-reference',
      accepts: ['audio'],
    });
  }

  if (inputKinds.includes('video-input')) {
    addSlot({
      key: 'video-input',
      role: 'reference',
      roleLabel: 'VID',
      title: 'Required video input',
      displayName: 'Video input',
      className: 'video-input',
      accepts: ['video'],
    });
  }

  return slots;
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
  const [activeReferenceSlotKey, setActiveReferenceSlotKey] = useState<string | null>(null);
  const activeReferenceSlotKeyRef = useRef<string | null>(activeReferenceSlotKey);
  const currentReferenceMediaFileIdsRef = useRef(referenceMediaFileIds);
  useLayoutEffect(() => {
    currentReferenceMediaFileIdsRef.current = referenceMediaFileIds;
  }, [referenceMediaFileIds]);
  useLayoutEffect(() => {
    activeReferenceSlotKeyRef.current = activeReferenceSlotKey;
  }, [activeReferenceSlotKey]);

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
    clearReferenceDragOver,
    getReferenceMediaFileIdsFromTransfer,
    handleReferenceDragLeave,
    handleReferenceDragOver,
    handleReferenceDrop,
    hasReferenceDragType,
    isReferenceDragOver,
    markSlotDropHandled,
  } = useFlashBoardReferenceDrop({
    appendReferenceMediaFileIds,
    clampReferenceMediaFileIds,
    getCurrentReferenceMediaFileIds,
    isReferenceableMediaType,
    maxReferenceMedia,
    mediaFilesById,
    updateReferenceMediaFileIds,
  });
  const handleReferenceSlotDragOver = useCallback((
    slot: ComposerReferenceSlot,
    event: ReactDragEvent<HTMLDivElement>,
  ) => {
    if (!hasReferenceDragType(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setActiveReferenceSlotKey(slot.key);
  }, [hasReferenceDragType]);
  const applyReferenceSlotDrop = useCallback((
    slot: ComposerReferenceSlot,
    dataTransfer: DataTransfer,
  ) => {
    const mediaFileId = getReferenceMediaFileIdsFromTransfer(dataTransfer)
      .find((candidateId) => {
        const mediaType = mediaFilesById.get(candidateId)?.type;
        return !slot.accepts?.length || slot.accepts.includes(mediaType as 'image' | 'video' | 'audio');
      });
    if (!mediaFileId) {
      return;
    }

    runFlashBoardReferenceTransition(() => {
      updateComposer(buildFlashBoardReferenceRolePatch({
        composer,
        effectiveReferenceMediaFileIds,
        maxReferenceMedia,
        mediaFileId,
        role: slot.role,
      }));
    });
    setHoveredComposerReference({ mediaFileId, role: slot.role });
  }, [
    composer,
    effectiveReferenceMediaFileIds,
    getReferenceMediaFileIdsFromTransfer,
    maxReferenceMedia,
    mediaFilesById,
    setHoveredComposerReference,
    updateComposer,
  ]);
  const handleReferenceSlotDrop = useCallback((
    slot: ComposerReferenceSlot,
    event: ReactDragEvent<HTMLDivElement>,
  ) => {
    if (!hasReferenceDragType(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    markSlotDropHandled(event);
    setActiveReferenceSlotKey(null);
    clearReferenceDragOver();
    applyReferenceSlotDrop(slot, event.dataTransfer);
  }, [
    applyReferenceSlotDrop,
    clearReferenceDragOver,
    hasReferenceDragType,
    markSlotDropHandled,
  ]);
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
  const composerReferenceSlots = useMemo(() => buildReferenceSlots({
    hasEndFrame: Boolean(composer.endMediaFileId),
    hasStartFrame: Boolean(composer.startMediaFileId),
    multiShots,
    selectedEntry,
    supportsEndFrameReference,
    supportsTimelineReferenceRoles,
  }), [
    composer.endMediaFileId,
    composer.startMediaFileId,
    multiShots,
    selectedEntry,
    supportsEndFrameReference,
    supportsTimelineReferenceRoles,
  ]);
  const currentReferenceSlotsRef = useRef(composerReferenceSlots);
  useLayoutEffect(() => {
    currentReferenceSlotsRef.current = composerReferenceSlots;
  }, [composerReferenceSlots]);
  const getPromptRefineMediaFile = useCallback(
    (mediaFileId: string) => mediaFilesById.get(mediaFileId),
    [mediaFilesById],
  );
  const referenceItemCount = composerReferenceBadges.length + composerReferenceSlots.length;
  const referenceSlotColumns = Math.ceil(composerReferenceSlots.length / 2);
  const handleReferenceRootDragOverCapture = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasReferenceDragType(event.dataTransfer)) {
      return;
    }

    const slotKey = findNearestReferenceSlotKey(event.currentTarget, event.clientX, event.clientY);
    setActiveReferenceSlotKey(slotKey);
    if (slotKey) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, [hasReferenceDragType]);
  const handleReferenceRootDropCapture = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasReferenceDragType(event.dataTransfer)) {
      return;
    }

    const slotKey = findNearestReferenceSlotKey(event.currentTarget, event.clientX, event.clientY)
      ?? activeReferenceSlotKey;
    const slot = composerReferenceSlots.find((candidate) => candidate.key === slotKey);
    if (!slot) {
      return;
    }

    handleReferenceSlotDrop(slot, event);
  }, [
    activeReferenceSlotKey,
    composerReferenceSlots,
    handleReferenceSlotDrop,
    hasReferenceDragType,
  ]);
  const handleReferenceRootDragLeaveCapture = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setActiveReferenceSlotKey(null);
    }
  }, []);
  useEffect(() => {
    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer || !hasReferenceDragType(dataTransfer)) {
        return;
      }

      const slotKey = findNearestReferenceSlotKey(document, event.clientX, event.clientY);
      setActiveReferenceSlotKey(slotKey);
      if (slotKey) {
        event.preventDefault();
        dataTransfer.dropEffect = 'copy';
      }
    };
    const handleWindowDrop = (event: globalThis.DragEvent) => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer || !hasReferenceDragType(dataTransfer)) {
        return;
      }

      const slotKey = findNearestReferenceSlotKey(document, event.clientX, event.clientY)
        ?? activeReferenceSlotKeyRef.current;
      const slot = currentReferenceSlotsRef.current.find((candidate) => candidate.key === slotKey);
      if (!slot) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setActiveReferenceSlotKey(null);
      clearReferenceDragOver();
      applyReferenceSlotDrop(slot, dataTransfer);
    };

    window.addEventListener('dragover', handleWindowDragOver, true);
    window.addEventListener('drop', handleWindowDrop, true);
    return () => {
      window.removeEventListener('dragover', handleWindowDragOver, true);
      window.removeEventListener('drop', handleWindowDrop, true);
    };
  }, [
    applyReferenceSlotDrop,
    clearReferenceDragOver,
    hasReferenceDragType,
  ]);
  const showComposerReferences = referenceItemCount > 0;
  const composerStyle = useMemo<CSSProperties | undefined>(() => (
    showComposerReferences
      ? ({ '--fb-reference-strip-width': `${Math.max(80, composerReferenceBadges.length * 80 + referenceSlotColumns * 74 + 4)}px` } as CSSProperties)
      : undefined
  ), [composerReferenceBadges.length, referenceSlotColumns, showComposerReferences]);

  return {
    activeReferenceSlotKey,
    composerReferenceBadges,
    composerReferenceSlots,
    composerStyle,
    effectiveReferenceMediaFileIds,
    getPromptRefineMediaFile,
    handleComposerReferenceRoleChange,
    handleReferenceDragLeave,
    handleReferenceDragOver,
    handleReferenceDrop,
    handleReferenceRootDragLeaveCapture,
    handleReferenceRootDragOverCapture,
    handleReferenceRootDropCapture,
    handleReferenceStripPointerLeave,
    handleReferenceSlotDragOver,
    handleReferenceSlotDrop,
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
