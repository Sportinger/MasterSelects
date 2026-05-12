import type { MediaFolder } from '../../../../stores/mediaStore';
import {
  BOARD_GROUP_OFFSETS_STORAGE_KEY,
  BOARD_LAYOUT_SNAPSHOT_STORAGE_KEY,
  BOARD_LAYOUT_SNAPSHOT_VERSION,
  BOARD_LAYOUTS_STORAGE_KEY,
  BOARD_ORDER_STORAGE_KEY,
  BOARD_VIEWPORT_STORAGE_KEY,
  DEFAULT_BOARD_VIEWPORT,
  MEDIA_BOARD_PAN_ZOOM_MAX,
  MEDIA_BOARD_PAN_ZOOM_MIN,
  MEDIA_BOARD_ROOT_ORDER_KEY,
} from './constants';
import { restoreMediaBoardLayoutItems } from './layout';
import type {
  MediaBoardGroupOffset,
  MediaBoardLayoutResult,
  MediaBoardLayoutSnapshot,
  MediaBoardNodePlacement,
  MediaBoardViewport,
  MediaBoardItem,
} from './types';

export function loadMediaBoardViewport(): MediaBoardViewport {
  try {
    const stored = localStorage.getItem(BOARD_VIEWPORT_STORAGE_KEY);
    if (!stored) return DEFAULT_BOARD_VIEWPORT;
    const parsed = JSON.parse(stored) as Partial<MediaBoardViewport>;
    const zoom = Number(parsed.zoom);
    const panX = Number(parsed.panX);
    const panY = Number(parsed.panY);
    if (!Number.isFinite(zoom) || !Number.isFinite(panX) || !Number.isFinite(panY)) {
      return DEFAULT_BOARD_VIEWPORT;
    }
    return {
      zoom: Math.min(MEDIA_BOARD_PAN_ZOOM_MAX, Math.max(MEDIA_BOARD_PAN_ZOOM_MIN, zoom)),
      panX,
      panY,
    };
  } catch {
    return DEFAULT_BOARD_VIEWPORT;
  }
}

export function loadMediaBoardOrder(): Record<string, string[]> {
  try {
    const stored = localStorage.getItem(BOARD_ORDER_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, string[]>;
    if (!parsed || typeof parsed !== 'object') return {};
    const valid: Record<string, string[]> = {};
    Object.entries(parsed).forEach(([folderKey, ids]) => {
      if (!folderKey || !Array.isArray(ids)) return;
      const uniqueIds = ids.filter((id, index) => typeof id === 'string' && id.length > 0 && ids.indexOf(id) === index);
      if (uniqueIds.length > 0) {
        valid[folderKey] = uniqueIds;
      }
    });
    return valid;
  } catch {
    return {};
  }
}

export function loadMediaBoardGroupOffsets(): Record<string, MediaBoardGroupOffset> {
  try {
    const stored = localStorage.getItem(BOARD_GROUP_OFFSETS_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, Partial<MediaBoardGroupOffset>>;
    if (!parsed || typeof parsed !== 'object') return {};

    const valid: Record<string, MediaBoardGroupOffset> = {};
    Object.entries(parsed).forEach(([folderId, offset]) => {
      if (!folderId || folderId === MEDIA_BOARD_ROOT_ORDER_KEY || !offset || typeof offset !== 'object') return;
      const x = Number(offset.x);
      const y = Number(offset.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) return;
      valid[folderId] = { x, y };
    });
    return valid;
  } catch {
    return {};
  }
}

export function loadMediaBoardLayouts(): Record<string, MediaBoardGroupOffset> {
  try {
    const stored = localStorage.getItem(BOARD_LAYOUTS_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, Partial<MediaBoardGroupOffset>>;
    if (!parsed || typeof parsed !== 'object') return {};

    const valid: Record<string, MediaBoardGroupOffset> = {};
    Object.entries(parsed).forEach(([itemId, layout]) => {
      if (!itemId || !layout || typeof layout !== 'object') return;
      const x = Number(layout.x);
      const y = Number(layout.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      valid[itemId] = { x, y };
    });
    return valid;
  } catch {
    return {};
  }
}

export function loadMediaBoardLayoutSnapshot(
  signature: string,
  itemsById: Map<string, MediaBoardItem>,
  folders: MediaFolder[],
): MediaBoardLayoutResult | null {
  try {
    const stored = localStorage.getItem(BOARD_LAYOUT_SNAPSHOT_STORAGE_KEY);
    if (!stored) return null;

    const snapshot = JSON.parse(stored) as Partial<MediaBoardLayoutSnapshot>;
    if (
      snapshot.version !== BOARD_LAYOUT_SNAPSHOT_VERSION
      || snapshot.signature !== signature
      || !Array.isArray(snapshot.groups)
      || !Array.isArray(snapshot.placements)
      || !Array.isArray(snapshot.insertGaps)
      || !Array.isArray(snapshot.slots)
    ) {
      return null;
    }

    const placements = snapshot.placements
      .map((placement): MediaBoardNodePlacement | null => {
        if (!placement || typeof placement.itemId !== 'string') return null;
        const item = itemsById.get(placement.itemId);
        if (!item || !placement.layout || !placement.defaultLayout) return null;
        return {
          item,
          layout: placement.layout,
          defaultLayout: placement.defaultLayout,
          groupId: placement.groupId ?? null,
          slotIndex: Number(placement.slotIndex) || 0,
          isDraggingPreview: placement.isDraggingPreview,
        };
      })
      .filter((placement): placement is MediaBoardNodePlacement => placement !== null);

    if (placements.length !== snapshot.placements.length) return null;

    return restoreMediaBoardLayoutItems({
      groups: snapshot.groups,
      placements,
      insertGaps: snapshot.insertGaps,
      slots: snapshot.slots,
    }, itemsById, folders);
  } catch {
    return null;
  }
}

export function saveMediaBoardLayoutSnapshot(signature: string, layout: MediaBoardLayoutResult) {
  try {
    const snapshot: MediaBoardLayoutSnapshot = {
      version: BOARD_LAYOUT_SNAPSHOT_VERSION,
      signature,
      groups: layout.groups.map((group) => ({ ...group, isDraggingPreview: undefined })),
      placements: layout.placements.map((placement) => ({
        itemId: placement.item.id,
        layout: placement.layout,
        defaultLayout: placement.defaultLayout,
        groupId: placement.groupId,
        slotIndex: placement.slotIndex,
        isDraggingPreview: undefined,
      })),
      insertGaps: layout.insertGaps,
      slots: layout.slots,
    };
    localStorage.setItem(BOARD_LAYOUT_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Snapshot cache is an optimization only.
  }
}

export function saveMediaBoardViewport(viewport: MediaBoardViewport) {
  localStorage.setItem(BOARD_VIEWPORT_STORAGE_KEY, JSON.stringify(viewport));
}

export function saveMediaBoardOrder(order: Record<string, string[]>) {
  localStorage.setItem(BOARD_ORDER_STORAGE_KEY, JSON.stringify(order));
}

export function saveMediaBoardGroupOffsets(offsets: Record<string, MediaBoardGroupOffset>) {
  localStorage.setItem(BOARD_GROUP_OFFSETS_STORAGE_KEY, JSON.stringify(offsets));
}

export function saveMediaBoardLayouts(layouts: Record<string, MediaBoardGroupOffset>) {
  localStorage.setItem(BOARD_LAYOUTS_STORAGE_KEY, JSON.stringify(layouts));
}
