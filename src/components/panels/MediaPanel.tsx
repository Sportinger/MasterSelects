// Media Panel - Project browser like After Effects

import React, { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react';
import { Logger } from '../../services/logger';
import { FileTypeIcon } from './media/FileTypeIcon';
import { LABEL_COLORS, getLabelHex } from './media/labelColors';
import { CompositionSettingsDialog } from './media/CompositionSettingsDialog';
import { SolidSettingsDialog } from './media/SolidSettingsDialog';
import { LabelColorPicker } from './media/LabelColorPicker';
import { getItemImportProgress, isImportedMediaFileItem } from './media/itemTypeGuards';
import { handleSubmenuHover, handleSubmenuLeave } from './media/submenuPosition';
import { collectDroppedMediaFiles, planDroppedMediaImports } from './media/dropImport';
import { isProxyFrameCountComplete } from '../../stores/mediaStore/helpers/proxyCompleteness';

const log = Logger.create('MediaPanel');
import { useMediaStore } from '../../stores/mediaStore';
import type { MediaFile, Composition, ProjectItem, TextItem, SolidItem, CameraItem, MediaFolder } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useDockStore } from '../../stores/dockStore';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { RelinkDialog } from '../common/RelinkDialog';
import { mediaNeedsRelink } from '../../services/project/relinkMedia';
import {
  clearExternalDragPayload,
  dispatchExternalDragBridgeEvent,
  setExternalDragPayload,
  type ExternalDragPayload,
} from '../timeline/utils/externalDragSession';

// Column definitions
type ColumnId = 'label' | 'name' | 'duration' | 'resolution' | 'fps' | 'container' | 'codec' | 'audio' | 'bitrate' | 'size';
type MediaPanelViewMode = 'classic' | 'icons' | 'board';
type MediaBoardItem = ProjectItem;

const CLASSIC_ROW_HEIGHT = 20;
const CLASSIC_OVERSCAN_ROWS = 12;

interface ClassicListRow {
  item: ProjectItem;
  depth: number;
}

interface MediaBoardViewport {
  zoom: number;
  panX: number;
  panY: number;
}

interface MediaBoardViewportSize {
  width: number;
  height: number;
}

interface MediaBoardVisibleRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface MediaBoardGroupOffset {
  x: number;
  y: number;
}

interface MediaBoardNodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MediaBoardGroupLayout {
  id: string | null;
  parentId: string | null;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  itemCount: number;
  depth: number;
  isDraggingPreview?: boolean;
}

interface MediaBoardNodePlacement {
  item: MediaBoardItem;
  layout: MediaBoardNodeLayout;
  defaultLayout: MediaBoardNodeLayout;
  groupId: string | null;
  slotIndex: number;
  isDraggingPreview?: boolean;
}

interface MediaBoardInsertGapPlacement {
  id: string;
  layout: MediaBoardNodeLayout;
  groupId: string | null;
  slotIndex: number;
}

interface MediaBoardSlotPlacement {
  id: string;
  layout: MediaBoardNodeLayout;
  groupId: string | null;
  slotIndex: number;
  itemId?: string;
  isEmptySlot?: boolean;
}

interface MediaBoardMarquee {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface MediaBoardInsertionPreview {
  movingIds: string[];
  targetGroupId: string | null;
  targetPosition: MediaBoardGroupOffset;
  sourceLayouts: Record<string, MediaBoardNodeLayout>;
}

type MediaPanelContextMenu = {
  x: number;
  y: number;
  itemId?: string;
  parentId?: string | null;
};

const COLUMN_LABELS_MAP: Record<ColumnId, string> = {
  label: '●',
  name: 'Name',
  duration: 'Duration',
  resolution: 'Resolution',
  fps: 'FPS',
  container: 'Container',
  codec: 'Codec',
  audio: 'Audio',
  bitrate: 'Bitrate',
  size: 'Size',
};

const DEFAULT_COLUMN_ORDER: ColumnId[] = ['name', 'label', 'duration', 'resolution', 'fps', 'container', 'codec', 'audio', 'bitrate', 'size'];
const STORAGE_KEY = 'media-panel-column-order';
const VIEW_MODE_STORAGE_KEY = 'media-panel-view-mode';
const BOARD_VIEWPORT_STORAGE_KEY = 'media-panel-board-viewport';
const BOARD_ORDER_STORAGE_KEY = 'media-panel-board-order';
const BOARD_GROUP_OFFSETS_STORAGE_KEY = 'media-panel-board-group-offsets';
const BOARD_LAYOUTS_STORAGE_KEY = 'media-panel-board-layouts';
const MEDIA_PANEL_PROJECT_UI_LOADED_EVENT = 'media-panel-project-ui-loaded';
const MEDIA_BOARD_ROOT_ORDER_KEY = '__root__';
const MEDIA_BOARD_EMPTY_SLOT_ID = '__media_board_empty_slot__';
const MEDIA_BOARD_EMPTY_SLOT_SIZE_SEPARATOR = ':';

const DEFAULT_BOARD_VIEWPORT: MediaBoardViewport = { zoom: 0.82, panX: 32, panY: 28 };
const MEDIA_BOARD_NODE_TARGET_AREA = 20500;
const MEDIA_BOARD_NODE_MIN_WIDTH = 86;
const MEDIA_BOARD_NODE_MAX_WIDTH = 212;
const MEDIA_BOARD_NODE_MIN_HEIGHT = 72;
const MEDIA_BOARD_NODE_MAX_HEIGHT = 190;
const MEDIA_BOARD_NODE_ASPECT_MIN = 0.45;
const MEDIA_BOARD_NODE_ASPECT_MAX = 2.75;
const MEDIA_BOARD_NODE_GAP = 14;
const MEDIA_BOARD_GROUP_HEADER_HEIGHT = 42;
const MEDIA_BOARD_GROUP_PADDING = 18;
const MEDIA_BOARD_GROUP_MIN_WIDTH = 260;
const MEDIA_BOARD_GROUP_MAX_BODY_WIDTH = 700;
const MEDIA_BOARD_FOLDER_ROW_MAX_WIDTH = 1480;
const MEDIA_BOARD_EMPTY_FOLDER_BODY_MIN_HEIGHT = 128;
const MEDIA_BOARD_EMPTY_SLOT_WIDTH = 192;
const MEDIA_BOARD_EMPTY_SLOT_HEIGHT = 108;
const MEDIA_BOARD_SLOT_CELL_WIDTH = 32;
const MEDIA_BOARD_SLOT_CELL_HEIGHT = 32;
const MEDIA_BOARD_ROOT_PADDING = 0;
const MEDIA_BOARD_PAN_ZOOM_MIN = 0.18;
const MEDIA_BOARD_PAN_ZOOM_MAX = 2.4;
const MEDIA_BOARD_DRAG_START_DISTANCE = 4;
const MEDIA_BOARD_GRID_PARALLAX = 0.18;
const MEDIA_BOARD_AUTOPAN_EDGE_PX = 72;
const MEDIA_BOARD_AUTOPAN_MAX_SPEED = 620;
const MEDIA_BOARD_TIMELINE_HANDOFF_DISTANCE_PX = 96;
const MEDIA_BOARD_RENDER_BUFFER_PX = 420;
const MEDIA_BOARD_COMPACT_RENDER_BUFFER_PX = 220;
const MEDIA_BOARD_COMPACT_LOD_ZOOM = 0.22;
const MEDIA_BOARD_THUMBNAIL_LOD_MIN_ZOOM = 0;
const MEDIA_BOARD_THUMBNAIL_REQUEST_LIMIT = 180;
const MEDIA_BOARD_THUMBNAIL_WORKER_COUNT = 2;
const MEDIA_PANEL_VIEW_TRANSITION_MS = 500;

interface MediaPanelTransitionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MediaPanelTransitionCapture {
  box: MediaPanelTransitionBox;
  clone: HTMLElement;
  baseWidth: number;
  baseHeight: number;
  scaleX: number;
  scaleY: number;
}

interface PendingMediaPanelViewTransition {
  captures: Map<string, MediaPanelTransitionCapture>;
  overlay: HTMLDivElement;
  panelBox: MediaPanelTransitionBox;
}

interface ActiveMediaPanelViewTransition {
  animations: Animation[];
  hiddenTargets: HTMLElement[];
  overlay: HTMLDivElement;
  timeoutId: number;
}

// Load column order from localStorage
function loadColumnOrder(): ColumnId[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ColumnId[];
      // If all default columns are present and no extras, use saved order
      if (parsed.length === DEFAULT_COLUMN_ORDER.length &&
          DEFAULT_COLUMN_ORDER.every(col => parsed.includes(col))) {
        return parsed;
      }
      // If saved order is missing new columns, add them
      const missingColumns = DEFAULT_COLUMN_ORDER.filter(col => !parsed.includes(col));
      if (missingColumns.length > 0) {
        // Filter out any invalid columns and add missing ones
        const validColumns = parsed.filter(col => DEFAULT_COLUMN_ORDER.includes(col));
        return [...validColumns, ...missingColumns];
      }
    }
  } catch {
    // Ignore errors
  }
  return DEFAULT_COLUMN_ORDER;
}

function loadMediaPanelViewMode(): MediaPanelViewMode {
  const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
  if (stored === 'board') return 'board';
  if (stored === 'icons' || stored === 'grid') return 'icons';
  return 'classic';
}

function loadMediaBoardViewport(): MediaBoardViewport {
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

function loadMediaBoardOrder(): Record<string, string[]> {
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

function loadMediaBoardGroupOffsets(): Record<string, MediaBoardGroupOffset> {
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

function loadMediaBoardLayouts(): Record<string, MediaBoardGroupOffset> {
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

function getProjectItemIconType(item: ProjectItem | undefined): string | undefined {
  if (!item || !('type' in item)) return undefined;
  if (item.type === 'model') {
    return 'meshType' in item && item.meshType === 'text3d'
      ? 'text-3d'
      : 'mesh';
  }
  return item.type;
}

function formatCompactCount(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

function getGaussianSplatFrameCount(mediaFile: MediaFile): number | undefined {
  return mediaFile.splatFrameCount ?? mediaFile.gaussianSplatSequence?.frameCount;
}

function getGaussianSplatTotalCount(mediaFile: MediaFile): number | undefined {
  return mediaFile.totalSplatCount ?? mediaFile.gaussianSplatSequence?.totalSplatCount ?? mediaFile.splatCount;
}

function getGaussianSplatFirstFrameCount(mediaFile: MediaFile): number | undefined {
  return mediaFile.splatCount ?? mediaFile.gaussianSplatSequence?.frames[0]?.splatCount;
}

function getGaussianSplatResolutionLabel(item: ProjectItem): string | null {
  if (!isImportedMediaFileItem(item) || item.type !== 'gaussian-splat') return null;

  const frameCount = getGaussianSplatFrameCount(item);
  const totalCount = getGaussianSplatTotalCount(item);
  const firstFrameCount = getGaussianSplatFirstFrameCount(item);
  const totalLabel = formatCompactCount(totalCount);
  const firstFrameLabel = formatCompactCount(firstFrameCount);

  if (frameCount && frameCount > 1) {
    return totalLabel ? `${frameCount}f / ${totalLabel} splats` : `${frameCount}f`;
  }

  return firstFrameLabel ? `${firstFrameLabel} splats` : null;
}

function getGaussianSplatDetailLines(mediaFile: MediaFile): string[] {
  if (mediaFile.type !== 'gaussian-splat') return [];

  const frameCount = getGaussianSplatFrameCount(mediaFile);
  const totalCount = getGaussianSplatTotalCount(mediaFile);
  const firstFrameCount = getGaussianSplatFirstFrameCount(mediaFile);
  const minCount = mediaFile.gaussianSplatSequence?.minSplatCount;
  const maxCount = mediaFile.gaussianSplatSequence?.maxSplatCount;
  const lines: string[] = [];

  if (frameCount && frameCount > 1) {
    lines.push(`${frameCount} frames`);
    const totalLabel = formatCompactCount(totalCount);
    if (totalLabel) lines.push(`${totalLabel} splats total`);
    const minLabel = formatCompactCount(minCount);
    const maxLabel = formatCompactCount(maxCount);
    if (minLabel && maxLabel && minLabel !== maxLabel) {
      lines.push(`${minLabel}-${maxLabel} splats/frame`);
    }
  } else {
    const firstFrameLabel = formatCompactCount(firstFrameCount);
    if (firstFrameLabel) lines.push(`${firstFrameLabel} splats`);
  }

  return lines;
}

function getMediaFileContainerLabel(mediaFile: MediaFile | null): string | undefined {
  if (!mediaFile) return undefined;
  if (mediaFile.container) return mediaFile.container;
  if (mediaFile.type === 'gaussian-splat' && mediaFile.gaussianSplatSequence?.container) {
    const frameCount = getGaussianSplatFrameCount(mediaFile);
    return frameCount && frameCount > 1
      ? `${mediaFile.gaussianSplatSequence.container} Seq`
      : mediaFile.gaussianSplatSequence.container;
  }
  return undefined;
}

function getMediaFileCodecLabel(mediaFile: MediaFile | null): string | undefined {
  if (!mediaFile) return undefined;
  if (mediaFile.codec) return mediaFile.codec;
  if (mediaFile.type === 'gaussian-splat') {
    const frameCount = getGaussianSplatFrameCount(mediaFile);
    return frameCount && frameCount > 1
      ? 'Splat Seq'
      : 'Splat';
  }
  return undefined;
}

function getMediaBoardGroupName(folderId: string | null, folders: Array<{ id: string; name: string; parentId: string | null }>): string {
  if (!folderId) return 'Root';
  const path: string[] = [];
  let current = folders.find((folder) => folder.id === folderId);
  while (current) {
    path.unshift(current.name);
    current = current.parentId ? folders.find((folder) => folder.id === current!.parentId) : undefined;
  }
  return path.length ? path.join(' / ') : 'Folder';
}

function isMediaBoardFolder(item: ProjectItem): item is MediaFolder {
  return 'isExpanded' in item;
}

function isMediaBoardEmptySlotId(id: string): boolean {
  return id === MEDIA_BOARD_EMPTY_SLOT_ID || id.startsWith(`${MEDIA_BOARD_EMPTY_SLOT_ID}${MEDIA_BOARD_EMPTY_SLOT_SIZE_SEPARATOR}`);
}

function normalizeMediaBoardOrderIds(ids: string[], validItemIds: Set<string>): string[] {
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

function getMediaBoardTypeLabel(item: MediaBoardItem): string {
  if (isMediaBoardFolder(item)) return 'Folder';
  if (item.type === 'composition') return 'Composition';
  if (item.type === 'gaussian-splat') {
    return isImportedMediaFileItem(item) && (getGaussianSplatFrameCount(item) ?? 1) > 1
      ? 'Splat Seq'
      : 'Splat';
  }
  if (item.type === 'splat-effector') return 'Effector';
  if (item.type === 'solid') return 'Solid';
  if (item.type === 'model') return 'Model';
  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

function getMediaBoardOrderKey(folderId: string | null): string {
  return folderId ?? MEDIA_BOARD_ROOT_ORDER_KEY;
}

function clampMediaBoardNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getMediaBoardItemAspectRatio(item: MediaBoardItem): number {
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

function getMediaBoardNodeSize(item: MediaBoardItem): { width: number; height: number } {
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

function getMediaBoardGroupChrome(groupId: string | null): { headerHeight: number; padding: number } {
  return groupId === null
    ? { headerHeight: 0, padding: MEDIA_BOARD_ROOT_PADDING }
    : { headerHeight: MEDIA_BOARD_GROUP_HEADER_HEIGHT, padding: MEDIA_BOARD_GROUP_PADDING };
}

function getMediaBoardVisibleRect(
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

function waitForMediaBoardThumbnailTurn(): Promise<void> {
  return new Promise((resolve) => {
    const requestIdle = typeof window === 'undefined' ? undefined : window.requestIdleCallback;
    if (typeof requestIdle === 'function') {
      requestIdle(() => resolve(), { timeout: 120 });
      return;
    }

    globalThis.setTimeout(resolve, 8);
  });
}

function mediaBoardNodeIntersectsVisibleRect(
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

function mediaBoardGroupIntersectsVisibleRect(
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

function rectToTransitionBox(rect: DOMRect): MediaPanelTransitionBox {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function boxesIntersect(a: MediaPanelTransitionBox, b: MediaPanelTransitionBox): boolean {
  return (
    a.left < b.left + b.width
    && a.left + a.width > b.left
    && a.top < b.top + b.height
    && a.top + a.height > b.top
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function MediaPanel() {
  // Reactive data - subscribe to specific values only
  const files = useMediaStore(state => state.files);
  const compositions = useMediaStore(state => state.compositions);
  const folders = useMediaStore(state => state.folders);
  const textItems = useMediaStore(state => state.textItems);
  const solidItems = useMediaStore(state => state.solidItems);
  const meshItems = useMediaStore(state => state.meshItems);
  const cameraItems = useMediaStore(state => state.cameraItems);
  const splatEffectorItems = useMediaStore(state => state.splatEffectorItems);
  const selectedIds = useMediaStore(state => state.selectedIds);
  const expandedFolderIds = useMediaStore(state => state.expandedFolderIds);
  const fileSystemSupported = useMediaStore(state => state.fileSystemSupported);
  const proxyFolderName = useMediaStore(state => state.proxyFolderName);
  const activeCompositionId = useMediaStore(state => state.activeCompositionId);
  const refreshFileUrls = useMediaStore(state => state.refreshFileUrls);
  const ensureFileThumbnail = useMediaStore(state => state.ensureFileThumbnail);

  // Actions from getState() - stable, no subscription needed
  const {
    importFiles,
    importFilesWithPicker,
    createComposition,
    createFolder,
    removeFile,
    removeComposition,
    removeFolder,
    renameFile,
    renameFolder,
    reloadFile,
    toggleFolderExpanded,
    setSelection,
    addToSelection,
    openCompositionTab,
    updateComposition,
    generateProxy,
    cancelProxyGeneration,
    pickProxyFolder,
    showInExplorer,
    moveToFolder,
    createTextItem,
    getOrCreateTextFolder,
    removeTextItem,
    createSolidItem,
    getOrCreateSolidFolder,
    updateSolidItem,
    createMeshItem,
    getOrCreateMeshFolder,
    removeMeshItem,
    createCameraItem,
    getOrCreateCameraFolder,
    removeCameraItem,
    createSplatEffectorItem,
    getOrCreateSplatEffectorFolder,
    removeSplatEffectorItem,
    setLabelColor,
    importGaussianSplat,
  } = useMediaStore.getState();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemListRef = useRef<HTMLDivElement>(null);
  const mediaPanelContentRef = useRef<HTMLDivElement>(null);
  const boardWrapperRef = useRef<HTMLDivElement>(null);
  const boardCanvasRef = useRef<HTMLDivElement>(null);
  const boardCanvasInnerRef = useRef<HTMLDivElement>(null);
  const boardInteractionFrameRef = useRef<number | null>(null);
  const boardAutoPanFrameRef = useRef<number | null>(null);
  const pendingViewTransitionRef = useRef<PendingMediaPanelViewTransition | null>(null);
  const activeViewTransitionRef = useRef<ActiveMediaPanelViewTransition | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameTimerRef = useRef<number | null>(null);
  const [contextMenu, setContextMenu] = useState<MediaPanelContextMenu | null>(null);

  // Marquee selection state
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const marqueeRef = useRef<{ startX: number; startY: number; initialSelection: string[] } | null>(null);
  const { menuRef: contextMenuRef, adjustedPosition: contextMenuPosition } = useContextMenuPosition(contextMenu);
  const [settingsDialog, setSettingsDialog] = useState<{ compositionId: string; width: number; height: number; frameRate: number; duration: number } | null>(null);
  const [solidSettingsDialog, setSolidSettingsDialog] = useState<{ solidItemId: string; width: number; height: number; color: string } | null>(null);
  const [addDropdownOpen, setAddDropdownOpen] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [internalDragId, setInternalDragId] = useState<string | null>(null);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [classicListViewport, setClassicListViewport] = useState({ scrollTop: 0, height: 0 });
  const [labelPickerItemId, setLabelPickerItemId] = useState<string | null>(null);
  const [labelPickerPos, setLabelPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [viewMode, setViewMode] = useState<MediaPanelViewMode>(loadMediaPanelViewMode);
  // Grid view: current open folder (null = root)
  const [gridFolderId, setGridFolderId] = useState<string | null>(null);
  const [mediaBoardViewport, setMediaBoardViewport] = useState<MediaBoardViewport>(loadMediaBoardViewport);
  const [mediaBoardOrder, setMediaBoardOrder] = useState<Record<string, string[]>>(loadMediaBoardOrder);
  const [mediaBoardGroupOffsets, setMediaBoardGroupOffsets] = useState<Record<string, MediaBoardGroupOffset>>(loadMediaBoardGroupOffsets);
  const [mediaBoardLayouts, setMediaBoardLayouts] = useState<Record<string, MediaBoardGroupOffset>>(loadMediaBoardLayouts);
  const [mediaBoardCanvasSize, setMediaBoardCanvasSize] = useState<MediaBoardViewportSize>(() => ({
    width: typeof window === 'undefined' ? 1280 : Math.max(1, window.innerWidth),
    height: typeof window === 'undefined' ? 720 : Math.max(1, window.innerHeight),
  }));
  const [mediaBoardMarquee, setMediaBoardMarquee] = useState<MediaBoardMarquee | null>(null);
  const [mediaBoardInsertionPreview, setMediaBoardInsertionPreview] = useState<MediaBoardInsertionPreview | null>(null);
  const suppressMediaBoardContextMenuRef = useRef(false);
  const suppressMediaBoardContextMenuTimerRef = useRef<number | null>(null);

  // Column order state
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(loadColumnOrder);
  const [draggingColumn, setDraggingColumn] = useState<ColumnId | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);

  // Sort state
  const [sortColumn, setSortColumn] = useState<ColumnId | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Save column order to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columnOrder));
  }, [columnOrder]);

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem(BOARD_VIEWPORT_STORAGE_KEY, JSON.stringify(mediaBoardViewport));
  }, [mediaBoardViewport]);

  useEffect(() => {
    localStorage.setItem(BOARD_ORDER_STORAGE_KEY, JSON.stringify(mediaBoardOrder));
  }, [mediaBoardOrder]);

  useEffect(() => {
    localStorage.setItem(BOARD_GROUP_OFFSETS_STORAGE_KEY, JSON.stringify(mediaBoardGroupOffsets));
  }, [mediaBoardGroupOffsets]);

  useEffect(() => {
    localStorage.setItem(BOARD_LAYOUTS_STORAGE_KEY, JSON.stringify(mediaBoardLayouts));
  }, [mediaBoardLayouts]);

  useLayoutEffect(() => {
    if (viewMode !== 'board') return;

    const canvas = boardCanvasRef.current;
    if (!canvas) return;

    const updateCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      setMediaBoardCanvasSize((current) => (
        current.width === width && current.height === height
          ? current
          : { width, height }
      ));
    };

    updateCanvasSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateCanvasSize);
      return () => window.removeEventListener('resize', updateCanvasSize);
    }

    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [viewMode]);

  useLayoutEffect(() => {
    if (viewMode !== 'classic') return;

    const list = itemListRef.current;
    if (!list) return;

    const updateViewport = () => {
      setClassicListViewport((current) => {
        const next = {
          scrollTop: list.scrollTop,
          height: list.clientHeight,
        };
        return current.scrollTop === next.scrollTop && current.height === next.height ? current : next;
      });
    };

    updateViewport();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewport);
      return () => window.removeEventListener('resize', updateViewport);
    }

    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(list);
    return () => resizeObserver.disconnect();
  }, [viewMode]);

  useEffect(() => () => {
    if (boardInteractionFrameRef.current !== null) {
      window.cancelAnimationFrame(boardInteractionFrameRef.current);
    }
    if (boardAutoPanFrameRef.current !== null) {
      window.cancelAnimationFrame(boardAutoPanFrameRef.current);
    }
    if (suppressMediaBoardContextMenuTimerRef.current !== null) {
      window.clearTimeout(suppressMediaBoardContextMenuTimerRef.current);
    }
  }, []);

  const cleanupActiveMediaPanelViewTransition = useCallback(() => {
    const active = activeViewTransitionRef.current;
    if (!active) return;

    activeViewTransitionRef.current = null;
    window.clearTimeout(active.timeoutId);
    active.animations.forEach((animation) => animation.cancel());
    active.hiddenTargets.forEach((target) => {
      target.classList.remove('media-panel-view-transition-hidden');
    });
    active.overlay.remove();
  }, []);

  const cleanupPendingMediaPanelViewTransition = useCallback(() => {
    const pending = pendingViewTransitionRef.current;
    if (!pending) return;

    pendingViewTransitionRef.current = null;
    pending.overlay.remove();
  }, []);

  const prepareMediaPanelViewTransition = useCallback(() => {
    cleanupActiveMediaPanelViewTransition();
    cleanupPendingMediaPanelViewTransition();

    if (prefersReducedMotion()) return;

    const content = mediaPanelContentRef.current;
    if (!content) return;

    const panelBox = rectToTransitionBox(content.getBoundingClientRect());
    if (panelBox.width < 1 || panelBox.height < 1) return;

    const overlay = document.createElement('div');
    overlay.className = 'media-panel-view-transition-layer';
    overlay.style.left = `${panelBox.left}px`;
    overlay.style.top = `${panelBox.top}px`;
    overlay.style.width = `${panelBox.width}px`;
    overlay.style.height = `${panelBox.height}px`;

    const captures = new Map<string, MediaPanelTransitionCapture>();
    const nodes = content.querySelectorAll<HTMLElement>('[data-media-panel-anim-id]');
    nodes.forEach((node) => {
      const id = node.dataset.mediaPanelAnimId;
      if (!id || node.matches(':focus-within')) return;

      const box = rectToTransitionBox(node.getBoundingClientRect());
      if (box.width < 1 || box.height < 1 || !boxesIntersect(box, panelBox)) return;

      const clone = node.cloneNode(true) as HTMLElement;
      const baseWidth = node.offsetWidth || box.width;
      const baseHeight = node.offsetHeight || box.height;
      const scaleX = box.width / Math.max(baseWidth, 1);
      const scaleY = box.height / Math.max(baseHeight, 1);
      clone.classList.add('media-panel-view-transition-clone');
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('draggable', 'false');
      clone.querySelectorAll<HTMLElement>('[draggable]').forEach((draggableChild) => {
        draggableChild.setAttribute('draggable', 'false');
      });
      clone.style.left = `${box.left - panelBox.left}px`;
      clone.style.top = `${box.top - panelBox.top}px`;
      clone.style.width = `${baseWidth}px`;
      clone.style.height = `${baseHeight}px`;
      clone.style.transform = `scale(${scaleX}, ${scaleY})`;

      captures.set(id, { box, clone, baseWidth, baseHeight, scaleX, scaleY });
      overlay.appendChild(clone);
    });

    if (captures.size === 0) {
      overlay.remove();
      return;
    }

    document.body.appendChild(overlay);
    pendingViewTransitionRef.current = { captures, overlay, panelBox };
  }, [cleanupActiveMediaPanelViewTransition, cleanupPendingMediaPanelViewTransition]);

  useLayoutEffect(() => {
    const pending = pendingViewTransitionRef.current;
    if (!pending) return;

    pendingViewTransitionRef.current = null;

    const content = mediaPanelContentRef.current;
    if (!content || prefersReducedMotion()) {
      pending.overlay.remove();
      return;
    }

    const nextPanelBox = rectToTransitionBox(content.getBoundingClientRect());
    const hiddenTargets: HTMLElement[] = [];
    const animations: Animation[] = [];

    const animateCloneOut = ({ clone, scaleX, scaleY }: MediaPanelTransitionCapture) => {
      animations.push(clone.animate(
        [
          { opacity: 1, transform: `scale(${scaleX}, ${scaleY}) translate3d(0, 0, 0)` },
          { opacity: 0, transform: `scale(${scaleX}, ${scaleY}) translate3d(0, -4px, 0)` },
        ],
        {
          duration: 180,
          easing: 'ease-out',
          fill: 'forwards',
        }
      ));
    };

    pending.captures.forEach((capture, id) => {
      const { box, clone, baseWidth, baseHeight, scaleX, scaleY } = capture;
      const target = content.querySelector<HTMLElement>(`[data-media-panel-anim-id="${CSS.escape(id)}"]`);
      if (!target) {
        animateCloneOut(capture);
        return;
      }

      const targetBox = rectToTransitionBox(target.getBoundingClientRect());
      if (targetBox.width < 1 || targetBox.height < 1 || !boxesIntersect(targetBox, nextPanelBox)) {
        animateCloneOut(capture);
        return;
      }

      const sourceLeft = box.left - pending.panelBox.left;
      const sourceTop = box.top - pending.panelBox.top;
      const targetLeft = targetBox.left - pending.panelBox.left;
      const targetTop = targetBox.top - pending.panelBox.top;
      const targetBaseWidth = target.offsetWidth || targetBox.width;
      const targetBaseHeight = target.offsetHeight || targetBox.height;
      const targetScaleX = targetBox.width / Math.max(targetBaseWidth, 1);
      const targetScaleY = targetBox.height / Math.max(targetBaseHeight, 1);
      const targetInitialWidth = box.width / Math.max(targetScaleX, 0.001);
      const targetInitialHeight = box.height / Math.max(targetScaleY, 0.001);
      const targetScaleTransform = `scale(${targetScaleX}, ${targetScaleY})`;

      const targetClone = target.cloneNode(true) as HTMLElement;
      targetClone.classList.add('media-panel-view-transition-clone', 'media-panel-view-transition-target-clone');
      targetClone.setAttribute('aria-hidden', 'true');
      targetClone.setAttribute('draggable', 'false');
      targetClone.querySelectorAll<HTMLElement>('[draggable]').forEach((draggableChild) => {
        draggableChild.setAttribute('draggable', 'false');
      });
      targetClone.style.left = `${sourceLeft}px`;
      targetClone.style.top = `${sourceTop}px`;
      targetClone.style.width = `${targetInitialWidth}px`;
      targetClone.style.height = `${targetInitialHeight}px`;
      targetClone.style.opacity = '0';
      targetClone.style.transform = targetScaleTransform;
      pending.overlay.appendChild(targetClone);

      target.classList.add('media-panel-view-transition-hidden');
      hiddenTargets.push(target);

      animations.push(clone.animate(
        [
          {
            left: `${sourceLeft}px`,
            top: `${sourceTop}px`,
            width: `${baseWidth}px`,
            height: `${baseHeight}px`,
            transform: `scale(${scaleX}, ${scaleY})`,
            opacity: 1,
          },
          {
            left: `${targetLeft}px`,
            top: `${targetTop}px`,
            width: `${targetBaseWidth}px`,
            height: `${targetBaseHeight}px`,
            transform: targetScaleTransform,
            opacity: 0,
          },
        ],
        {
          duration: 260,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          fill: 'forwards',
        }
      ));
      animations.push(targetClone.animate(
        [
          {
            left: `${sourceLeft}px`,
            top: `${sourceTop}px`,
            width: `${targetInitialWidth}px`,
            height: `${targetInitialHeight}px`,
            transform: targetScaleTransform,
            opacity: 0,
            offset: 0,
          },
          {
            left: `${sourceLeft + ((targetLeft - sourceLeft) * 0.35)}px`,
            top: `${sourceTop + ((targetTop - sourceTop) * 0.35)}px`,
            width: `${targetInitialWidth + ((targetBaseWidth - targetInitialWidth) * 0.35)}px`,
            height: `${targetInitialHeight + ((targetBaseHeight - targetInitialHeight) * 0.35)}px`,
            transform: targetScaleTransform,
            opacity: 0,
            offset: 0.18,
          },
          {
            left: `${targetLeft}px`,
            top: `${targetTop}px`,
            width: `${targetBaseWidth}px`,
            height: `${targetBaseHeight}px`,
            transform: targetScaleTransform,
            opacity: 1,
            offset: 1,
          },
        ],
        {
          duration: MEDIA_PANEL_VIEW_TRANSITION_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards',
        }
      ));
    });

    content.querySelectorAll<HTMLElement>('[data-media-panel-anim-id]').forEach((target) => {
      const id = target.dataset.mediaPanelAnimId;
      if (!id || pending.captures.has(id)) return;

      const targetBox = rectToTransitionBox(target.getBoundingClientRect());
      if (targetBox.width < 1 || targetBox.height < 1 || !boxesIntersect(targetBox, nextPanelBox)) return;

      animations.push(target.animate(
        [
          { opacity: 0 },
          { opacity: 1 },
        ],
        {
          duration: 180,
          delay: 160,
          easing: 'ease-out',
        }
      ));
    });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;

      const active = activeViewTransitionRef.current;
      if (active?.overlay === pending.overlay) {
        activeViewTransitionRef.current = null;
      }
      window.clearTimeout(timeoutId);
      hiddenTargets.forEach((target) => {
        target.classList.remove('media-panel-view-transition-hidden');
      });
      pending.overlay.remove();
    };

    const timeoutId = window.setTimeout(finish, MEDIA_PANEL_VIEW_TRANSITION_MS + 100);
    activeViewTransitionRef.current = {
      animations,
      hiddenTargets,
      overlay: pending.overlay,
      timeoutId,
    };

    if (animations.length === 0) {
      finish();
      return;
    }

    void Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
  });

  useEffect(() => () => {
    cleanupActiveMediaPanelViewTransition();
    cleanupPendingMediaPanelViewTransition();
  }, [cleanupActiveMediaPanelViewTransition, cleanupPendingMediaPanelViewTransition]);

  const handleViewModeChange = useCallback((nextViewMode: MediaPanelViewMode) => {
    if (nextViewMode === viewMode) return;

    prepareMediaPanelViewTransition();
    setViewMode(nextViewMode);
    if (nextViewMode !== 'icons') {
      setGridFolderId(null);
    }
  }, [prepareMediaPanelViewTransition, viewMode]);

  // Column drag handlers
  const handleColumnDragStart = useCallback((e: React.DragEvent, columnId: ColumnId) => {
    e.stopPropagation();
    setDraggingColumn(columnId);
    e.dataTransfer.setData('application/x-column-id', columnId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleColumnDragOver = useCallback((e: React.DragEvent, columnId: ColumnId) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggingColumn && draggingColumn !== columnId) {
      setDragOverColumn(columnId);
    }
  }, [draggingColumn]);

  const handleColumnDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleColumnDrop = useCallback((e: React.DragEvent, targetColumnId: ColumnId) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceColumnId = e.dataTransfer.getData('application/x-column-id') as ColumnId;
    if (sourceColumnId && sourceColumnId !== targetColumnId) {
      setColumnOrder(prev => {
        const newOrder = [...prev];
        const sourceIndex = newOrder.indexOf(sourceColumnId);
        const targetIndex = newOrder.indexOf(targetColumnId);
        newOrder.splice(sourceIndex, 1);
        newOrder.splice(targetIndex, 0, sourceColumnId);
        return newOrder;
      });
    }
    setDraggingColumn(null);
    setDragOverColumn(null);
  }, []);

  const handleColumnDragEnd = useCallback(() => {
    setDraggingColumn(null);
    setDragOverColumn(null);
  }, []);

  // Sort handler - click on column header to sort
  const handleColumnSort = useCallback((colId: ColumnId) => {
    if (sortColumn === colId) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        // Third click: remove sort
        setSortColumn(null);
        setSortDirection('asc');
      }
    } else {
      setSortColumn(colId);
      setSortDirection('asc');
    }
  }, [sortColumn, sortDirection]);

  // Sort items comparator
  const getSortValue = useCallback((item: ProjectItem, colId: ColumnId): string | number => {
    const mediaFile = ('type' in item && item.type !== 'composition' && item.type !== 'text' && item.type !== 'solid' && item.type !== 'camera' && item.type !== 'splat-effector') ? item as MediaFile : null;
    switch (colId) {
      case 'name': return item.name.toLowerCase();
      case 'label': {
        const labelColor = 'labelColor' in item ? (item as MediaFile).labelColor : undefined;
        const idx = LABEL_COLORS.findIndex(c => c.key === (labelColor || 'none'));
        return idx >= 0 ? idx : 999;
      }
      case 'duration': return 'duration' in item && item.duration ? item.duration : 0;
      case 'resolution':
        if (mediaFile?.type === 'gaussian-splat') {
          return getGaussianSplatTotalCount(mediaFile) ?? getGaussianSplatFirstFrameCount(mediaFile) ?? 0;
        }
        return 'width' in item && 'height' in item && item.width && item.height ? item.width * item.height : 0;
      case 'fps': return mediaFile?.fps || ('type' in item && item.type === 'composition' ? (item as Composition).frameRate : 0);
      case 'container': return getMediaFileContainerLabel(mediaFile)?.toLowerCase() || '';
      case 'codec': return getMediaFileCodecLabel(mediaFile)?.toLowerCase() || '';
      case 'audio': return mediaFile?.hasAudio ? 1 : 0;
      case 'bitrate': return mediaFile?.bitrate || 0;
      case 'size': return mediaFile?.fileSize || 0;
      default: return 0;
    }
  }, []);

  const sortItems = useCallback((items: ProjectItem[]): ProjectItem[] => {
    if (!sortColumn) return items;
    // Separate folders from other items - folders stay at top
    const folderItems = items.filter(i => 'isExpanded' in i);
    const nonFolderItems = items.filter(i => !('isExpanded' in i));

    const compare = (a: ProjectItem, b: ProjectItem): number => {
      const va = getSortValue(a, sortColumn);
      const vb = getSortValue(b, sortColumn);
      let result: number;
      if (typeof va === 'string' && typeof vb === 'string') {
        result = va.localeCompare(vb);
      } else {
        result = (va as number) - (vb as number);
      }
      return sortDirection === 'desc' ? -result : result;
    };

    folderItems.sort(compare);
    nonFolderItems.sort(compare);
    return [...folderItems, ...nonFolderItems];
  }, [sortColumn, sortDirection, getSortValue]);

  const handleClassicListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    setClassicListViewport((current) => {
      const next = {
        scrollTop: target.scrollTop,
        height: target.clientHeight,
      };
      return current.scrollTop === next.scrollTop && current.height === next.height ? current : next;
    });
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!addDropdownOpen) return;
    const handleClickOutside = () => setAddDropdownOpen(false);
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [addDropdownOpen]);

  // Handle file import - prefer File System Access API for better file path access
  const handleImport = useCallback(async () => {
    if (fileSystemSupported) {
      // Use File System Access API - gives us file handles with path info
      await importFilesWithPicker();
    } else {
      // Fallback to traditional file input
      fileInputRef.current?.click();
    }
  }, [fileSystemSupported, importFilesWithPicker]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await importFiles(e.target.files);
      e.target.value = ''; // Reset input
    }
  }, [importFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if this is an external file drag (from OS file explorer)
    const hasFiles = e.dataTransfer.types.includes('Files');
    const isInternalDrag = e.dataTransfer.types.includes('application/x-media-panel-item');

    log.debug('DragOver', { hasFiles, isInternalDrag, types: [...e.dataTransfer.types] });

    if (hasFiles && !isInternalDrag) {
      e.dataTransfer.dropEffect = 'copy';
      setIsExternalDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only reset if leaving the panel entirely (not just entering a child)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsExternalDragOver(false);
    }
  }, []);

  const handleExternalDropImport = useCallback(async (dataTransfer: DataTransfer, targetParentId: string | null) => {
    const mediaStore = useMediaStore.getState();
    const droppedFiles = await collectDroppedMediaFiles(dataTransfer);

    if (droppedFiles.length === 0) {
      return;
    }

    const importBatches = planDroppedMediaImports(
      droppedFiles,
      mediaStore.folders,
      targetParentId,
      (name, parentId) => mediaStore.createFolder(name, parentId),
    );

    for (const batch of importBatches) {
      if (batch.filesWithHandles.length > 0) {
        await mediaStore.importFilesWithHandles(batch.filesWithHandles, batch.parentId);
      }

      if (batch.files.length > 0) {
        await mediaStore.importFiles(batch.files, batch.parentId);
      }
    }
  }, []);

  // Marquee selection handlers
  const handleMarqueeMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Ignore clicks on buttons, inputs, context menus
    if (target.closest('button, input, .context-menu')) return;

    // Don't start marquee when clicking on an item — let item drag handle it
    const clickedOnItem = !!target.closest('.media-item, .media-grid-item');
    if (clickedOnItem) return;

    const container = itemListRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const startX = e.clientX - rect.left + container.scrollLeft;
    const startY = e.clientY - rect.top + container.scrollTop;
    const clientStartX = e.clientX;
    const clientStartY = e.clientY;

    const initial = e.ctrlKey || e.metaKey ? [...selectedIds] : [];
    let isDragging = false;

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - clientStartX;
      const dy = ev.clientY - clientStartY;

      // Start marquee after 4px movement threshold
      if (!isDragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        isDragging = true;
        marqueeRef.current = { startX, startY, initialSelection: initial };
        if (!ev.ctrlKey && !ev.metaKey) {
          setSelection([]);
        }
      }

      if (!isDragging || !marqueeRef.current) return;

      const r = container.getBoundingClientRect();
      const cx = ev.clientX - r.left + container.scrollLeft;
      const cy = ev.clientY - r.top + container.scrollTop;
      setMarquee({ startX: marqueeRef.current.startX, startY: marqueeRef.current.startY, currentX: cx, currentY: cy });

      // Hit-test items
      const mLeft = Math.min(marqueeRef.current.startX, cx);
      const mRight = Math.max(marqueeRef.current.startX, cx);
      const mTop = Math.min(marqueeRef.current.startY, cy);
      const mBottom = Math.max(marqueeRef.current.startY, cy);

      const itemEls = container.querySelectorAll('.media-item, .media-grid-item');
      const hitIds: string[] = [];
      itemEls.forEach((el) => {
        const elRect = el.getBoundingClientRect();
        const elTop = elRect.top - r.top + container.scrollTop;
        const elBottom = elTop + elRect.height;
        const elLeft = elRect.left - r.left + container.scrollLeft;
        const elRight = elLeft + elRect.width;
        if (elRight > mLeft && elLeft < mRight && elBottom > mTop && elTop < mBottom) {
          const itemId = (el as HTMLElement).dataset.mediaPanelAnimId ?? el.parentElement?.getAttribute('data-item-id');
          if (itemId) hitIds.push(itemId);
        }
      });

      const combined = [...new Set([...marqueeRef.current.initialSelection, ...hitIds])];
      setSelection(combined);
    };

    const handleMouseUp = () => {
      if (!isDragging) {
        // Clicked on empty space without dragging → deselect all
        if (!e.ctrlKey && !e.metaKey) {
          setSelection([]);
        }
      }
      isDragging = false;
      marqueeRef.current = null;
      setMarquee(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [selectedIds, setSelection]);

  // Handle item selection
  const handleItemClick = useCallback((id: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Toggle: add or remove
      if (selectedIds.includes(id)) {
        const { removeFromSelection } = useMediaStore.getState();
        removeFromSelection(id);
      } else {
        addToSelection(id);
      }
    } else if (e.shiftKey) {
      addToSelection(id);
    } else {
      setSelection([id]);
    }
  }, [addToSelection, setSelection, selectedIds]);

  // Handle double-click (open/expand)
  const handleItemDoubleClick = useCallback(async (item: ProjectItem) => {
    if ('isExpanded' in item) {
      // Folders navigate in icon view and expand/collapse in the denser views.
      if (viewMode === 'icons') {
        setGridFolderId(item.id);
      } else {
        toggleFolderExpanded(item.id);
      }
    } else if (item.type === 'composition') {
      // Open composition in timeline (as a tab)
      openCompositionTab(item.id);
    } else if ((item.type === 'video' || item.type === 'image') && 'file' in item && (item as MediaFile).file) {
      // Open in source monitor
      useMediaStore.getState().setSourceMonitorFile(item.id);
    } else if ('file' in item && mediaNeedsRelink(item as MediaFile)) {
      // Media file needs reload - request permission
      const success = await reloadFile(item.id);
      if (success) {
        log.info('File reloaded successfully');
      }
    }
  }, [toggleFolderExpanded, openCompositionTab, reloadFile, viewMode]);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, itemId?: string, parentId?: string | null) => {
    e.preventDefault();
    if (itemId && !selectedIds.includes(itemId)) {
      // If right-clicking an unselected item, select only it (unless Ctrl held)
      if (e.ctrlKey || e.metaKey) {
        addToSelection(itemId);
      } else {
        setSelection([itemId]);
      }
    }
    setContextMenu({ x: e.clientX, y: e.clientY, itemId, parentId });
  }, [selectedIds, setSelection, addToSelection]);

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

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Rename handling
  const startRename = useCallback((id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
    closeContextMenu();
  }, [closeContextMenu]);

  const finishRename = useCallback(() => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }

    const file = files.find(f => f.id === renamingId);
    const folder = folders.find(f => f.id === renamingId);
    const composition = compositions.find(c => c.id === renamingId);

    if (file) {
      renameFile(renamingId, renameValue.trim());
    } else if (folder) {
      renameFolder(renamingId, renameValue.trim());
    } else if (composition) {
      updateComposition(renamingId, { name: renameValue.trim() });
    }

    setRenamingId(null);
  }, [renamingId, renameValue, files, folders, compositions, renameFile, renameFolder, updateComposition]);

  // Handle click on item name to start rename (delayed so drag can cancel it)
  const handleNameClick = useCallback((e: React.MouseEvent, id: string, currentName: string) => {
    // Only start rename if item is already selected (double-click on name effect)
    if (selectedIds.includes(id)) {
      e.stopPropagation();
      if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
      renameTimerRef.current = window.setTimeout(() => {
        renameTimerRef.current = null;
        startRename(id, currentName);
      }, 300);
    }
  }, [selectedIds, startRename]);

  // Handle badge click — select clip using this media file, open properties panel with target tab
  const handleBadgeClick = useCallback((mediaFileId: string, tab: 'transcript' | 'analysis') => {
    const timelineState = useTimelineStore.getState();
    // Find a clip in the timeline that uses this media file
    const clip = timelineState.clips.find(c =>
      (c.source?.mediaFileId || c.mediaFileId) === mediaFileId
    );
    if (clip) {
      timelineState.selectClip(clip.id);
    }
    // Open clip-properties panel and dispatch tab switch after React re-renders
    useDockStore.getState().activatePanelType('clip-properties');
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('openPropertiesTab', { detail: { tab } }));
    });
  }, []);

  // Delete selected items
  const handleDelete = useCallback(() => {
    selectedIds.forEach(id => {
      if (files.find(f => f.id === id)) removeFile(id);
      else if (compositions.find(c => c.id === id)) removeComposition(id);
      else if (folders.find(f => f.id === id)) removeFolder(id);
      else if (textItems.find(t => t.id === id)) removeTextItem(id);
      else if (meshItems.find(m => m.id === id)) removeMeshItem(id);
      else if (cameraItems.find(c => c.id === id)) removeCameraItem(id);
      else if (splatEffectorItems.find(e => e.id === id)) removeSplatEffectorItem(id);
    });
    closeContextMenu();
  }, [selectedIds, files, compositions, folders, textItems, meshItems, cameraItems, splatEffectorItems, removeFile, removeComposition, removeFolder, removeTextItem, removeMeshItem, removeCameraItem, removeSplatEffectorItem, closeContextMenu]);

  // Get the active parent folder (icons view: current open folder, classic/board view: selected folder or null)
  const getActiveParentId = useCallback((): string | null => {
    if (contextMenu && contextMenu.parentId !== undefined) return contextMenu.parentId;
    if (viewMode === 'icons' && gridFolderId) return gridFolderId;
    // In classic/board view, if a single folder is selected, create inside it
    if (selectedIds.length === 1) {
      const sel = folders.find(f => f.id === selectedIds[0]);
      if (sel) return sel.id;
    }
    return null;
  }, [contextMenu, viewMode, gridFolderId, selectedIds, folders]);

  // New composition
  const handleNewComposition = useCallback(() => {
    createComposition(`Comp ${compositions.length + 1}`, { parentId: getActiveParentId() });
    closeContextMenu();
  }, [compositions.length, createComposition, getActiveParentId, closeContextMenu]);

  // New folder
  const handleNewFolder = useCallback(() => {
    createFolder('New Folder', getActiveParentId());
    closeContextMenu();
  }, [createFolder, getActiveParentId, closeContextMenu]);

  // New text item (in Media Panel, can be dragged to timeline)
  const handleNewText = useCallback(() => {
    const textFolderId = getOrCreateTextFolder();
    createTextItem(undefined, textFolderId);
    closeContextMenu();
  }, [createTextItem, getOrCreateTextFolder, closeContextMenu]);

  const handleNewText3D = useCallback(() => {
    const textFolderId = getOrCreateTextFolder();
    createMeshItem('text3d', undefined, textFolderId);
    closeContextMenu();
  }, [createMeshItem, getOrCreateTextFolder, closeContextMenu]);

  // New solid item (in Media Panel, can be dragged to timeline)
  const handleNewSolid = useCallback(() => {
    const solidFolderId = getOrCreateSolidFolder();
    createSolidItem(undefined, '#ffffff', solidFolderId);
    closeContextMenu();
  }, [createSolidItem, getOrCreateSolidFolder, closeContextMenu]);

  // New mesh item (in Media Panel, can be dragged to timeline)
  const handleNewMesh = useCallback((meshType: import('../../stores/mediaStore/types').MeshPrimitiveType) => {
    const meshFolderId = getOrCreateMeshFolder();
    createMeshItem(meshType, undefined, meshFolderId);
    closeContextMenu();
  }, [createMeshItem, getOrCreateMeshFolder, closeContextMenu]);

  const handleNewCamera = useCallback(() => {
    const cameraFolderId = getOrCreateCameraFolder();
    createCameraItem(undefined, cameraFolderId);
    closeContextMenu();
  }, [createCameraItem, getOrCreateCameraFolder, closeContextMenu]);

  const handleNewSplatEffector = useCallback(() => {
    const effectorFolderId = getOrCreateSplatEffectorFolder();
    createSplatEffectorItem(undefined, effectorFolderId);
    closeContextMenu();
  }, [createSplatEffectorItem, getOrCreateSplatEffectorFolder, closeContextMenu]);

  // Import Gaussian Avatar (.zip) — opens file picker, imports with forced gaussian-avatar type
  const handleImportGaussianSplat = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ply,.compressed.ply,.splat,.ksplat,.spz,.sog,.lcc,.zip';
    input.onchange = async (e) => {
      const fileList = (e.target as HTMLInputElement).files;
      if (fileList && fileList.length > 0) {
        await importGaussianSplat(fileList[0]);
      }
    };
    input.click();
    closeContextMenu();
  }, [importGaussianSplat, closeContextMenu]);

  // Composition settings
  const openCompositionSettings = useCallback((comp: Composition) => {
    setSettingsDialog({
      compositionId: comp.id,
      width: comp.width,
      height: comp.height,
      frameRate: comp.frameRate,
      duration: comp.duration,
    });
    closeContextMenu();
  }, [closeContextMenu]);

  const saveCompositionSettings = useCallback(() => {
    if (!settingsDialog) return;
    updateComposition(settingsDialog.compositionId, {
      width: settingsDialog.width,
      height: settingsDialog.height,
      frameRate: settingsDialog.frameRate,
      duration: settingsDialog.duration,
    });
    // If this is the active composition, also update timeline duration
    if (settingsDialog.compositionId === activeCompositionId) {
      useTimelineStore.getState().setDuration(settingsDialog.duration);
    }
    setSettingsDialog(null);
  }, [settingsDialog, updateComposition, activeCompositionId]);

  // Handle drag start for media files and compositions (to drag to Timeline OR to folders)
  const handleDragStart = useCallback((e: React.DragEvent, item: ProjectItem) => {
    // Cancel pending rename — drag wins over rename
    if (renameTimerRef.current) {
      clearTimeout(renameTimerRef.current);
      renameTimerRef.current = null;
    }
    const isFolder = 'isExpanded' in item;
    clearExternalDragPayload();

    // Mark as internal drag (for moving to folders)
    e.dataTransfer.setData('application/x-media-panel-item', item.id);
    setInternalDragId(item.id);

    // Don't set timeline data for folders
    if (isFolder) {
      e.dataTransfer.effectAllowed = 'move';
      if (e.currentTarget instanceof HTMLElement) {
        e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
      }
      return;
    }

    // Handle composition drag
    if (item.type === 'composition') {
      const comp = item as Composition;
      // Don't allow dragging comp into itself (check active comp)
      // Exception: in slot grid view, dragging active comp to a slot is fine
      const inSlotView = useTimelineStore.getState().slotGridProgress > 0.5;
      if (comp.id === activeCompositionId && !inSlotView) {
        e.preventDefault();
        return;
      }
      setExternalDragPayload({
        kind: 'composition',
        id: comp.id,
        duration: comp.timelineData?.duration ?? comp.duration ?? 5,
        hasAudio: true,
        isAudio: false,
        isVideo: true,
      });
      e.dataTransfer.setData('application/x-composition-id', comp.id);
      e.dataTransfer.effectAllowed = 'copyMove';
      if (e.currentTarget instanceof HTMLElement) {
        e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
      }
      return;
    }

    // Handle text item drag
    if (item.type === 'text') {
      setExternalDragPayload({
        kind: 'text',
        id: item.id,
        duration: item.duration,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      });
      e.dataTransfer.setData('application/x-text-item-id', item.id);
      e.dataTransfer.effectAllowed = 'copyMove';
      if (e.currentTarget instanceof HTMLElement) {
        e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
      }
      return;
    }

    // Handle solid item drag
    if (item.type === 'solid') {
      setExternalDragPayload({
        kind: 'solid',
        id: item.id,
        duration: item.duration,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      });
      e.dataTransfer.setData('application/x-solid-item-id', item.id);
      e.dataTransfer.effectAllowed = 'copyMove';
      if (e.currentTarget instanceof HTMLElement) {
        e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
      }
      return;
    }

    // Handle mesh item drag
    if (item.type === 'model' && 'meshType' in item) {
      const meshItem = item as import('../../stores/mediaStore/types').MeshItem;
      setExternalDragPayload({
        kind: 'mesh',
        id: item.id,
        duration: meshItem.duration,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
        meshType: meshItem.meshType,
      });
      e.dataTransfer.setData('application/x-mesh-item-id', item.id);
      e.dataTransfer.effectAllowed = 'copyMove';
      if (e.currentTarget instanceof HTMLElement) {
        e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
      }
      return;
    }

    // Handle camera item drag
    if (item.type === 'camera') {
      const cameraItem = item as CameraItem;
      setExternalDragPayload({
        kind: 'camera',
        id: item.id,
        duration: cameraItem.duration,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      });
      e.dataTransfer.setData('application/x-camera-item-id', item.id);
      e.dataTransfer.effectAllowed = 'copyMove';
      if (e.currentTarget instanceof HTMLElement) {
        e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
      }
      return;
    }

    if (item.type === 'splat-effector') {
      setExternalDragPayload({
        kind: 'splat-effector',
        id: item.id,
        duration: item.duration,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      });
      e.dataTransfer.setData('application/x-splat-effector-item-id', item.id);
      e.dataTransfer.effectAllowed = 'copyMove';
      if (e.currentTarget instanceof HTMLElement) {
        e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
      }
      return;
    }

    // Handle media file drag
    const mediaFile = item as MediaFile;
    if (mediaFile.isImporting || mediaNeedsRelink(mediaFile)) {
      // File still importing or truly unresolved - only allow internal move
      e.dataTransfer.effectAllowed = 'move';
      if (e.currentTarget instanceof HTMLElement) {
        e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
      }
      return;
    }

    // Set the media file ID so Timeline can look it up
    const fileName = mediaFile.file?.name ?? mediaFile.name;
    const isAudioOnly =
      mediaFile.type === 'audio' ||
      mediaFile.file?.type.startsWith('audio/') ||
      /\.(mp3|wav|ogg|aac|m4a|flac|wma|aiff|alac|opus)$/i.test(fileName);
    setExternalDragPayload({
      kind: 'media-file',
      id: mediaFile.id,
      duration: mediaFile.duration,
      hasAudio: mediaFile.type === 'image' ? false : isAudioOnly ? true : mediaFile.hasAudio,
      isAudio: isAudioOnly,
      isVideo: !isAudioOnly,
      file: mediaFile.file,
    });
    e.dataTransfer.setData('application/x-media-file-id', mediaFile.id);
    // Mark audio-only files so timeline can restrict drop targets to audio tracks
    if (isAudioOnly) {
      e.dataTransfer.setData('application/x-media-is-audio', 'true');
    }
    e.dataTransfer.effectAllowed = 'copyMove';

    // Set drag image
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
    }
  }, [activeCompositionId]);

  // Handle drag end (clear internal drag state)
  const handleDragEnd = useCallback(() => {
    setInternalDragId(null);
    setDragOverFolderId(null);
    setMediaBoardInsertionPreview(null);
    clearExternalDragPayload();
  }, []);

  // Handle drag over folder (for internal moves and external imports)
  const handleFolderDragOver = useCallback((e: React.DragEvent, folderId: string) => {
    const isInternalDrag = e.dataTransfer.types.includes('application/x-media-panel-item');
    const hasFiles = e.dataTransfer.types.includes('Files');

    if (!isInternalDrag && !hasFiles) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = isInternalDrag ? 'move' : 'copy';
    setDragOverFolderId(folderId);
  }, []);

  // Handle drag leave folder
  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);
  }, []);

  // Handle drop on folder
  const handleFolderDrop = useCallback(async (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!e.dataTransfer.types.includes('application/x-media-panel-item')) {
      setIsExternalDragOver(false);
      await handleExternalDropImport(e.dataTransfer, folderId);
      setDragOverFolderId(null);
      setInternalDragId(null);
      return;
    }

    const itemId = e.dataTransfer.getData('application/x-media-panel-item');
    if (itemId && itemId !== folderId) {
      // Don't allow dropping a folder into itself or its children
      const draggedFolder = folders.find(f => f.id === itemId);
      if (draggedFolder) {
        // Check if target is a child of dragged folder (would create cycle)
        let parent = folders.find(f => f.id === folderId);
        while (parent) {
          if (parent.id === itemId) {
            // Would create cycle - abort
            setDragOverFolderId(null);
            setInternalDragId(null);
            return;
          }
          parent = folders.find(f => f.id === parent?.parentId);
        }
      }

      // Move item(s) to folder
      const itemsToMove = selectedIds.includes(itemId) ? selectedIds : [itemId];
      moveToFolder(itemsToMove, folderId);
    }

    setDragOverFolderId(null);
    setInternalDragId(null);
  }, [folders, selectedIds, moveToFolder, handleExternalDropImport]);

  // Handle drop on root (move out of folder or external file import)
  const handleRootDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExternalDragOver(false);

    log.debug('Drop event', { types: [...e.dataTransfer.types], filesCount: e.dataTransfer.files.length });

    // Check if this is an external file drop
    if (!e.dataTransfer.types.includes('application/x-media-panel-item')) {
      await handleExternalDropImport(e.dataTransfer, null);
      return;
    }

    // Internal drag - move to root
    const itemId = e.dataTransfer.getData('application/x-media-panel-item');
    if (itemId) {
      const itemsToMove = selectedIds.includes(itemId) ? selectedIds : [itemId];
      moveToFolder(itemsToMove, null); // null = root
    }

    setDragOverFolderId(null);
    setInternalDragId(null);
  }, [selectedIds, moveToFolder, handleExternalDropImport]);

  // Format file size
  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '–';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatBitrate = (bps?: number): string => {
    if (!bps) return '–';
    if (bps < 1000) return `${bps} bps`;
    if (bps < 1000 * 1000) return `${(bps / 1000).toFixed(0)} kbps`;
    return `${(bps / (1000 * 1000)).toFixed(1)} Mbps`;
  };

  // Name column width state (resizable)
  const [nameColumnWidth, setNameColumnWidth] = useState(() => {
    const stored = localStorage.getItem('media-panel-name-width');
    return stored ? parseInt(stored) : 250;
  });
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const handleProjectUiLoaded = () => {
      setColumnOrder(loadColumnOrder());
      setViewMode(loadMediaPanelViewMode());
      setMediaBoardViewport(loadMediaBoardViewport());
      setMediaBoardOrder(loadMediaBoardOrder());
      setMediaBoardGroupOffsets(loadMediaBoardGroupOffsets());
      setMediaBoardLayouts(loadMediaBoardLayouts());
      const storedNameWidth = localStorage.getItem('media-panel-name-width');
      setNameColumnWidth(storedNameWidth ? parseInt(storedNameWidth, 10) : 250);
      setGridFolderId(null);
    };

    window.addEventListener(MEDIA_PANEL_PROJECT_UI_LOADED_EVENT, handleProjectUiLoaded);
    return () => window.removeEventListener(MEDIA_PANEL_PROJECT_UI_LOADED_EVENT, handleProjectUiLoaded);
  }, []);

  // Save name column width
  useEffect(() => {
    localStorage.setItem('media-panel-name-width', String(nameColumnWidth));
  }, [nameColumnWidth]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startWidth: nameColumnWidth };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (resizeRef.current) {
        const delta = moveEvent.clientX - resizeRef.current.startX;
        const newWidth = Math.max(120, Math.min(500, resizeRef.current.startWidth + delta));
        setNameColumnWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [nameColumnWidth]);

  // Render column content for an item
  const renderColumnContent = (
    colId: ColumnId,
    item: ProjectItem,
    depth: number,
    isFolder: boolean,
    isExpanded: boolean,
    isRenaming: boolean,
    isSelected: boolean,
    mediaFile: MediaFile | null
  ) => {
    switch (colId) {
      case 'label': {
        const labelColor = 'labelColor' in item ? (item as MediaFile).labelColor : undefined;
        const hex = getLabelHex(labelColor);
        return (
          <div
            className="media-col media-col-label"
            onClick={(e) => {
              e.stopPropagation();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setLabelPickerItemId(item.id);
              setLabelPickerPos({ x: rect.left, y: rect.bottom + 2 });
            }}
          >
            <span
              className="media-label-dot"
              style={{
                background: hex === 'transparent' ? 'var(--border-color)' : hex,
                opacity: hex === 'transparent' ? 0.4 : 1,
              }}
            />
          </div>
        );
      }
      case 'name': {
        const importProgress = getItemImportProgress(item);
        return (
          <div
            className="media-col media-col-name"
            style={{ paddingLeft: `${4 + depth * 16}px`, width: nameColumnWidth, minWidth: nameColumnWidth, maxWidth: nameColumnWidth }}
          >
            {isFolder && (
              <span
                className={`media-folder-arrow ${isExpanded ? 'expanded' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolderExpanded(item.id);
                }}
              >
                ▶
              </span>
            )}
            <span className="media-item-icon">
              {isFolder
                ? <span className="media-folder-icon">&#128193;</span>
                : <FileTypeIcon type={getProjectItemIconType(item)} />
              }
            </span>
            {isRenaming ? (
              <input
                type="text"
                className="media-item-rename"
                value={renameValue}
                size={Math.max(1, renameValue.length)}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className={`media-item-name ${isSelected ? 'editable' : ''}`}
                onClick={(e) => handleNameClick(e, item.id, item.name)}
              >
                {item.name}
              </span>
            )}
            {importProgress !== null && (
              <span
                className="media-item-import-progress"
                title={`Importing: ${importProgress}%`}
              >
                {importProgress}%
              </span>
            )}
            {'proxyStatus' in item &&
              item.proxyStatus === 'ready' &&
              isProxyFrameCountComplete(
                (item as MediaFile).proxyFrameCount,
                (item as MediaFile).duration,
                (item as MediaFile).proxyFps ?? (item as MediaFile).fps
              ) && (
              <span className="media-item-proxy-badge" title="Proxy generated">P</span>
            )}
            {'proxyStatus' in item && item.proxyStatus === 'error' && (
              <span className="media-item-proxy-error" title="Proxy generation failed. Right-click to retry.">P!</span>
            )}
            {'proxyStatus' in item && item.proxyStatus === 'generating' && (
              <span className="media-item-proxy-generating" title={`Generating proxy: ${(item as MediaFile).proxyProgress || 0}%`}>
                <span className="proxy-fill-badge">
                  <span className="proxy-fill-bg">P</span>
                  <span className="proxy-fill-progress" style={{ height: `${(item as MediaFile).proxyProgress || 0}%` }}>P</span>
                </span>
                <span className="proxy-percent">{(item as MediaFile).proxyProgress || 0}%</span>
              </span>
            )}
            {/* Transcript badge with coverage fill */}
            {'transcriptStatus' in item && (item as MediaFile).transcriptStatus === 'ready' && (() => {
              const cov = (item as MediaFile).transcriptCoverage ?? 0;
              const pct = Math.round(cov * 100);
              return pct >= 100 ? (
                <span
                  className="media-item-transcript-badge"
                  title="Fully transcribed — click to open"
                  onClick={(e) => { e.stopPropagation(); handleBadgeClick(item.id, 'transcript'); }}
                >T</span>
              ) : (
                <span
                  className="media-item-transcript-fill"
                  title={`${pct}% transcribed — click to open`}
                  onClick={(e) => { e.stopPropagation(); handleBadgeClick(item.id, 'transcript'); }}
                >
                  <span className="coverage-fill-badge transcript-fill">
                    <span className="coverage-fill-bg">T</span>
                    <span className="coverage-fill-progress" style={{ height: `${pct}%` }}>T</span>
                  </span>
                </span>
              );
            })()}
            {/* Analysis badge with coverage fill */}
            {'analysisStatus' in item && (item as MediaFile).analysisStatus === 'ready' && (() => {
              const cov = (item as MediaFile).analysisCoverage ?? 0;
              const pct = Math.round(cov * 100);
              return pct >= 100 ? (
                <span
                  className="media-item-analysis-badge"
                  title="Fully analyzed — click to open"
                  onClick={(e) => { e.stopPropagation(); handleBadgeClick(item.id, 'analysis'); }}
                >A</span>
              ) : (
                <span
                  className="media-item-analysis-fill"
                  title={`${pct}% analyzed — click to open`}
                  onClick={(e) => { e.stopPropagation(); handleBadgeClick(item.id, 'analysis'); }}
                >
                  <span className="coverage-fill-badge analysis-fill">
                    <span className="coverage-fill-bg">A</span>
                    <span className="coverage-fill-progress" style={{ height: `${pct}%` }}>A</span>
                  </span>
                </span>
              );
            })()}
          </div>
        );
      }
      case 'duration': {
        const importProgress = getItemImportProgress(item);
        return (
          <div className="media-col media-col-duration">
            {importProgress !== null
              ? `Import ${importProgress}%`
              : ('duration' in item && item.duration ? formatDuration(item.duration) : '–')}
          </div>
        );
      }
      case 'resolution':
        return (
          <div className="media-col media-col-resolution" title={getGaussianSplatResolutionLabel(item) ?? undefined}>
            {getGaussianSplatResolutionLabel(item) ??
              ('width' in item && 'height' in item && item.width && item.height ? `${item.width}×${item.height}` : '–')}
          </div>
        );
      case 'fps':
        return (
          <div className="media-col media-col-fps">
            {mediaFile?.fps ? `${mediaFile.fps}` : ('type' in item && item.type === 'composition' ? (item as Composition).frameRate : '–')}
          </div>
        );
      case 'container':
        return <div className="media-col media-col-container">{getMediaFileContainerLabel(mediaFile) || '–'}</div>;
      case 'codec':
        return <div className="media-col media-col-codec">{getMediaFileCodecLabel(mediaFile) || '–'}</div>;
      case 'audio':
        return <div className="media-col media-col-audio">
          {mediaFile?.type === 'audio' ? 'Yes' :
           mediaFile?.type === 'image' ? '–' :
           mediaFile?.hasAudio === true ? 'Yes' :
           mediaFile?.hasAudio === false ? 'No' : '–'}
        </div>;
      case 'bitrate':
        return <div className="media-col media-col-bitrate">{mediaFile?.bitrate ? formatBitrate(mediaFile.bitrate) : '–'}</div>;
      case 'size':
        return <div className="media-col media-col-size">{mediaFile ? formatFileSize(mediaFile.fileSize) : '–'}</div>;
      default:
        return null;
    }
  };

  // Render a single classic-list row. Tree traversal is virtualized separately.
  const renderClassicRow = (item: ProjectItem, depth: number = 0) => {
    const isFolder = 'isExpanded' in item;
    const isSelected = selectedIds.includes(item.id);
    const isRenaming = renamingId === item.id;
    const isExpanded = isFolder && expandedFolderIds.includes(item.id);
    const isMediaFile = isImportedMediaFileItem(item);
    const needsRelink = isMediaFile && mediaNeedsRelink(item);
    const isImporting = isMediaFile && !!item.isImporting;
    const isDragTarget = isFolder && dragOverFolderId === item.id;
    const isBeingDragged = internalDragId === item.id;
    const mediaFile = isMediaFile ? item : null;

    return (
      <div key={item.id} data-item-id={item.id}>
        <div
          data-media-panel-anim-id={item.id}
          className={`media-item ${isSelected ? 'selected' : ''} ${isFolder ? 'folder' : ''} ${needsRelink ? 'no-file' : ''} ${isImporting ? 'importing' : ''} ${isDragTarget ? 'drag-target' : ''} ${isBeingDragged ? 'dragging' : ''}`}
          draggable={!isImporting}
          onDragStart={(e) => handleDragStart(e, item)}
          onDragEnd={handleDragEnd}
          onDragOver={isFolder ? (e) => handleFolderDragOver(e, item.id) : undefined}
          onDragLeave={isFolder ? handleFolderDragLeave : undefined}
          onDrop={isFolder ? (e) => handleFolderDrop(e, item.id) : undefined}
          onClick={(e) => handleItemClick(item.id, e)}
          onDoubleClick={() => handleItemDoubleClick(item)}
          onContextMenu={(e) => handleContextMenu(e, item.id)}
        >
          {columnOrder.map(colId => (
            <React.Fragment key={colId}>
              {renderColumnContent(colId, item, depth, isFolder, isExpanded, isRenaming, isSelected, mediaFile)}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  // Build hover tooltip for grid items
  const buildGridTooltip = (item: ProjectItem, isFolder: boolean, isComp: boolean): string => {
    const parts: string[] = [item.name];

    if (isFolder) {
      const children = getItemsForParent(item.id);
      parts.push(`${children.length} item${children.length !== 1 ? 's' : ''}`);
    } else if (isComp) {
      const comp = item as Composition;
      parts.push(`${comp.width}×${comp.height}`);
      parts.push(`${comp.frameRate} fps`);
      if (comp.duration) parts.push(formatDuration(comp.duration));
    } else if ('type' in item) {
      const mf = item as MediaFile;
      if (mf.type === 'gaussian-splat') {
        parts.push(...getGaussianSplatDetailLines(mf));
        const container = getMediaFileContainerLabel(mf);
        if (container) parts.push(container);
      } else if (mf.width && mf.height) {
        parts.push(`${mf.width}×${mf.height}`);
      }
      if (mf.duration) parts.push(formatDuration(mf.duration));
      const codec = getMediaFileCodecLabel(mf);
      if (codec) parts.push(codec);
      if (mf.audioCodec) parts.push(mf.audioCodec);
      if (mf.fps) parts.push(`${mf.fps} fps`);
      if (mf.fileSize) parts.push(formatFileSize(mf.fileSize));
      if (mf.bitrate) parts.push(formatBitrate(mf.bitrate));
    }

    return parts.join('\n');
  };

  // Render a single grid item
  const renderGridItem = (item: ProjectItem) => {
    const isFolder = 'isExpanded' in item;
    const isSelected = selectedIds.includes(item.id);
    const isMediaFile = isImportedMediaFileItem(item);
    const mediaFile = isMediaFile ? item : null;
    const isComp = !isFolder && 'type' in item && item.type === 'composition';
    const comp = isComp ? (item as Composition) : null;
    const thumbUrl = mediaFile?.thumbnailUrl;
    const isDragTarget = isFolder && dragOverFolderId === item.id;
    const isImporting = !!mediaFile?.isImporting;
    const importProgress = getItemImportProgress(item);

    // Duration badge: videos + compositions
    const duration = mediaFile?.duration || comp?.duration;

    // Folder item count
    const folderCount = isFolder ? getItemsForParent(item.id).length : 0;

    return (
      <div key={item.id} data-item-id={item.id}>
        <div
          data-media-panel-anim-id={item.id}
          className={`media-grid-item ${isSelected ? 'selected' : ''} ${isFolder ? 'folder' : ''} ${isDragTarget ? 'drag-target' : ''} ${isImporting ? 'importing' : ''}`}
          draggable={!isImporting}
          onDragStart={(e) => handleDragStart(e, item)}
          onDragEnd={handleDragEnd}
          onDragOver={isFolder ? (e) => handleFolderDragOver(e, item.id) : undefined}
          onDragLeave={isFolder ? handleFolderDragLeave : undefined}
          onDrop={isFolder ? (e) => handleFolderDrop(e, item.id) : undefined}
          onClick={(e) => handleItemClick(item.id, e)}
          onDoubleClick={() => handleItemDoubleClick(item)}
          onContextMenu={(e) => handleContextMenu(e, item.id)}
          title={buildGridTooltip(item, isFolder, isComp)}
        >
          <div className="media-grid-thumb">
            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt=""
                draggable={false}
                onError={mediaFile ? () => { void refreshFileUrls(mediaFile.id); } : undefined}
              />
            ) : (
              <div className="media-grid-thumb-placeholder">
                <FileTypeIcon type={isFolder ? 'folder' : isComp ? 'composition' : getProjectItemIconType(item)} large />
              </div>
            )}
            {duration ? (
              <span className="media-grid-duration">{formatDuration(duration)}</span>
            ) : null}
            {isFolder && folderCount > 0 && (
              <span className="media-grid-badge">{folderCount}</span>
            )}
            {importProgress !== null && (
              <span className="media-grid-import-badge">{importProgress}%</span>
            )}
          </div>
          <div className="media-grid-name" title={item.name}>{item.name}</div>
        </div>
      </div>
    );
  };

  const totalItems = (
    files.length +
    compositions.length +
    folders.length +
    textItems.length +
    solidItems.length +
    meshItems.length +
    cameraItems.length +
    splatEffectorItems.length
  );

  const projectItemsByParentId = useMemo(() => {
    const itemsByParentId = new Map<string | null, ProjectItem[]>();
    const append = (item: ProjectItem) => {
      const parentId = item.parentId ?? null;
      const items = itemsByParentId.get(parentId);
      if (items) {
        items.push(item);
      } else {
        itemsByParentId.set(parentId, [item]);
      }
    };

    folders.forEach(append);
    compositions.forEach(append);
    textItems.forEach(append);
    solidItems.forEach(append);
    meshItems.forEach(append);
    cameraItems.forEach(append);
    splatEffectorItems.forEach(append);
    files.forEach(append);

    return itemsByParentId;
  }, [files, compositions, folders, textItems, solidItems, meshItems, cameraItems, splatEffectorItems]);

  const getItemsForParent = useCallback(
    (parentId: string | null) => projectItemsByParentId.get(parentId) ?? [],
    [projectItemsByParentId],
  );

  const classicExpandedFolderIdSet = useMemo(() => new Set(expandedFolderIds), [expandedFolderIds]);
  const classicRows = useMemo<ClassicListRow[]>(() => {
    const rows: ClassicListRow[] = [];
    const appendRows = (items: ProjectItem[], depth: number) => {
      for (const item of sortItems(items)) {
        rows.push({ item, depth });
        if ('isExpanded' in item && classicExpandedFolderIdSet.has(item.id)) {
          appendRows(getItemsForParent(item.id), depth + 1);
        }
      }
    };

    appendRows(getItemsForParent(null), 0);
    return rows;
  }, [
    sortItems,
    getItemsForParent,
    classicExpandedFolderIdSet,
  ]);

  const classicVisibleRange = useMemo(() => {
    const height = Math.max(classicListViewport.height, CLASSIC_ROW_HEIGHT);
    const start = Math.max(0, Math.floor(classicListViewport.scrollTop / CLASSIC_ROW_HEIGHT) - CLASSIC_OVERSCAN_ROWS);
    const visibleCount = Math.ceil(height / CLASSIC_ROW_HEIGHT) + CLASSIC_OVERSCAN_ROWS * 2;
    const end = Math.min(classicRows.length, start + visibleCount);
    return { start, end };
  }, [classicListViewport.height, classicListViewport.scrollTop, classicRows.length]);

  const classicVisibleRows = useMemo(
    () => classicRows.slice(classicVisibleRange.start, classicVisibleRange.end),
    [classicRows, classicVisibleRange.end, classicVisibleRange.start],
  );

  const classicTopSpacerHeight = classicVisibleRange.start * CLASSIC_ROW_HEIGHT;
  const classicBottomSpacerHeight = Math.max(0, (classicRows.length - classicVisibleRange.end) * CLASSIC_ROW_HEIGHT);

  const mediaBoardItems = useMemo<MediaBoardItem[]>(() => ([
    ...files,
    ...compositions,
    ...folders,
    ...textItems,
    ...solidItems,
    ...meshItems,
    ...cameraItems,
    ...splatEffectorItems,
  ]), [files, compositions, folders, textItems, solidItems, meshItems, cameraItems, splatEffectorItems]);

  const mediaBoardItemIds = useMemo(() => new Set(mediaBoardItems.map((item) => item.id)), [mediaBoardItems]);
  const mediaBoardItemsById = useMemo(() => new Map(mediaBoardItems.map((item) => [item.id, item])), [mediaBoardItems]);
  const mediaBoardFoldersById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

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

  useEffect(() => {
    setMediaBoardOrder((current) => {
      let changed = false;
      const validFolderKeys = new Set([
        MEDIA_BOARD_ROOT_ORDER_KEY,
        ...folders.map((folder) => folder.id),
      ]);
      const next: Record<string, string[]> = {};

      Object.entries(current).forEach(([folderKey, ids]) => {
        if (!validFolderKeys.has(folderKey)) {
          changed = true;
          return;
        }

        const filteredIds = normalizeMediaBoardOrderIds(ids, mediaBoardItemIds);
        if (filteredIds.length !== ids.length) {
          changed = true;
        }
        if (filteredIds.length > 0) {
          next[folderKey] = filteredIds;
        }
      });

      return changed ? next : current;
    });
  }, [folders, mediaBoardItemIds]);

  useEffect(() => {
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
    setMediaBoardLayouts((current) => {
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
        if (!mediaBoardItemIds.has(itemId)) {
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

      return changed ? next : current;
    });
  }, [mediaBoardItemIds, mediaBoardItems, sortItems]);

  const mediaBoardLayout = useMemo(() => {
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
    const itemsById = new Map(mediaBoardItems.map((item) => [item.id, item]));
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
  }, [folders, mediaBoardInsertionPreview, mediaBoardItems, mediaBoardLayouts]);

  const mediaBoardPlacementsById = useMemo(() => {
    return new Map(mediaBoardLayout.placements.map((placement) => [placement.item.id, placement]));
  }, [mediaBoardLayout.placements]);

  const mediaBoardVisibleRect = useMemo(() => getMediaBoardVisibleRect(
    mediaBoardViewport,
    mediaBoardCanvasSize,
  ), [mediaBoardCanvasSize, mediaBoardViewport]);

  const mediaBoardRenderLod = useMemo(() => ({
    compact: mediaBoardViewport.zoom <= MEDIA_BOARD_COMPACT_LOD_ZOOM,
    showImages: mediaBoardViewport.zoom >= MEDIA_BOARD_THUMBNAIL_LOD_MIN_ZOOM,
  }), [mediaBoardViewport.zoom]);

  const visibleMediaBoardGroups = useMemo(() => (
    mediaBoardLayout.groups.filter((group) => mediaBoardGroupIntersectsVisibleRect(group, mediaBoardVisibleRect))
  ), [mediaBoardLayout.groups, mediaBoardVisibleRect]);

  const visibleMediaBoardInsertGaps = useMemo(() => (
    mediaBoardLayout.insertGaps.filter((gap) => mediaBoardNodeIntersectsVisibleRect(gap.layout, mediaBoardVisibleRect))
  ), [mediaBoardLayout.insertGaps, mediaBoardVisibleRect]);

  const visibleMediaBoardPlacements = useMemo(() => (
    mediaBoardLayout.placements.filter((placement) => (
      placement.isDraggingPreview
      || selectedIdSet.has(placement.item.id)
      || mediaBoardNodeIntersectsVisibleRect(placement.layout, mediaBoardVisibleRect)
    ))
  ), [mediaBoardLayout.placements, mediaBoardVisibleRect, selectedIdSet]);

  const visibleMediaBoardThumbnailKey = useMemo(() => {
    if (!mediaBoardRenderLod.showImages) return '';

    const centerX = (mediaBoardVisibleRect.left + mediaBoardVisibleRect.right) / 2;
    const centerY = (mediaBoardVisibleRect.top + mediaBoardVisibleRect.bottom) / 2;

    return visibleMediaBoardPlacements
      .map((placement) => {
        const { item, layout } = placement;
        if (
          !isImportedMediaFileItem(item)
          || item.thumbnailUrl
          || item.isImporting
          || (item.type !== 'image' && item.type !== 'video')
        ) {
          return null;
        }

        const itemCenterX = layout.x + layout.width / 2;
        const itemCenterY = layout.y + layout.height / 2;
        return {
          id: item.id,
          area: layout.width * layout.height,
          distance: Math.hypot(itemCenterX - centerX, itemCenterY - centerY),
        };
      })
      .filter((entry): entry is { id: string; area: number; distance: number } => entry !== null)
      .toSorted((a, b) => (b.area - a.area) || (a.distance - b.distance))
      .slice(0, MEDIA_BOARD_THUMBNAIL_REQUEST_LIMIT)
      .map((entry) => entry.id)
      .join('\n');
  }, [mediaBoardRenderLod.showImages, mediaBoardVisibleRect, visibleMediaBoardPlacements]);

  useEffect(() => {
    if (viewMode !== 'board' || !visibleMediaBoardThumbnailKey) return;

    const thumbnailIds = visibleMediaBoardThumbnailKey.split('\n').filter(Boolean);
    let cancelled = false;
    let nextIndex = 0;
    const workerCount = Math.min(MEDIA_BOARD_THUMBNAIL_WORKER_COUNT, thumbnailIds.length);

    const runWorker = async () => {
      while (!cancelled) {
        const id = thumbnailIds[nextIndex];
        nextIndex += 1;
        if (!id) return;
        await waitForMediaBoardThumbnailTurn();
        if (cancelled) return;
        await ensureFileThumbnail(id);
      }
    };

    for (let index = 0; index < workerCount; index += 1) {
      void runWorker();
    }

    return () => {
      cancelled = true;
    };
  }, [ensureFileThumbnail, viewMode, visibleMediaBoardThumbnailKey]);

  const screenToMediaBoard = useCallback((clientX: number, clientY: number) => {
    const rect = boardCanvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - mediaBoardViewport.panX) / mediaBoardViewport.zoom,
      y: (clientY - rect.top - mediaBoardViewport.panY) / mediaBoardViewport.zoom,
    };
  }, [mediaBoardViewport.panX, mediaBoardViewport.panY, mediaBoardViewport.zoom]);

  const openBoardAI = useCallback(() => {
    useDockStore.getState().activatePanelType('ai-video');
    closeContextMenu();
  }, [closeContextMenu]);

  const setMediaBoardPerformanceMode = useCallback((enabled: boolean) => {
    boardWrapperRef.current?.classList.toggle('board-interacting', enabled);
  }, []);

  const startMediaBoardPanGesture = useCallback((e: React.MouseEvent, options?: { clearSelectionOnTap?: boolean }) => {
    if (e.button === 1) {
      e.preventDefault();
    }
    closeContextMenu();

    const startX = e.clientX;
    const startY = e.clientY;
    const startViewport = { ...mediaBoardViewport };
    let pendingViewport = startViewport;
    let didPan = false;

    const schedulePreview = () => {
      if (boardInteractionFrameRef.current !== null) return;
      boardInteractionFrameRef.current = window.requestAnimationFrame(() => {
        boardInteractionFrameRef.current = null;
        const inner = boardCanvasInnerRef.current;
        if (!inner) return;
        inner.style.transform = `translate(${pendingViewport.panX}px, ${pendingViewport.panY}px) scale(${pendingViewport.zoom})`;
        boardWrapperRef.current?.style.setProperty('--media-board-grid-x', `${pendingViewport.panX * MEDIA_BOARD_GRID_PARALLAX}px`);
        boardWrapperRef.current?.style.setProperty('--media-board-grid-y', `${pendingViewport.panY * MEDIA_BOARD_GRID_PARALLAX}px`);
      });
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const distance = Math.hypot(dx, dy);
      if (!didPan && distance < MEDIA_BOARD_DRAG_START_DISTANCE) return;

      if (!didPan) {
        didPan = true;
        moveEvent.preventDefault();
        setMediaBoardPerformanceMode(true);
      }

      moveEvent.preventDefault();
      pendingViewport = {
        ...startViewport,
        panX: startViewport.panX + dx,
        panY: startViewport.panY + dy,
      };
      schedulePreview();
    };

    const handleMouseUp = () => {
      if (boardInteractionFrameRef.current !== null) {
        window.cancelAnimationFrame(boardInteractionFrameRef.current);
        boardInteractionFrameRef.current = null;
      }
      setMediaBoardPerformanceMode(false);

      if (didPan) {
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
  }, [closeContextMenu, mediaBoardViewport, setMediaBoardPerformanceMode, setSelection]);

  const startMediaBoardMarqueeGesture = useCallback((e: React.MouseEvent) => {
    const startPoint = screenToMediaBoard(e.clientX, e.clientY);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const initialSelection = e.ctrlKey || e.metaKey ? selectedIds : [];
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
      const distance = Math.hypot(moveEvent.clientX - startClientX, moveEvent.clientY - startClientY);
      if (!didSelect && distance < MEDIA_BOARD_DRAG_START_DISTANCE) return;

      didSelect = true;
      closeContextMenu();
      const currentPoint = screenToMediaBoard(moveEvent.clientX, moveEvent.clientY);
      const rect = {
        left: Math.min(startPoint.x, currentPoint.x),
        right: Math.max(startPoint.x, currentPoint.x),
        top: Math.min(startPoint.y, currentPoint.y),
        bottom: Math.max(startPoint.y, currentPoint.y),
      };
      setMediaBoardMarquee({
        startX: startPoint.x,
        startY: startPoint.y,
        currentX: currentPoint.x,
        currentY: currentPoint.y,
      });
      updateSelectionForRect(rect);
    };

    const handleMouseUp = () => {
      if (didSelect) {
        suppressNextMediaBoardContextMenu();
      }
      setMediaBoardMarquee(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
  }, [closeContextMenu, mediaBoardLayout.placements, screenToMediaBoard, selectedIds, setSelection, suppressNextMediaBoardContextMenu]);

  const getMediaBoardGroupsAtPoint = useCallback((point: { x: number; y: number }) => {
    return mediaBoardLayout.groups
      .filter((group) => (
        point.x >= group.x
        && point.x <= group.x + group.width
        && point.y >= group.y
        && point.y <= group.y + group.height
      ))
      .sort((a, b) => b.depth - a.depth);
  }, [mediaBoardLayout.groups]);

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
        if (parent.id === itemId) {
          return false;
        }
        parent = parent.parentId ? folders.find((folder) => folder.id === parent!.parentId) : undefined;
      }
      return true;
    });
  }, [folders]);

  const handleMediaBoardWorkspaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (consumeSuppressedMediaBoardContextMenu()) return;
    const point = screenToMediaBoard(e.clientX, e.clientY);
    const targetGroup = getMediaBoardGroupAtPoint(point);
    handleContextMenu(e, undefined, targetGroup?.id ?? null);
  }, [consumeSuppressedMediaBoardContextMenu, getMediaBoardGroupAtPoint, handleContextMenu, screenToMediaBoard]);

  const getMediaBoardInsertTarget = useCallback((
    point: { x: number; y: number },
    movingIds: string[],
    groupPoint = point,
  ) => {
    const groupsAtPoint = getMediaBoardGroupsAtPoint(groupPoint);
    const rootGroup = mediaBoardLayout.groups.find((group) => group.id === null) ?? null;
    const isPointInsideGroupBody = (group: MediaBoardGroupLayout) => {
      if (group.id === null) return true;
      const chrome = getMediaBoardGroupChrome(group.id);
      if (group.itemCount === 0) {
        return (
          groupPoint.x >= group.x
          && groupPoint.x <= group.x + group.width
          && groupPoint.y >= group.y
          && groupPoint.y <= group.y + group.height
        );
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
    const columnPitch = MEDIA_BOARD_SLOT_CELL_WIDTH;
    const rowPitch = MEDIA_BOARD_SLOT_CELL_HEIGHT;
    const hoveredSlot = targetSlots.find(({ layout }) => (
      groupPoint.x >= layout.x
      && groupPoint.x <= layout.x + layout.width
      && groupPoint.y >= layout.y
      && groupPoint.y <= layout.y + layout.height
    ));
    const clampToFolderBody = targetGroup.id !== null;
    const clampBoardPosition = (value: number) => clampToFolderBody ? Math.max(0, value) : value;
    const targetPosition = hoveredSlot
      ? {
          x: clampBoardPosition(hoveredSlot.layout.x - bodyLeft),
          y: clampBoardPosition(hoveredSlot.layout.y - bodyTop),
        }
      : {
          x: clampBoardPosition(Math.round((point.x - bodyLeft) / columnPitch) * columnPitch),
          y: clampBoardPosition(Math.round((point.y - bodyTop) / rowPitch) * rowPitch),
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
    setMediaBoardInsertionPreview((current) => {
      if (
        current
        && current.targetGroupId === target.groupId
        && current.targetPosition.x === target.position.x
        && current.targetPosition.y === target.position.y
        && current.movingIds.join('\u0000') === movingKey
      ) {
        return current;
      }
      return {
        movingIds,
        sourceLayouts,
        targetGroupId: target.groupId,
        targetPosition: target.position,
      };
    });
    return target;
  }, [getMediaBoardInsertTarget]);

  const commitMediaBoardOrderChange = useCallback((
    movingIds: string[],
    targetGroupId: string | null,
    targetPosition: MediaBoardGroupOffset,
    options?: { sourceLayouts?: Record<string, MediaBoardNodeLayout>; anchorId?: string },
  ) => {
    if (movingIds.length === 0) return;
    const normalizedMovingIds = movingIds.filter((id) => mediaBoardItemsById.has(id));
    if (normalizedMovingIds.length === 0) return;
    const movingIdSet = new Set(normalizedMovingIds);

    const columnPitch = MEDIA_BOARD_SLOT_CELL_WIDTH;
    const rowPitch = MEDIA_BOARD_SLOT_CELL_HEIGHT;
    const targetGroup = mediaBoardLayout.groups.find((group) => group.id === targetGroupId) ?? null;
    const targetChrome = getMediaBoardGroupChrome(targetGroupId);
    const targetBodyLeft = targetGroup ? targetGroup.x + targetChrome.padding : 0;
    const targetBodyTop = targetGroup ? targetGroup.y + targetChrome.headerHeight + targetChrome.padding : 0;
    const allowNegativePositions = targetGroupId === null;
    const clampLocalPosition = (value: number) => allowNegativePositions ? value : Math.max(0, value);

    const getItemSize = (id: string) => {
      const placement = mediaBoardPlacementsById.get(id);
      if (placement) {
        return { width: placement.layout.width, height: placement.layout.height };
      }
      const item = mediaBoardItemsById.get(id);
      return item ? getMediaBoardNodeSize(item) : { width: MEDIA_BOARD_EMPTY_SLOT_WIDTH, height: MEDIA_BOARD_EMPTY_SLOT_HEIGHT };
    };

    const getFallbackLocalPosition = (id: string, fallbackIndex: number): MediaBoardGroupOffset => {
      const placement = mediaBoardPlacementsById.get(id);
      if (placement && placement.groupId === targetGroupId) {
        return {
          x: clampLocalPosition(placement.layout.x - targetBodyLeft),
          y: clampLocalPosition(placement.layout.y - targetBodyTop),
        };
      }
      return {
        x: fallbackIndex * columnPitch,
        y: 0,
      };
    };

    const sourceLayouts = options?.sourceLayouts ?? {};
    const anchorSourceLayout = (options?.anchorId ? sourceLayouts[options.anchorId] : undefined)
      ?? normalizedMovingIds.map((id) => sourceLayouts[id]).find((layout): layout is MediaBoardNodeLayout => Boolean(layout))
      ?? null;

    const getMovingDesiredPosition = (id: string, index: number): MediaBoardGroupOffset => {
      const sourceLayout = sourceLayouts[id];
      if (sourceLayout && anchorSourceLayout) {
        return {
          x: targetPosition.x + (sourceLayout.x - anchorSourceLayout.x),
          y: targetPosition.y + (sourceLayout.y - anchorSourceLayout.y),
        };
      }
      return {
        x: targetPosition.x + (index * columnPitch),
        y: targetPosition.y,
      };
    };

    setMediaBoardLayouts((current) => {
      const next = { ...current };
      const occupied = new Set<string>();
      let changed = false;

      const getSpan = (size: { width: number; height: number }) => ({
        columns: Math.max(1, Math.ceil((size.width + MEDIA_BOARD_NODE_GAP) / columnPitch)),
        rows: Math.max(1, Math.ceil((size.height + MEDIA_BOARD_NODE_GAP) / rowPitch)),
      });

      const canPlace = (column: number, row: number, span: { columns: number; rows: number }) => {
        if (!allowNegativePositions && (column < 0 || row < 0)) return false;
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

      mediaBoardItems
        .filter((item) => !movingIdSet.has(item.id) && (item.parentId ?? null) === targetGroupId)
        .forEach((item, index) => {
          const size = getItemSize(item.id);
          const desired = current[item.id] ?? getFallbackLocalPosition(item.id, index);
          const span = getSpan(size);
          const column = allowNegativePositions
            ? Math.round(desired.x / columnPitch)
            : Math.max(0, Math.round(desired.x / columnPitch));
          const row = allowNegativePositions
            ? Math.round(desired.y / rowPitch)
            : Math.max(0, Math.round(desired.y / rowPitch));
          markOccupied(column, row, span);
        });

      normalizedMovingIds.forEach((id, index) => {
        const desired = getMovingDesiredPosition(id, index);
        const size = getItemSize(id);
        const entry = { id, desired, size };
        const span = getSpan(entry.size);
        const initialColumn = allowNegativePositions
          ? Math.round(entry.desired.x / columnPitch)
          : Math.max(0, Math.round(entry.desired.x / columnPitch));
        const initialRow = allowNegativePositions
          ? Math.round(entry.desired.y / rowPitch)
          : Math.max(0, Math.round(entry.desired.y / rowPitch));
        let column = initialColumn;
        let row = initialRow;
        let attempts = 0;
        while (!canPlace(column, row, span)) {
          column += 1;
          attempts += 1;
          if (attempts > 10000) {
            row += 1;
            column = initialColumn;
            attempts = 0;
          }
        }
        markOccupied(column, row, span);

        const resolvedPosition = {
          x: column * columnPitch,
          y: row * rowPitch,
        };
        if (next[entry.id]?.x !== resolvedPosition.x || next[entry.id]?.y !== resolvedPosition.y) {
          next[entry.id] = resolvedPosition;
          changed = true;
        }
      });

      return changed ? next : current;
    });

    moveToFolder(normalizedMovingIds, targetGroupId);
  }, [mediaBoardItems, mediaBoardItemsById, mediaBoardLayout.groups, mediaBoardPlacementsById, moveToFolder, setMediaBoardLayouts]);

  const getMediaBoardExternalDragPayload = useCallback((item: MediaBoardItem): ExternalDragPayload | null => {
    if (isMediaBoardFolder(item)) return null;

    if (item.type === 'composition') {
      const comp = item as Composition;
      const inSlotView = useTimelineStore.getState().slotGridProgress > 0.5;
      if (comp.id === activeCompositionId && !inSlotView) return null;
      return {
        kind: 'composition',
        id: comp.id,
        duration: comp.timelineData?.duration ?? comp.duration ?? 5,
        hasAudio: true,
        isAudio: false,
        isVideo: true,
      };
    }

    if (item.type === 'text') {
      return {
        kind: 'text',
        id: item.id,
        duration: item.duration,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      };
    }

    if (item.type === 'solid') {
      return {
        kind: 'solid',
        id: item.id,
        duration: item.duration,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      };
    }

    if (item.type === 'model' && 'meshType' in item) {
      return {
        kind: 'mesh',
        id: item.id,
        duration: item.duration,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
        meshType: item.meshType,
      };
    }

    if (item.type === 'camera') {
      return {
        kind: 'camera',
        id: item.id,
        duration: item.duration,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      };
    }

    if (item.type === 'splat-effector') {
      return {
        kind: 'splat-effector',
        id: item.id,
        duration: item.duration,
        hasAudio: false,
        isAudio: false,
        isVideo: true,
      };
    }

    if (isImportedMediaFileItem(item) && item.file && !item.isImporting) {
      const isAudioOnly =
        item.file.type.startsWith('audio/') ||
        /\.(mp3|wav|ogg|aac|m4a|flac|wma|aiff|alac|opus)$/i.test(item.file.name);
      return {
        kind: 'media-file',
        id: item.id,
        duration: item.duration,
        hasAudio: item.type === 'image' ? false : isAudioOnly ? true : item.hasAudio,
        isAudio: isAudioOnly,
        isVideo: !isAudioOnly,
        file: item.file,
      };
    }

    return null;
  }, [activeCompositionId]);

  const startMediaBoardNodeMoveGesture = useCallback((e: React.MouseEvent, item: MediaBoardItem) => {
    const requestedMoveIds = selectedIds.includes(item.id)
      ? selectedIds.filter((id) => mediaBoardItemIds.has(id))
      : [item.id];
    const selectedMoveIds = getMediaBoardTopLevelMoveIds(requestedMoveIds);
    const boardOrderedMoveIds = mediaBoardLayout.placements
      .filter((placement) => selectedMoveIds.includes(placement.item.id))
      .sort((a, b) => (a.layout.y - b.layout.y) || (a.layout.x - b.layout.x) || (a.slotIndex - b.slotIndex))
      .map((placement) => placement.item.id);
    const moveIds = boardOrderedMoveIds.length > 0 ? boardOrderedMoveIds : selectedMoveIds;
    const startLayouts = moveIds.map((id) => {
      const placement = mediaBoardPlacementsById.get(id);
      return {
        id,
        layout: placement?.defaultLayout ?? placement?.layout,
      };
    }).filter((entry): entry is { id: string; layout: MediaBoardNodeLayout } => !!entry.layout);

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
    const startX = e.clientX;
    const startY = e.clientY;
    const startViewport = { ...mediaBoardViewport };
    let liveViewport = { ...mediaBoardViewport };
    let didDrag = false;
    let previewDx = 0;
    let previewDy = 0;
    let latestClientX = startX;
    let latestClientY = startY;
    let latestTimelineHandoffActive = false;
    let timelineBridgeActive = false;
    let latestInsertTarget: { groupId: string | null; position: MediaBoardGroupOffset } | null = null;
    let autoPanVelocity = { x: 0, y: 0 };
    let lastAutoPanTime: number | null = null;

    const pointToBoard = (clientX: number, clientY: number, viewport = liveViewport) => {
      const rect = boardCanvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.panX) / viewport.zoom,
        y: (clientY - rect.top - viewport.panY) / viewport.zoom,
      };
    };

    const applyLiveViewportPreview = () => {
      const inner = boardCanvasInnerRef.current;
      if (!inner) return;
      inner.style.transform = `translate(${liveViewport.panX}px, ${liveViewport.panY}px) scale(${liveViewport.zoom})`;
      boardWrapperRef.current?.style.setProperty('--media-board-grid-x', `${liveViewport.panX * MEDIA_BOARD_GRID_PARALLAX}px`);
      boardWrapperRef.current?.style.setProperty('--media-board-grid-y', `${liveViewport.panY * MEDIA_BOARD_GRID_PARALLAX}px`);
    };

    const isTimelineHandoffTarget = () => {
      const rect = boardCanvasRef.current?.getBoundingClientRect();
      if (!rect || !timelineDragPayload) return false;
      const outsideX = latestClientX < rect.left
        ? rect.left - latestClientX
        : latestClientX > rect.right
          ? latestClientX - rect.right
          : 0;
      const outsideY = latestClientY < rect.top
        ? rect.top - latestClientY
        : latestClientY > rect.bottom
          ? latestClientY - rect.bottom
          : 0;
      const outsideDistance = Math.max(outsideX, outsideY);
      if (outsideDistance < MEDIA_BOARD_TIMELINE_HANDOFF_DISTANCE_PX) return false;

      const elementAtPoint = document.elementFromPoint(latestClientX, latestClientY);
      const targetElement = elementAtPoint instanceof HTMLElement ? elementAtPoint : null;
      return Boolean(targetElement?.closest('.track-lane[data-track-id], .new-track-drop-zone'));
    };

    const syncTimelineBridge = (phase: 'move' | 'drop' | 'cancel' = 'move') => {
      if (!timelineDragPayload) {
        latestTimelineHandoffActive = false;
        return;
      }

      if (phase === 'cancel') {
        if (timelineBridgeActive) {
          dispatchExternalDragBridgeEvent({ phase: 'cancel', clientX: latestClientX, clientY: latestClientY });
        }
        timelineBridgeActive = false;
        latestTimelineHandoffActive = false;
        clearExternalDragPayload();
        return;
      }

      latestTimelineHandoffActive = isTimelineHandoffTarget();
      if (!latestTimelineHandoffActive) {
        if (timelineBridgeActive) {
          dispatchExternalDragBridgeEvent({ phase: 'cancel', clientX: latestClientX, clientY: latestClientY });
        }
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
      if (latestTimelineHandoffActive) {
        latestInsertTarget = null;
        setMediaBoardInsertionPreview(null);
        return;
      }
      const insertionPoint = anchorLayout
        ? { x: anchorLayout.x + previewDx, y: anchorLayout.y + previewDy }
        : pointToBoard(latestClientX, latestClientY);
      const groupPoint = pointToBoard(latestClientX, latestClientY);
      latestInsertTarget = updateMediaBoardInsertionPreview(
        insertionPoint,
        moveIds,
        sourceLayouts,
        groupPoint,
      );
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
        applyLiveViewportPreview();
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
      liveViewport = {
        ...liveViewport,
        panX: liveViewport.panX + autoPanVelocity.x * dt,
        panY: liveViewport.panY + autoPanVelocity.y * dt,
      };
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

      autoPanVelocity = {
        x: resolveAxisVelocity(latestClientX - rect.left, rect.right - latestClientX),
        y: resolveAxisVelocity(latestClientY - rect.top, rect.bottom - latestClientY),
      };

      if ((autoPanVelocity.x !== 0 || autoPanVelocity.y !== 0) && boardAutoPanFrameRef.current === null) {
        boardAutoPanFrameRef.current = window.requestAnimationFrame(tickAutoPan);
      } else if (autoPanVelocity.x === 0 && autoPanVelocity.y === 0) {
        stopAutoPan();
      }
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      latestClientX = moveEvent.clientX;
      latestClientY = moveEvent.clientY;
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!didDrag && distance < MEDIA_BOARD_DRAG_START_DISTANCE) return;

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
      updatePreviewDelta();
      updateInsertionPreview();
      updateAutoPanVelocity();
      schedulePreview();
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
        setMediaBoardViewport(liveViewport);

        if (latestTimelineHandoffActive && timelineDragPayload) {
          syncTimelineBridge('drop');
          timelineBridgeActive = false;
          clearExternalDragPayload();
        } else {
          syncTimelineBridge('cancel');
          const insertionPoint = anchorLayout
            ? { x: anchorLayout.x + previewDx, y: anchorLayout.y + previewDy }
            : pointToBoard(latestClientX, latestClientY);
          const groupPoint = pointToBoard(latestClientX, latestClientY);
          const target = latestInsertTarget ?? getMediaBoardInsertTarget(insertionPoint, moveIds, groupPoint);
          if (target) {
            commitMediaBoardOrderChange(moveIds, target.groupId, target.position, {
              sourceLayouts,
              anchorId: item.id,
            });
          }
        }
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => setMediaBoardPerformanceMode(false));
        });
      } else {
        syncTimelineBridge('cancel');
        setMediaBoardPerformanceMode(false);
      }

      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      if (didDrag) {
        window.setTimeout(() => {
          window.removeEventListener('contextmenu', handleWindowContextMenu, true);
        }, 350);
      } else {
        window.removeEventListener('contextmenu', handleWindowContextMenu, true);
      }
    };

    const handleWindowContextMenu = (contextEvent: MouseEvent) => {
      if (!didDrag) return;
      contextEvent.preventDefault();
      contextEvent.stopPropagation();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
    window.addEventListener('contextmenu', handleWindowContextMenu, true);
  }, [
    closeContextMenu,
    commitMediaBoardOrderChange,
    getMediaBoardExternalDragPayload,
    getMediaBoardInsertTarget,
    getMediaBoardTopLevelMoveIds,
    mediaBoardItemIds,
    mediaBoardLayout.placements,
    mediaBoardPlacementsById,
    mediaBoardViewport,
    selectedIds,
    setMediaBoardPerformanceMode,
    suppressNextMediaBoardContextMenu,
    updateMediaBoardInsertionPreview,
  ]);

  const handleMediaBoardWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = boardCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    setMediaBoardViewport((current) => {
      const nextZoom = Math.min(
        MEDIA_BOARD_PAN_ZOOM_MAX,
        Math.max(MEDIA_BOARD_PAN_ZOOM_MIN, current.zoom * zoomDelta),
      );
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      return {
        zoom: nextZoom,
        panX: cursorX - ((cursorX - current.panX) * (nextZoom / current.zoom)),
        panY: cursorY - ((cursorY - current.panY) * (nextZoom / current.zoom)),
      };
    });
  }, []);

  const handleMediaBoardMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.media-board-node, .media-board-group.folder-group, button, input, .context-menu')) return;

    if (e.button === 2) {
      startMediaBoardMarqueeGesture(e);
      return;
    }

    if (e.button !== 0 && e.button !== 1) return;
    startMediaBoardPanGesture(e, { clearSelectionOnTap: e.button === 0 && !e.ctrlKey && !e.metaKey });
  }, [startMediaBoardMarqueeGesture, startMediaBoardPanGesture]);

  const handleMediaBoardNodeMouseDown = useCallback((e: React.MouseEvent, item: MediaBoardItem) => {
    const target = e.target as HTMLElement;
    if (target.closest('.media-board-node-timeline-drag, button, input')) return;

    if (e.button === 2) {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        startMediaBoardMarqueeGesture(e);
        return;
      }
      if (!selectedIds.includes(item.id)) {
        setSelection([item.id]);
      }
      startMediaBoardNodeMoveGesture(e, item);
      return;
    }

    if (e.button !== 0) return;

    e.stopPropagation();
    if (e.detail >= 2) return;

    handleItemClick(item.id, e);

    startMediaBoardPanGesture(e);
  }, [
    handleItemClick,
    setSelection,
    selectedIds,
    startMediaBoardMarqueeGesture,
    startMediaBoardNodeMoveGesture,
    startMediaBoardPanGesture,
  ]);

  const updateMediaBoardInsertionFromNativeDrag = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-media-panel-item')) {
      setMediaBoardInsertionPreview(null);
      return false;
    }

    const itemId = e.dataTransfer.getData('application/x-media-panel-item') || internalDragId || '';
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
      if (placement) {
        layouts[id] = placement.defaultLayout;
      }
      return layouts;
    }, {});

    const point = screenToMediaBoard(e.clientX, e.clientY);
    updateMediaBoardInsertionPreview(point, movingIds, sourceLayouts, point);
    return true;
  }, [
    getMediaBoardTopLevelMoveIds,
    internalDragId,
    mediaBoardPlacementsById,
    screenToMediaBoard,
    selectedIds,
    updateMediaBoardInsertionPreview,
  ]);

  const handleMediaBoardDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExternalDragOver(false);
    setMediaBoardInsertionPreview(null);

    if (e.dataTransfer.types.includes('application/x-media-panel-item')) {
      const itemId = e.dataTransfer.getData('application/x-media-panel-item');
      if (itemId) {
        const itemsToMove = getMediaBoardTopLevelMoveIds(selectedIds.includes(itemId) ? selectedIds : [itemId]);
        const point = screenToMediaBoard(e.clientX, e.clientY);
        const target = getMediaBoardInsertTarget(point, itemsToMove);
        if (target && canMoveItemsToMediaBoardGroup(itemsToMove, target.groupId)) {
          commitMediaBoardOrderChange(itemsToMove, target.groupId, target.position);
        }
      }
      setDragOverFolderId(null);
      setInternalDragId(null);
      return;
    }

    const point = screenToMediaBoard(e.clientX, e.clientY);
    const targetGroup = getMediaBoardGroupAtPoint(point);
    await handleExternalDropImport(e.dataTransfer, targetGroup?.id ?? null);
  }, [canMoveItemsToMediaBoardGroup, commitMediaBoardOrderChange, getMediaBoardGroupAtPoint, getMediaBoardInsertTarget, getMediaBoardTopLevelMoveIds, handleExternalDropImport, screenToMediaBoard, selectedIds]);

  const handleMediaBoardGroupDrop = useCallback(async (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMediaBoardInsertionPreview(null);

    if (e.dataTransfer.types.includes('application/x-media-panel-item')) {
      const itemId = e.dataTransfer.getData('application/x-media-panel-item');
      if (itemId) {
        const itemsToMove = getMediaBoardTopLevelMoveIds(selectedIds.includes(itemId) ? selectedIds : [itemId]);
        if (!canMoveItemsToMediaBoardGroup(itemsToMove, groupId)) {
          setDragOverFolderId(null);
          setInternalDragId(null);
          return;
        }
        const point = screenToMediaBoard(e.clientX, e.clientY);
        const target = getMediaBoardInsertTarget(point, itemsToMove);
        if (target) {
          commitMediaBoardOrderChange(itemsToMove, target.groupId, target.position);
        }
      }
      setDragOverFolderId(null);
      setInternalDragId(null);
      return;
    }

    await handleExternalDropImport(e.dataTransfer, groupId);
    setIsExternalDragOver(false);
  }, [canMoveItemsToMediaBoardGroup, commitMediaBoardOrderChange, getMediaBoardInsertTarget, getMediaBoardTopLevelMoveIds, handleExternalDropImport, screenToMediaBoard, selectedIds]);

  const handleMediaBoardGroupDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-media-panel-item') && !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-media-panel-item') ? 'move' : 'copy';
    updateMediaBoardInsertionFromNativeDrag(e);
  }, [updateMediaBoardInsertionFromNativeDrag]);

  const resetMediaBoardLayout = useCallback(() => {
    setMediaBoardOrder({});
    setMediaBoardGroupOffsets({});
    setMediaBoardLayouts({});
    setMediaBoardViewport(DEFAULT_BOARD_VIEWPORT);
  }, []);

  const renderMediaBoardNode = (placement: MediaBoardNodePlacement) => {
    const { item, layout } = placement;
    if (isMediaBoardFolder(item)) return null;

    const isSelected = selectedIdSet.has(item.id);
    const isMediaFile = isImportedMediaFileItem(item);
    const mediaFile = isMediaFile ? item : null;
    const isComp = item.type === 'composition';
    const comp = isComp ? (item as Composition) : null;
    const isTextItem = item.type === 'text';
    const textItem = isTextItem ? (item as TextItem) : null;
    const isSolidItem = item.type === 'solid';
    const solidItem = isSolidItem ? (item as SolidItem) : null;
    const thumbUrl = mediaFile?.thumbnailUrl;
    const duration = mediaFile?.duration || comp?.duration;
    const importProgress = getItemImportProgress(item);
    const labelHex = 'labelColor' in item ? getLabelHex(item.labelColor) : 'transparent';
    const title = buildGridTooltip(item, false, isComp);
    const splatStatsLabel = mediaFile?.type === 'gaussian-splat'
      ? getGaussianSplatResolutionLabel(mediaFile)
      : null;
    const resolutionLabel = splatStatsLabel ??
      ('width' in item && 'height' in item && item.width && item.height
        ? `${item.width}x${item.height}`
        : comp
          ? `${comp.width}x${comp.height}`
          : null);
    const boardCodecLabel = mediaFile?.type === 'gaussian-splat'
      ? getMediaFileContainerLabel(mediaFile)
      : getMediaFileCodecLabel(mediaFile);
    const isCompactNode = mediaBoardRenderLod.compact;
    const shouldRenderThumb = Boolean(thumbUrl && mediaBoardRenderLod.showImages);

    return (
      <div
        key={item.id}
        data-item-id={item.id}
        data-board-group-key={getMediaBoardOrderKey(placement.groupId)}
        data-media-panel-anim-id={item.id}
        className={[
          'media-board-node',
          isSelected ? 'selected' : '',
          mediaFile && mediaNeedsRelink(mediaFile) ? 'no-file' : '',
          importProgress !== null ? 'importing' : '',
          isTextItem ? 'text' : '',
          placement.isDraggingPreview ? 'drag-source-preview' : '',
          isCompactNode ? 'lod-compact' : '',
          thumbUrl && !shouldRenderThumb ? 'lod-thumbnail-paused' : '',
        ].filter(Boolean).join(' ')}
        style={{
          left: layout.x,
          top: layout.y,
          width: layout.width,
          height: layout.height,
          borderTopColor: labelHex === 'transparent' ? 'var(--border-color)' : labelHex,
        }}
        title={title}
        onMouseDown={(e) => handleMediaBoardNodeMouseDown(e, item)}
        onDoubleClick={() => { void handleItemDoubleClick(item); }}
        onContextMenu={(e) => {
          if (consumeSuppressedMediaBoardContextMenu()) {
            e.preventDefault();
            return;
          }
          handleContextMenu(e, item.id);
        }}
      >
        <div className="media-board-node-thumb">
          {isSolidItem && solidItem ? (
            <div className="media-board-solid-preview" style={{ backgroundColor: solidItem.color }} />
          ) : textItem ? (
            <div className="media-board-text-preview" style={{ color: textItem.color, fontFamily: textItem.fontFamily }}>
              {textItem.text}
            </div>
          ) : shouldRenderThumb ? (
            <img
              src={thumbUrl}
              alt=""
              draggable={false}
              loading="eager"
              decoding="async"
              onError={mediaFile ? () => { void refreshFileUrls(mediaFile.id); } : undefined}
            />
          ) : (
            <div className="media-board-node-placeholder">
              <FileTypeIcon type={isComp ? 'composition' : getProjectItemIconType(item)} large />
            </div>
          )}
          {!isCompactNode && duration ? <span className="media-board-duration">{formatDuration(duration)}</span> : null}
          {!isCompactNode && importProgress !== null ? <span className="media-board-progress">{importProgress}%</span> : null}
          <span
            className="media-board-node-timeline-drag"
            draggable={importProgress === null}
            title="Drag to timeline"
            onMouseDown={(e) => e.stopPropagation()}
            onDragStart={(e) => handleDragStart(e, item)}
            onDragEnd={handleDragEnd}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
              <path d="M3 2h2v12H3V2Zm4 0h2v12H7V2Zm4 0h2v12h-2V2Z" />
            </svg>
          </span>
        </div>
        {!isCompactNode ? (
          <div className="media-board-node-body">
            <div className="media-board-node-name">{item.name}</div>
            <div className="media-board-node-meta">
              <span>{getMediaBoardTypeLabel(item)}</span>
              {resolutionLabel ? <span>{resolutionLabel}</span> : null}
              {boardCodecLabel ? <span>{boardCodecLabel}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const renderMediaBoardView = () => (
    <div
      className="media-board-wrapper"
      ref={boardWrapperRef}
      style={{
        '--media-board-grid-x': `${mediaBoardViewport.panX * MEDIA_BOARD_GRID_PARALLAX}px`,
        '--media-board-grid-y': `${mediaBoardViewport.panY * MEDIA_BOARD_GRID_PARALLAX}px`,
      } as React.CSSProperties}
    >
      <div className="media-board-toolbar">
        <div className="media-board-toolbar-title">
          <span>Board</span>
          <span>{mediaBoardItems.length} items in {mediaBoardLayout.groups.filter((group) => group.id !== null).length} folders</span>
        </div>
        <div className="media-board-toolbar-actions">
          <button
            className="btn btn-sm"
            onClick={openBoardAI}
            title="Open AI Video panel"
          >
            AI
          </button>
          <button className="btn btn-sm" onClick={resetMediaBoardLayout} title="Reset board layout">
            Reset
          </button>
        </div>
      </div>
      <div
        ref={boardCanvasRef}
        className="media-board-canvas"
        onWheel={handleMediaBoardWheel}
        onMouseDown={handleMediaBoardMouseDown}
        onContextMenu={(e) => {
          const target = e.target as HTMLElement;
          if (!target.closest('.media-board-node')) handleMediaBoardWorkspaceContextMenu(e);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            setIsExternalDragOver(true);
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-media-panel-item') ? 'move' : 'copy';
          updateMediaBoardInsertionFromNativeDrag(e);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) {
            setMediaBoardInsertionPreview(null);
          }
        }}
        onDrop={handleMediaBoardDrop}
      >
        <div
          ref={boardCanvasInnerRef}
          className="media-board-canvas-inner"
          style={{
            transform: `translate(${mediaBoardViewport.panX}px, ${mediaBoardViewport.panY}px) scale(${mediaBoardViewport.zoom})`,
          }}
        >
          {visibleMediaBoardGroups.filter((group) => group.id !== null).map((group) => {
            const folder = group.id ? folders.find((candidate) => candidate.id === group.id) : null;
            if (!folder) return null;
            const isRenamingGroup = group.id !== null && renamingId === group.id;
            return (
              <div
                key={group.id ?? 'root'}
                className={[
                  'media-board-group',
                  'folder-group',
                  `depth-${Math.min(group.depth, 3)}`,
                  selectedIdSet.has(folder.id) ? 'selected' : '',
                  group.isDraggingPreview ? 'drag-source-preview' : '',
                ].filter(Boolean).join(' ')}
                data-item-id={folder.id}
                data-board-group-key={getMediaBoardOrderKey(group.id)}
                data-media-panel-anim-id={group.id ?? undefined}
                draggable={false}
                style={{
                  left: group.x,
                  top: group.y,
                  width: group.width,
                  height: group.height,
                }}
                onMouseDown={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest('input, button')) return;
                  handleMediaBoardNodeMouseDown(e, folder);
                }}
                onDoubleClick={() => { void handleItemDoubleClick(folder); }}
                onContextMenu={(e) => {
                  if (consumeSuppressedMediaBoardContextMenu()) {
                    e.preventDefault();
                    return;
                  }
                  handleContextMenu(e, folder.id);
                }}
                onDragOver={handleMediaBoardGroupDragOver}
                onDrop={(e) => handleMediaBoardGroupDrop(e, group.id)}
              >
                <div className="media-board-group-header">
                  {isRenamingGroup ? (
                    <input
                      className="media-board-group-rename"
                      value={renameValue}
                      size={Math.max(1, renameValue.length)}
                      style={{ width: `${Math.max(4, renameValue.length + 1)}ch` }}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={finishRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span
                      title={group.name}
                      onDoubleClick={(e) => {
                        if (!group.id) return;
                        e.stopPropagation();
                        startRename(group.id, folder?.name ?? group.name);
                      }}
                    >
                      {group.name}
                    </span>
                  )}
                  <span>{group.itemCount}</span>
                </div>
              </div>
            );
          })}
          {visibleMediaBoardInsertGaps.map((gap) => (
            <div
              key={gap.id}
              className="media-board-insert-gap"
              style={{
                left: gap.layout.x,
                top: gap.layout.y,
                width: gap.layout.width,
                height: gap.layout.height,
              }}
            />
          ))}
          {visibleMediaBoardPlacements.map(renderMediaBoardNode)}
          {mediaBoardMarquee && (() => {
            const left = Math.min(mediaBoardMarquee.startX, mediaBoardMarquee.currentX);
            const top = Math.min(mediaBoardMarquee.startY, mediaBoardMarquee.currentY);
            const width = Math.abs(mediaBoardMarquee.currentX - mediaBoardMarquee.startX);
            const height = Math.abs(mediaBoardMarquee.currentY - mediaBoardMarquee.startY);
            if (width < 2 && height < 2) return null;
            return (
              <div
                className="media-board-marquee"
                style={{ left, top, width, height }}
              />
            );
          })()}
        </div>
      </div>
    </div>
  );

  // Grid view: items for current folder + breadcrumb path
  const gridItems = sortItems(getItemsForParent(gridFolderId));
  const gridBreadcrumb: Array<{ id: string | null; name: string }> = [];
  if (gridFolderId) {
    // Build path from root to current folder
    const path: Array<{ id: string; name: string }> = [];
    let current = folders.find(f => f.id === gridFolderId);
    while (current) {
      path.unshift({ id: current.id, name: current.name });
      current = current.parentId ? folders.find(f => f.id === current!.parentId) : undefined;
    }
    gridBreadcrumb.push({ id: null, name: '/' });
    gridBreadcrumb.push(...path);
  }

  // Check if any files need relinking (lost permission after refresh).
  // Native-helper projects can be linked by project/absolute paths without
  // eagerly materializing browser File objects for every media item.
  const filesNeedReload = files.some(mediaNeedsRelink);
  const filesNeedReloadCount = files.filter(mediaNeedsRelink).length;

  // Relink dialog state
  const [showRelinkDialog, setShowRelinkDialog] = useState(false);

  return (
    <div
      className={`media-panel ${isExternalDragOver ? 'drop-target' : ''}`}
      onDrop={handleRootDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => { if (contextMenu) closeContextMenu(); }}
    >
      {/* Header */}
      <div className="media-panel-header">
        <span className="media-panel-title">Project</span>
        <span className="media-panel-count">{totalItems} items</span>
        <div className="media-panel-actions">
          <div className="media-view-segment" role="tablist" aria-label="Media view mode">
            <button
              className={`btn btn-sm btn-icon media-view-toggle ${viewMode === 'classic' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('classic')}
              title="Classic list view"
              aria-label="Classic list view"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="0.5"/><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="1" y="12" width="14" height="2" rx="0.5"/></svg>
            </button>
            <button
              className={`btn btn-sm btn-icon media-view-toggle ${viewMode === 'icons' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('icons')}
              title="Large icon view"
              aria-label="Large icon view"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
            </button>
            <button
              className={`btn btn-sm btn-icon media-view-toggle ${viewMode === 'board' ? 'active' : ''}`}
              onClick={() => handleViewModeChange('board')}
              title="Board view"
              aria-label="Board view"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2 2h5v4H2V2Zm7 0h5v6H9V2ZM2 8h5v6H2V8Zm7 2h5v4H9v-4Z"/></svg>
            </button>
          </div>
          {filesNeedReload && (
            <button
              className="btn btn-sm btn-reload-all"
              onClick={() => setShowRelinkDialog(true)}
              title={`Restore access to ${filesNeedReloadCount} file${filesNeedReloadCount > 1 ? 's' : ''}`}
            >
              Relink ({filesNeedReloadCount})
            </button>
          )}
          <button className="btn btn-sm" onClick={handleImport} title="Import Media">
            Import
          </button>
          <div className="add-dropdown-container">
            <button
              className={`btn btn-sm add-dropdown-trigger ${addDropdownOpen ? 'active' : ''}`}
              onClick={() => setAddDropdownOpen(!addDropdownOpen)}
              title="Add New Item"
            >
              + Add ▾
            </button>
            {addDropdownOpen && (
              <div className="add-dropdown-menu">
                <div className="add-dropdown-item" onClick={() => { handleNewComposition(); setAddDropdownOpen(false); }}>
                  <span className="add-dropdown-icon"><FileTypeIcon type="composition" /></span>
                  <span>Composition</span>
                </div>
                <div className="add-dropdown-item" onClick={() => { handleNewFolder(); setAddDropdownOpen(false); }}>
                  <span className="add-dropdown-icon"><span className="media-folder-icon">&#128193;</span></span>
                  <span>Folder</span>
                </div>
                <div className="add-dropdown-separator" />
                <div className="add-dropdown-item" onClick={() => { handleNewText(); setAddDropdownOpen(false); }}>
                  <span className="add-dropdown-icon"><FileTypeIcon type="text" /></span>
                  <span>Text</span>
                </div>
                <div className="add-dropdown-item" onClick={() => { handleNewText3D(); setAddDropdownOpen(false); }}>
                  <span className="add-dropdown-icon"><FileTypeIcon type="text-3d" /></span>
                  <span>3D Text</span>
                </div>
                <div className="add-dropdown-item" onClick={() => { handleNewSolid(); setAddDropdownOpen(false); }}>
                  <span className="add-dropdown-icon"><FileTypeIcon type="solid" /></span>
                  <span>Solid</span>
                </div>
                <div className="add-dropdown-item" onClick={() => { handleNewCamera(); setAddDropdownOpen(false); }}>
                  <span className="add-dropdown-icon"><FileTypeIcon type="camera" /></span>
                  <span>Camera</span>
                </div>
                <div className="add-dropdown-item" onClick={() => { handleNewSplatEffector(); setAddDropdownOpen(false); }}>
                  <span className="add-dropdown-icon"><FileTypeIcon type="splat-effector" /></span>
                  <span>3D Effector</span>
                </div>
                <div className="add-dropdown-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
                  <span className="add-dropdown-icon"><FileTypeIcon type="mesh" /></span>
                  <span>Mesh</span>
                  <span className="submenu-arrow">&#9654;</span>
                  <div className="add-dropdown-submenu">
                    {(['cube', 'sphere', 'plane', 'cylinder', 'torus', 'cone'] as const).map(meshType => (
                      <div key={meshType} className="add-dropdown-item" onClick={() => { handleNewMesh(meshType); setAddDropdownOpen(false); }}>
                        <span>{meshType.charAt(0).toUpperCase() + meshType.slice(1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="add-dropdown-item" onClick={() => { handleImportGaussianSplat(); setAddDropdownOpen(false); }}>
                  <span className="add-dropdown-icon"><FileTypeIcon type="gaussian-splat" /></span>
                  <span>Gaussian Splat</span>
                </div>
                <div className="add-dropdown-separator" />
                <div className="add-dropdown-item" onClick={() => { /* TODO: Add adjustment layer */ setAddDropdownOpen(false); }}>
                  <span className="add-dropdown-icon"><FileTypeIcon type="solid" /></span>
                  <span>Adjustment Layer</span>
                  <span className="add-dropdown-hint">Coming soon</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*,.obj,.gltf,.glb,.ply,.compressed.ply,.splat,.ksplat,.spz,.sog,.lcc,.zip"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Item list with column headers */}
      <div className="media-panel-content" ref={mediaPanelContentRef}>
        {totalItems === 0 ? (
          <div className="media-panel-empty" onContextMenu={(e) => handleContextMenu(e)}>
            <div className="drop-icon">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p>No media imported</p>
            <p className="hint">Drag & drop files or folders here or click Import</p>
          </div>
        ) : viewMode === 'classic' ? (
          <div className="media-panel-table-wrapper">
            {/* Column headers */}
            <div className="media-column-headers">
              {columnOrder.map((colId) => (
                <div
                  key={colId}
                  className={`media-col media-col-${colId} ${draggingColumn === colId ? 'dragging' : ''} ${dragOverColumn === colId ? 'drag-over' : ''} ${sortColumn === colId ? 'sorted' : ''}`}
                  style={colId === 'name' ? { width: nameColumnWidth, minWidth: nameColumnWidth, maxWidth: nameColumnWidth } : undefined}
                  draggable
                  onDragStart={(e) => handleColumnDragStart(e, colId)}
                  onDragOver={(e) => handleColumnDragOver(e, colId)}
                  onDragLeave={handleColumnDragLeave}
                  onDrop={(e) => handleColumnDrop(e, colId)}
                  onDragEnd={handleColumnDragEnd}
                  onClick={() => handleColumnSort(colId)}
                >
                  {COLUMN_LABELS_MAP[colId]}
                  {sortColumn === colId && (
                    <span className="media-sort-indicator">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                  {/* Resize handle after name column */}
                  {colId === 'name' && (
                    <div
                      className="media-col-resize-handle"
                      onMouseDown={handleResizeStart}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </div>
              ))}
            </div>
            <div
              className="media-item-list"
              ref={itemListRef}
              onScroll={handleClassicListScroll}
              onMouseDown={handleMarqueeMouseDown}
              onContextMenu={(e) => {
                const target = e.target as HTMLElement;
                if (!target.closest('.media-item')) handleContextMenu(e);
              }}
              style={{ position: 'relative' }}
            >
              {classicTopSpacerHeight > 0 && (
                <div className="media-classic-virtual-spacer" style={{ height: classicTopSpacerHeight }} />
              )}
              {classicVisibleRows.map(({ item, depth }) => renderClassicRow(item, depth))}
              {classicBottomSpacerHeight > 0 && (
                <div className="media-classic-virtual-spacer" style={{ height: classicBottomSpacerHeight }} />
              )}
              {/* Marquee selection rectangle */}
              {marquee && (() => {
                const left = Math.min(marquee.startX, marquee.currentX);
                const top = Math.min(marquee.startY, marquee.currentY);
                const width = Math.abs(marquee.currentX - marquee.startX);
                const height = Math.abs(marquee.currentY - marquee.startY);
                if (width < 3 && height < 3) return null;
                return (
                  <div
                    className="media-marquee"
                    style={{ left, top, width, height }}
                  />
                );
              })()}
            </div>
          </div>
        ) : viewMode === 'icons' ? (
          /* Grid View */
          <div
            className="media-grid-wrapper"
            ref={itemListRef}
            onMouseDown={handleMarqueeMouseDown}
            onContextMenu={(e) => {
              const target = e.target as HTMLElement;
              if (!target.closest('.media-grid-item')) handleContextMenu(e);
            }}
            style={{ position: 'relative' }}
          >
            {/* Breadcrumb for folder navigation */}
            {gridFolderId && (
              <div className="media-grid-breadcrumb">
                {gridBreadcrumb.map((crumb, i) => (
                  <React.Fragment key={crumb.id ?? 'root'}>
                    {i > 0 && <span className="media-grid-breadcrumb-sep">/</span>}
                    <button
                      className={`media-grid-breadcrumb-btn ${i === gridBreadcrumb.length - 1 ? 'active' : ''}`}
                      onClick={() => setGridFolderId(crumb.id)}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}
            <div className="media-grid">
              {gridItems.map(item => renderGridItem(item))}
            </div>
            {/* Marquee selection rectangle */}
            {marquee && (() => {
              const left = Math.min(marquee.startX, marquee.currentX);
              const top = Math.min(marquee.startY, marquee.currentY);
              const width = Math.abs(marquee.currentX - marquee.startX);
              const height = Math.abs(marquee.currentY - marquee.startY);
              if (width < 3 && height < 3) return null;
              return (
                <div
                  className="media-marquee"
                  style={{ left, top, width, height }}
                />
              );
            })()}
          </div>
        ) : (
          renderMediaBoardView()
        )}
      </div>

      {/* Drop overlay - shown when dragging files from outside */}
      {isExternalDragOver && (
        <div className="media-panel-drop-overlay">
          <div className="drop-overlay-content">
            <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Drop files or folders to import</span>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (() => {
        const multiSelect = selectedIds.length > 1;
        const selectedItem = contextMenu.itemId
          ? files.find(f => f.id === contextMenu.itemId) ||
            compositions.find(c => c.id === contextMenu.itemId) ||
            folders.find(f => f.id === contextMenu.itemId) ||
            textItems.find(t => t.id === contextMenu.itemId) ||
            solidItems.find(s => s.id === contextMenu.itemId) ||
            meshItems.find(m => m.id === contextMenu.itemId) ||
            cameraItems.find(c => c.id === contextMenu.itemId) ||
            splatEffectorItems.find(e => e.id === contextMenu.itemId)
          : null;
        const isVideoFile = selectedItem && 'type' in selectedItem && selectedItem.type === 'video';
        const isComposition = selectedItem && 'type' in selectedItem && selectedItem.type === 'composition';
        const isSolidItem = selectedItem && 'type' in selectedItem && selectedItem.type === 'solid';
        const mediaFile = isVideoFile ? (selectedItem as MediaFile) : null;
        const composition = isComposition ? (selectedItem as Composition) : null;
        const solidItem = isSolidItem ? (selectedItem as SolidItem) : null;
        const isGenerating = mediaFile?.proxyStatus === 'generating';
        const hasProxy = mediaFile?.proxyStatus === 'ready';
        // Available folders for "Move to Folder" submenu
        const availableFolders = folders.filter(f => !selectedIds.includes(f.id));

        return (
          <div
            ref={contextMenuRef}
            className="media-context-menu"
            style={{
              position: 'fixed',
              left: contextMenuPosition?.x ?? contextMenu.x,
              top: contextMenuPosition?.y ?? contextMenu.y,
              zIndex: 10000,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="context-menu-item" onClick={handleImport}>
              Import Media...
            </div>
            <div className="context-menu-separator" />
            <div className="context-menu-item" onClick={() => { handleNewComposition(); closeContextMenu(); }}>
              <span className="context-menu-icon"><FileTypeIcon type="composition" /></span>
              Composition
            </div>
            <div className="context-menu-item" onClick={() => { handleNewFolder(); closeContextMenu(); }}>
              <span className="context-menu-icon"><span className="media-folder-icon">&#128193;</span></span>
              Folder
            </div>
            <div className="context-menu-separator" />
            <div className="context-menu-item" onClick={() => { handleNewText(); closeContextMenu(); }}>
              <span className="context-menu-icon"><FileTypeIcon type="text" /></span>
              Text
            </div>
            <div className="context-menu-item" onClick={() => { handleNewText3D(); closeContextMenu(); }}>
              <span className="context-menu-icon"><FileTypeIcon type="text-3d" /></span>
              3D Text
            </div>
            <div className="context-menu-item" onClick={() => { handleNewSolid(); closeContextMenu(); }}>
              <span className="context-menu-icon"><FileTypeIcon type="solid" /></span>
              Solid
            </div>
            <div className="context-menu-item" onClick={() => { handleNewCamera(); closeContextMenu(); }}>
              <span className="context-menu-icon"><FileTypeIcon type="camera" /></span>
              Camera
            </div>
            <div className="context-menu-item" onClick={() => { handleNewSplatEffector(); closeContextMenu(); }}>
              <span className="context-menu-icon"><FileTypeIcon type="splat-effector" /></span>
              3D Effector
            </div>
            <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
              <span className="context-menu-icon"><FileTypeIcon type="mesh" /></span>
              <span>Mesh</span>
              <span className="submenu-arrow">&#9654;</span>
              <div className="context-submenu">
                {(['cube', 'sphere', 'plane', 'cylinder', 'torus', 'cone'] as const).map(meshType => (
                  <div key={meshType} className="context-menu-item" onClick={() => { handleNewMesh(meshType); closeContextMenu(); }}>
                    {meshType.charAt(0).toUpperCase() + meshType.slice(1)}
                  </div>
                ))}
              </div>
            </div>
            <div className="context-menu-item" onClick={() => { handleImportGaussianSplat(); closeContextMenu(); }}>
              <span className="context-menu-icon"><FileTypeIcon type="gaussian-splat" /></span>
              Gaussian Splat
            </div>
            <div className="context-menu-separator" />
            <div className="context-menu-item disabled" onClick={closeContextMenu}>
              <span className="context-menu-icon"><FileTypeIcon type="solid" /></span>
              Adjustment Layer
              <span className="context-menu-hint">Coming soon</span>
            </div>
            {(contextMenu.itemId || multiSelect) && (
              <>
                <div className="context-menu-separator" />

                {/* Rename - only for single selection */}
                {!multiSelect && selectedItem && (
                  <div className="context-menu-item" onClick={() => {
                    startRename(selectedItem.id, selectedItem.name);
                  }}>
                    Rename
                  </div>
                )}

                {/* Move to Folder submenu */}
                {availableFolders.length > 0 && (
                  <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
                    <span>Move to Folder{multiSelect ? ` (${selectedIds.length})` : ''}</span>
                    <span className="submenu-arrow">▶</span>
                    <div className="context-submenu">
                      <div
                        className="context-menu-item"
                        onClick={() => {
                          moveToFolder(selectedIds, null);
                          closeContextMenu();
                        }}
                      >
                        Root (no folder)
                      </div>
                      <div className="context-menu-separator" />
                      {availableFolders.map(folder => (
                        <div
                          key={folder.id}
                          className="context-menu-item"
                          onClick={() => {
                            moveToFolder(selectedIds, folder.id);
                            closeContextMenu();
                          }}
                        >
                          {folder.name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Composition Settings - only for single composition */}
                {!multiSelect && isComposition && composition && (
                  <div className="context-menu-item" onClick={() => openCompositionSettings(composition)}>
                    Composition Settings...
                  </div>
                )}

                {/* Solid Settings - only for single solid */}
                {!multiSelect && isSolidItem && solidItem && (
                  <div className="context-menu-item" onClick={() => {
                    setSolidSettingsDialog({
                      solidItemId: solidItem.id,
                      width: solidItem.width,
                      height: solidItem.height,
                      color: solidItem.color,
                    });
                    closeContextMenu();
                  }}>
                    Solid Settings...
                  </div>
                )}

                {/* Proxy Generation - only for single video */}
                {!multiSelect && isVideoFile && mediaFile && (
                  <>
                    <div className="context-menu-separator" />
                    {isGenerating ? (
                      <div
                        className="context-menu-item"
                        onClick={() => {
                          cancelProxyGeneration(mediaFile.id);
                          closeContextMenu();
                        }}
                      >
                        Stop Proxy Generation ({mediaFile.proxyProgress || 0}%)
                      </div>
                    ) : hasProxy ? (
                      <div className="context-menu-item disabled">
                        Proxy Ready
                      </div>
                    ) : (
                      <div
                        className="context-menu-item"
                        onClick={() => {
                          generateProxy(mediaFile.id);
                          closeContextMenu();
                        }}
                      >
                        Generate Proxy
                      </div>
                    )}
                  </>
                )}

                {/* Show in Explorer submenu - only for single video with file */}
                {!multiSelect && isVideoFile && mediaFile?.file && (
                  <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
                    <span>Show in Explorer</span>
                    <span className="submenu-arrow">▶</span>
                    <div className="context-submenu">
                      <div
                        className="context-menu-item"
                        onClick={async () => {
                          const result = await showInExplorer('raw', mediaFile.id);
                          if (result.success) {
                            alert(result.message);
                          } else {
                            if (mediaFile.file) {
                              const url = URL.createObjectURL(mediaFile.file);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = mediaFile.name;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              URL.revokeObjectURL(url);
                            }
                          }
                          closeContextMenu();
                        }}
                      >
                        Raw {mediaFile.hasFileHandle && '(has path)'}
                      </div>
                      <div
                        className={`context-menu-item ${!hasProxy ? 'disabled' : ''}`}
                        onClick={async () => {
                          if (hasProxy) {
                            const result = await showInExplorer('proxy', mediaFile.id);
                            alert(result.message);
                          }
                          closeContextMenu();
                        }}
                      >
                        Proxy {!hasProxy ? '(not available)' : proxyFolderName ? `(${proxyFolderName})` : '(IndexedDB)'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Set Proxy Folder - for single video */}
                {!multiSelect && isVideoFile && (
                  <div
                    className="context-menu-item"
                    onClick={async () => {
                      await pickProxyFolder();
                      closeContextMenu();
                    }}
                  >
                    Set Proxy Folder... {proxyFolderName && `(${proxyFolderName})`}
                  </div>
                )}

                <div className="context-menu-separator" />
                <div className="context-menu-item danger" onClick={handleDelete}>
                  Delete{multiSelect ? ` (${selectedIds.length} items)` : ''}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* Composition Settings Dialog */}
      {settingsDialog && (
        <CompositionSettingsDialog
          settings={settingsDialog}
          onSettingsChange={setSettingsDialog}
          onSave={saveCompositionSettings}
          onCancel={() => setSettingsDialog(null)}
        />
      )}

      {/* Solid Settings Dialog */}
      {solidSettingsDialog && (
        <SolidSettingsDialog
          settings={solidSettingsDialog}
          onSettingsChange={setSolidSettingsDialog}
          onSave={() => {
            if (solidSettingsDialog) {
              updateSolidItem(solidSettingsDialog.solidItemId, {
                color: solidSettingsDialog.color,
                width: solidSettingsDialog.width,
                height: solidSettingsDialog.height,
              });
              setSolidSettingsDialog(null);
            }
          }}
          onCancel={() => setSolidSettingsDialog(null)}
        />
      )}

      {/* Label Color Picker */}
      {labelPickerItemId && labelPickerPos && (
        <LabelColorPicker
          position={labelPickerPos}
          selectedIds={selectedIds}
          labelPickerItemId={labelPickerItemId}
          onSelect={(ids, colorKey) => {
            setLabelColor(ids, colorKey);
            setLabelPickerItemId(null);
            setLabelPickerPos(null);
          }}
          onClose={() => { setLabelPickerItemId(null); setLabelPickerPos(null); }}
        />
      )}

      {/* Relink Dialog */}
      {showRelinkDialog && (
        <RelinkDialog onClose={() => setShowRelinkDialog(false)} />
      )}
    </div>
  );
}

// Format duration as mm:ss
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
