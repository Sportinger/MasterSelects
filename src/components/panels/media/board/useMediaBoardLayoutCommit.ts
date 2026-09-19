import { useCallback, type Dispatch, type SetStateAction } from 'react';

import {
  MEDIA_BOARD_EMPTY_SLOT_HEIGHT,
  MEDIA_BOARD_EMPTY_SLOT_WIDTH,
  MEDIA_BOARD_NODE_GAP,
  MEDIA_BOARD_SLOT_CELL_HEIGHT,
  MEDIA_BOARD_SLOT_CELL_WIDTH,
} from './constants';
import { getMediaBoardGroupChrome, getMediaBoardNodeSize } from './layout';
import { findNearestMediaBoardGridSlot, getMediaBoardGridColumnLimit } from './nearestGridSlot';
import type {
  MediaBoardGroupOffset,
  MediaBoardItem,
  MediaBoardNodeLayout,
  MediaBoardNodePlacement,
} from './types';

export interface UseMediaBoardLayoutCommitOptions {
  mediaBoardItems: MediaBoardItem[];
  mediaBoardItemsById: Map<string, MediaBoardItem>;
  mediaBoardGroups: Array<{ id: string | null; x: number; y: number }>;
  mediaBoardPlacementsById: Map<string, MediaBoardNodePlacement>;
  moveToFolder: (itemIds: string[], folderId: string | null) => void;
  setMediaBoardLayouts: Dispatch<SetStateAction<Record<string, MediaBoardGroupOffset>>>;
}

export function useMediaBoardLayoutCommit({
  mediaBoardItems,
  mediaBoardItemsById,
  mediaBoardGroups,
  mediaBoardPlacementsById,
  moveToFolder,
  setMediaBoardLayouts,
}: UseMediaBoardLayoutCommitOptions) {
  return useCallback((
    movingIds: string[],
    targetGroupId: string | null,
    targetPosition: MediaBoardGroupOffset,
    options?: { sourceLayouts?: Record<string, MediaBoardNodeLayout>; anchorId?: string },
  ) => {
    if (movingIds.length === 0) return;
    const normalizedMovingIds = movingIds.filter((id) => mediaBoardItemsById.has(id));
    if (normalizedMovingIds.length === 0) return;
    const movingIdSet = new Set(normalizedMovingIds);
    const targetGroup = mediaBoardGroups.find((group) => group.id === targetGroupId) ?? null;
    const targetChrome = getMediaBoardGroupChrome(targetGroupId);
    const targetBodyLeft = targetGroup ? targetGroup.x + targetChrome.padding : 0;
    const targetBodyTop = targetGroup ? targetGroup.y + targetChrome.headerHeight + targetChrome.padding : 0;
    const allowNegativePositions = targetGroupId === null;
    const clampLocalPosition = (value: number) => allowNegativePositions ? value : Math.max(0, value);
    const getItemSize = (id: string) => {
      const placement = mediaBoardPlacementsById.get(id);
      if (placement) return { width: placement.layout.width, height: placement.layout.height };
      const item = mediaBoardItemsById.get(id);
      return item ? getMediaBoardNodeSize(item) : { width: MEDIA_BOARD_EMPTY_SLOT_WIDTH, height: MEDIA_BOARD_EMPTY_SLOT_HEIGHT };
    };
    const getFallbackLocalPosition = (id: string, fallbackIndex: number): MediaBoardGroupOffset => {
      const placement = mediaBoardPlacementsById.get(id);
      if (placement && placement.groupId === targetGroupId) {
        return { x: clampLocalPosition(placement.layout.x - targetBodyLeft), y: clampLocalPosition(placement.layout.y - targetBodyTop) };
      }
      return { x: fallbackIndex * MEDIA_BOARD_SLOT_CELL_WIDTH, y: 0 };
    };
    const sourceLayouts = options?.sourceLayouts ?? {};
    const anchorSourceLayout = (options?.anchorId ? sourceLayouts[options.anchorId] : undefined)
      ?? normalizedMovingIds.map((id) => sourceLayouts[id]).find((layout): layout is MediaBoardNodeLayout => Boolean(layout))
      ?? null;
    const getMovingDesiredPosition = (id: string, index: number): MediaBoardGroupOffset => {
      const sourceLayout = sourceLayouts[id];
      return sourceLayout && anchorSourceLayout
        ? { x: targetPosition.x + (sourceLayout.x - anchorSourceLayout.x), y: targetPosition.y + (sourceLayout.y - anchorSourceLayout.y) }
        : { x: targetPosition.x + (index * MEDIA_BOARD_SLOT_CELL_WIDTH), y: targetPosition.y };
    };

    setMediaBoardLayouts((current) => {
      const next = { ...current };
      const occupied = new Set<string>();
      let changed = false;
      const getSpan = (size: { width: number; height: number }) => ({
        columns: Math.max(1, Math.ceil((size.width + MEDIA_BOARD_NODE_GAP) / MEDIA_BOARD_SLOT_CELL_WIDTH)),
        rows: Math.max(1, Math.ceil((size.height + MEDIA_BOARD_NODE_GAP) / MEDIA_BOARD_SLOT_CELL_HEIGHT)),
      });
      const stationaryItems = mediaBoardItems.filter((item) => !movingIdSet.has(item.id) && (item.parentId ?? null) === targetGroupId);
      const columnCount = getMediaBoardGridColumnLimit(targetGroupId, [
        ...stationaryItems.map((item, index) => ({
          x: (current[item.id] ?? getFallbackLocalPosition(item.id, index)).x, width: getItemSize(item.id).width,
        })),
        ...normalizedMovingIds.map((id, index) => ({ x: getMovingDesiredPosition(id, index).x, width: getItemSize(id).width })),
      ]);
      const canPlace = (column: number, row: number, span: { columns: number; rows: number }) => {
        if (!allowNegativePositions && (column < 0 || row < 0)) return false;
        if (column + span.columns > columnCount) return false;
        for (let y = row; y < row + span.rows; y += 1) {
          for (let x = column; x < column + span.columns; x += 1) if (occupied.has(`${x}:${y}`)) return false;
        }
        return true;
      };
      const markOccupied = (column: number, row: number, span: { columns: number; rows: number }) => {
        for (let y = row; y < row + span.rows; y += 1) {
          for (let x = column; x < column + span.columns; x += 1) occupied.add(`${x}:${y}`);
        }
      };

      stationaryItems.forEach((item, index) => {
        const desired = current[item.id] ?? getFallbackLocalPosition(item.id, index);
        const span = getSpan(getItemSize(item.id));
        markOccupied(
          allowNegativePositions ? Math.round(desired.x / MEDIA_BOARD_SLOT_CELL_WIDTH) : Math.max(0, Math.round(desired.x / MEDIA_BOARD_SLOT_CELL_WIDTH)),
          allowNegativePositions ? Math.round(desired.y / MEDIA_BOARD_SLOT_CELL_HEIGHT) : Math.max(0, Math.round(desired.y / MEDIA_BOARD_SLOT_CELL_HEIGHT)),
          span,
        );
      });

      normalizedMovingIds.forEach((id, index) => {
        const desired = getMovingDesiredPosition(id, index);
        const span = getSpan(getItemSize(id));
        const initialColumn = allowNegativePositions ? Math.round(desired.x / MEDIA_BOARD_SLOT_CELL_WIDTH) : Math.max(0, Math.round(desired.x / MEDIA_BOARD_SLOT_CELL_WIDTH));
        const initialRow = allowNegativePositions ? Math.round(desired.y / MEDIA_BOARD_SLOT_CELL_HEIGHT) : Math.max(0, Math.round(desired.y / MEDIA_BOARD_SLOT_CELL_HEIGHT));
        const { column, row } = findNearestMediaBoardGridSlot(
          initialColumn, initialRow, (candidateColumn, candidateRow) => canPlace(candidateColumn, candidateRow, span),
        );
        markOccupied(column, row, span);
        const resolvedPosition = { x: column * MEDIA_BOARD_SLOT_CELL_WIDTH, y: row * MEDIA_BOARD_SLOT_CELL_HEIGHT };
        if (next[id]?.x !== resolvedPosition.x || next[id]?.y !== resolvedPosition.y) {
          next[id] = resolvedPosition;
          changed = true;
        }
      });
      return changed ? next : current;
    });

    moveToFolder(normalizedMovingIds, targetGroupId);
  }, [mediaBoardItems, mediaBoardItemsById, mediaBoardGroups, mediaBoardPlacementsById, moveToFolder, setMediaBoardLayouts]);
}
