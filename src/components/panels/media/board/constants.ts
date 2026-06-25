import type { MediaBoardRenderLod, MediaBoardViewport } from './types';

export const BOARD_VIEWPORT_STORAGE_KEY = 'media-panel-board-viewport';
export const BOARD_ORDER_STORAGE_KEY = 'media-panel-board-order';
export const BOARD_GROUP_OFFSETS_STORAGE_KEY = 'media-panel-board-group-offsets';
export const BOARD_LAYOUTS_STORAGE_KEY = 'media-panel-board-layouts';
export const BOARD_LAYOUT_SNAPSHOT_STORAGE_KEY = 'media-panel-board-layout-snapshot';
export const BOARD_LAYOUT_SNAPSHOT_VERSION = 1;

export const MEDIA_BOARD_ROOT_ORDER_KEY = '__root__';
export const MEDIA_BOARD_EMPTY_SLOT_ID = '__media_board_empty_slot__';
export const MEDIA_BOARD_EMPTY_SLOT_SIZE_SEPARATOR = ':';

export const DEFAULT_BOARD_VIEWPORT: MediaBoardViewport = { zoom: 0.82, panX: 32, panY: 28 };
export const MEDIA_BOARD_NODE_TARGET_AREA = 20500;
export const MEDIA_BOARD_NODE_MIN_WIDTH = 86;
export const MEDIA_BOARD_NODE_MAX_WIDTH = 212;
export const MEDIA_BOARD_NODE_MIN_HEIGHT = 72;
export const MEDIA_BOARD_NODE_MAX_HEIGHT = 190;
export const MEDIA_BOARD_NODE_ASPECT_MIN = 0.45;
export const MEDIA_BOARD_NODE_ASPECT_MAX = 2.75;
export const MEDIA_BOARD_NODE_GAP = 14;
export const MEDIA_BOARD_GROUP_HEADER_HEIGHT = 42;
export const MEDIA_BOARD_GROUP_PADDING = 18;
export const MEDIA_BOARD_GROUP_MIN_WIDTH = 260;
export const MEDIA_BOARD_GROUP_MAX_BODY_WIDTH = 700;
export const MEDIA_BOARD_FOLDER_ROW_MAX_WIDTH = 1480;
export const MEDIA_BOARD_EMPTY_FOLDER_BODY_MIN_HEIGHT = 128;
export const MEDIA_BOARD_EMPTY_SLOT_WIDTH = 192;
export const MEDIA_BOARD_EMPTY_SLOT_HEIGHT = 108;
export const MEDIA_BOARD_SLOT_CELL_WIDTH = 32;
export const MEDIA_BOARD_SLOT_CELL_HEIGHT = 32;
export const MEDIA_BOARD_ROOT_PADDING = 0;
export const MEDIA_BOARD_PAN_ZOOM_MIN = 0.06;
export const MEDIA_BOARD_PAN_ZOOM_MAX = 64;
export const MEDIA_BOARD_DRAG_START_DISTANCE = 4;
export const MEDIA_BOARD_GRID_PARALLAX = 0.18;
export const MEDIA_BOARD_AUTOPAN_EDGE_PX = 72;
export const MEDIA_BOARD_AUTOPAN_MAX_SPEED = 620;
export const MEDIA_BOARD_TIMELINE_HANDOFF_DISTANCE_PX = 96;
export const MEDIA_BOARD_RENDER_BUFFER_PX = 420;
export const MEDIA_BOARD_COMPACT_RENDER_BUFFER_PX = 220;
export const MEDIA_BOARD_COMPACT_LOD_ZOOM = 0.22;
export const MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM = 0.34;
export const MEDIA_BOARD_THUMBNAIL_LOD_MIN_ZOOM = MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM;
export const MEDIA_BOARD_THUMBNAIL_REQUEST_MIN_ZOOM = MEDIA_BOARD_PAN_ZOOM_MIN;
export const MEDIA_BOARD_THUMBNAIL_REQUEST_LIMIT = 180;
export const MEDIA_BOARD_OVERVIEW_THUMBNAIL_REQUEST_LIMIT = 64;
export const MEDIA_BOARD_THUMBNAIL_WORKER_COUNT = 2;
export const MEDIA_BOARD_VIDEO_POSTER_FALLBACK_LIMIT = 16;
export const MEDIA_BOARD_ORIGINAL_FOCUS_ZOOM = 4;
export const MEDIA_BOARD_ORIGINAL_FOCUS_MARGIN_RATIO = 0.35;
export const MEDIA_BOARD_UI_SCALE_CAP_ZOOM = 2.5;
const MEDIA_BOARD_LOD_HYSTERESIS = 0.025;

function isBelowLodThreshold(zoom: number, threshold: number, wasActive?: boolean): boolean {
  if (wasActive === undefined) return zoom <= threshold;
  return wasActive
    ? zoom <= threshold + MEDIA_BOARD_LOD_HYSTERESIS
    : zoom <= threshold - MEDIA_BOARD_LOD_HYSTERESIS;
}

export function getMediaBoardRenderLod(
  zoom: number,
  previous?: MediaBoardRenderLod,
): MediaBoardRenderLod {
  const overviewCanvas = isBelowLodThreshold(
    zoom,
    MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM,
    previous?.overviewCanvas,
  );
  return {
    overviewCanvas,
    compact: isBelowLodThreshold(zoom, MEDIA_BOARD_COMPACT_LOD_ZOOM, previous?.compact),
    showImages: !overviewCanvas,
    requestThumbnails: zoom >= MEDIA_BOARD_THUMBNAIL_REQUEST_MIN_ZOOM,
  };
}

export function getMediaBoardUiScale(zoom: number): number {
  return Math.min(1, MEDIA_BOARD_UI_SCALE_CAP_ZOOM / Math.max(zoom, MEDIA_BOARD_PAN_ZOOM_MIN));
}

// Background grid base cell size in CSS px (at zoom = 1).
export const MEDIA_BOARD_GRID_BASE_SIZE = 32;
// How much the grid follows the canvas zoom. < 1 means the grid scales SLOWER
// than the board content, giving a subtle parallax/depth effect (#188).
export const MEDIA_BOARD_GRID_ZOOM_PARALLAX = 0.35;

/**
 * Grid cell size for the current zoom. The grid scales with zoom but at a
 * reduced rate, and is clamped so it always stays comfortably visible across
 * the full zoom range instead of collapsing into a dense haze or vanishing.
 */
export function getMediaBoardGridSize(zoom: number): number {
  const scaled = MEDIA_BOARD_GRID_BASE_SIZE * (1 + (zoom - 1) * MEDIA_BOARD_GRID_ZOOM_PARALLAX);
  return Math.min(96, Math.max(14, scaled));
}
