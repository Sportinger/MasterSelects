import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import type { MediaFolder } from '../../../../stores/mediaStore';
import {
  DEFAULT_BOARD_VIEWPORT,
  MEDIA_BOARD_NODE_GAP,
  MEDIA_BOARD_ROOT_ORDER_KEY,
  MEDIA_BOARD_SLOT_CELL_HEIGHT,
  MEDIA_BOARD_SLOT_CELL_WIDTH,
} from './constants';
import {
  buildMediaBoardLayoutGeometry,
  createMediaBoardLayoutSignature,
  getMediaBoardGroupChrome,
  normalizeMediaBoardOrderIds,
  restoreMediaBoardLayoutItems,
} from './layout';
import { reconcileMediaBoardLayouts } from './layoutReconcile';
import { useMediaBoardLayoutCommit } from './useMediaBoardLayoutCommit';
import { subscribeMediaBoardPlacementRequests } from './placementRequests';
import {
  loadMediaBoardGroupOffsets,
  loadMediaBoardLayoutSnapshot,
  loadMediaBoardLayouts,
  loadMediaBoardOrder,
  saveMediaBoardGroupOffsets,
  saveMediaBoardLayouts,
  saveMediaBoardLayoutSnapshot,
  saveMediaBoardOrder,
} from './storage';
import type {
  MediaBoardGroupLayout,
  MediaBoardGroupOffset,
  MediaBoardInsertionPreview,
  MediaBoardItem,
  MediaBoardLayoutResult,
  MediaBoardNodeLayout,
  MediaBoardNodePlacement,
} from './types';

export interface UseMediaBoardLayoutControllerOptions {
  folders: MediaFolder[];
  mediaBoardItems: MediaBoardItem[];
  moveToFolder: (itemIds: string[], folderId: string | null) => void;
  setMediaBoardViewport: (viewport: typeof DEFAULT_BOARD_VIEWPORT) => void;
  sortItems: (items: MediaBoardItem[]) => MediaBoardItem[];
  viewMode: string;
}

export interface UseMediaBoardLayoutControllerResult {
  canMoveItemsToMediaBoardGroup: (itemIds: string[], targetGroupId: string | null) => boolean;
  clearMediaBoardInsertionPreview: () => void;
  commitMediaBoardOrderChange: (
    movingIds: string[],
    targetGroupId: string | null,
    targetPosition: MediaBoardGroupOffset,
    options?: { sourceLayouts?: Record<string, MediaBoardNodeLayout>; anchorId?: string },
  ) => void;
  getMediaBoardGroupAtPoint: (point: { x: number; y: number }) => MediaBoardGroupLayout | null;
  getMediaBoardGroupsAtPoint: (point: { x: number; y: number }) => MediaBoardGroupLayout[];
  getMediaBoardInsertTarget: (
    point: { x: number; y: number },
    movingIds: string[],
    groupPoint?: { x: number; y: number },
  ) => { groupId: string | null; position: MediaBoardGroupOffset } | null;
  getMediaBoardPlacementAtPoint: (point: { x: number; y: number }) => MediaBoardNodePlacement | null;
  getMediaBoardTopLevelMoveIds: (itemIds: string[]) => string[];
  mediaBoardInsertionPreview: MediaBoardInsertionPreview | null;
  mediaBoardItemIds: Set<string>;
  mediaBoardItemsById: Map<string, MediaBoardItem>;
  mediaBoardLayout: MediaBoardLayoutResult;
  mediaBoardPlacementsById: Map<string, MediaBoardNodePlacement>;
  placeMediaBoardItemsAtPoint: (itemIds: string[], point: MediaBoardGroupOffset) => void;
  reloadMediaBoardLayoutState: () => void;
  resetMediaBoardLayout: () => void;
  setMediaBoardInsertionPreview: Dispatch<SetStateAction<MediaBoardInsertionPreview | null>>;
  updateMediaBoardInsertionPreview: (
    point: { x: number; y: number },
    movingIds: string[],
    sourceLayouts: Record<string, MediaBoardNodeLayout>,
    groupPoint?: { x: number; y: number },
  ) => { groupId: string | null; position: MediaBoardGroupOffset } | null;
}

export function useMediaBoardLayoutController({
  folders,
  mediaBoardItems,
  moveToFolder,
  setMediaBoardViewport,
  sortItems,
  viewMode,
}: UseMediaBoardLayoutControllerOptions): UseMediaBoardLayoutControllerResult {
  const [mediaBoardOrder, setMediaBoardOrder] = useState<Record<string, string[]>>(loadMediaBoardOrder);
  const [mediaBoardGroupOffsets, setMediaBoardGroupOffsets] = useState<Record<string, MediaBoardGroupOffset>>(loadMediaBoardGroupOffsets);
  const [mediaBoardLayouts, setMediaBoardLayouts] = useState<Record<string, MediaBoardGroupOffset>>(loadMediaBoardLayouts);
  const [mediaBoardInsertionPreview, setMediaBoardInsertionPreview] = useState<MediaBoardInsertionPreview | null>(null);
  const mediaBoardItemIds = useMemo(() => new Set(mediaBoardItems.map((item) => item.id)), [mediaBoardItems]);
  const mediaBoardItemsById = useMemo(() => new Map(mediaBoardItems.map((item) => [item.id, item])), [mediaBoardItems]);
  const mediaBoardFoldersById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const mediaBoardLayoutSignature = useMemo(
    () => createMediaBoardLayoutSignature(mediaBoardItems, mediaBoardLayouts),
    [mediaBoardItems, mediaBoardLayouts],
  );
  const mediaBoardInsertionPreviewKey = useMemo(() => {
    if (!mediaBoardInsertionPreview) return '';
    return JSON.stringify([
      mediaBoardInsertionPreview.movingIds,
      mediaBoardInsertionPreview.targetGroupId,
      mediaBoardInsertionPreview.targetPosition.x,
      mediaBoardInsertionPreview.targetPosition.y,
    ]);
  }, [mediaBoardInsertionPreview]);

  useEffect(() => { saveMediaBoardOrder(mediaBoardOrder); }, [mediaBoardOrder]);
  useEffect(() => { saveMediaBoardGroupOffsets(mediaBoardGroupOffsets); }, [mediaBoardGroupOffsets]);
  useEffect(() => { saveMediaBoardLayouts(mediaBoardLayouts); }, [mediaBoardLayouts]);

  const reloadMediaBoardLayoutState = useCallback(() => {
    setMediaBoardOrder(loadMediaBoardOrder());
    setMediaBoardGroupOffsets(loadMediaBoardGroupOffsets());
    setMediaBoardLayouts(loadMediaBoardLayouts());
    setMediaBoardInsertionPreview(null);
  }, []);

  const clearMediaBoardInsertionPreview = useCallback(() => {
    setMediaBoardInsertionPreview(null);
  }, []);

  useEffect(() => {
    // Synchronous reconciliation keeps board nodes available in the same act cycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMediaBoardOrder((current) => {
      let changed = false;
      const validFolderKeys = new Set([MEDIA_BOARD_ROOT_ORDER_KEY, ...folders.map((folder) => folder.id)]);
      const next: Record<string, string[]> = {};
      Object.entries(current).forEach(([folderKey, ids]) => {
        if (!validFolderKeys.has(folderKey)) {
          changed = true;
          return;
        }
        const filteredIds = normalizeMediaBoardOrderIds(ids, mediaBoardItemIds);
        if (filteredIds.length !== ids.length) changed = true;
        if (filteredIds.length > 0) next[folderKey] = filteredIds;
      });
      return changed ? next : current;
    });
  }, [folders, mediaBoardItemIds]);

  useEffect(() => {
    // Synchronous reconciliation keeps board group offsets coherent before layout geometry is read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMediaBoardGroupOffsets((current) => {
      const validFolderIds = new Set(folders.map((folder) => folder.id));
      let changed = false;
      const next: Record<string, MediaBoardGroupOffset> = {};
      Object.entries(current).forEach(([folderId, offset]) => {
        if (!validFolderIds.has(folderId)) {
          changed = true;
          return;
        }
        next[folderId] = offset;
      });
      return changed ? next : current;
    });
  }, [folders]);

  useEffect(() => {
    // Synchronous reconciliation preserves same-cycle board mounting for tests and user interactions.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMediaBoardLayouts((current) => {
      const { next, changed } = reconcileMediaBoardLayouts(current, mediaBoardItems, sortItems);
      return changed ? next : current;
    });
  }, [mediaBoardItems, mediaBoardLayoutSignature, sortItems]);

  const mediaBoardLayoutGeometry = useMemo<MediaBoardLayoutResult>(() => {
    const itemsById = new Map(mediaBoardItems.map((item) => [item.id, item]));
    if (!mediaBoardInsertionPreviewKey) {
      const snapshot = loadMediaBoardLayoutSnapshot(mediaBoardLayoutSignature, itemsById, folders);
      if (snapshot) return snapshot;
    }
    return buildMediaBoardLayoutGeometry({ mediaBoardItems, folders, mediaBoardLayouts, mediaBoardInsertionPreview });
  }, [folders, mediaBoardInsertionPreview, mediaBoardInsertionPreviewKey, mediaBoardItems, mediaBoardLayoutSignature, mediaBoardLayouts]);

  const mediaBoardLayout = useMemo(() => (
    restoreMediaBoardLayoutItems(mediaBoardLayoutGeometry, mediaBoardItemsById, folders)
  ), [folders, mediaBoardItemsById, mediaBoardLayoutGeometry]);

  useEffect(() => {
    if (viewMode !== 'board' || mediaBoardInsertionPreviewKey) return;
    const saveSnapshot = () => { saveMediaBoardLayoutSnapshot(mediaBoardLayoutSignature, mediaBoardLayoutGeometry); };
    const requestIdle = window.requestIdleCallback;
    if (typeof requestIdle === 'function') {
      const idleId = requestIdle(saveSnapshot, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(idleId);
    }
    const timeoutId = window.setTimeout(saveSnapshot, 250);
    return () => window.clearTimeout(timeoutId);
  }, [mediaBoardInsertionPreviewKey, mediaBoardLayoutGeometry, mediaBoardLayoutSignature, viewMode]);

  const mediaBoardPlacementsById = useMemo(() => (
    new Map(mediaBoardLayout.placements.map((placement) => [placement.item.id, placement]))
  ), [mediaBoardLayout.placements]);

  const getMediaBoardTopLevelMoveIds = useCallback((itemIds: string[]) => {
    const requestedIds = new Set(itemIds.filter((id) => mediaBoardItemIds.has(id)));
    const seenIds = new Set<string>();
    const hasSelectedAncestor = (itemId: string) => {
      const item = mediaBoardItemsById.get(itemId);
      let parentId = item?.parentId ?? null;
      while (parentId) {
        if (requestedIds.has(parentId)) return true;
        parentId = mediaBoardFoldersById.get(parentId)?.parentId ?? null;
      }
      return false;
    };
    return itemIds.filter((id) => {
      if (!requestedIds.has(id) || seenIds.has(id) || hasSelectedAncestor(id)) return false;
      seenIds.add(id);
      return true;
    });
  }, [mediaBoardFoldersById, mediaBoardItemIds, mediaBoardItemsById]);

  const getMediaBoardPlacementAtPoint = useCallback((point: { x: number; y: number }) => {
    for (let index = mediaBoardLayout.placements.length - 1; index >= 0; index -= 1) {
      const placement = mediaBoardLayout.placements[index];
      const { layout } = placement;
      if (point.x >= layout.x && point.x <= layout.x + layout.width && point.y >= layout.y && point.y <= layout.y + layout.height) {
        return placement;
      }
    }
    return null;
  }, [mediaBoardLayout.placements]);

  const getMediaBoardGroupsAtPoint = useCallback((point: { x: number; y: number }) => (
    mediaBoardLayout.groups
      .filter((group) => point.x >= group.x && point.x <= group.x + group.width && point.y >= group.y && point.y <= group.y + group.height)
      .sort((a, b) => b.depth - a.depth)
  ), [mediaBoardLayout.groups]);

  const getMediaBoardGroupAtPoint = useCallback((point: { x: number; y: number }) => {
    const groupsAtPoint = getMediaBoardGroupsAtPoint(point);
    return groupsAtPoint[0] ?? mediaBoardLayout.groups.find((group) => group.id === null) ?? null;
  }, [getMediaBoardGroupsAtPoint, mediaBoardLayout.groups]);

  const canMoveItemsToMediaBoardGroup = useCallback((itemIds: string[], targetGroupId: string | null) => {
    if (!targetGroupId) return true;
    return itemIds.every((itemId) => {
      const draggedFolder = folders.find((folder) => folder.id === itemId);
      if (!draggedFolder) return true;
      let parent = folders.find((folder) => folder.id === targetGroupId);
      while (parent) {
        if (parent.id === itemId) return false;
        parent = parent.parentId ? folders.find((folder) => folder.id === parent!.parentId) : undefined;
      }
      return true;
    });
  }, [folders]);

  const getMediaBoardInsertTarget = useCallback((point: { x: number; y: number }, movingIds: string[], groupPoint = point) => {
    const groupsAtPoint = getMediaBoardGroupsAtPoint(groupPoint);
    const rootGroup = mediaBoardLayout.groups.find((group) => group.id === null) ?? null;
    const isPointInsideGroupBody = (group: MediaBoardGroupLayout) => {
      if (group.id === null) return true;
      const chrome = getMediaBoardGroupChrome(group.id);
      if (group.itemCount === 0) {
        return groupPoint.x >= group.x && groupPoint.x <= group.x + group.width && groupPoint.y >= group.y && groupPoint.y <= group.y + group.height;
      }
      return (
        groupPoint.x >= group.x + chrome.padding
        && groupPoint.x <= group.x + group.width - chrome.padding
        && groupPoint.y >= group.y + chrome.headerHeight + chrome.padding
        && groupPoint.y <= group.y + group.height - chrome.padding
      );
    };
    const targetGroup = [
      ...groupsAtPoint.filter(isPointInsideGroupBody),
      ...(rootGroup && !groupsAtPoint.some((group) => group.id === rootGroup.id) ? [rootGroup] : []),
    ].find((group) => canMoveItemsToMediaBoardGroup(movingIds, group.id)) ?? null;
    if (!targetGroup) return null;

    const movingIdSet = new Set(movingIds);
    const targetSlots = mediaBoardLayout.slots
      .filter((slot) => slot.groupId === targetGroup.id && (!slot.itemId || !movingIdSet.has(slot.itemId)))
      .sort((a, b) => a.slotIndex - b.slotIndex);
    const chrome = getMediaBoardGroupChrome(targetGroup.id);
    const bodyLeft = targetGroup.x + chrome.padding;
    const bodyTop = targetGroup.y + chrome.headerHeight + chrome.padding;
    const hoveredSlot = targetSlots.find(({ layout }) => (
      groupPoint.x >= layout.x && groupPoint.x <= layout.x + layout.width && groupPoint.y >= layout.y && groupPoint.y <= layout.y + layout.height
    ));
    const clampToFolderBody = targetGroup.id !== null;
    const clampBoardPosition = (value: number) => clampToFolderBody ? Math.max(0, value) : value;
    const targetPosition = hoveredSlot
      ? { x: clampBoardPosition(hoveredSlot.layout.x - bodyLeft), y: clampBoardPosition(hoveredSlot.layout.y - bodyTop) }
      : {
          x: clampBoardPosition(Math.round((point.x - bodyLeft) / MEDIA_BOARD_SLOT_CELL_WIDTH) * MEDIA_BOARD_SLOT_CELL_WIDTH),
          y: clampBoardPosition(Math.round((point.y - bodyTop) / MEDIA_BOARD_SLOT_CELL_HEIGHT) * MEDIA_BOARD_SLOT_CELL_HEIGHT),
        };
    return { groupId: targetGroup.id, position: targetPosition };
  }, [canMoveItemsToMediaBoardGroup, getMediaBoardGroupsAtPoint, mediaBoardLayout.groups, mediaBoardLayout.slots]);

  const updateMediaBoardInsertionPreview = useCallback((
    point: { x: number; y: number },
    movingIds: string[],
    sourceLayouts: Record<string, MediaBoardNodeLayout>,
    groupPoint = point,
  ) => {
    const target = getMediaBoardInsertTarget(point, movingIds, groupPoint);
    if (!target) {
      setMediaBoardInsertionPreview(null);
      return null;
    }
    const movingKey = movingIds.join('\u0000');
    setMediaBoardInsertionPreview((current) => (
      current
      && current.targetGroupId === target.groupId
      && current.targetPosition.x === target.position.x
      && current.targetPosition.y === target.position.y
      && current.movingIds.join('\u0000') === movingKey
        ? current
        : { movingIds, sourceLayouts, targetGroupId: target.groupId, targetPosition: target.position }
    ));
    return target;
  }, [getMediaBoardInsertTarget]);

  const placeMediaBoardItemsInGroup = useCallback((
    itemIds: string[],
    targetGroupId: string | null,
    targetPosition: MediaBoardGroupOffset,
  ) => {
    const normalizedIds = [...new Set(itemIds.filter(Boolean))];
    if (normalizedIds.length === 0) return;

    setMediaBoardLayouts((current) => {
      const next = { ...current };
      let changed = false;
      normalizedIds.forEach((id, index) => {
        const position = {
          x: targetPosition.x + (index * MEDIA_BOARD_SLOT_CELL_WIDTH),
          y: targetPosition.y,
        };
        if (next[id]?.x === position.x && next[id]?.y === position.y) return;
        next[id] = position;
        changed = true;
      });
      return changed ? next : current;
    });
    moveToFolder(normalizedIds, targetGroupId);
  }, [moveToFolder]);

  const placeMediaBoardItemsAtPoint = useCallback((itemIds: string[], point: MediaBoardGroupOffset) => {
    const normalizedIds = [...new Set(itemIds.filter(Boolean))];
    if (normalizedIds.length === 0) return;
    const target = getMediaBoardInsertTarget(point, normalizedIds);
    if (!target || !canMoveItemsToMediaBoardGroup(normalizedIds, target.groupId)) return;
    placeMediaBoardItemsInGroup(normalizedIds, target.groupId, target.position);
  }, [canMoveItemsToMediaBoardGroup, getMediaBoardInsertTarget, placeMediaBoardItemsInGroup]);

  const placeMediaBoardItemsNearItem = useCallback((itemIds: string[], nearItemId: string) => {
    const placement = mediaBoardPlacementsById.get(nearItemId);
    if (!placement) return;
    const targetGroup = mediaBoardLayout.groups.find((group) => group.id === placement.groupId) ?? null;
    const chrome = getMediaBoardGroupChrome(placement.groupId);
    const bodyLeft = targetGroup ? targetGroup.x + chrome.padding : 0;
    const bodyTop = targetGroup ? targetGroup.y + chrome.headerHeight + chrome.padding : 0;
    placeMediaBoardItemsInGroup(itemIds, placement.groupId, {
      x: placement.layout.x - bodyLeft + placement.layout.width + MEDIA_BOARD_NODE_GAP,
      y: placement.layout.y - bodyTop,
    });
  }, [mediaBoardLayout.groups, mediaBoardPlacementsById, placeMediaBoardItemsInGroup]);

  useEffect(() => subscribeMediaBoardPlacementRequests((request) => {
    if (request.point) {
      placeMediaBoardItemsAtPoint(request.itemIds, request.point);
      return;
    }
    if (request.nearItemId) {
      placeMediaBoardItemsNearItem(request.itemIds, request.nearItemId);
    }
  }), [placeMediaBoardItemsAtPoint, placeMediaBoardItemsNearItem]);

  const commitMediaBoardOrderChange = useMediaBoardLayoutCommit({
    mediaBoardItems,
    mediaBoardItemsById,
    mediaBoardGroups: mediaBoardLayout.groups,
    mediaBoardPlacementsById,
    moveToFolder,
    setMediaBoardLayouts,
  });
  const resetMediaBoardLayout = useCallback(() => {
    setMediaBoardOrder({});
    setMediaBoardGroupOffsets({});
    setMediaBoardLayouts({});
    setMediaBoardViewport(DEFAULT_BOARD_VIEWPORT);
  }, [setMediaBoardViewport]);

  return {
    canMoveItemsToMediaBoardGroup,
    clearMediaBoardInsertionPreview,
    commitMediaBoardOrderChange,
    getMediaBoardGroupAtPoint,
    getMediaBoardGroupsAtPoint,
    getMediaBoardInsertTarget,
    getMediaBoardPlacementAtPoint,
    getMediaBoardTopLevelMoveIds,
    mediaBoardInsertionPreview,
    mediaBoardItemIds,
    mediaBoardItemsById,
    mediaBoardLayout,
    mediaBoardPlacementsById,
    placeMediaBoardItemsAtPoint,
    reloadMediaBoardLayoutState,
    resetMediaBoardLayout,
    setMediaBoardInsertionPreview,
    updateMediaBoardInsertionPreview,
  };
}
