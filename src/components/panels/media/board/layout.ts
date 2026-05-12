import type { MediaFolder, ProjectItem } from '../../../../stores/mediaStore';
import { isImportedMediaFileItem } from '../itemTypeGuards';
import {
  BOARD_LAYOUT_SNAPSHOT_VERSION,
  MEDIA_BOARD_COMPACT_LOD_ZOOM,
  MEDIA_BOARD_COMPACT_RENDER_BUFFER_PX,
  MEDIA_BOARD_EMPTY_FOLDER_BODY_MIN_HEIGHT,
  MEDIA_BOARD_EMPTY_SLOT_ID,
  MEDIA_BOARD_EMPTY_SLOT_SIZE_SEPARATOR,
  MEDIA_BOARD_FOLDER_ROW_MAX_WIDTH,
  MEDIA_BOARD_GROUP_HEADER_HEIGHT,
  MEDIA_BOARD_GROUP_MAX_BODY_WIDTH,
  MEDIA_BOARD_GROUP_MIN_WIDTH,
  MEDIA_BOARD_GROUP_PADDING,
  MEDIA_BOARD_NODE_ASPECT_MAX,
  MEDIA_BOARD_NODE_ASPECT_MIN,
  MEDIA_BOARD_NODE_GAP,
  MEDIA_BOARD_NODE_MAX_HEIGHT,
  MEDIA_BOARD_NODE_MAX_WIDTH,
  MEDIA_BOARD_NODE_MIN_HEIGHT,
  MEDIA_BOARD_NODE_MIN_WIDTH,
  MEDIA_BOARD_NODE_TARGET_AREA,
  MEDIA_BOARD_PAN_ZOOM_MIN,
  MEDIA_BOARD_RENDER_BUFFER_PX,
  MEDIA_BOARD_ROOT_ORDER_KEY,
  MEDIA_BOARD_ROOT_PADDING,
  MEDIA_BOARD_SLOT_CELL_HEIGHT,
  MEDIA_BOARD_SLOT_CELL_WIDTH,
} from './constants';
import type {
  MediaBoardFolderLookup,
  MediaBoardGroupLayout,
  MediaBoardGroupOffset,
  MediaBoardInsertGapPlacement,
  MediaBoardInsertionPreview,
  MediaBoardItem,
  MediaBoardLayoutResult,
  MediaBoardNodeLayout,
  MediaBoardNodePlacement,
  MediaBoardSlotPlacement,
  MediaBoardViewport,
  MediaBoardViewportSize,
  MediaBoardVisibleRect,
} from './types';

export type SortMediaBoardItems = (items: ProjectItem[]) => ProjectItem[];

export function getMediaBoardGroupName(folderId: string | null, folders: MediaBoardFolderLookup[]): string {
  if (!folderId) return 'Root';
  const path: string[] = [];
  let current = folders.find((folder) => folder.id === folderId);
  while (current) {
    path.unshift(current.name);
    current = current.parentId ? folders.find((folder) => folder.id === current!.parentId) : undefined;
  }
  return path.length ? path.join(' / ') : 'Folder';
}

export function isMediaBoardFolder(item: ProjectItem): item is MediaFolder {
  return 'isExpanded' in item;
}

export function isMediaBoardEmptySlotId(id: string): boolean {
  return id === MEDIA_BOARD_EMPTY_SLOT_ID || id.startsWith(`${MEDIA_BOARD_EMPTY_SLOT_ID}${MEDIA_BOARD_EMPTY_SLOT_SIZE_SEPARATOR}`);
}

export function normalizeMediaBoardOrderIds(ids: string[], validItemIds: Set<string>): string[] {
  const seenItemIds = new Set<string>();
  const normalized: string[] = [];

  ids.forEach((id) => {
    if (isMediaBoardEmptySlotId(id)) {
      normalized.push(MEDIA_BOARD_EMPTY_SLOT_ID);
      return;
    }

    if (!validItemIds.has(id) || seenItemIds.has(id)) return;
    seenItemIds.add(id);
    normalized.push(id);
  });

  while (normalized.length > 0 && isMediaBoardEmptySlotId(normalized[normalized.length - 1])) {
    normalized.pop();
  }

  return normalized.some((id) => !isMediaBoardEmptySlotId(id)) ? normalized : [];
}

export function getMediaBoardTypeLabel(item: MediaBoardItem): string {
  if (isMediaBoardFolder(item)) return 'Folder';
  if (item.type === 'composition') return 'Composition';
  if (item.type === 'gaussian-splat') {
    const frameCount = isImportedMediaFileItem(item)
      ? item.splatFrameCount ?? item.gaussianSplatSequence?.frameCount
      : undefined;
    return (frameCount ?? 1) > 1 ? 'Splat Seq' : 'Splat';
  }
  if (item.type === 'splat-effector') return 'Effector';
  if (item.type === 'solid') return 'Solid';
  if (item.type === 'model') return 'Model';
  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

export function getMediaBoardOrderKey(folderId: string | null): string {
  return folderId ?? MEDIA_BOARD_ROOT_ORDER_KEY;
}

export function clampMediaBoardNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getMediaBoardItemAspectRatio(item: MediaBoardItem): number {
  if (isMediaBoardFolder(item)) return 16 / 9;

  const width = 'width' in item ? Number(item.width) : undefined;
  const height = 'height' in item ? Number(item.height) : undefined;
  if (width && height && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return clampMediaBoardNumber(width / height, MEDIA_BOARD_NODE_ASPECT_MIN, MEDIA_BOARD_NODE_ASPECT_MAX);
  }

  if (item.type === 'camera' || item.type === 'model' || item.type === 'splat-effector') {
    return 1;
  }

  return 16 / 9;
}

export function getMediaBoardNodeSize(item: MediaBoardItem): { width: number; height: number } {
  const aspectRatio = getMediaBoardItemAspectRatio(item);
  let width = Math.sqrt(MEDIA_BOARD_NODE_TARGET_AREA * aspectRatio);
  let height = width / aspectRatio;
  const maxScale = Math.min(
    MEDIA_BOARD_NODE_MAX_WIDTH / width,
    MEDIA_BOARD_NODE_MAX_HEIGHT / height,
    1,
  );
  width *= maxScale;
  height *= maxScale;

  if (width < MEDIA_BOARD_NODE_MIN_WIDTH) {
    width = MEDIA_BOARD_NODE_MIN_WIDTH;
    height = width / aspectRatio;
  }
  if (height < MEDIA_BOARD_NODE_MIN_HEIGHT) {
    height = MEDIA_BOARD_NODE_MIN_HEIGHT;
    width = height * aspectRatio;
  }
  if (width > MEDIA_BOARD_NODE_MAX_WIDTH) {
    width = MEDIA_BOARD_NODE_MAX_WIDTH;
    height = width / aspectRatio;
  }
  if (height > MEDIA_BOARD_NODE_MAX_HEIGHT) {
    height = MEDIA_BOARD_NODE_MAX_HEIGHT;
    width = height * aspectRatio;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function getMediaBoardGroupChrome(groupId: string | null): { headerHeight: number; padding: number } {
  return groupId === null
    ? { headerHeight: 0, padding: MEDIA_BOARD_ROOT_PADDING }
    : { headerHeight: MEDIA_BOARD_GROUP_HEADER_HEIGHT, padding: MEDIA_BOARD_GROUP_PADDING };
}

export function getMediaBoardVisibleRect(
  viewport: MediaBoardViewport,
  viewportSize: MediaBoardViewportSize,
): MediaBoardVisibleRect {
  const zoom = Math.max(viewport.zoom, MEDIA_BOARD_PAN_ZOOM_MIN);
  const buffer = zoom <= MEDIA_BOARD_COMPACT_LOD_ZOOM
    ? MEDIA_BOARD_COMPACT_RENDER_BUFFER_PX
    : MEDIA_BOARD_RENDER_BUFFER_PX;

  return {
    left: (-viewport.panX - buffer) / zoom,
    top: (-viewport.panY - buffer) / zoom,
    right: (viewportSize.width - viewport.panX + buffer) / zoom,
    bottom: (viewportSize.height - viewport.panY + buffer) / zoom,
  };
}

function hashMediaBoardSignature(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createMediaBoardLayoutSignature(
  items: MediaBoardItem[],
  layouts: Record<string, MediaBoardGroupOffset>,
): string {
  const itemPayload = items.map((item) => [
    item.id,
    item.parentId ?? '',
    isMediaBoardFolder(item) ? 'folder' : item.type,
    'width' in item ? item.width ?? 0 : 0,
    'height' in item ? item.height ?? 0 : 0,
  ]);
  const layoutPayload = Object.keys(layouts)
    .sort()
    .map((id) => [
      id,
      Math.round((layouts[id]?.x ?? 0) * 100) / 100,
      Math.round((layouts[id]?.y ?? 0) * 100) / 100,
    ]);

  return `${BOARD_LAYOUT_SNAPSHOT_VERSION}:${hashMediaBoardSignature(JSON.stringify([itemPayload, layoutPayload]))}`;
}

export function restoreMediaBoardLayoutItems(
  layout: MediaBoardLayoutResult,
  itemsById: Map<string, MediaBoardItem>,
  folders: MediaFolder[],
): MediaBoardLayoutResult {
  const placements = layout.placements
    .map((placement) => {
      const item = itemsById.get(placement.item.id);
      return item ? { ...placement, item } : null;
    })
    .filter((placement): placement is MediaBoardNodePlacement => placement !== null);

  return {
    groups: layout.groups.map((group) => ({
      ...group,
      name: getMediaBoardGroupName(group.id, folders),
    })),
    placements,
    insertGaps: layout.insertGaps,
    slots: layout.slots,
  };
}

export function waitForMediaBoardThumbnailTurn(): Promise<void> {
  return new Promise((resolve) => {
    const requestIdle = typeof window === 'undefined' ? undefined : window.requestIdleCallback;
    if (typeof requestIdle === 'function') {
      requestIdle(() => resolve(), { timeout: 120 });
      return;
    }

    globalThis.setTimeout(resolve, 8);
  });
}

export function mediaBoardNodeIntersectsVisibleRect(
  layout: MediaBoardNodeLayout,
  visibleRect: MediaBoardVisibleRect,
): boolean {
  return (
    layout.x < visibleRect.right
    && layout.x + layout.width > visibleRect.left
    && layout.y < visibleRect.bottom
    && layout.y + layout.height > visibleRect.top
  );
}

export function mediaBoardGroupIntersectsVisibleRect(
  group: MediaBoardGroupLayout,
  visibleRect: MediaBoardVisibleRect,
): boolean {
  return (
    group.x < visibleRect.right
    && group.x + group.width > visibleRect.left
    && group.y < visibleRect.bottom
    && group.y + group.height > visibleRect.top
  );
}

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

type MediaBoardLayoutEntry = {
  id: string;
  item?: MediaBoardItem;
  width: number;
  height: number;
  desiredX: number;
  desiredY: number;
  isInsertGap: boolean;
  isEmptySlot?: boolean;
  offsetX?: number;
  offsetY?: number;
  resolvedSlotIndex?: number;
};

type MediaBoardLayoutRow = {
  entries: MediaBoardLayoutEntry[];
  width: number;
  height: number;
};

type MediaBoardGroupMeasure = {
  width: number;
  height: number;
  itemRows: MediaBoardLayoutRow[];
  itemCount: number;
  bodyHeight: number;
};

export function buildMediaBoardLayoutGeometry({
  mediaBoardItems,
  folders,
  mediaBoardLayouts,
  mediaBoardInsertionPreview,
}: {
  mediaBoardItems: MediaBoardItem[];
  folders: MediaFolder[];
  mediaBoardLayouts: Record<string, MediaBoardGroupOffset>;
  mediaBoardInsertionPreview: MediaBoardInsertionPreview | null;
}): MediaBoardLayoutResult {
  const itemsById = new Map(mediaBoardItems.map((item) => [item.id, item]));
  const groupsByParent = new Map<string | null, MediaBoardItem[]>();
  groupsByParent.set(null, []);
  folders.forEach((folder) => groupsByParent.set(folder.id, []));
  const foldersByParent = new Map<string | null, MediaFolder[]>();
  foldersByParent.set(null, []);
  folders.forEach((folder) => {
    const parentId = folder.parentId ?? null;
    if (!foldersByParent.has(parentId)) {
      foldersByParent.set(parentId, []);
    }
    foldersByParent.get(parentId)!.push(folder);
  });
  const movingIdSet = new Set(mediaBoardInsertionPreview?.movingIds ?? []);

  mediaBoardItems.forEach((item) => {
    if (isMediaBoardFolder(item)) return;
    const parentId = item.parentId ?? null;
    if (!groupsByParent.has(parentId)) {
      groupsByParent.set(parentId, []);
    }
    groupsByParent.get(parentId)!.push(item);
  });

  const groups: MediaBoardGroupLayout[] = [];
  const placements: MediaBoardNodePlacement[] = [];
  const insertGaps: MediaBoardInsertGapPlacement[] = [];
  const slots: MediaBoardSlotPlacement[] = [];

  const getDirectBoardItems = (groupId: string | null): MediaBoardItem[] => [
    ...(groupsByParent.get(groupId) ?? []),
    ...(foldersByParent.get(groupId) ?? []),
  ];

  function getLayoutSizeForItem(item: MediaBoardItem, stack: Set<string>): { width: number; height: number } {
    if (!isMediaBoardFolder(item)) {
      return getMediaBoardNodeSize(item);
    }

    if (stack.has(item.id)) {
      return {
        width: MEDIA_BOARD_GROUP_MIN_WIDTH,
        height: MEDIA_BOARD_GROUP_HEADER_HEIGHT + (MEDIA_BOARD_GROUP_PADDING * 2) + MEDIA_BOARD_NODE_MIN_HEIGHT,
      };
    }

    const measure = measureGroup(item.id, stack);
    return { width: measure.width, height: measure.height };
  }

  const getEntriesForGroup = (groupId: string | null, stack: Set<string>): MediaBoardLayoutEntry[] => {
    const columnPitch = MEDIA_BOARD_SLOT_CELL_WIDTH;
    const entries: MediaBoardLayoutEntry[] = [];

    getDirectBoardItems(groupId).forEach((item) => {
      if (movingIdSet.has(item.id)) return;
      const position = mediaBoardLayouts[item.id];
      if (!position) return;
      entries.push({
        id: item.id,
        item,
        ...getLayoutSizeForItem(item, stack),
        desiredX: position.x,
        desiredY: position.y,
        isInsertGap: false,
      });
    });

    if (mediaBoardInsertionPreview?.targetGroupId === groupId) {
      mediaBoardInsertionPreview.movingIds.forEach((id, index) => {
        const item = itemsById.get(id);
        if (!item) return;
        entries.push({
          id: `insert-gap-${id}-${index}`,
          ...getLayoutSizeForItem(item, stack),
          desiredX: mediaBoardInsertionPreview.targetPosition.x + (index * columnPitch),
          desiredY: mediaBoardInsertionPreview.targetPosition.y,
          isInsertGap: true,
        });
      });
    }

    return entries;
  };

  function placeEntriesOnGrid<T extends MediaBoardLayoutEntry>(
    entries: T[],
    maxBodyWidth: number,
    allowNegativePositions: boolean,
  ): Array<{ entries: T[]; width: number; height: number }> {
    const columnPitch = MEDIA_BOARD_SLOT_CELL_WIDTH;
    const rowPitch = MEDIA_BOARD_SLOT_CELL_HEIGHT;
    const occupied = new Set<string>();
    const rowsByIndex = new Map<number, Array<T & Required<Pick<MediaBoardLayoutEntry, 'offsetX' | 'offsetY' | 'resolvedSlotIndex'>>>>();

    const getSpan = (entry: T) => ({
      columns: Math.max(1, Math.ceil((entry.width + MEDIA_BOARD_NODE_GAP) / columnPitch)),
      rows: Math.max(1, Math.ceil((entry.height + MEDIA_BOARD_NODE_GAP) / rowPitch)),
    });
    const columnCount = Math.max(
      1,
      Math.floor(maxBodyWidth / columnPitch),
      ...entries.map((entry) => Math.max(0, Math.round(entry.desiredX / columnPitch)) + getSpan(entry).columns),
    );

    const canPlace = (column: number, row: number, span: { columns: number; rows: number }) => {
      if (!allowNegativePositions && (column < 0 || row < 0)) return false;
      if (column + span.columns > columnCount) return false;
      for (let y = row; y < row + span.rows; y += 1) {
        for (let x = column; x < column + span.columns; x += 1) {
          if (occupied.has(`${x}:${y}`)) return false;
        }
      }
      return true;
    };

    const markOccupied = (column: number, row: number, span: { columns: number; rows: number }) => {
      for (let y = row; y < row + span.rows; y += 1) {
        for (let x = column; x < column + span.columns; x += 1) {
          occupied.add(`${x}:${y}`);
        }
      }
    };

    entries.forEach((entry) => {
      const span = getSpan(entry);
      const initialColumn = allowNegativePositions
        ? Math.round(entry.desiredX / columnPitch)
        : Math.max(0, Math.round(entry.desiredX / columnPitch));
      const initialRow = allowNegativePositions
        ? Math.round(entry.desiredY / rowPitch)
        : Math.max(0, Math.round(entry.desiredY / rowPitch));
      let column = initialColumn;
      let row = initialRow;
      while (!canPlace(column, row, span)) {
        column += 1;
        if (column + span.columns > columnCount) {
          row += 1;
          column = allowNegativePositions ? initialColumn : 0;
        }
      }
      markOccupied(column, row, span);

      const placedEntry = {
        ...entry,
        offsetX: column * columnPitch,
        offsetY: row * rowPitch,
        resolvedSlotIndex: (row * 100000) + column,
      };
      const rowEntries = rowsByIndex.get(row) ?? [];
      rowEntries.push(placedEntry);
      rowsByIndex.set(row, rowEntries);
    });

    return [...rowsByIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, rowEntries]) => ({
        entries: rowEntries.sort((a, b) => (a.offsetX - b.offsetX) || (a.resolvedSlotIndex - b.resolvedSlotIndex)),
        width: Math.max(0, ...rowEntries.map((entry) => entry.offsetX + entry.width)),
        height: Math.max(0, ...rowEntries.map((entry) => entry.offsetY + entry.height)),
      }));
  }

  const measureCache = new Map<string, MediaBoardGroupMeasure>();
  function measureGroup(groupId: string | null, stack: Set<string> = new Set()): MediaBoardGroupMeasure {
    const cacheKey = getMediaBoardOrderKey(groupId);
    const cached = measureCache.get(cacheKey);
    if (cached) return cached;

    if (groupId && stack.has(groupId)) {
      return {
        width: MEDIA_BOARD_GROUP_MIN_WIDTH,
        height: MEDIA_BOARD_GROUP_HEADER_HEIGHT + (MEDIA_BOARD_GROUP_PADDING * 2) + MEDIA_BOARD_EMPTY_FOLDER_BODY_MIN_HEIGHT,
        itemRows: [],
        itemCount: 0,
        bodyHeight: MEDIA_BOARD_EMPTY_FOLDER_BODY_MIN_HEIGHT,
      };
    }

    const nextStack = new Set(stack);
    if (groupId) {
      nextStack.add(groupId);
    }

    const maxBodyWidth = groupId === null ? MEDIA_BOARD_FOLDER_ROW_MAX_WIDTH : MEDIA_BOARD_GROUP_MAX_BODY_WIDTH;
    const itemRows = placeEntriesOnGrid(getEntriesForGroup(groupId, nextStack), maxBodyWidth, groupId === null) as MediaBoardLayoutRow[];
    const hasItems = itemRows.length > 0;
    const bodyWidth = Math.max(0, ...itemRows.map((row) => row.width));
    const bodyHeight = hasItems ? Math.max(0, ...itemRows.map((row) => row.height)) : MEDIA_BOARD_EMPTY_FOLDER_BODY_MIN_HEIGHT;
    const chrome = getMediaBoardGroupChrome(groupId);
    const minWidth = groupId === null ? Math.max(MEDIA_BOARD_GROUP_MAX_BODY_WIDTH, bodyWidth) : MEDIA_BOARD_GROUP_MIN_WIDTH;
    const measure: MediaBoardGroupMeasure = {
      width: Math.max(minWidth, Math.ceil(bodyWidth + (chrome.padding * 2))),
      height: chrome.headerHeight + (chrome.padding * 2) + bodyHeight,
      itemRows,
      itemCount: getDirectBoardItems(groupId).length,
      bodyHeight,
    };
    measureCache.set(cacheKey, measure);
    return measure;
  }

  const placeGroup = (
    groupId: string | null,
    x: number,
    y: number,
    depth: number,
    parentId: string | null,
    options?: { draggingPreview?: boolean },
  ) => {
    const measure = measureGroup(groupId);
    const group: MediaBoardGroupLayout = {
      id: groupId,
      parentId,
      name: getMediaBoardGroupName(groupId, folders),
      x,
      y,
      width: measure.width,
      height: measure.height,
      itemCount: measure.itemCount,
      depth,
      isDraggingPreview: options?.draggingPreview,
    };
    groups.push(group);

    const chrome = getMediaBoardGroupChrome(groupId);
    const entryOriginX = x + chrome.padding;
    const entryOriginY = y + chrome.headerHeight + chrome.padding;
    measure.itemRows.forEach((layoutRow) => {
      layoutRow.entries.forEach((entry) => {
        const entryOffsetX = entry.offsetX ?? 0;
        const entryOffsetY = entry.offsetY ?? 0;
        const entrySlotIndex = entry.resolvedSlotIndex ?? 0;
        const layout: MediaBoardNodeLayout = {
          x: entryOriginX + entryOffsetX,
          y: entryOriginY + entryOffsetY,
          width: entry.width,
          height: entry.height,
        };

        if (!entry.isInsertGap) {
          slots.push({
            id: entry.isEmptySlot ? entry.id : entry.item?.id ?? entry.id,
            itemId: entry.item?.id,
            layout,
            groupId,
            slotIndex: entrySlotIndex,
            isEmptySlot: entry.isEmptySlot,
          });
        }

        if (entry.isInsertGap) {
          insertGaps.push({
            id: entry.id,
            layout,
            groupId,
            slotIndex: entrySlotIndex,
          });
        } else if (entry.item) {
          placements.push({
            item: entry.item,
            defaultLayout: layout,
            groupId,
            isDraggingPreview: options?.draggingPreview,
            layout,
            slotIndex: entrySlotIndex,
          });

          if (isMediaBoardFolder(entry.item)) {
            placeGroup(
              entry.item.id,
              layout.x,
              layout.y,
              depth + 1,
              groupId,
              { draggingPreview: options?.draggingPreview },
            );
          }
        }
      });
    });
  };

  placeGroup(null, 0, 0, 0, null);

  const groupsByKey = new Map(groups.map((group) => [getMediaBoardOrderKey(group.id), group]));
  [...groups]
    .sort((a, b) => b.depth - a.depth)
    .forEach((group) => {
      if (group.parentId === null && group.id !== null) {
        const parent = groupsByKey.get(MEDIA_BOARD_ROOT_ORDER_KEY);
        if (!parent) return;
        parent.width = Math.max(parent.width, Math.ceil(group.x + group.width - parent.x + MEDIA_BOARD_GROUP_PADDING));
        parent.height = Math.max(parent.height, Math.ceil(group.y + group.height - parent.y + MEDIA_BOARD_GROUP_PADDING));
        return;
      }
      if (!group.parentId) return;
      const parent = groupsByKey.get(group.parentId);
      if (!parent) return;
      parent.width = Math.max(parent.width, Math.ceil(group.x + group.width - parent.x + MEDIA_BOARD_GROUP_PADDING));
      parent.height = Math.max(parent.height, Math.ceil(group.y + group.height - parent.y + MEDIA_BOARD_GROUP_PADDING));
    });

  if (mediaBoardInsertionPreview) {
    mediaBoardInsertionPreview.movingIds.forEach((id, index) => {
      const item = itemsById.get(id);
      const sourceLayout = mediaBoardInsertionPreview.sourceLayouts[id];
      if (!item || !sourceLayout) return;
      placements.push({
        item,
        defaultLayout: sourceLayout,
        groupId: item.parentId ?? null,
        isDraggingPreview: true,
        layout: sourceLayout,
        slotIndex: index,
      });
      if (isMediaBoardFolder(item)) {
        placeGroup(item.id, sourceLayout.x, sourceLayout.y, 1, item.parentId ?? null, {
          draggingPreview: true,
        });
      }
    });
  }

  return { groups, placements, insertGaps, slots };
}
