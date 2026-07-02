import { useCallback, useState, type DragEvent } from 'react';
import { getExternalDragPayload } from '../../timeline/utils/externalDragSession';

const MEDIA_FILE_DRAG_MIME = 'application/x-media-file-id';
const MEDIA_PANEL_ITEM_DRAG_MIME = 'application/x-media-panel-item';
const SLOT_DROP_HANDLED = Symbol('flashboardSlotDropHandled');

type SlotHandledDragEvent = DragEvent<HTMLDivElement> & {
  [SLOT_DROP_HANDLED]?: boolean;
};

function isSlotDropTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.fb-reference-slot-grid'));
}

interface ReferenceDropMediaFile {
  type?: string;
}

interface UseFlashBoardReferenceDropOptions {
  appendReferenceMediaFileIds: (currentIds: string[], nextIds: string[]) => string[];
  clampReferenceMediaFileIds: (referenceMediaFileIds: string[], maxReferenceMedia?: number) => string[];
  getCurrentReferenceMediaFileIds: () => string[];
  isReferenceableMediaType: (type: string | undefined) => boolean;
  maxReferenceMedia?: number;
  mediaFilesById: ReadonlyMap<string, ReferenceDropMediaFile>;
  updateReferenceMediaFileIds: (referenceMediaFileIds: string[]) => void;
}

export function useFlashBoardReferenceDrop({
  appendReferenceMediaFileIds,
  clampReferenceMediaFileIds,
  getCurrentReferenceMediaFileIds,
  isReferenceableMediaType,
  maxReferenceMedia,
  mediaFilesById,
  updateReferenceMediaFileIds,
}: UseFlashBoardReferenceDropOptions) {
  const [isReferenceDragOver, setIsReferenceDragOver] = useState(false);

  const getReferenceMediaFileIdsFromTransfer = useCallback((dataTransfer: DataTransfer): string[] => {
    const externalDragPayload = getExternalDragPayload();
    const ids = [
      dataTransfer.getData(MEDIA_FILE_DRAG_MIME),
      dataTransfer.getData(MEDIA_PANEL_ITEM_DRAG_MIME),
      externalDragPayload?.kind === 'media-file' ? externalDragPayload.id : '',
    ].filter(Boolean);

    return ids.filter((id, index) => {
      if (ids.indexOf(id) !== index) {
        return false;
      }

      const mediaFile = mediaFilesById.get(id);
      return isReferenceableMediaType(mediaFile?.type);
    });
  }, [isReferenceableMediaType, mediaFilesById]);

  const hasReferenceDragType = useCallback((dataTransfer: DataTransfer): boolean => (
    dataTransfer.types.includes(MEDIA_FILE_DRAG_MIME)
    || dataTransfer.types.includes(MEDIA_PANEL_ITEM_DRAG_MIME)
    || getExternalDragPayload()?.kind === 'media-file'
  ), []);

  const handleReferenceDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasReferenceDragType(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setIsReferenceDragOver(true);
  }, [hasReferenceDragType]);

  const handleReferenceDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsReferenceDragOver(false);
    }
  }, []);
  const clearReferenceDragOver = useCallback(() => {
    setIsReferenceDragOver(false);
  }, []);

  const handleReferenceDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if ((event as SlotHandledDragEvent)[SLOT_DROP_HANDLED] || isSlotDropTarget(event.target)) {
      return;
    }

    if (!hasReferenceDragType(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsReferenceDragOver(false);

    const droppedIds = getReferenceMediaFileIdsFromTransfer(event.dataTransfer);
    if (droppedIds.length === 0) {
      return;
    }

    updateReferenceMediaFileIds(
      clampReferenceMediaFileIds(
        appendReferenceMediaFileIds(getCurrentReferenceMediaFileIds(), droppedIds),
        maxReferenceMedia,
      ),
    );
  }, [
    appendReferenceMediaFileIds,
    clampReferenceMediaFileIds,
    getCurrentReferenceMediaFileIds,
    getReferenceMediaFileIdsFromTransfer,
    hasReferenceDragType,
    maxReferenceMedia,
    updateReferenceMediaFileIds,
  ]);

  return {
    clearReferenceDragOver,
    getReferenceMediaFileIdsFromTransfer,
    handleReferenceDragLeave,
    handleReferenceDragOver,
    handleReferenceDrop,
    hasReferenceDragType,
    isReferenceDragOver,
    markSlotDropHandled: (event: DragEvent<HTMLDivElement>) => {
      (event as SlotHandledDragEvent)[SLOT_DROP_HANDLED] = true;
    },
  };
}
