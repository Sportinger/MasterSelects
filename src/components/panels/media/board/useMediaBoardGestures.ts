import { useCallback, useEffect, useRef, type Dispatch, type MouseEvent as ReactMouseEvent, type MutableRefObject, type SetStateAction } from 'react';

import { MEDIA_BOARD_DRAG_START_DISTANCE } from './constants';
import { isMediaBoardFolder } from './layout';
import type {
  MediaBoardGroupOffset,
  MediaBoardInsertionPreview,
  MediaBoardItem,
  MediaBoardLayoutResult,
  MediaBoardNodeLayout,
  MediaBoardNodePlacement,
  MediaBoardRenderLod,
  MediaBoardViewport,
} from './types';
import { useMediaBoardNodeMoveGesture } from './useMediaBoardNodeMoveGesture';

type MediaBoardContextMenuHandler = (
  event: ReactMouseEvent,
  itemId?: string,
  parentId?: string | null,
  boardPosition?: { x: number; y: number },
) => void;

export interface UseMediaBoardGesturesOptions {
  activeCompositionId: string | null;
  applyMediaBoardViewportPreview: (viewport: MediaBoardViewport) => void;
  boardAutoPanFrameRef: MutableRefObject<number | null>;
  boardCanvasRef: MutableRefObject<HTMLDivElement | null>;
  boardInteractionFrameRef: MutableRefObject<number | null>;
  closeContextMenu: () => void;
  commitMediaBoardOrderChange: (
    movingIds: string[],
    targetGroupId: string | null,
    targetPosition: MediaBoardGroupOffset,
    options?: { sourceLayouts?: Record<string, MediaBoardNodeLayout>; anchorId?: string },
  ) => void;
  getMediaBoardExternalDragPayload?: (item: MediaBoardItem) => unknown;
  getMediaBoardGroupAtPoint: (point: { x: number; y: number }) => { id: string | null } | null;
  getMediaBoardInsertTarget: (
    point: { x: number; y: number },
    movingIds: string[],
    groupPoint?: { x: number; y: number },
  ) => { groupId: string | null; position: MediaBoardGroupOffset } | null;
  getMediaBoardPlacementAtPoint: (point: { x: number; y: number }) => MediaBoardNodePlacement | null;
  getMediaBoardTopLevelMoveIds: (itemIds: string[]) => string[];
  getSlotGridProgress: () => number;
  handleContextMenu: MediaBoardContextMenuHandler;
  handleItemClick: (itemId: string, event: ReactMouseEvent) => void;
  handleItemDoubleClick: (item: MediaBoardItem) => void | Promise<void>;
  mediaBoardItemIds: Set<string>;
  mediaBoardLayout: MediaBoardLayoutResult;
  mediaBoardPlacementsById: Map<string, MediaBoardNodePlacement>;
  mediaBoardRenderLod: MediaBoardRenderLod;
  mediaBoardViewportRef: MutableRefObject<MediaBoardViewport>;
  screenToMediaBoard: (clientX: number, clientY: number) => { x: number; y: number };
  selectedIds: string[];
  setMediaBoardInsertionPreview: Dispatch<SetStateAction<MediaBoardInsertionPreview | null>>;
  setMediaBoardMarquee: Dispatch<SetStateAction<{ startX: number; startY: number; currentX: number; currentY: number } | null>>;
  setMediaBoardPerformanceMode: (enabled: boolean) => void;
  setMediaBoardViewport: (viewport: MediaBoardViewport) => void;
  setSelection: (ids: string[]) => void;
  updateMediaBoardInsertionPreview: (
    point: { x: number; y: number },
    movingIds: string[],
    sourceLayouts: Record<string, MediaBoardNodeLayout>,
    groupPoint?: { x: number; y: number },
  ) => { groupId: string | null; position: MediaBoardGroupOffset } | null;
}

export function useMediaBoardGestures({
  activeCompositionId,
  applyMediaBoardViewportPreview,
  boardAutoPanFrameRef,
  boardCanvasRef,
  boardInteractionFrameRef,
  closeContextMenu,
  commitMediaBoardOrderChange,
  getMediaBoardGroupAtPoint,
  getMediaBoardInsertTarget,
  getMediaBoardPlacementAtPoint,
  getMediaBoardTopLevelMoveIds,
  getSlotGridProgress,
  handleContextMenu,
  handleItemClick,
  handleItemDoubleClick,
  mediaBoardItemIds,
  mediaBoardLayout,
  mediaBoardPlacementsById,
  mediaBoardRenderLod,
  mediaBoardViewportRef,
  screenToMediaBoard,
  selectedIds,
  setMediaBoardInsertionPreview,
  setMediaBoardMarquee,
  setMediaBoardPerformanceMode,
  setMediaBoardViewport,
  setSelection,
  updateMediaBoardInsertionPreview,
}: UseMediaBoardGesturesOptions) {
  const suppressMediaBoardContextMenuRef = useRef(false);
  const suppressMediaBoardContextMenuTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (suppressMediaBoardContextMenuTimerRef.current !== null) {
      window.clearTimeout(suppressMediaBoardContextMenuTimerRef.current);
    }
  }, []);

  const suppressNextMediaBoardContextMenu = useCallback(() => {
    suppressMediaBoardContextMenuRef.current = true;
    if (suppressMediaBoardContextMenuTimerRef.current !== null) {
      window.clearTimeout(suppressMediaBoardContextMenuTimerRef.current);
    }
    suppressMediaBoardContextMenuTimerRef.current = window.setTimeout(() => {
      suppressMediaBoardContextMenuRef.current = false;
      suppressMediaBoardContextMenuTimerRef.current = null;
    }, 600);
  }, []);

  const consumeSuppressedMediaBoardContextMenu = useCallback(() => {
    if (!suppressMediaBoardContextMenuRef.current) return false;
    suppressMediaBoardContextMenuRef.current = false;
    if (suppressMediaBoardContextMenuTimerRef.current !== null) {
      window.clearTimeout(suppressMediaBoardContextMenuTimerRef.current);
      suppressMediaBoardContextMenuTimerRef.current = null;
    }
    return true;
  }, []);

  const startMediaBoardPanGesture = useCallback((event: ReactMouseEvent, options?: { clearSelectionOnTap?: boolean }) => {
    if (event.button === 1) event.preventDefault();
    closeContextMenu();
    const startX = event.clientX;
    const startY = event.clientY;
    const startViewport = { ...mediaBoardViewportRef.current };
    let pendingViewport = startViewport;
    let didPan = false;
    const schedulePreview = () => {
      if (boardInteractionFrameRef.current !== null) return;
      boardInteractionFrameRef.current = window.requestAnimationFrame(() => {
        boardInteractionFrameRef.current = null;
        applyMediaBoardViewportPreview(pendingViewport);
      });
    };
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!didPan && Math.hypot(dx, dy) < MEDIA_BOARD_DRAG_START_DISTANCE) return;
      if (!didPan) {
        didPan = true;
        moveEvent.preventDefault();
        setMediaBoardPerformanceMode(true);
      }
      moveEvent.preventDefault();
      pendingViewport = { ...startViewport, panX: startViewport.panX + dx, panY: startViewport.panY + dy };
      schedulePreview();
    };
    const handleMouseUp = () => {
      if (boardInteractionFrameRef.current !== null) {
        window.cancelAnimationFrame(boardInteractionFrameRef.current);
        boardInteractionFrameRef.current = null;
      }
      setMediaBoardPerformanceMode(false);
      if (didPan) {
        mediaBoardViewportRef.current = pendingViewport;
        setMediaBoardViewport(pendingViewport);
      } else if (options?.clearSelectionOnTap) {
        setSelection([]);
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
  }, [applyMediaBoardViewportPreview, boardInteractionFrameRef, closeContextMenu, mediaBoardViewportRef, setMediaBoardPerformanceMode, setMediaBoardViewport, setSelection]);

  const startMediaBoardMarqueeGesture = useCallback((event: ReactMouseEvent) => {
    const startPoint = screenToMediaBoard(event.clientX, event.clientY);
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const initialSelection = event.ctrlKey || event.metaKey ? selectedIds : [];
    let didSelect = false;
    const updateSelectionForRect = (rect: { left: number; right: number; top: number; bottom: number }) => {
      const hitIds = mediaBoardLayout.placements
        .filter(({ layout }) => {
          const right = layout.x + layout.width;
          const bottom = layout.y + layout.height;
          return right > rect.left && layout.x < rect.right && bottom > rect.top && layout.y < rect.bottom;
        })
        .map(({ item }) => item.id);
      setSelection([...new Set([...initialSelection, ...hitIds])]);
    };
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!didSelect && Math.hypot(moveEvent.clientX - startClientX, moveEvent.clientY - startClientY) < MEDIA_BOARD_DRAG_START_DISTANCE) return;
      didSelect = true;
      closeContextMenu();
      const currentPoint = screenToMediaBoard(moveEvent.clientX, moveEvent.clientY);
      const rect = {
        left: Math.min(startPoint.x, currentPoint.x),
        right: Math.max(startPoint.x, currentPoint.x),
        top: Math.min(startPoint.y, currentPoint.y),
        bottom: Math.max(startPoint.y, currentPoint.y),
      };
      setMediaBoardMarquee({ startX: startPoint.x, startY: startPoint.y, currentX: currentPoint.x, currentY: currentPoint.y });
      updateSelectionForRect(rect);
    };
    const handleMouseUp = () => {
      if (didSelect) suppressNextMediaBoardContextMenu();
      setMediaBoardMarquee(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
  }, [closeContextMenu, mediaBoardLayout.placements, screenToMediaBoard, selectedIds, setMediaBoardMarquee, setSelection, suppressNextMediaBoardContextMenu]);

  const startMediaBoardNodeMoveGesture = useMediaBoardNodeMoveGesture({
    activeCompositionId,
    applyMediaBoardViewportPreview,
    boardAutoPanFrameRef,
    boardCanvasRef,
    boardInteractionFrameRef,
    closeContextMenu,
    commitMediaBoardOrderChange,
    getMediaBoardInsertTarget,
    getMediaBoardTopLevelMoveIds,
    getSlotGridProgress,
    mediaBoardItemIds,
    mediaBoardLayout,
    mediaBoardPlacementsById,
    mediaBoardViewportRef,
    selectedIds,
    setMediaBoardInsertionPreview,
    setMediaBoardPerformanceMode,
    setMediaBoardViewport,
    suppressNextMediaBoardContextMenu,
    updateMediaBoardInsertionPreview,
  });
  const handleMediaBoardWorkspaceContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    if (consumeSuppressedMediaBoardContextMenu()) return;
    const point = screenToMediaBoard(event.clientX, event.clientY);
    const targetGroup = getMediaBoardGroupAtPoint(point);
    handleContextMenu(event, undefined, targetGroup?.id ?? null, point);
  }, [consumeSuppressedMediaBoardContextMenu, getMediaBoardGroupAtPoint, handleContextMenu, screenToMediaBoard]);

  const handleMediaBoardMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const annotationTarget = target.closest('.media-board-annotation');
    if (target.closest('.media-board-node, .media-board-group.folder-group, button, input, .context-menu')) return;
    if (mediaBoardRenderLod.overviewCanvas) {
      const hitPlacement = getMediaBoardPlacementAtPoint(screenToMediaBoard(event.clientX, event.clientY));
      if (hitPlacement && !isMediaBoardFolder(hitPlacement.item)) {
        if (event.button === 2) {
          event.stopPropagation();
          if (event.ctrlKey || event.metaKey) {
            startMediaBoardMarqueeGesture(event);
            return;
          }
          if (!selectedIds.includes(hitPlacement.item.id)) setSelection([hitPlacement.item.id]);
          startMediaBoardNodeMoveGesture(event, hitPlacement.item);
          return;
        }
        if (event.button === 0) {
          event.stopPropagation();
          if (event.detail >= 2) return;
          handleItemClick(hitPlacement.item.id, event);
          startMediaBoardPanGesture(event);
          return;
        }
      }
    }
    if (event.button === 2) {
      startMediaBoardMarqueeGesture(event);
      return;
    }
    if (event.button !== 0 && event.button !== 1) return;
    startMediaBoardPanGesture(event, { clearSelectionOnTap: !annotationTarget && event.button === 0 && !event.ctrlKey && !event.metaKey });
  }, [
    getMediaBoardPlacementAtPoint,
    handleItemClick,
    mediaBoardRenderLod.overviewCanvas,
    screenToMediaBoard,
    selectedIds,
    setSelection,
    startMediaBoardMarqueeGesture,
    startMediaBoardNodeMoveGesture,
    startMediaBoardPanGesture,
  ]);

  const handleMediaBoardDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!mediaBoardRenderLod.overviewCanvas) return;
    const target = event.target as HTMLElement;
    if (target.closest('.media-board-node, .media-board-group.folder-group, .media-board-annotation, button, input, .context-menu')) return;
    const hitPlacement = getMediaBoardPlacementAtPoint(screenToMediaBoard(event.clientX, event.clientY));
    if (!hitPlacement || isMediaBoardFolder(hitPlacement.item)) return;
    event.preventDefault();
    event.stopPropagation();
    void handleItemDoubleClick(hitPlacement.item);
  }, [getMediaBoardPlacementAtPoint, handleItemDoubleClick, mediaBoardRenderLod.overviewCanvas, screenToMediaBoard]);

  const handleMediaBoardContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('.media-board-node, .media-board-group.folder-group, .media-board-annotation, button, input, .context-menu')) return;
    if (mediaBoardRenderLod.overviewCanvas) {
      const hitPlacement = getMediaBoardPlacementAtPoint(screenToMediaBoard(event.clientX, event.clientY));
      if (hitPlacement && !isMediaBoardFolder(hitPlacement.item)) {
        if (consumeSuppressedMediaBoardContextMenu()) {
          event.preventDefault();
          return;
        }
        handleContextMenu(event, hitPlacement.item.id);
        return;
      }
    }
    handleMediaBoardWorkspaceContextMenu(event);
  }, [
    consumeSuppressedMediaBoardContextMenu,
    getMediaBoardPlacementAtPoint,
    handleContextMenu,
    handleMediaBoardWorkspaceContextMenu,
    mediaBoardRenderLod.overviewCanvas,
    screenToMediaBoard,
  ]);

  const handleMediaBoardNodeMouseDown = useCallback((event: ReactMouseEvent, item: MediaBoardItem) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input')) return;
    if (event.button === 2) {
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) {
        startMediaBoardMarqueeGesture(event);
        return;
      }
      if (!selectedIds.includes(item.id)) setSelection([item.id]);
      startMediaBoardNodeMoveGesture(event, item);
      return;
    }
    if (event.button !== 0) return;
    event.stopPropagation();
    if (event.detail >= 2) return;
    handleItemClick(item.id, event);
    startMediaBoardPanGesture(event);
  }, [handleItemClick, selectedIds, setSelection, startMediaBoardMarqueeGesture, startMediaBoardNodeMoveGesture, startMediaBoardPanGesture]);

  return {
    consumeSuppressedMediaBoardContextMenu,
    handleMediaBoardContextMenu,
    handleMediaBoardDoubleClick,
    handleMediaBoardMouseDown,
    handleMediaBoardNodeMouseDown,
    suppressNextMediaBoardContextMenu,
  };
}
