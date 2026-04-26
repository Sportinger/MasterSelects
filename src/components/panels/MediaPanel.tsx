// Media Panel - Project browser like After Effects

import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Logger } from '../../services/logger';
import { FileTypeIcon } from './media/FileTypeIcon';
import { LABEL_COLORS, getLabelHex } from './media/labelColors';
import { CompositionSettingsDialog } from './media/CompositionSettingsDialog';
import { SolidSettingsDialog } from './media/SolidSettingsDialog';
import { LabelColorPicker } from './media/LabelColorPicker';
import { getItemImportProgress, isImportedMediaFileItem } from './media/itemTypeGuards';
import { handleSubmenuHover, handleSubmenuLeave } from './media/submenuPosition';
import { collectDroppedMediaFiles, planDroppedMediaImports } from './media/dropImport';

const log = Logger.create('MediaPanel');
import { useMediaStore } from '../../stores/mediaStore';
import type { MediaFile, Composition, ProjectItem, TextItem, SolidItem, CameraItem, MediaFolder } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useDockStore } from '../../stores/dockStore';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { RelinkDialog } from '../common/RelinkDialog';
import {
  clearExternalDragPayload,
  setExternalDragPayload,
} from '../timeline/utils/externalDragSession';

// Column definitions
type ColumnId = 'label' | 'name' | 'duration' | 'resolution' | 'fps' | 'container' | 'codec' | 'audio' | 'bitrate' | 'size';
type MediaPanelViewMode = 'classic' | 'icons' | 'board';
type MediaBoardItem = Exclude<ProjectItem, MediaFolder>;

interface MediaBoardViewport {
  zoom: number;
  panX: number;
  panY: number;
}

interface MediaBoardNodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MediaBoardGroupLayout {
  id: string | null;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  itemCount: number;
}

interface MediaBoardNodePlacement {
  item: MediaBoardItem;
  layout: MediaBoardNodeLayout;
  defaultLayout: MediaBoardNodeLayout;
  groupId: string | null;
  slotIndex: number;
}

interface MediaBoardMarquee {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
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
const MEDIA_PANEL_PROJECT_UI_LOADED_EVENT = 'media-panel-project-ui-loaded';
const MEDIA_BOARD_ROOT_ORDER_KEY = '__root__';

const DEFAULT_BOARD_VIEWPORT: MediaBoardViewport = { zoom: 0.82, panX: 32, panY: 28 };
const MEDIA_BOARD_NODE_WIDTH = 156;
const MEDIA_BOARD_NODE_HEIGHT = 132;
const MEDIA_BOARD_NODE_GAP = 14;
const MEDIA_BOARD_GROUP_WIDTH = 732;
const MEDIA_BOARD_GROUP_HEADER_HEIGHT = 42;
const MEDIA_BOARD_GROUP_PADDING = 18;
const MEDIA_BOARD_GROUP_GAP = 72;
const MEDIA_BOARD_COLUMNS_PER_GROUP = 4;
const MEDIA_BOARD_PAN_ZOOM_MIN = 0.18;
const MEDIA_BOARD_PAN_ZOOM_MAX = 2.4;
const MEDIA_BOARD_DRAG_START_DISTANCE = 4;

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

function getProjectItemIconType(item: ProjectItem | undefined): string | undefined {
  if (!item || !('type' in item)) return undefined;
  if (item.type === 'model') {
    return 'meshType' in item && item.meshType === 'text3d'
      ? 'text-3d'
      : 'mesh';
  }
  return item.type;
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

function getMediaBoardTypeLabel(item: MediaBoardItem): string {
  if (item.type === 'composition') return 'Composition';
  if (item.type === 'gaussian-splat') return 'Splat';
  if (item.type === 'splat-effector') return 'Effector';
  if (item.type === 'solid') return 'Solid';
  if (item.type === 'model') return 'Model';
  return item.type.charAt(0).toUpperCase() + item.type.slice(1);
}

function getMediaBoardOrderKey(folderId: string | null): string {
  return folderId ?? MEDIA_BOARD_ROOT_ORDER_KEY;
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
    getItemsByFolder,
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
  const boardWrapperRef = useRef<HTMLDivElement>(null);
  const boardCanvasRef = useRef<HTMLDivElement>(null);
  const boardCanvasInnerRef = useRef<HTMLDivElement>(null);
  const boardInteractionFrameRef = useRef<number | null>(null);
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
  const [labelPickerItemId, setLabelPickerItemId] = useState<string | null>(null);
  const [labelPickerPos, setLabelPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [viewMode, setViewMode] = useState<MediaPanelViewMode>(loadMediaPanelViewMode);
  // Grid view: current open folder (null = root)
  const [gridFolderId, setGridFolderId] = useState<string | null>(null);
  const [mediaBoardViewport, setMediaBoardViewport] = useState<MediaBoardViewport>(loadMediaBoardViewport);
  const [mediaBoardOrder, setMediaBoardOrder] = useState<Record<string, string[]>>(loadMediaBoardOrder);
  const [mediaBoardMarquee, setMediaBoardMarquee] = useState<MediaBoardMarquee | null>(null);
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

  useEffect(() => () => {
    if (boardInteractionFrameRef.current !== null) {
      window.cancelAnimationFrame(boardInteractionFrameRef.current);
    }
    if (suppressMediaBoardContextMenuTimerRef.current !== null) {
      window.clearTimeout(suppressMediaBoardContextMenuTimerRef.current);
    }
  }, []);

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
      case 'resolution': return 'width' in item && 'height' in item && item.width && item.height ? item.width * item.height : 0;
      case 'fps': return mediaFile?.fps || ('type' in item && item.type === 'composition' ? (item as Composition).frameRate : 0);
      case 'container': return mediaFile?.container?.toLowerCase() || '';
      case 'codec': return mediaFile?.codec?.toLowerCase() || '';
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
          const itemId = el.parentElement?.getAttribute('data-item-id');
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
    } else if ('file' in item && !item.file) {
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
    if (!mediaFile.file || mediaFile.isImporting) {
      // File not available or still importing - only allow internal move
      e.dataTransfer.effectAllowed = 'move';
      if (e.currentTarget instanceof HTMLElement) {
        e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
      }
      return;
    }

    // Set the media file ID so Timeline can look it up
    const isAudioOnly =
      mediaFile.file.type.startsWith('audio/') ||
      /\.(mp3|wav|ogg|aac|m4a|flac|wma|aiff|alac|opus)$/i.test(mediaFile.file.name);
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
            {'proxyStatus' in item && item.proxyStatus === 'ready' && (
              <span className="media-item-proxy-badge" title="Proxy generated">P</span>
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
          <div className="media-col media-col-resolution">
            {'width' in item && 'height' in item && item.width && item.height ? `${item.width}×${item.height}` : '–'}
          </div>
        );
      case 'fps':
        return (
          <div className="media-col media-col-fps">
            {mediaFile?.fps ? `${mediaFile.fps}` : ('type' in item && item.type === 'composition' ? (item as Composition).frameRate : '–')}
          </div>
        );
      case 'container':
        return <div className="media-col media-col-container">{mediaFile?.container || '–'}</div>;
      case 'codec':
        return <div className="media-col media-col-codec">{mediaFile?.codec || '–'}</div>;
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

  // Render a single item
  const renderItem = (item: ProjectItem, depth: number = 0) => {
    const isFolder = 'isExpanded' in item;
    const isSelected = selectedIds.includes(item.id);
    const isRenaming = renamingId === item.id;
    const isExpanded = isFolder && expandedFolderIds.includes(item.id);
    const isMediaFile = isImportedMediaFileItem(item);
    const hasFile = isMediaFile && !!item.file;
    const isImporting = isMediaFile && !!item.isImporting;
    const isDragTarget = isFolder && dragOverFolderId === item.id;
    const isBeingDragged = internalDragId === item.id;
    const mediaFile = isMediaFile ? item : null;

    return (
      <div key={item.id} data-item-id={item.id}>
        <div
          className={`media-item ${isSelected ? 'selected' : ''} ${isFolder ? 'folder' : ''} ${isMediaFile && !hasFile ? 'no-file' : ''} ${isImporting ? 'importing' : ''} ${isDragTarget ? 'drag-target' : ''} ${isBeingDragged ? 'dragging' : ''}`}
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
        {isFolder && isExpanded && (
          <div className="media-folder-children">
            {sortItems(getItemsByFolder(item.id)).map(child => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Build hover tooltip for grid items
  const buildGridTooltip = (item: ProjectItem, isFolder: boolean, isComp: boolean): string => {
    const parts: string[] = [item.name];

    if (isFolder) {
      const children = getItemsByFolder(item.id);
      parts.push(`${children.length} item${children.length !== 1 ? 's' : ''}`);
    } else if (isComp) {
      const comp = item as Composition;
      parts.push(`${comp.width}×${comp.height}`);
      parts.push(`${comp.frameRate} fps`);
      if (comp.duration) parts.push(formatDuration(comp.duration));
    } else if ('type' in item) {
      const mf = item as MediaFile;
      if (mf.width && mf.height) parts.push(`${mf.width}×${mf.height}`);
      if (mf.duration) parts.push(formatDuration(mf.duration));
      if (mf.codec) parts.push(mf.codec);
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
    const folderCount = isFolder ? getItemsByFolder(item.id).length : 0;

    return (
      <div key={item.id} data-item-id={item.id}>
        <div
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

  // Get root items (with sorting applied)
  const rootItems = sortItems(getItemsByFolder(null));
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

  const mediaBoardItems = useMemo<MediaBoardItem[]>(() => ([
    ...files,
    ...compositions,
    ...textItems,
    ...solidItems,
    ...meshItems,
    ...cameraItems,
    ...splatEffectorItems,
  ]), [files, compositions, textItems, solidItems, meshItems, cameraItems, splatEffectorItems]);

  const mediaBoardItemIds = useMemo(() => new Set(mediaBoardItems.map((item) => item.id)), [mediaBoardItems]);

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

        const filteredIds = ids.filter((id, index) => mediaBoardItemIds.has(id) && ids.indexOf(id) === index);
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

  const mediaBoardLayout = useMemo(() => {
    const groupsByParent = new Map<string | null, MediaBoardItem[]>();
    groupsByParent.set(null, []);
    folders.forEach((folder) => groupsByParent.set(folder.id, []));

    mediaBoardItems.forEach((item) => {
      const parentId = item.parentId ?? null;
      if (!groupsByParent.has(parentId)) {
        groupsByParent.set(parentId, []);
      }
      groupsByParent.get(parentId)!.push(item);
    });

    const orderedGroupIds: Array<string | null> = [
      null,
      ...folders
        .map((folder) => folder.id)
        .sort((leftId, rightId) =>
          getMediaBoardGroupName(leftId, folders).localeCompare(getMediaBoardGroupName(rightId, folders))
        ),
    ].filter((groupId, index, ids) => ids.indexOf(groupId) === index);

    const groups: MediaBoardGroupLayout[] = [];
    const placements: MediaBoardNodePlacement[] = [];
    let rowY = 0;
    let rowMaxHeight = 0;
    let column = 0;

    const orderItemsForGroup = (groupId: string | null, items: MediaBoardItem[]): MediaBoardItem[] => {
      const sortedItems = sortItems([...items]) as MediaBoardItem[];
      const savedOrder = mediaBoardOrder[getMediaBoardOrderKey(groupId)] ?? [];
      if (savedOrder.length === 0) return sortedItems;

      const byId = new Map(sortedItems.map((item) => [item.id, item]));
      const orderedItems = savedOrder
        .map((id) => byId.get(id))
        .filter((item): item is MediaBoardItem => Boolean(item));
      const orderedIds = new Set(orderedItems.map((item) => item.id));
      return [
        ...orderedItems,
        ...sortedItems.filter((item) => !orderedIds.has(item.id)),
      ];
    };

    orderedGroupIds.forEach((groupId) => {
      const items = orderItemsForGroup(groupId, groupsByParent.get(groupId) ?? []);
      const rows = Math.max(1, Math.ceil(items.length / MEDIA_BOARD_COLUMNS_PER_GROUP));
      const height = MEDIA_BOARD_GROUP_HEADER_HEIGHT
        + (MEDIA_BOARD_GROUP_PADDING * 2)
        + (rows * MEDIA_BOARD_NODE_HEIGHT)
        + ((rows - 1) * MEDIA_BOARD_NODE_GAP);
      const x = column * (MEDIA_BOARD_GROUP_WIDTH + MEDIA_BOARD_GROUP_GAP);
      const y = rowY;
      const group: MediaBoardGroupLayout = {
        id: groupId,
        name: getMediaBoardGroupName(groupId, folders),
        x,
        y,
        width: MEDIA_BOARD_GROUP_WIDTH,
        height,
        itemCount: items.length,
      };
      groups.push(group);

      items.forEach((item, index) => {
        const col = index % MEDIA_BOARD_COLUMNS_PER_GROUP;
        const row = Math.floor(index / MEDIA_BOARD_COLUMNS_PER_GROUP);
        const defaultLayout: MediaBoardNodeLayout = {
          x: x + MEDIA_BOARD_GROUP_PADDING + (col * (MEDIA_BOARD_NODE_WIDTH + MEDIA_BOARD_NODE_GAP)),
          y: y + MEDIA_BOARD_GROUP_HEADER_HEIGHT + MEDIA_BOARD_GROUP_PADDING + (row * (MEDIA_BOARD_NODE_HEIGHT + MEDIA_BOARD_NODE_GAP)),
          width: MEDIA_BOARD_NODE_WIDTH,
          height: MEDIA_BOARD_NODE_HEIGHT,
        };
        placements.push({
          item,
          defaultLayout,
          groupId,
          layout: defaultLayout,
          slotIndex: index,
        });
      });

      rowMaxHeight = Math.max(rowMaxHeight, height);
      column += 1;
      if (column >= 2) {
        rowY += rowMaxHeight + MEDIA_BOARD_GROUP_GAP;
        rowMaxHeight = 0;
        column = 0;
      }
    });

    return { groups, placements };
  }, [folders, mediaBoardItems, mediaBoardOrder, sortItems]);

  const mediaBoardPlacementsById = useMemo(() => {
    return new Map(mediaBoardLayout.placements.map((placement) => [placement.item.id, placement]));
  }, [mediaBoardLayout.placements]);

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
    e.preventDefault();
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
      });
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const distance = Math.hypot(dx, dy);
      if (!didPan && distance < MEDIA_BOARD_DRAG_START_DISTANCE) return;

      if (!didPan) {
        didPan = true;
        setMediaBoardPerformanceMode(true);
      }

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

  const getMediaBoardGroupAtPoint = useCallback((point: { x: number; y: number }) => {
    return mediaBoardLayout.groups.find((group) => (
      point.x >= group.x
      && point.x <= group.x + group.width
      && point.y >= group.y
      && point.y <= group.y + group.height
    )) ?? null;
  }, [mediaBoardLayout.groups]);

  const handleMediaBoardWorkspaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (consumeSuppressedMediaBoardContextMenu()) return;
    const point = screenToMediaBoard(e.clientX, e.clientY);
    const targetGroup = getMediaBoardGroupAtPoint(point);
    handleContextMenu(e, undefined, targetGroup?.id ?? null);
  }, [consumeSuppressedMediaBoardContextMenu, getMediaBoardGroupAtPoint, handleContextMenu, screenToMediaBoard]);

  const getMediaBoardInsertTarget = useCallback((point: { x: number; y: number }, movingIds: string[]) => {
    const targetGroup = getMediaBoardGroupAtPoint(point);
    if (!targetGroup) return null;

    const movingIdSet = new Set(movingIds);
    const targetPlacements = mediaBoardLayout.placements
      .filter((placement) => placement.groupId === targetGroup.id && !movingIdSet.has(placement.item.id))
      .sort((a, b) => a.slotIndex - b.slotIndex);

    let targetIndex = targetPlacements.length;
    for (let index = 0; index < targetPlacements.length; index += 1) {
      const { layout } = targetPlacements[index];
      const centerX = layout.x + layout.width / 2;
      const centerY = layout.y + layout.height / 2;
      if (point.y < centerY || (point.y < layout.y + layout.height && point.x < centerX)) {
        targetIndex = index;
        break;
      }
    }

    return { groupId: targetGroup.id, index: targetIndex };
  }, [getMediaBoardGroupAtPoint, mediaBoardLayout.placements]);

  const getMediaBoardAppendIndex = useCallback((groupId: string | null, movingIds: string[]) => {
    const movingIdSet = new Set(movingIds);
    return mediaBoardLayout.placements.filter((placement) => (
      placement.groupId === groupId && !movingIdSet.has(placement.item.id)
    )).length;
  }, [mediaBoardLayout.placements]);

  const commitMediaBoardOrderChange = useCallback((movingIds: string[], targetGroupId: string | null, targetIndex: number) => {
    if (movingIds.length === 0) return;
    const movingIdSet = new Set(movingIds);
    const targetGroupKey = getMediaBoardOrderKey(targetGroupId);
    const groupIds = [
      MEDIA_BOARD_ROOT_ORDER_KEY,
      ...folders.map((folder) => folder.id),
    ];

    setMediaBoardOrder((current) => {
      const next: Record<string, string[]> = { ...current };

      groupIds.forEach((groupKey) => {
        const existingOrder = next[groupKey]
          ?? mediaBoardLayout.placements
            .filter((placement) => getMediaBoardOrderKey(placement.groupId) === groupKey)
            .sort((a, b) => a.slotIndex - b.slotIndex)
            .map((placement) => placement.item.id);
        const filteredOrder = existingOrder.filter((id) => !movingIdSet.has(id));
        if (filteredOrder.length > 0) {
          next[groupKey] = filteredOrder;
        } else {
          delete next[groupKey];
        }
      });

      const targetOrder = [
        ...(next[targetGroupKey]
          ?? mediaBoardLayout.placements
            .filter((placement) => placement.groupId === targetGroupId && !movingIdSet.has(placement.item.id))
            .sort((a, b) => a.slotIndex - b.slotIndex)
            .map((placement) => placement.item.id)),
      ];
      const insertIndex = Math.max(0, Math.min(targetIndex, targetOrder.length));
      targetOrder.splice(insertIndex, 0, ...movingIds);
      next[targetGroupKey] = targetOrder;

      return next;
    });

    moveToFolder(movingIds, targetGroupId);
  }, [folders, mediaBoardLayout.placements, moveToFolder]);

  const startMediaBoardNodeMoveGesture = useCallback((e: React.MouseEvent, item: MediaBoardItem) => {
    const selectedMoveIds = selectedIds.includes(item.id)
      ? selectedIds.filter((id) => mediaBoardItemIds.has(id))
      : [item.id];
    const boardOrderedMoveIds = mediaBoardLayout.placements
      .filter((placement) => selectedMoveIds.includes(placement.item.id))
      .sort((a, b) => a.slotIndex - b.slotIndex)
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

    const startX = e.clientX;
    const startY = e.clientY;
    let didDrag = false;
    let previewDx = 0;
    let previewDy = 0;
    let latestClientX = startX;
    let latestClientY = startY;

    const clearPreview = () => {
      startLayouts.forEach(({ id }) => {
        const node = boardCanvasRef.current?.querySelector<HTMLElement>(`.media-board-node[data-item-id="${CSS.escape(id)}"]`);
        if (!node) return;
        node.style.transform = '';
        node.classList.remove('drag-preview');
      });
    };

    const schedulePreview = () => {
      if (boardInteractionFrameRef.current !== null) return;
      boardInteractionFrameRef.current = window.requestAnimationFrame(() => {
        boardInteractionFrameRef.current = null;
        startLayouts.forEach(({ id }) => {
          const node = boardCanvasRef.current?.querySelector<HTMLElement>(`.media-board-node[data-item-id="${CSS.escape(id)}"]`);
          if (!node) return;
          node.style.transform = `translate3d(${previewDx}px, ${previewDy}px, 0)`;
          node.classList.add('drag-preview');
        });
      });
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      latestClientX = moveEvent.clientX;
      latestClientY = moveEvent.clientY;
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!didDrag && distance < MEDIA_BOARD_DRAG_START_DISTANCE) return;

      if (!didDrag) {
        didDrag = true;
        suppressNextMediaBoardContextMenu();
        closeContextMenu();
        setMediaBoardPerformanceMode(true);
      }

      previewDx = (moveEvent.clientX - startX) / mediaBoardViewport.zoom;
      previewDy = (moveEvent.clientY - startY) / mediaBoardViewport.zoom;
      schedulePreview();
    };

    const handleMouseUp = () => {
      if (boardInteractionFrameRef.current !== null) {
        window.cancelAnimationFrame(boardInteractionFrameRef.current);
        boardInteractionFrameRef.current = null;
      }
      clearPreview();
      setMediaBoardPerformanceMode(false);

      if (didDrag) {
        const point = screenToMediaBoard(latestClientX, latestClientY);
        const target = getMediaBoardInsertTarget(point, moveIds);
        if (target) {
          commitMediaBoardOrderChange(moveIds, target.groupId, target.index);
        }
      }

      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
  }, [
    closeContextMenu,
    commitMediaBoardOrderChange,
    getMediaBoardInsertTarget,
    mediaBoardItemIds,
    mediaBoardLayout.placements,
    mediaBoardPlacementsById,
    mediaBoardViewport.zoom,
    selectedIds,
    screenToMediaBoard,
    setMediaBoardPerformanceMode,
    suppressNextMediaBoardContextMenu,
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
    if (target.closest('.media-board-node, button, input, .context-menu')) return;

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
    handleItemClick(item.id, e);

    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      startMediaBoardPanGesture(e);
    }
  }, [
    handleItemClick,
    setSelection,
    selectedIds,
    startMediaBoardMarqueeGesture,
    startMediaBoardNodeMoveGesture,
    startMediaBoardPanGesture,
  ]);

  const handleMediaBoardDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsExternalDragOver(false);

    if (e.dataTransfer.types.includes('application/x-media-panel-item')) {
      const itemId = e.dataTransfer.getData('application/x-media-panel-item');
      if (itemId) {
        const itemsToMove = selectedIds.includes(itemId) ? selectedIds : [itemId];
        const isFolderMove = itemsToMove.some((id) => folders.some((folder) => folder.id === id));
        if (isFolderMove) {
          moveToFolder(itemsToMove, null);
        } else {
          const point = screenToMediaBoard(e.clientX, e.clientY);
          const target = getMediaBoardInsertTarget(point, itemsToMove);
          const groupId = target?.groupId ?? null;
          const index = target?.index ?? getMediaBoardAppendIndex(groupId, itemsToMove);
          commitMediaBoardOrderChange(itemsToMove, groupId, index);
        }
      }
      setDragOverFolderId(null);
      setInternalDragId(null);
      return;
    }

    const point = screenToMediaBoard(e.clientX, e.clientY);
    const targetGroup = mediaBoardLayout.groups.find((group) => (
      point.x >= group.x
      && point.x <= group.x + group.width
      && point.y >= group.y
      && point.y <= group.y + group.height
    ));
    await handleExternalDropImport(e.dataTransfer, targetGroup?.id ?? null);
  }, [commitMediaBoardOrderChange, folders, getMediaBoardAppendIndex, getMediaBoardInsertTarget, handleExternalDropImport, mediaBoardLayout.groups, moveToFolder, screenToMediaBoard, selectedIds]);

  const handleMediaBoardGroupDrop = useCallback(async (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.types.includes('application/x-media-panel-item')) {
      const itemId = e.dataTransfer.getData('application/x-media-panel-item');
      if (itemId) {
        if (groupId) {
          const draggedFolder = folders.find((folder) => folder.id === itemId);
          if (draggedFolder) {
            let parent = folders.find((folder) => folder.id === groupId);
            while (parent) {
              if (parent.id === itemId) {
                setDragOverFolderId(null);
                setInternalDragId(null);
                return;
              }
              parent = parent.parentId ? folders.find((folder) => folder.id === parent!.parentId) : undefined;
            }
          }
        }
        const itemsToMove = selectedIds.includes(itemId) ? selectedIds : [itemId];
        const isFolderMove = itemsToMove.some((id) => folders.some((folder) => folder.id === id));
        if (isFolderMove) {
          moveToFolder(itemsToMove, groupId);
        } else {
          const point = screenToMediaBoard(e.clientX, e.clientY);
          const target = getMediaBoardInsertTarget(point, itemsToMove);
          const targetGroupId = target?.groupId ?? groupId;
          const targetIndex = target?.index ?? getMediaBoardAppendIndex(targetGroupId, itemsToMove);
          commitMediaBoardOrderChange(itemsToMove, targetGroupId, targetIndex);
        }
      }
      setDragOverFolderId(null);
      setInternalDragId(null);
      return;
    }

    await handleExternalDropImport(e.dataTransfer, groupId);
    setIsExternalDragOver(false);
  }, [commitMediaBoardOrderChange, folders, getMediaBoardAppendIndex, getMediaBoardInsertTarget, handleExternalDropImport, moveToFolder, screenToMediaBoard, selectedIds]);

  const handleMediaBoardGroupDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-media-panel-item') && !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-media-panel-item') ? 'move' : 'copy';
  }, []);

  const resetMediaBoardLayout = useCallback(() => {
    setMediaBoardOrder({});
    setMediaBoardViewport(DEFAULT_BOARD_VIEWPORT);
  }, []);

  const renderMediaBoardNode = (placement: MediaBoardNodePlacement) => {
    const { item, layout } = placement;
    const isSelected = selectedIds.includes(item.id);
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
    const resolutionLabel = 'width' in item && 'height' in item && item.width && item.height
      ? `${item.width}x${item.height}`
      : comp
        ? `${comp.width}x${comp.height}`
        : null;

    return (
      <div
        key={item.id}
        data-item-id={item.id}
        className={`media-board-node ${isSelected ? 'selected' : ''} ${isMediaFile && !mediaFile?.file ? 'no-file' : ''} ${importProgress !== null ? 'importing' : ''} ${isTextItem ? 'text' : ''}`}
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
          ) : thumbUrl ? (
            <img
              src={thumbUrl}
              alt=""
              draggable={false}
              onError={mediaFile ? () => { void refreshFileUrls(mediaFile.id); } : undefined}
            />
          ) : (
            <div className="media-board-node-placeholder">
              <FileTypeIcon type={isComp ? 'composition' : getProjectItemIconType(item)} large />
            </div>
          )}
          {duration ? <span className="media-board-duration">{formatDuration(duration)}</span> : null}
          {importProgress !== null ? <span className="media-board-progress">{importProgress}%</span> : null}
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
        <div className="media-board-node-body">
          <div className="media-board-node-name">{item.name}</div>
          <div className="media-board-node-meta">
            <span>{getMediaBoardTypeLabel(item)}</span>
            {resolutionLabel ? <span>{resolutionLabel}</span> : null}
            {mediaFile?.codec ? <span>{mediaFile.codec}</span> : null}
          </div>
        </div>
      </div>
    );
  };

  const renderMediaBoardView = () => (
    <div className="media-board-wrapper" ref={boardWrapperRef}>
      <div className="media-board-toolbar">
        <div className="media-board-toolbar-title">
          <span>Board</span>
          <span>{mediaBoardItems.length} assets in {mediaBoardLayout.groups.length} groups</span>
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
          {mediaBoardLayout.groups.map((group) => (
            <div
              key={group.id ?? 'root'}
              className="media-board-group"
              style={{
                left: group.x,
                top: group.y,
                width: group.width,
                height: group.height,
              }}
              onDragOver={handleMediaBoardGroupDragOver}
              onDrop={(e) => handleMediaBoardGroupDrop(e, group.id)}
            >
              <div className="media-board-group-header">
                <span>{group.name}</span>
                <span>{group.itemCount}</span>
              </div>
            </div>
          ))}
          {mediaBoardLayout.placements.map(renderMediaBoardNode)}
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
  const gridItems = sortItems(getItemsByFolder(gridFolderId));
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

  // Check if any files need reload (lost permission after refresh)
  const filesNeedReload = files.some(f => !f.file);
  const filesNeedReloadCount = files.filter(f => !f.file).length;

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
              onClick={() => {
                setViewMode('classic');
                setGridFolderId(null);
              }}
              title="Classic list view"
              aria-label="Classic list view"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="0.5"/><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="1" y="12" width="14" height="2" rx="0.5"/></svg>
            </button>
            <button
              className={`btn btn-sm btn-icon media-view-toggle ${viewMode === 'icons' ? 'active' : ''}`}
              onClick={() => setViewMode('icons')}
              title="Large icon view"
              aria-label="Large icon view"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
            </button>
            <button
              className={`btn btn-sm btn-icon media-view-toggle ${viewMode === 'board' ? 'active' : ''}`}
              onClick={() => {
                setViewMode('board');
                setGridFolderId(null);
              }}
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
      <div className="media-panel-content">
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
              onMouseDown={handleMarqueeMouseDown}
              onContextMenu={(e) => {
                const target = e.target as HTMLElement;
                if (!target.closest('.media-item')) handleContextMenu(e);
              }}
              style={{ position: 'relative' }}
            >
              {rootItems.map(item => renderItem(item))}
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
