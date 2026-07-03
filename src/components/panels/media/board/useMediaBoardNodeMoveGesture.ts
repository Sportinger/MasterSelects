import { useCallback, type Dispatch, type MouseEvent as ReactMouseEvent, type MutableRefObject, type SetStateAction } from 'react';

import type { FlashBoardComposerReferenceRole } from '../../../../stores/flashboardStore';
import { useFlashBoardStore } from '../../../../stores/flashboardStore';
import { getCatalogEntry } from '../../../../services/flashboard/FlashBoardModelCatalog';
import {
  clearExternalDragPayload,
  createExternalDragPayloadForProjectItem,
  dispatchExternalDragBridgeEvent,
  setExternalDragPayload,
} from '../../../timeline/utils/externalDragSession';
import { buildFlashBoardReferenceRolePatch } from '../../flashboard/FlashBoardReferenceAssignmentPlanner';
import { runFlashBoardReferenceTransition } from '../../flashboard/FlashBoardReferenceTransition';
import {
  appendReferenceMediaFileIds,
  isReferenceableMediaType,
} from '../../flashboard/FlashBoardReferenceMediaPlanner';
import {
  MEDIA_BOARD_AUTOPAN_EDGE_PX,
  MEDIA_BOARD_AUTOPAN_MAX_SPEED,
  MEDIA_BOARD_DRAG_START_DISTANCE,
  MEDIA_BOARD_TIMELINE_HANDOFF_DISTANCE_PX,
} from './constants';
import { isMediaBoardFolder } from './layout';
import type {
  MediaBoardGroupOffset,
  MediaBoardInsertionPreview,
  MediaBoardItem,
  MediaBoardLayoutResult,
  MediaBoardNodeLayout,
  MediaBoardNodePlacement,
  MediaBoardViewport,
} from './types';

const FLASH_BOARD_REFERENCE_SLOT_SELECTOR = '.fb-reference-slot[data-slot-key]';

interface FlashBoardReferenceSlotTarget {
  accepts: string[];
  element: HTMLElement;
  role: FlashBoardComposerReferenceRole;
}

function isFlashBoardReferenceRole(role: string | undefined): role is FlashBoardComposerReferenceRole {
  return role === 'start' || role === 'end' || role === 'reference';
}

function getFlashBoardReferenceSlotTarget(
  clientX: number,
  clientY: number,
  availableMediaTypes: Set<string>,
): FlashBoardReferenceSlotTarget | null {
  for (const element of document.querySelectorAll<HTMLElement>(FLASH_BOARD_REFERENCE_SLOT_SELECTOR)) {
    const role = element.dataset.slotRole;
    if (!isFlashBoardReferenceRole(role)) continue;

    const accepts = (element.dataset.slotAccepts ?? '').split(/\s+/).filter(Boolean);
    if (accepts.length > 0 && !accepts.some((type) => availableMediaTypes.has(type))) continue;

    const rect = element.getBoundingClientRect();
    if (
      rect.width > 0
      && rect.height > 0
      && clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
    ) {
      return { accepts, element, role };
    }
  }

  return null;
}

export interface UseMediaBoardNodeMoveGestureOptions {
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
  getMediaBoardInsertTarget: (
    point: { x: number; y: number },
    movingIds: string[],
    groupPoint?: { x: number; y: number },
  ) => { groupId: string | null; position: MediaBoardGroupOffset } | null;
  getMediaBoardTopLevelMoveIds: (itemIds: string[]) => string[];
  getSlotGridProgress: () => number;
  mediaBoardItemIds: Set<string>;
  mediaBoardLayout: MediaBoardLayoutResult;
  mediaBoardPlacementsById: Map<string, MediaBoardNodePlacement>;
  mediaBoardViewportRef: MutableRefObject<MediaBoardViewport>;
  selectedIds: string[];
  setMediaBoardInsertionPreview: Dispatch<SetStateAction<MediaBoardInsertionPreview | null>>;
  setMediaBoardPerformanceMode: (enabled: boolean) => void;
  setMediaBoardViewport: (viewport: MediaBoardViewport) => void;
  suppressNextMediaBoardContextMenu: () => void;
  updateMediaBoardInsertionPreview: (
    point: { x: number; y: number },
    movingIds: string[],
    sourceLayouts: Record<string, MediaBoardNodeLayout>,
    groupPoint?: { x: number; y: number },
  ) => { groupId: string | null; position: MediaBoardGroupOffset } | null;
}

export function useMediaBoardNodeMoveGesture({
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
}: UseMediaBoardNodeMoveGestureOptions) {
  const getMediaBoardExternalDragPayload = useCallback((item: MediaBoardItem) => {
    if (isMediaBoardFolder(item)) return null;
    return createExternalDragPayloadForProjectItem(item, {
      activeCompositionId,
      requireMediaFileObject: true,
      slotGridProgress: getSlotGridProgress(),
    });
  }, [activeCompositionId, getSlotGridProgress]);

  const addMoveIdsToFlashBoardReferences = useCallback((
    moveIds: string[],
    role: FlashBoardComposerReferenceRole = 'reference',
    accepts: string[] = [],
  ) => {
    const referenceIds = moveIds.filter((id) => {
      const item = mediaBoardPlacementsById.get(id)?.item;
      return item
        && !isMediaBoardFolder(item)
        && isReferenceableMediaType(item.type)
        && (accepts.length === 0 || accepts.includes(item.type));
    });
    if (referenceIds.length === 0) return false;

    const { composer, setHoveredComposerReference, updateComposer } = useFlashBoardStore.getState();
    if (role === 'reference') {
      const referenceMediaFileIds = appendReferenceMediaFileIds(composer.referenceMediaFileIds ?? [], referenceIds);
      const lastReferenceId = referenceIds[referenceIds.length - 1];
      runFlashBoardReferenceTransition(() => {
        updateComposer({ referenceMediaFileIds });
      });
      if (lastReferenceId) {
        setHoveredComposerReference({ mediaFileId: lastReferenceId, role });
      }
      return true;
    }

    const mediaFileId = referenceIds[0];
    if (!mediaFileId) return false;
    const catalogEntry = composer.service && composer.providerId
      ? getCatalogEntry(composer.service, composer.providerId)
      : undefined;
    runFlashBoardReferenceTransition(() => {
      updateComposer(buildFlashBoardReferenceRolePatch({
        composer,
        effectiveReferenceMediaFileIds: composer.referenceMediaFileIds ?? [],
        maxReferenceMedia: catalogEntry?.maxReferenceMedia ?? catalogEntry?.maxReferenceImages,
        mediaFileId,
        role,
      }));
    });
    setHoveredComposerReference({ mediaFileId, role });
    return true;
  }, [mediaBoardPlacementsById]);

  return useCallback((event: ReactMouseEvent, item: MediaBoardItem) => {
    const requestedMoveIds = selectedIds.includes(item.id) ? selectedIds.filter((id) => mediaBoardItemIds.has(id)) : [item.id];
    const selectedMoveIds = getMediaBoardTopLevelMoveIds(requestedMoveIds);
    const boardOrderedMoveIds = mediaBoardLayout.placements
      .filter((placement) => selectedMoveIds.includes(placement.item.id))
      .sort((a, b) => (a.layout.y - b.layout.y) || (a.layout.x - b.layout.x) || (a.slotIndex - b.slotIndex))
      .map((placement) => placement.item.id);
    const moveIds = boardOrderedMoveIds.length > 0 ? boardOrderedMoveIds : selectedMoveIds;
    const startLayouts = moveIds.map((id) => ({ id, layout: mediaBoardPlacementsById.get(id)?.defaultLayout ?? mediaBoardPlacementsById.get(id)?.layout }))
      .filter((entry): entry is { id: string; layout: MediaBoardNodeLayout } => !!entry.layout);
    if (startLayouts.length === 0) return;

    const timelineDragPayload = getMediaBoardExternalDragPayload(item);
    const sourceLayouts = startLayouts.reduce<Record<string, MediaBoardNodeLayout>>((layouts, entry) => {
      layouts[entry.id] = entry.layout;
      return layouts;
    }, {});
    const anchorLayout = sourceLayouts[item.id] ?? startLayouts[0]?.layout ?? null;
    const getMediaBoardElementById = (id: string) => (
      boardCanvasRef.current?.querySelector<HTMLElement>(
        `.media-board-node[data-item-id="${CSS.escape(id)}"], .media-board-group[data-item-id="${CSS.escape(id)}"]`,
      ) ?? null
    );
    const getMediaBoardPreviewElements = () => {
      const elements = new Set<HTMLElement>();
      startLayouts.forEach(({ id }) => {
        const node = getMediaBoardElementById(id);
        if (node) elements.add(node);
      });
      boardCanvasRef.current
        ?.querySelectorAll<HTMLElement>('.media-board-node.drag-source-preview, .media-board-group.drag-source-preview')
        .forEach((node) => elements.add(node));
      return [...elements];
    };
    const startX = event.clientX;
    const startY = event.clientY;
    const startViewport = { ...mediaBoardViewportRef.current };
    let liveViewport = { ...startViewport };
    let didDrag = false;
    let previewDx = 0;
    let previewDy = 0;
    let latestClientX = startX;
    let latestClientY = startY;
    let latestTimelineHandoffActive = false;
    let latestFlashBoardReferenceTargetActive = false;
    let latestFlashBoardReferenceSlotTarget: FlashBoardReferenceSlotTarget | null = null;
    let activeFlashBoardReferenceSlotElement: HTMLElement | null = null;
    let timelineBridgeActive = false;
    let latestInsertTarget: { groupId: string | null; position: MediaBoardGroupOffset } | null = null;
    let autoPanVelocity = { x: 0, y: 0 };
    let lastAutoPanTime: number | null = null;
    const pointToBoard = (clientX: number, clientY: number, viewport = liveViewport) => {
      const rect = boardCanvasRef.current?.getBoundingClientRect();
      return rect ? { x: (clientX - rect.left - viewport.panX) / viewport.zoom, y: (clientY - rect.top - viewport.panY) / viewport.zoom } : { x: 0, y: 0 };
    };
    const isTimelineHandoffTarget = () => {
      const rect = boardCanvasRef.current?.getBoundingClientRect();
      if (!rect || !timelineDragPayload) return false;
      const outsideX = latestClientX < rect.left ? rect.left - latestClientX : latestClientX > rect.right ? latestClientX - rect.right : 0;
      const outsideY = latestClientY < rect.top ? rect.top - latestClientY : latestClientY > rect.bottom ? latestClientY - rect.bottom : 0;
      if (Math.max(outsideX, outsideY) < MEDIA_BOARD_TIMELINE_HANDOFF_DISTANCE_PX) return false;
      const targetElement = document.elementFromPoint(latestClientX, latestClientY);
      return Boolean((targetElement instanceof HTMLElement ? targetElement : null)?.closest('.track-lane[data-track-id], .new-track-drop-zone'));
    };
    const getReferenceMoveTypes = () => {
      const mediaTypes = new Set<string>();
      moveIds.forEach((id) => {
        const movingItem = mediaBoardPlacementsById.get(id)?.item;
        if (!movingItem || isMediaBoardFolder(movingItem) || !isReferenceableMediaType(movingItem.type)) return;
        mediaTypes.add(movingItem.type);
      });
      return mediaTypes;
    };
    const setActiveFlashBoardReferenceSlotElement = (element: HTMLElement | null) => {
      if (activeFlashBoardReferenceSlotElement === element) return;
      activeFlashBoardReferenceSlotElement?.classList.remove('is-active');
      activeFlashBoardReferenceSlotElement = element;
      activeFlashBoardReferenceSlotElement?.classList.add('is-active');
    };
    const syncFlashBoardReferenceTarget = () => {
      if (latestTimelineHandoffActive) {
        latestFlashBoardReferenceTargetActive = false;
        latestFlashBoardReferenceSlotTarget = null;
        setActiveFlashBoardReferenceSlotElement(null);
        return;
      }
      latestFlashBoardReferenceSlotTarget = getFlashBoardReferenceSlotTarget(
        latestClientX,
        latestClientY,
        getReferenceMoveTypes(),
      );
      setActiveFlashBoardReferenceSlotElement(latestFlashBoardReferenceSlotTarget?.element ?? null);
      latestFlashBoardReferenceTargetActive = document.elementsFromPoint(latestClientX, latestClientY).some(
        (element) => element instanceof HTMLElement
          && Boolean(element.closest('.media-ai-tray-expanded .fb-bubble:not(.media-download-bubble)')),
      ) || latestFlashBoardReferenceSlotTarget !== null;
      if (latestFlashBoardReferenceTargetActive) document.body.style.cursor = 'copy';
    };
    const syncTimelineBridge = (phase: 'move' | 'drop' | 'cancel' = 'move') => {
      if (!timelineDragPayload) {
        latestTimelineHandoffActive = false;
        return;
      }
      if (phase === 'cancel') {
        if (timelineBridgeActive) dispatchExternalDragBridgeEvent({ phase: 'cancel', clientX: latestClientX, clientY: latestClientY });
        timelineBridgeActive = false;
        latestTimelineHandoffActive = false;
        clearExternalDragPayload();
        return;
      }
      latestTimelineHandoffActive = isTimelineHandoffTarget();
      if (!latestTimelineHandoffActive) {
        if (timelineBridgeActive) dispatchExternalDragBridgeEvent({ phase: 'cancel', clientX: latestClientX, clientY: latestClientY });
        timelineBridgeActive = false;
        clearExternalDragPayload();
        document.body.style.cursor = 'grabbing';
        return;
      }
      setExternalDragPayload(timelineDragPayload);
      timelineBridgeActive = true;
      document.body.style.cursor = 'copy';
      dispatchExternalDragBridgeEvent({ phase, clientX: latestClientX, clientY: latestClientY });
    };
    const updateInsertionPreview = () => {
      if (latestTimelineHandoffActive || latestFlashBoardReferenceTargetActive) {
        latestInsertTarget = null;
        setMediaBoardInsertionPreview(null);
        return;
      }
      const insertionPoint = anchorLayout ? { x: anchorLayout.x + previewDx, y: anchorLayout.y + previewDy } : pointToBoard(latestClientX, latestClientY);
      latestInsertTarget = updateMediaBoardInsertionPreview(insertionPoint, moveIds, sourceLayouts, pointToBoard(latestClientX, latestClientY));
    };
    const updatePreviewDelta = () => {
      previewDx = (latestClientX - startX - (liveViewport.panX - startViewport.panX)) / liveViewport.zoom;
      previewDy = (latestClientY - startY - (liveViewport.panY - startViewport.panY)) / liveViewport.zoom;
    };
    const clearPreview = () => {
      getMediaBoardPreviewElements().forEach((node) => {
        node.style.transform = '';
        node.classList.remove('drag-preview');
      });
    };
    const schedulePreview = () => {
      if (boardInteractionFrameRef.current !== null) return;
      boardInteractionFrameRef.current = window.requestAnimationFrame(() => {
        boardInteractionFrameRef.current = null;
        applyMediaBoardViewportPreview(liveViewport);
        getMediaBoardPreviewElements().forEach((node) => {
          node.style.transform = `translate3d(${previewDx}px, ${previewDy}px, 0)`;
          node.classList.add('drag-preview');
        });
      });
    };
    const stopAutoPan = () => {
      autoPanVelocity = { x: 0, y: 0 };
      lastAutoPanTime = null;
      if (boardAutoPanFrameRef.current !== null) {
        window.cancelAnimationFrame(boardAutoPanFrameRef.current);
        boardAutoPanFrameRef.current = null;
      }
    };
    const tickAutoPan = (timestamp: number) => {
      boardAutoPanFrameRef.current = null;
      if (!didDrag || latestTimelineHandoffActive || (autoPanVelocity.x === 0 && autoPanVelocity.y === 0)) {
        lastAutoPanTime = null;
        return;
      }
      const dt = lastAutoPanTime === null ? 1 / 60 : Math.min(0.05, (timestamp - lastAutoPanTime) / 1000);
      lastAutoPanTime = timestamp;
      liveViewport = { ...liveViewport, panX: liveViewport.panX + autoPanVelocity.x * dt, panY: liveViewport.panY + autoPanVelocity.y * dt };
      syncTimelineBridge('move');
      updatePreviewDelta();
      updateInsertionPreview();
      schedulePreview();
      boardAutoPanFrameRef.current = window.requestAnimationFrame(tickAutoPan);
    };
    const updateAutoPanVelocity = () => {
      const rect = boardCanvasRef.current?.getBoundingClientRect();
      if (!rect || latestTimelineHandoffActive) {
        stopAutoPan();
        return;
      }
      const resolveAxisVelocity = (distanceToStart: number, distanceToEnd: number) => {
        if (distanceToStart < MEDIA_BOARD_AUTOPAN_EDGE_PX) {
          const t = 1 - Math.max(0, distanceToStart) / MEDIA_BOARD_AUTOPAN_EDGE_PX;
          return MEDIA_BOARD_AUTOPAN_MAX_SPEED * t * t;
        }
        if (distanceToEnd < MEDIA_BOARD_AUTOPAN_EDGE_PX) {
          const t = 1 - Math.max(0, distanceToEnd) / MEDIA_BOARD_AUTOPAN_EDGE_PX;
          return -MEDIA_BOARD_AUTOPAN_MAX_SPEED * t * t;
        }
        return 0;
      };
      autoPanVelocity = { x: resolveAxisVelocity(latestClientX - rect.left, rect.right - latestClientX), y: resolveAxisVelocity(latestClientY - rect.top, rect.bottom - latestClientY) };
      if ((autoPanVelocity.x !== 0 || autoPanVelocity.y !== 0) && boardAutoPanFrameRef.current === null) boardAutoPanFrameRef.current = window.requestAnimationFrame(tickAutoPan);
      else if (autoPanVelocity.x === 0 && autoPanVelocity.y === 0) stopAutoPan();
    };
    const handleMouseMove = (moveEvent: MouseEvent) => {
      latestClientX = moveEvent.clientX;
      latestClientY = moveEvent.clientY;
      if (!didDrag && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < MEDIA_BOARD_DRAG_START_DISTANCE) return;
      if (!didDrag) {
        didDrag = true;
        moveEvent.preventDefault();
        suppressNextMediaBoardContextMenu();
        closeContextMenu();
        setMediaBoardPerformanceMode(true);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }
      moveEvent.preventDefault();
      syncTimelineBridge('move');
      syncFlashBoardReferenceTarget();
      updatePreviewDelta();
      updateInsertionPreview();
      updateAutoPanVelocity();
      schedulePreview();
    };
    const handleWindowContextMenu = (contextEvent: MouseEvent) => {
      if (!didDrag) return;
      contextEvent.preventDefault();
      contextEvent.stopPropagation();
    };
    const handleMouseUp = () => {
      if (boardInteractionFrameRef.current !== null) {
        window.cancelAnimationFrame(boardInteractionFrameRef.current);
        boardInteractionFrameRef.current = null;
      }
      stopAutoPan();
      clearPreview();
      setMediaBoardInsertionPreview(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (didDrag) {
        suppressNextMediaBoardContextMenu();
        syncTimelineBridge('move');
        syncFlashBoardReferenceTarget();
        if (latestTimelineHandoffActive && timelineDragPayload) {
          mediaBoardViewportRef.current = liveViewport;
          setMediaBoardViewport(liveViewport);
          syncTimelineBridge('drop');
          timelineBridgeActive = false;
          clearExternalDragPayload();
        } else if (latestFlashBoardReferenceTargetActive) {
          syncTimelineBridge('cancel');
          if (latestFlashBoardReferenceSlotTarget) {
            addMoveIdsToFlashBoardReferences(
              moveIds,
              latestFlashBoardReferenceSlotTarget.role,
              latestFlashBoardReferenceSlotTarget.accepts,
            );
          } else {
            addMoveIdsToFlashBoardReferences(moveIds);
          }
          liveViewport = startViewport;
          mediaBoardViewportRef.current = startViewport;
          applyMediaBoardViewportPreview(startViewport);
          setMediaBoardViewport(startViewport);
        } else {
          mediaBoardViewportRef.current = liveViewport;
          setMediaBoardViewport(liveViewport);
          syncTimelineBridge('cancel');
          const insertionPoint = anchorLayout ? { x: anchorLayout.x + previewDx, y: anchorLayout.y + previewDy } : pointToBoard(latestClientX, latestClientY);
          const target = latestInsertTarget ?? getMediaBoardInsertTarget(insertionPoint, moveIds, pointToBoard(latestClientX, latestClientY));
          if (target) commitMediaBoardOrderChange(moveIds, target.groupId, target.position, { sourceLayouts, anchorId: item.id });
        }
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => setMediaBoardPerformanceMode(false));
        });
      } else {
        syncTimelineBridge('cancel');
        setMediaBoardPerformanceMode(false);
      }
      latestFlashBoardReferenceSlotTarget = null;
      setActiveFlashBoardReferenceSlotElement(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      if (didDrag) window.setTimeout(() => { window.removeEventListener('contextmenu', handleWindowContextMenu, true); }, 350);
      else window.removeEventListener('contextmenu', handleWindowContextMenu, true);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    window.addEventListener('contextmenu', handleWindowContextMenu, true);
  }, [
    applyMediaBoardViewportPreview,
    addMoveIdsToFlashBoardReferences,
    boardAutoPanFrameRef,
    boardCanvasRef,
    boardInteractionFrameRef,
    closeContextMenu,
    commitMediaBoardOrderChange,
    getMediaBoardExternalDragPayload,
    getMediaBoardInsertTarget,
    getMediaBoardTopLevelMoveIds,
    mediaBoardItemIds,
    mediaBoardLayout.placements,
    mediaBoardPlacementsById,
    mediaBoardViewportRef,
    selectedIds,
    setMediaBoardInsertionPreview,
    setMediaBoardPerformanceMode,
    setMediaBoardViewport,
    suppressNextMediaBoardContextMenu,
    updateMediaBoardInsertionPreview,
  ]);
}
