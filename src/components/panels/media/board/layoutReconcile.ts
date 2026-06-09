import type { ProjectItem } from '../../../../stores/mediaStore';
import {
  MEDIA_BOARD_EMPTY_FOLDER_BODY_MIN_HEIGHT,
  MEDIA_BOARD_GROUP_HEADER_HEIGHT,
  MEDIA_BOARD_GROUP_MIN_WIDTH,
  MEDIA_BOARD_GROUP_PADDING,
  MEDIA_BOARD_NODE_GAP,
  MEDIA_BOARD_SLOT_CELL_HEIGHT,
  MEDIA_BOARD_SLOT_CELL_WIDTH,
} from './constants';
import { getMediaBoardNodeSize, isMediaBoardFolder } from './layout';
import type { MediaBoardGroupOffset, MediaBoardItem } from './types';

export type SortMediaBoardItems = (items: ProjectItem[]) => ProjectItem[];

export function reconcileMediaBoardLayouts(
  current: Record<string, MediaBoardGroupOffset>,
  mediaBoardItems: MediaBoardItem[],
  sortItems: SortMediaBoardItems,
): { next: Record<string, MediaBoardGroupOffset>; changed: boolean } {
  const currentMediaBoardItemIds = new Set(mediaBoardItems.map((item) => item.id));
  const columnPitch = MEDIA_BOARD_SLOT_CELL_WIDTH;
  const rowPitch = MEDIA_BOARD_SLOT_CELL_HEIGHT;
  let changed = false;
  const next: Record<string, MediaBoardGroupOffset> = {};
  const usedSlotsByGroup = new Map<string | null, Set<string>>();
  const itemsByParent = new Map<string | null, MediaBoardItem[]>();

  mediaBoardItems.forEach((item) => {
    const parentId = item.parentId ?? null;
    const siblings = itemsByParent.get(parentId) ?? [];
    siblings.push(item);
    itemsByParent.set(parentId, siblings);
  });

  const canPlace = (
    usedSlots: Set<string>,
    column: number,
    row: number,
    span: { columns: number; rows: number },
    columnCount: number,
  ) => {
    if (column + span.columns > columnCount) return false;
    for (let y = row; y < row + span.rows; y += 1) {
      for (let x = column; x < column + span.columns; x += 1) {
        if (usedSlots.has(`${x}:${y}`)) return false;
      }
    }
    return true;
  };

  const markSpan = (
    usedSlots: Set<string>,
    column: number,
    row: number,
    span: { columns: number; rows: number },
  ) => {
    for (let y = row; y < row + span.rows; y += 1) {
      for (let x = column; x < column + span.columns; x += 1) {
        usedSlots.add(`${x}:${y}`);
      }
    }
  };

  const getSpanForSize = (size: { width: number; height: number }) => ({
    columns: Math.max(1, Math.ceil((size.width + MEDIA_BOARD_NODE_GAP) / columnPitch)),
    rows: Math.max(1, Math.ceil((size.height + MEDIA_BOARD_NODE_GAP) / rowPitch)),
  });

  const getPackColumnsForSpans = (groupId: string | null, spans: Array<{ columns: number; rows: number }>) => {
    if (spans.length === 0) return 1;
    const widestItem = Math.max(1, ...spans.map((span) => span.columns));
    const totalCells = spans.reduce((sum, span) => sum + (span.columns * span.rows), 0);
    const targetColumns = Math.ceil(Math.sqrt(totalCells) * (groupId === null ? 1.35 : 1.22));
    const hardMaxColumns = groupId === null ? 128 : 84;
    return Math.max(widestItem, Math.min(hardMaxColumns, targetColumns));
  };

  const packSpans = (
    spans: Array<{ columns: number; rows: number }>,
    columnCount: number,
  ) => {
    const usedSlots = new Set<string>();
    let maxColumn = 0;
    let maxRow = 0;

    spans.forEach((span) => {
      let slotIndex = 0;
      while (!canPlace(usedSlots, slotIndex % columnCount, Math.floor(slotIndex / columnCount), span, columnCount)) {
        slotIndex += 1;
      }
      const column = slotIndex % columnCount;
      const row = Math.floor(slotIndex / columnCount);
      markSpan(usedSlots, column, row, span);
      maxColumn = Math.max(maxColumn, column + span.columns);
      maxRow = Math.max(maxRow, row + span.rows);
    });

    return {
      width: maxColumn * columnPitch,
      height: maxRow * rowPitch,
    };
  };

  const estimatedSizeCache = new Map<string, { width: number; height: number }>();
  const estimateBoardItemSize = (item: MediaBoardItem, stack: Set<string> = new Set()): { width: number; height: number } => {
    if (!isMediaBoardFolder(item)) {
      return getMediaBoardNodeSize(item);
    }

    const cached = estimatedSizeCache.get(item.id);
    if (cached) return cached;

    if (stack.has(item.id)) {
      return {
        width: MEDIA_BOARD_GROUP_MIN_WIDTH,
        height: MEDIA_BOARD_GROUP_HEADER_HEIGHT + (MEDIA_BOARD_GROUP_PADDING * 2) + MEDIA_BOARD_EMPTY_FOLDER_BODY_MIN_HEIGHT,
      };
    }

    const nextStack = new Set(stack);
    nextStack.add(item.id);
    const children = sortItems([...(itemsByParent.get(item.id) ?? [])]) as MediaBoardItem[];
    const childSpans = children.map((child) => getSpanForSize(estimateBoardItemSize(child, nextStack)));
    const body = childSpans.length > 0
      ? packSpans(childSpans, getPackColumnsForSpans(item.id, childSpans))
      : { width: 0, height: MEDIA_BOARD_EMPTY_FOLDER_BODY_MIN_HEIGHT };
    const estimated = {
      width: Math.max(MEDIA_BOARD_GROUP_MIN_WIDTH, Math.ceil(body.width + (MEDIA_BOARD_GROUP_PADDING * 2))),
      height: MEDIA_BOARD_GROUP_HEADER_HEIGHT + (MEDIA_BOARD_GROUP_PADDING * 2) + Math.max(body.height, MEDIA_BOARD_EMPTY_FOLDER_BODY_MIN_HEIGHT),
    };
    estimatedSizeCache.set(item.id, estimated);
    return estimated;
  };

  const getSpan = (item: MediaBoardItem) => getSpanForSize(estimateBoardItemSize(item));

  const markUsed = (groupId: string | null, position: MediaBoardGroupOffset, span: { columns: number; rows: number }) => {
    const usedSlots = usedSlotsByGroup.get(groupId) ?? new Set<string>();
    const column = Math.max(0, Math.round(position.x / columnPitch));
    const row = Math.max(0, Math.round(position.y / rowPitch));
    markSpan(usedSlots, column, row, span);
    usedSlotsByGroup.set(groupId, usedSlots);
  };

  mediaBoardItems.forEach((item) => {
    const parentId = item.parentId ?? null;
    const layout = current[item.id];
    if (!layout) return;
    next[item.id] = layout;
    markUsed(parentId, layout, getSpan(item));
  });

  Object.keys(current).forEach((itemId) => {
    if (!currentMediaBoardItemIds.has(itemId)) {
      changed = true;
    }
  });

  itemsByParent.forEach((items, parentId) => {
    const sortedItems = sortItems([...items]) as MediaBoardItem[];
    const columnCount = getPackColumnsForSpans(parentId, sortedItems.map(getSpan));
    sortedItems.forEach((item) => {
      if (next[item.id]) return;

      const usedSlots = usedSlotsByGroup.get(parentId) ?? new Set<string>();
      const span = getSpan(item);
      let slotIndex = 0;
      while (!canPlace(usedSlots, slotIndex % columnCount, Math.floor(slotIndex / columnCount), span, columnCount)) {
        slotIndex += 1;
      }

      const position = {
        x: (slotIndex % columnCount) * columnPitch,
        y: Math.floor(slotIndex / columnCount) * rowPitch,
      };
      next[item.id] = position;
      markUsed(parentId, position, span);
      changed = true;
    });
  });

  if (Object.keys(next).length !== Object.keys(current).length) {
    changed = true;
  }

  return { next, changed };
}
