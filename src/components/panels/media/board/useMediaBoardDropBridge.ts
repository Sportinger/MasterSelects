import { useCallback, type Dispatch, type DragEvent as ReactDragEvent, type SetStateAction } from 'react';

import type {
  MediaBoardGroupOffset,
  MediaBoardInsertionPreview,
  MediaBoardNodeLayout,
  MediaBoardNodePlacement,
} from './types';

export interface UseMediaBoardDropBridgeOptions {
  canMoveItemsToMediaBoardGroup: (itemIds: string[], targetGroupId: string | null) => boolean;
  commitMediaBoardOrderChange: (movingIds: string[], targetGroupId: string | null, targetPosition: MediaBoardGroupOffset) => void;
  getMediaBoardGroupAtPoint: (point: { x: number; y: number }) => { id: string | null } | null;
  getMediaBoardInsertTarget: (
    point: { x: number; y: number },
    movingIds: string[],
  ) => { groupId: string | null; position: MediaBoardGroupOffset } | null;
  getMediaBoardTopLevelMoveIds: (itemIds: string[]) => string[];
  handleExternalDropImport: (dataTransfer: DataTransfer, folderId: string | null) => Promise<string[]>;
  internalDragId: string | null;
  mediaBoardPlacementsById: Map<string, MediaBoardNodePlacement>;
  placeMediaBoardItemsAtPoint: (itemIds: string[], point: MediaBoardGroupOffset) => void;
  screenToMediaBoard: (clientX: number, clientY: number) => { x: number; y: number };
  selectedIds: string[];
  setDragOverFolderId: (id: string | null) => void;
  setInternalDragId: (id: string | null) => void;
  setIsExternalDragOver: (isOver: boolean) => void;
  setMediaBoardInsertionPreview: Dispatch<SetStateAction<MediaBoardInsertionPreview | null>>;
  updateMediaBoardInsertionPreview: (
    point: { x: number; y: number },
    movingIds: string[],
    sourceLayouts: Record<string, MediaBoardNodeLayout>,
    groupPoint?: { x: number; y: number },
  ) => { groupId: string | null; position: MediaBoardGroupOffset } | null;
}

export function useMediaBoardDropBridge({
  canMoveItemsToMediaBoardGroup,
  commitMediaBoardOrderChange,
  getMediaBoardGroupAtPoint,
  getMediaBoardInsertTarget,
  getMediaBoardTopLevelMoveIds,
  handleExternalDropImport,
  internalDragId,
  mediaBoardPlacementsById,
  placeMediaBoardItemsAtPoint,
  screenToMediaBoard,
  selectedIds,
  setDragOverFolderId,
  setInternalDragId,
  setIsExternalDragOver,
  setMediaBoardInsertionPreview,
  updateMediaBoardInsertionPreview,
}: UseMediaBoardDropBridgeOptions) {
  const updateMediaBoardInsertionFromNativeDrag = useCallback((event: ReactDragEvent) => {
    if (!event.dataTransfer.types.includes('application/x-media-panel-item')) {
      setMediaBoardInsertionPreview(null);
      return false;
    }

    const itemId = event.dataTransfer.getData('application/x-media-panel-item') || internalDragId || '';
    if (!itemId) {
      setMediaBoardInsertionPreview(null);
      return false;
    }

    const itemIds = selectedIds.includes(itemId) ? selectedIds : [itemId];
    const movingIds = getMediaBoardTopLevelMoveIds(itemIds);
    if (movingIds.length === 0) {
      setMediaBoardInsertionPreview(null);
      return false;
    }

    const sourceLayouts = movingIds.reduce<Record<string, MediaBoardNodeLayout>>((layouts, id) => {
      const placement = mediaBoardPlacementsById.get(id);
      if (placement) layouts[id] = placement.defaultLayout;
      return layouts;
    }, {});

    const point = screenToMediaBoard(event.clientX, event.clientY);
    updateMediaBoardInsertionPreview(point, movingIds, sourceLayouts, point);
    return true;
  }, [
    getMediaBoardTopLevelMoveIds,
    internalDragId,
    mediaBoardPlacementsById,
    screenToMediaBoard,
    selectedIds,
    setMediaBoardInsertionPreview,
    updateMediaBoardInsertionPreview,
  ]);

  const handleMediaBoardDrop = useCallback(async (event: ReactDragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsExternalDragOver(false);
    setMediaBoardInsertionPreview(null);

    if (event.dataTransfer.types.includes('application/x-media-panel-item')) {
      const itemId = event.dataTransfer.getData('application/x-media-panel-item');
      if (itemId) {
        const itemsToMove = getMediaBoardTopLevelMoveIds(selectedIds.includes(itemId) ? selectedIds : [itemId]);
        const point = screenToMediaBoard(event.clientX, event.clientY);
        const target = getMediaBoardInsertTarget(point, itemsToMove);
        if (target && canMoveItemsToMediaBoardGroup(itemsToMove, target.groupId)) {
          commitMediaBoardOrderChange(itemsToMove, target.groupId, target.position);
        }
      }
      setDragOverFolderId(null);
      setInternalDragId(null);
      return;
    }

    const point = screenToMediaBoard(event.clientX, event.clientY);
    const targetGroup = getMediaBoardGroupAtPoint(point);
    const importedIds = await handleExternalDropImport(event.dataTransfer, targetGroup?.id ?? null);
    placeMediaBoardItemsAtPoint(importedIds, point);
  }, [
    canMoveItemsToMediaBoardGroup,
    commitMediaBoardOrderChange,
    getMediaBoardGroupAtPoint,
    getMediaBoardInsertTarget,
    getMediaBoardTopLevelMoveIds,
    handleExternalDropImport,
    placeMediaBoardItemsAtPoint,
    screenToMediaBoard,
    selectedIds,
    setDragOverFolderId,
    setInternalDragId,
    setIsExternalDragOver,
    setMediaBoardInsertionPreview,
  ]);

  const handleMediaBoardGroupDrop = useCallback(async (event: ReactDragEvent, groupId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    setMediaBoardInsertionPreview(null);

    if (event.dataTransfer.types.includes('application/x-media-panel-item')) {
      const itemId = event.dataTransfer.getData('application/x-media-panel-item');
      if (itemId) {
        const itemsToMove = getMediaBoardTopLevelMoveIds(selectedIds.includes(itemId) ? selectedIds : [itemId]);
        if (!canMoveItemsToMediaBoardGroup(itemsToMove, groupId)) {
          setDragOverFolderId(null);
          setInternalDragId(null);
          return;
        }
        const point = screenToMediaBoard(event.clientX, event.clientY);
        const target = getMediaBoardInsertTarget(point, itemsToMove);
        if (target) commitMediaBoardOrderChange(itemsToMove, target.groupId, target.position);
      }
      setDragOverFolderId(null);
      setInternalDragId(null);
      return;
    }

    const point = screenToMediaBoard(event.clientX, event.clientY);
    const importedIds = await handleExternalDropImport(event.dataTransfer, groupId);
    placeMediaBoardItemsAtPoint(importedIds, point);
    setIsExternalDragOver(false);
  }, [
    canMoveItemsToMediaBoardGroup,
    commitMediaBoardOrderChange,
    getMediaBoardInsertTarget,
    getMediaBoardTopLevelMoveIds,
    handleExternalDropImport,
    placeMediaBoardItemsAtPoint,
    screenToMediaBoard,
    selectedIds,
    setDragOverFolderId,
    setInternalDragId,
    setIsExternalDragOver,
    setMediaBoardInsertionPreview,
  ]);

  const handleMediaBoardGroupDragOver = useCallback((event: ReactDragEvent) => {
    if (!event.dataTransfer.types.includes('application/x-media-panel-item') && !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes('application/x-media-panel-item') ? 'move' : 'copy';
    updateMediaBoardInsertionFromNativeDrag(event);
  }, [updateMediaBoardInsertionFromNativeDrag]);

  const handleMediaBoardCanvasDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) {
      setIsExternalDragOver(true);
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes('application/x-media-panel-item') ? 'move' : 'copy';
    updateMediaBoardInsertionFromNativeDrag(event);
  }, [setIsExternalDragOver, updateMediaBoardInsertionFromNativeDrag]);

  const handleMediaBoardCanvasDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) {
      setMediaBoardInsertionPreview(null);
    }
  }, [setMediaBoardInsertionPreview]);

  return {
    handleMediaBoardCanvasDragLeave,
    handleMediaBoardCanvasDragOver,
    handleMediaBoardDrop,
    handleMediaBoardGroupDragOver,
    handleMediaBoardGroupDrop,
  };
}
