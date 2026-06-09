// Media Panel - Project browser like After Effects

import React, { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react';
import './MediaPanel.css';
import { CompositionSettingsDialog } from './media/CompositionSettingsDialog';
import { SolidSettingsDialog } from './media/SolidSettingsDialog';
import { LabelColorPicker } from './media/LabelColorPicker';
import { isImportedMediaFileItem } from './media/itemTypeGuards';
import { renderMediaAnnotationContextMenuMount } from './media/context/MediaAnnotationContextMenuMount';
import { MediaPanelProjectContextMenuMount } from './media/context/MediaPanelProjectContextMenuMount';
import { useMediaContextExplorerHandlers } from './media/context/useMediaContextExplorerHandlers';
import { useMediaContextLocalHandlers, type MediaContextSolidSettingsDialogState } from './media/context/useMediaContextLocalHandlers';
import { formatMediaDuration as formatDuration } from './media/grid/format';
import { MediaGridChrome } from './media/grid/MediaGridChrome';
import { MediaFloatingFeedbackPortal } from './media/panel/MediaFloatingFeedbackPortal';
import { MediaGenerationTrayMount } from './media/panel/MediaGenerationTrayMount';
import { MediaClassicListChrome } from './media/list/MediaClassicListChrome';
import {
  MEDIA_CLASSIC_ROW_HEIGHT as CLASSIC_ROW_HEIGHT,
  formatMediaPanelBitrate as formatBitrate,
  formatMediaPanelFileSize as formatFileSize,
  getGaussianSplatDetailLines,
  getGaussianSplatResolutionLabel,
  getMediaFileCodecLabel,
  getMediaFileContainerLabel,
  loadMediaClassicColumnOrder,
  saveMediaClassicColumnOrder,
  sortClassicMediaItems,
} from './media/list/classicListPlanning';
import type { MediaClassicColumnId } from './media/list/types';
import { MediaDropOverlay } from './media/panel/MediaDropOverlay';
import { MediaPanelHeader } from './media/panel/MediaPanelHeader';
import { MediaNoMediaEmptyState } from './media/panel/MediaNoMediaEmptyState';
import { MediaNoSearchResultsEmptyState } from './media/panel/MediaNoSearchResultsEmptyState';
import type { MediaPanelViewMode } from './media/panel/types';
import { useMediaPanelAddImportCommands } from './media/panel/useMediaPanelAddImportCommands';
import { useMediaPanelContextMenuState } from './media/panel/useMediaPanelContextMenuState';
import { useMediaPanelDragDropMarquee, type MediaPanelMarquee } from './media/panel/useMediaPanelDragDropMarquee';
import { useMediaPanelItemRenderers } from './media/panel/useMediaPanelItemRenderers';
import { useMediaPanelProjectItems } from './media/panel/useMediaPanelProjectItems';
import { useMediaPanelRelinkStatus } from './media/panel/useMediaPanelRelinkStatus';
import { getMediaDeleteImpact, useMediaPanelRenameDeleteCommands } from './media/panel/useMediaPanelRenameDeleteCommands';
import { useMediaPanelSelectionCommands } from './media/panel/useMediaPanelSelectionCommands';
import { useMediaPanelSourceMonitorBadges } from './media/panel/useMediaPanelSourceMonitorBadges';
import { useMediaPanelViewTransition } from './media/panel/useMediaPanelViewTransition';
import { MediaBoardAnnotationLayer } from './media/board/MediaBoardAnnotationLayer';
import { MediaBoardView } from './media/board/MediaBoardView';
import { useMediaBoardAnnotationCommands } from './media/board/useMediaBoardAnnotationCommands';
import { useMediaBoardAnnotationGestures } from './media/board/useMediaBoardAnnotationGestures';
import { useMediaBoardAnnotationState } from './media/board/useMediaBoardAnnotationState';
import {
  MEDIA_BOARD_ANNOTATION_COLOR_OPTIONS,
  getVisibleMediaBoardAnnotations,
} from './media/board/annotations';
import {
  DEFAULT_BOARD_VIEWPORT,
  MEDIA_BOARD_AUTOPAN_EDGE_PX,
  MEDIA_BOARD_AUTOPAN_MAX_SPEED,
  MEDIA_BOARD_COMPACT_LOD_ZOOM,
  MEDIA_BOARD_DRAG_START_DISTANCE,
  MEDIA_BOARD_EMPTY_SLOT_HEIGHT,
  MEDIA_BOARD_EMPTY_SLOT_WIDTH,
  MEDIA_BOARD_NODE_GAP,
  MEDIA_BOARD_ORIGINAL_FOCUS_MARGIN_RATIO,
  MEDIA_BOARD_ORIGINAL_FOCUS_ZOOM,
  MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM,
  MEDIA_BOARD_OVERVIEW_THUMBNAIL_REQUEST_LIMIT,
  MEDIA_BOARD_PAN_ZOOM_MAX,
  MEDIA_BOARD_PAN_ZOOM_MIN,
  MEDIA_BOARD_ROOT_ORDER_KEY,
  MEDIA_BOARD_SLOT_CELL_HEIGHT,
  MEDIA_BOARD_SLOT_CELL_WIDTH,
  MEDIA_BOARD_THUMBNAIL_LOD_MIN_ZOOM,
  MEDIA_BOARD_THUMBNAIL_REQUEST_LIMIT,
  MEDIA_BOARD_THUMBNAIL_REQUEST_MIN_ZOOM,
  MEDIA_BOARD_THUMBNAIL_WORKER_COUNT,
  MEDIA_BOARD_TIMELINE_HANDOFF_DISTANCE_PX,
  MEDIA_BOARD_VIDEO_POSTER_FALLBACK_LIMIT,
  MEDIA_BOARD_GRID_PARALLAX,
  getMediaBoardGridSize,
  getMediaBoardUiScale,
} from './media/board/constants';
import {
  buildMediaBoardLayoutGeometry,
  createMediaBoardLayoutSignature,
  getMediaBoardGroupChrome,
  getMediaBoardNodeSize,
  getMediaBoardVisibleRect,
  isMediaBoardFolder,
  mediaBoardGroupIntersectsVisibleRect,
  mediaBoardNodeIntersectsVisibleRect,
  normalizeMediaBoardOrderIds,
  restoreMediaBoardLayoutItems,
  waitForMediaBoardThumbnailTurn,
} from './media/board/layout';
import { reconcileMediaBoardLayouts } from './media/board/layoutReconcile';
import { drawMediaBoardOverviewItem } from './media/board/overviewCanvas';
import {
  loadMediaBoardGroupOffsets,
  loadMediaBoardLayoutSnapshot,
  loadMediaBoardLayouts,
  loadMediaBoardOrder,
  loadMediaBoardViewport,
  saveMediaBoardGroupOffsets,
  saveMediaBoardLayouts,
  saveMediaBoardOrder,
  saveMediaBoardLayoutSnapshot,
  saveMediaBoardViewport,
} from './media/board/storage';
import type {
  MediaBoardGroupLayout,
  MediaBoardGroupOffset,
  MediaBoardInsertionPreview,
  MediaBoardItem,
  MediaBoardLayoutResult,
  MediaBoardMarquee,
  MediaBoardNodeLayout,
  MediaBoardViewport,
  MediaBoardViewportSize,
} from './media/board/types';

import { useMediaStore } from '../../stores/mediaStore';
import { useFlashBoardStore } from '../../stores/flashboardStore';
import type {
  CameraItem,
  Composition,
  MathSceneItem,
  MediaFolder,
  MeshItem,
  MotionShapeItem,
  ProjectItem,
  SignalAssetItem,
  SolidItem,
  SplatEffectorItem,
  TextItem,
} from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { RelinkDialog } from '../common/RelinkDialog';
import { mediaNeedsRelink } from '../../services/project/relinkMedia';
import {
  getLastMediaSourceRevealRequest,
  isMediaSourceRevealEvent,
  MEDIA_SOURCE_REVEAL_EVENT,
  type MediaSourceRevealRequest,
} from '../../services/mediaSourceReveal';
import {
  clearExternalDragPayload,
  createExternalDragPayloadForProjectItem,
  dispatchExternalDragBridgeEvent,
  setExternalDragPayload,
} from '../timeline/utils/externalDragSession';

// Column definitions
type ColumnId = MediaClassicColumnId;

const EMPTY_TEXT_ITEMS: TextItem[] = [];
const EMPTY_SOLID_ITEMS: SolidItem[] = [];
const EMPTY_MESH_ITEMS: MeshItem[] = [];
const EMPTY_CAMERA_ITEMS: CameraItem[] = [];
const EMPTY_SPLAT_EFFECTOR_ITEMS: SplatEffectorItem[] = [];
const EMPTY_MATH_SCENE_ITEMS: MathSceneItem[] = [];
const EMPTY_MOTION_SHAPE_ITEMS: MotionShapeItem[] = [];
const EMPTY_SIGNAL_ASSETS: SignalAssetItem[] = [];

const VIEW_MODE_STORAGE_KEY = 'media-panel-view-mode';
const MEDIA_PANEL_PROJECT_UI_LOADED_EVENT = 'media-panel-project-ui-loaded';
const MEDIA_PANEL_REVEAL_PULSE_MS = 1200;
const MEDIA_PANEL_REVEAL_REQUEST_MAX_AGE_MS = 10000;

function loadMediaPanelViewMode(): MediaPanelViewMode {
  const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
  if (stored === 'board') return 'board';
  if (stored === 'icons' || stored === 'grid') return 'icons';
  return 'classic';
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

function getAncestorFolderIds(item: ProjectItem, folders: MediaFolder[]): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let parentId = item.parentId ?? null;

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    ancestors.push(parentId);
    parentId = folders.find((folder) => folder.id === parentId)?.parentId ?? null;
  }

  return ancestors;
}

function getMediaPanelAnimatedTarget(root: HTMLElement | null, itemId: string): HTMLElement | null {
  if (!root || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
    return null;
  }

  return root.querySelector<HTMLElement>(`[data-media-panel-anim-id="${CSS.escape(itemId)}"]`);
}

export function MediaPanel() {
  // Reactive data - subscribe to specific values only
  const files = useMediaStore(state => state.files);
  const compositions = useMediaStore(state => state.compositions);
  const folders = useMediaStore(state => state.folders);
  const textItems = useMediaStore(state => state.textItems ?? EMPTY_TEXT_ITEMS);
  const solidItems = useMediaStore(state => state.solidItems ?? EMPTY_SOLID_ITEMS);
  const meshItems = useMediaStore(state => state.meshItems ?? EMPTY_MESH_ITEMS);
  const cameraItems = useMediaStore(state => state.cameraItems ?? EMPTY_CAMERA_ITEMS);
  const splatEffectorItems = useMediaStore(state => state.splatEffectorItems ?? EMPTY_SPLAT_EFFECTOR_ITEMS);
  const mathSceneItems = useMediaStore(state => state.mathSceneItems ?? EMPTY_MATH_SCENE_ITEMS);
  const motionShapeItems = useMediaStore(state => state.motionShapeItems ?? EMPTY_MOTION_SHAPE_ITEMS);
  const signalAssets = useMediaStore(state => state.signalAssets ?? EMPTY_SIGNAL_ASSETS);
  const selectedIds = useMediaStore(state => state.selectedIds);
  const duplicateMediaItems = useMediaStore(state => state.duplicateMediaItems);
  const copyMediaItems = useMediaStore(state => state.copyMediaItems);
  const pasteMediaItems = useMediaStore(state => state.pasteMediaItems);
  const hasMediaClipboard = useMediaStore(state => state.hasMediaClipboard);

  const expandedFolderIds = useMediaStore(state => state.expandedFolderIds);
  const fileSystemSupported = useMediaStore(state => state.fileSystemSupported);
  const proxyFolderName = useMediaStore(state => state.proxyFolderName);
  const activeCompositionId = useMediaStore(state => state.activeCompositionId);
  const refreshFileUrls = useMediaStore(state => state.refreshFileUrls);
  const ensureFileThumbnail = useMediaStore(state => state.ensureFileThumbnail);
  const composerReferenceMediaFileIds = useFlashBoardStore(state => state.composer.referenceMediaFileIds);
  const updateFlashBoardComposer = useFlashBoardStore(state => state.updateComposer);

  // Actions from getState() - stable, no subscription needed
  const {
    importFiles,
    importFilesWithPicker,
    importFilesWithHandles,
    createComposition,
    createFolder,
    getMediaFileUsages,
    deleteMediaFilesEverywhere,
    removeSignalAsset,
    removeComposition,
    removeFolder,
    renameFile,
    renameSignalAsset,
    renameFolder,
    reloadFile,
    toggleFolderExpanded,
    setSelection,
    addToSelection,
    removeFromSelection,
    openCompositionTab,
    setSourceMonitorFile,
    updateComposition,
    generateProxy,
    generateAudioProxy,
    generateMediaWaveform,
    generateMediaSpectrogram,
    cancelProxyGeneration,
    pickProxyFolder,
    showInExplorer,
    moveToFolder,
    createTextItem,
    getOrCreateTextFolder,
    removeTextItem,
    createSolidItem,
    getOrCreateSolidFolder,
    removeSolidItem,
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
    createMathSceneItem,
    getOrCreateMathSceneFolder,
    removeMathSceneItem,
    createMotionShapeItem,
    getOrCreateMotionShapeFolder,
    removeMotionShapeItem,
    setLabelColor,
    importGaussianSplat,
  } = useMediaStore.getState();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemListRef = useRef<HTMLDivElement>(null);
  const mediaPanelContentRef = useRef<HTMLDivElement>(null);
  const boardWrapperRef = useRef<HTMLDivElement>(null);
  const boardCanvasRef = useRef<HTMLDivElement>(null);
  const boardCanvasInnerRef = useRef<HTMLDivElement>(null);
  const boardOverviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const boardInteractionFrameRef = useRef<number | null>(null);
  const boardAutoPanFrameRef = useRef<number | null>(null);
  const boardOverviewRedrawFrameRef = useRef<number | null>(null);
  const boardOverviewImageCacheRef = useRef(new Map<string, { src: string; image: HTMLImageElement; status: 'loading' | 'loaded' | 'error' }>());
  const lastHandledRevealRequestIdRef = useRef(0);
  const mediaRevealPulseTimerRef = useRef<number | null>(null);
  const classicListScrollTopRef = useRef(0);
  const classicListScrollLeftRef = useRef(0);
  const classicListScrollSnapTimerRef = useRef<number | null>(null);
  const classicListHorizontalSnapTimerRef = useRef<number | null>(null);
  const classicListScrollSettledTimerRef = useRef<number | null>(null);
  const {
    contextMenu,
    setContextMenu,
    closeContextMenu,
    contextMenuRef,
    contextMenuPosition,
  } = useMediaPanelContextMenuState();

  // Marquee selection state
  const [marquee, setMarquee] = useState<MediaPanelMarquee | null>(null);
  const [settingsDialog, setSettingsDialog] = useState<{ compositionId: string; width: number; height: number; frameRate: number; duration: number } | null>(null);
  const [solidSettingsDialog, setSolidSettingsDialog] = useState<MediaContextSolidSettingsDialogState | null>(null);
  const [addDropdownOpen, setAddDropdownOpen] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [internalDragId, setInternalDragId] = useState<string | null>(null);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [classicListViewport, setClassicListViewport] = useState({ scrollTop: 0, height: 0 });
  const [isClassicListVerticalScrolling, setClassicListVerticalScrolling] = useState(false);
  const [isClassicListHorizontallyScrolled, setClassicListHorizontallyScrolled] = useState(false);
  const [labelPickerItemId, setLabelPickerItemId] = useState<string | null>(null);
  const [labelPickerPos, setLabelPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [viewMode, setViewMode] = useState<MediaPanelViewMode>(loadMediaPanelViewMode);
  const [isGenerativeTrayExpanded, setGenerativeTrayExpanded] = useState(false);
  const [mediaSearchQuery, setMediaSearchQuery] = useState('');
  // Grid view: current open folder (null = root)
  const [gridFolderId, setGridFolderId] = useState<string | null>(null);
  const {
    renamingId,
    renameValue,
    renameTimerRef,
    setRenamingId,
    setRenameValue,
    startRename,
    finishRename,
    handleNameClick,
    handleDelete,
    deleteConfirmation,
    setDeleteConfirmation,
    deleteConfirmationBusy,
    confirmMediaDelete,
  } = useMediaPanelRenameDeleteCommands({
    selectedIds,
    files,
    folders,
    compositions,
    textItems,
    solidItems,
    meshItems,
    cameraItems,
    splatEffectorItems,
    mathSceneItems,
    motionShapeItems,
    signalAssets,
    renameFile,
    renameSignalAsset,
    renameFolder,
    updateComposition,
    getMediaFileUsages,
    deleteMediaFilesEverywhere,
    removeSignalAsset,
    removeComposition,
    removeFolder,
    removeTextItem,
    removeSolidItem,
    removeMeshItem,
    removeCameraItem,
    removeSplatEffectorItem,
    removeMathSceneItem,
    removeMotionShapeItem,
    closeContextMenu,
  });
  const handleViewModeChange = useMediaPanelViewTransition({
    mediaPanelContentRef,
    viewMode,
    setViewMode,
    setGridFolderId,
  });
  const [mediaBoardViewport, setMediaBoardViewport] = useState<MediaBoardViewport>(loadMediaBoardViewport);
  const mediaBoardViewportRef = useRef<MediaBoardViewport>(mediaBoardViewport);
  const boardWheelCommitTimerRef = useRef<number | null>(null);
  const [mediaBoardOrder, setMediaBoardOrder] = useState<Record<string, string[]>>(loadMediaBoardOrder);
  const [mediaBoardGroupOffsets, setMediaBoardGroupOffsets] = useState<Record<string, MediaBoardGroupOffset>>(loadMediaBoardGroupOffsets);
  const [mediaBoardLayouts, setMediaBoardLayouts] = useState<Record<string, MediaBoardGroupOffset>>(loadMediaBoardLayouts);
  const [mediaBoardCanvasSize, setMediaBoardCanvasSize] = useState<MediaBoardViewportSize>(() => ({
    width: typeof window === 'undefined' ? 1280 : Math.max(1, window.innerWidth),
    height: typeof window === 'undefined' ? 720 : Math.max(1, window.innerHeight),
  }));
  const [mediaBoardOverviewImageVersion, setMediaBoardOverviewImageVersion] = useState(0);
  const [mediaBoardMarquee, setMediaBoardMarquee] = useState<MediaBoardMarquee | null>(null);
  const [mediaBoardInsertionPreview, setMediaBoardInsertionPreview] = useState<MediaBoardInsertionPreview | null>(null);
  const [pendingMediaReveal, setPendingMediaReveal] = useState<MediaSourceRevealRequest | null>(null);
  const {
    createMediaBoardAnnotation,
    mediaBoardAnnotations,
    reloadMediaBoardAnnotations,
    selectedMediaBoardAnnotationId,
    setSelectedMediaBoardAnnotationId,
    updateMediaBoardAnnotation,
  } = useMediaBoardAnnotationState();
  const suppressMediaBoardContextMenuRef = useRef(false);
  const suppressMediaBoardContextMenuTimerRef = useRef<number | null>(null);

  // Column order state
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(loadMediaClassicColumnOrder);
  const [draggingColumn, setDraggingColumn] = useState<ColumnId | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);

  // Sort state
  const [sortColumn, setSortColumn] = useState<ColumnId | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Save column order to localStorage
  useEffect(() => {
    saveMediaClassicColumnOrder(columnOrder);
  }, [columnOrder]);

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    mediaBoardViewportRef.current = mediaBoardViewport;
    saveMediaBoardViewport(mediaBoardViewport);
  }, [mediaBoardViewport]);

  useEffect(() => () => {
    if (boardWheelCommitTimerRef.current !== null) {
      window.clearTimeout(boardWheelCommitTimerRef.current);
      boardWheelCommitTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    saveMediaBoardOrder(mediaBoardOrder);
  }, [mediaBoardOrder]);

  useEffect(() => {
    saveMediaBoardGroupOffsets(mediaBoardGroupOffsets);
  }, [mediaBoardGroupOffsets]);

  useEffect(() => {
    saveMediaBoardLayouts(mediaBoardLayouts);
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
      classicListScrollTopRef.current = list.scrollTop;
      classicListScrollLeftRef.current = list.scrollLeft;
      setClassicListHorizontallyScrolled(list.scrollLeft > 0.5);
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
    if (boardOverviewRedrawFrameRef.current !== null) {
      window.cancelAnimationFrame(boardOverviewRedrawFrameRef.current);
    }
    if (suppressMediaBoardContextMenuTimerRef.current !== null) {
      window.clearTimeout(suppressMediaBoardContextMenuTimerRef.current);
    }
    if (mediaRevealPulseTimerRef.current !== null) {
      window.clearTimeout(mediaRevealPulseTimerRef.current);
      mediaRevealPulseTimerRef.current = null;
    }
    if (classicListScrollSnapTimerRef.current !== null) {
      window.clearTimeout(classicListScrollSnapTimerRef.current);
      classicListScrollSnapTimerRef.current = null;
    }
    if (classicListHorizontalSnapTimerRef.current !== null) {
      window.clearTimeout(classicListHorizontalSnapTimerRef.current);
      classicListHorizontalSnapTimerRef.current = null;
    }
    if (classicListScrollSettledTimerRef.current !== null) {
      window.clearTimeout(classicListScrollSettledTimerRef.current);
      classicListScrollSettledTimerRef.current = null;
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

  const sortItems = useCallback((items: ProjectItem[]): ProjectItem[] => {
    return sortClassicMediaItems(items, sortColumn, sortDirection);
  }, [sortColumn, sortDirection]);

  const handleClassicListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const nextScrollTop = target.scrollTop;
    const nextScrollLeft = target.scrollLeft;
    const verticalScrollChanged = Math.abs(nextScrollTop - classicListScrollTopRef.current) > 0.5;
    const horizontalScrollChanged = Math.abs(nextScrollLeft - classicListScrollLeftRef.current) > 0.5;
    classicListScrollTopRef.current = nextScrollTop;
    classicListScrollLeftRef.current = nextScrollLeft;

    if (horizontalScrollChanged) {
      setClassicListHorizontallyScrolled(nextScrollLeft > 0.5);
      if (classicListHorizontalSnapTimerRef.current !== null) {
        window.clearTimeout(classicListHorizontalSnapTimerRef.current);
      }

      classicListHorizontalSnapTimerRef.current = window.setTimeout(() => {
        classicListHorizontalSnapTimerRef.current = null;
        const list = itemListRef.current;
        const header = list?.querySelector<HTMLElement>('.media-column-headers');
        if (!list || !header) return;

        const maxScrollLeft = Math.max(0, list.scrollWidth - list.clientWidth);
        if (maxScrollLeft <= 0) return;

        const nameColumn = header.querySelector<HTMLElement>('.media-col-name');
        const stickyWidth = nameColumn?.offsetWidth ?? 0;
        const candidates = new Set<number>([0, maxScrollLeft]);
        header.querySelectorAll<HTMLElement>('.media-col').forEach((column) => {
          if (column.classList.contains('media-col-name')) return;
          const alignedStart = Math.max(0, Math.min(maxScrollLeft, column.offsetLeft - stickyWidth));
          const alignedEnd = Math.max(0, Math.min(maxScrollLeft, column.offsetLeft + column.offsetWidth - stickyWidth));
          candidates.add(alignedStart);
          candidates.add(alignedEnd);
        });

        const snappedScrollLeft = [...candidates].reduce((best, candidate) => (
          Math.abs(candidate - list.scrollLeft) < Math.abs(best - list.scrollLeft) ? candidate : best
        ), 0);
        if (Math.abs(list.scrollLeft - snappedScrollLeft) > 0.5) {
          list.scrollTo({
            left: snappedScrollLeft,
            top: list.scrollTop,
            behavior: 'smooth',
          });
        }
      }, 90);
    }

    if (verticalScrollChanged) {
      setClassicListVerticalScrolling(true);
      if (classicListScrollSnapTimerRef.current !== null) {
        window.clearTimeout(classicListScrollSnapTimerRef.current);
      }
      if (classicListScrollSettledTimerRef.current !== null) {
        window.clearTimeout(classicListScrollSettledTimerRef.current);
      }

      classicListScrollSnapTimerRef.current = window.setTimeout(() => {
        classicListScrollSnapTimerRef.current = null;
        const list = itemListRef.current;
        if (!list) {
          setClassicListVerticalScrolling(false);
          return;
        }

        const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
        const snappedScrollTop = Math.max(
          0,
          Math.min(maxScrollTop, Math.round(list.scrollTop / CLASSIC_ROW_HEIGHT) * CLASSIC_ROW_HEIGHT),
        );
        if (Math.abs(list.scrollTop - snappedScrollTop) > 0.5) {
          list.scrollTo({
            left: list.scrollLeft,
            top: snappedScrollTop,
            behavior: 'smooth',
          });
        }
      }, 90);

      classicListScrollSettledTimerRef.current = window.setTimeout(() => {
        classicListScrollSettledTimerRef.current = null;
        setClassicListVerticalScrolling(false);
      }, 260);
    }

    setClassicListViewport((current) => {
      const next = {
        scrollTop: nextScrollTop,
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

  const clearMediaBoardInsertionPreview = useCallback(() => {
    setMediaBoardInsertionPreview(null);
  }, []);
  const getTimelineSlotGridProgress = useCallback(() => useTimelineStore.getState().slotGridProgress, []);
  const {
    handleExternalDropImport,
    handleDragOver,
    handleDragLeave,
    handleMarqueeMouseDown,
    handleDragStart,
    handleDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,
    handleRootDrop,
  } = useMediaPanelDragDropMarquee({
    itemListRef,
    renameTimerRef,
    folders,
    selectedIds,
    activeCompositionId,
    setSelection,
    moveToFolder,
    createFolder,
    importFiles,
    importFilesWithHandles,
    setMarquee,
    setInternalDragId,
    setDragOverFolderId,
    setIsExternalDragOver,
    clearMediaBoardInsertionPreview,
    getSlotGridProgress: getTimelineSlotGridProgress,
  });

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

  const mediaContextExplorerHandlers = useMediaContextExplorerHandlers({
    showInExplorer,
    pickProxyFolder,
    closeContextMenu,
  });
  const mediaContextLocalHandlers = useMediaContextLocalHandlers({ moveToFolder, setSolidSettingsDialog, closeContextMenu });

  const handleBadgeClick = useMediaPanelSourceMonitorBadges();

  const {
    getActiveParentId,
    handleImport,
    handleFileChange,
    handleNewComposition,
    handleNewFolder,
    handleNewText,
    handleNewText3D,
    handleNewSolid,
    handleNewMesh,
    handleNewCamera,
    handleNewSplatEffector,
    handleNewMathScene,
    handleNewMotionShape,
    handleImportGaussianSplat,
  } = useMediaPanelAddImportCommands({
    fileInputRef,
    fileSystemSupported,
    contextMenu,
    viewMode,
    gridFolderId,
    selectedIds,
    folders,
    compositionCount: compositions.length,
    importFiles,
    importFilesWithPicker,
    createComposition,
    createFolder,
    createTextItem,
    getOrCreateTextFolder,
    createSolidItem,
    getOrCreateSolidFolder,
    createMeshItem,
    getOrCreateMeshFolder,
    createCameraItem,
    getOrCreateCameraFolder,
    createSplatEffectorItem,
    getOrCreateSplatEffectorFolder,
    createMathSceneItem,
    getOrCreateMathSceneFolder,
    createMotionShapeItem,
    getOrCreateMotionShapeFolder,
    importGaussianSplat,
    closeContextMenu,
  });

  const {
    mediaPanelRootRef,
    floatingTexts,
    handleMediaPanelMouseMove,
    handleItemClick,
    handleItemDoubleClick,
    handleContextMenu,
    handleToggleAiPromptReferences,
    handleRegenerateMediaThumbnails,
    handleRegenerateMediaAudioProxy,
    handleRegenerateMediaWaveform,
    handleRegenerateMediaSpectrogram,
    handleCopySelected,
    handleDuplicateSelected,
    handlePasteItems,
  } = useMediaPanelSelectionCommands({
    selectedIds,
    viewMode,
    setGridFolderId,
    setContextMenu,
    closeContextMenu,
    setSelectedMediaBoardAnnotationId,
    setGenerativeTrayExpanded,
    getActiveParentId,
    getAiReferenceMediaFileIds: () => useFlashBoardStore.getState().composer.referenceMediaFileIds ?? [],
    updateAiReferenceMediaFileIds: (referenceMediaFileIds) => updateFlashBoardComposer({ referenceMediaFileIds }),
    setSelection,
    addToSelection,
    removeFromSelection,
    toggleFolderExpanded,
    openCompositionTab,
    reloadFile,
    setSourceMonitorFile,
    ensureFileThumbnail,
    generateAudioProxy,
    generateMediaWaveform,
    generateMediaSpectrogram,
    copyMediaItems,
    duplicateMediaItems,
    pasteMediaItems,
    hasMediaClipboard,
    handleDelete,
  });

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

  // Name column width state (resizable)
  const [nameColumnWidth, setNameColumnWidth] = useState(() => {
    const stored = localStorage.getItem('media-panel-name-width');
    return stored ? parseInt(stored) : 250;
  });
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const handleProjectUiLoaded = () => {
      setColumnOrder(loadMediaClassicColumnOrder());
      setViewMode(loadMediaPanelViewMode());
      setMediaBoardViewport(loadMediaBoardViewport());
      setMediaBoardOrder(loadMediaBoardOrder());
      setMediaBoardGroupOffsets(loadMediaBoardGroupOffsets());
      setMediaBoardLayouts(loadMediaBoardLayouts());
      reloadMediaBoardAnnotations();
      setSelectedMediaBoardAnnotationId(null);
      const storedNameWidth = localStorage.getItem('media-panel-name-width');
      setNameColumnWidth(storedNameWidth ? parseInt(storedNameWidth, 10) : 250);
      setGridFolderId(null);
    };

    window.addEventListener(MEDIA_PANEL_PROJECT_UI_LOADED_EVENT, handleProjectUiLoaded);
    return () => window.removeEventListener(MEDIA_PANEL_PROJECT_UI_LOADED_EVENT, handleProjectUiLoaded);
  }, [reloadMediaBoardAnnotations, setSelectedMediaBoardAnnotationId]);

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

  const {
    allProjectItems,
    allProjectItemsById,
    totalItems,
    isMediaSearchActive,
    mediaSearchVisibleItemIds,
    mediaSearchResultCount,
    getItemsForParent,
    classicRows,
    dynamicMediaColumnWidths,
    classicVisibleRows,
    classicTopSpacerHeight,
    classicBottomSpacerHeight,
    gridItems,
    gridBreadcrumb,
  } = useMediaPanelProjectItems({
    files,
    compositions,
    folders,
    textItems,
    solidItems,
    meshItems,
    cameraItems,
    splatEffectorItems,
    mathSceneItems,
    motionShapeItems,
    signalAssets,
    expandedFolderIds,
    mediaSearchQuery,
    gridFolderId,
    classicListViewport,
    sortItems,
  });

  const {
    renderClassicRow,
    buildGridTooltip,
    renderGridItem,
  } = useMediaPanelItemRenderers({
    columnOrder,
    selectedIds,
    renamingId,
    expandedFolderIds,
    dragOverFolderId,
    internalDragId,
    nameColumnWidth,
    renameValue,
    setLabelPickerItemId,
    setLabelPickerPos,
    setRenameValue,
    setRenamingId,
    toggleFolderExpanded,
    finishRename,
    handleNameClick,
    handleBadgeClick,
    handleDragStart,
    handleDragEnd,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,
    handleItemClick,
    handleItemDoubleClick,
    handleContextMenu,
    getItemsForParent,
    refreshFileUrls,
    getProjectItemIconType,
    getGaussianSplatDetailLines,
    getGaussianSplatResolutionLabel,
    getMediaFileContainerLabel,
    getMediaFileCodecLabel,
    mediaNeedsRelink,
    formatDuration,
    formatFileSize,
    formatBitrate,
  });

  const mediaBoardItems = allProjectItems;

  const mediaBoardItemIds = useMemo(() => new Set(mediaBoardItems.map((item) => item.id)), [mediaBoardItems]);
  const mediaBoardItemsById = useMemo(() => new Map(mediaBoardItems.map((item) => [item.id, item])), [mediaBoardItems]);
  const mediaBoardFoldersById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
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

    return buildMediaBoardLayoutGeometry({
      mediaBoardItems,
      folders,
      mediaBoardLayouts,
      mediaBoardInsertionPreview,
    });
  }, [folders, mediaBoardInsertionPreview, mediaBoardInsertionPreviewKey, mediaBoardItems, mediaBoardLayoutSignature, mediaBoardLayouts]);
  const mediaBoardLayout = useMemo(() => (
    restoreMediaBoardLayoutItems(mediaBoardLayoutGeometry, mediaBoardItemsById, folders)
  ), [folders, mediaBoardItemsById, mediaBoardLayoutGeometry]);

  useEffect(() => {
    if (viewMode !== 'board' || mediaBoardInsertionPreviewKey) return;

    const saveSnapshot = () => {
      saveMediaBoardLayoutSnapshot(mediaBoardLayoutSignature, mediaBoardLayoutGeometry);
    };
    const requestIdle = window.requestIdleCallback;
    if (typeof requestIdle === 'function') {
      const idleId = requestIdle(saveSnapshot, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(saveSnapshot, 250);
    return () => window.clearTimeout(timeoutId);
  }, [mediaBoardInsertionPreviewKey, mediaBoardLayoutGeometry, mediaBoardLayoutSignature, viewMode]);

  const mediaBoardPlacementsById = useMemo(() => {
    return new Map(mediaBoardLayout.placements.map((placement) => [placement.item.id, placement]));
  }, [mediaBoardLayout.placements]);

  const mediaBoardVisibleRect = useMemo(() => getMediaBoardVisibleRect(
    mediaBoardViewport,
    mediaBoardCanvasSize,
  ), [mediaBoardCanvasSize, mediaBoardViewport]);

  const mediaBoardRenderLod = useMemo(() => ({
    overviewCanvas: mediaBoardViewport.zoom <= MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM,
    compact: mediaBoardViewport.zoom <= MEDIA_BOARD_COMPACT_LOD_ZOOM,
    showImages: mediaBoardViewport.zoom > MEDIA_BOARD_THUMBNAIL_LOD_MIN_ZOOM,
    requestThumbnails: mediaBoardViewport.zoom >= MEDIA_BOARD_THUMBNAIL_REQUEST_MIN_ZOOM,
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

  const mediaBoardVideoPosterFallbackIds = useMemo(() => {
    if (viewMode !== 'board') {
      return new Set<string>();
    }

    const centerX = (mediaBoardVisibleRect.left + mediaBoardVisibleRect.right) / 2;
    const centerY = (mediaBoardVisibleRect.top + mediaBoardVisibleRect.bottom) / 2;

    const ids = visibleMediaBoardPlacements
      .map((placement) => {
        const { item, layout } = placement;
        if (
          placement.isDraggingPreview
          || !isImportedMediaFileItem(item)
          || item.type !== 'video'
          || item.isImporting
          || !item.url
          || mediaNeedsRelink(item)
          || layout.width * mediaBoardViewport.zoom < 4
          || layout.height * mediaBoardViewport.zoom < 4
          || (mediaSearchVisibleItemIds && !mediaSearchVisibleItemIds.has(item.id))
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
      .toSorted((a, b) => (a.distance - b.distance) || (b.area - a.area))
      .slice(0, MEDIA_BOARD_VIDEO_POSTER_FALLBACK_LIMIT)
      .map((entry) => entry.id);

    return new Set(ids);
  }, [
    mediaBoardVisibleRect,
    mediaBoardViewport.zoom,
    mediaSearchVisibleItemIds,
    viewMode,
    visibleMediaBoardPlacements,
  ]);

  const focusedMediaBoardOriginalId = useMemo(() => {
    if (mediaBoardViewport.zoom < MEDIA_BOARD_ORIGINAL_FOCUS_ZOOM) return null;

    const centerX = (mediaBoardVisibleRect.left + mediaBoardVisibleRect.right) / 2;
    const centerY = (mediaBoardVisibleRect.top + mediaBoardVisibleRect.bottom) / 2;
    let bestId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    visibleMediaBoardPlacements.forEach((placement) => {
      const { item, layout } = placement;
      if (
        placement.isDraggingPreview
        || !isImportedMediaFileItem(item)
        || item.type !== 'image'
        || !item.url
        || item.isImporting
        || mediaNeedsRelink(item)
        || (mediaSearchVisibleItemIds && !mediaSearchVisibleItemIds.has(item.id))
        || !mediaBoardNodeIntersectsVisibleRect(layout, mediaBoardVisibleRect)
      ) {
        return;
      }

      const marginX = layout.width * MEDIA_BOARD_ORIGINAL_FOCUS_MARGIN_RATIO;
      const marginY = layout.height * MEDIA_BOARD_ORIGINAL_FOCUS_MARGIN_RATIO;
      if (
        centerX < layout.x - marginX
        || centerX > layout.x + layout.width + marginX
        || centerY < layout.y - marginY
        || centerY > layout.y + layout.height + marginY
      ) {
        return;
      }

      const itemCenterX = layout.x + layout.width / 2;
      const itemCenterY = layout.y + layout.height / 2;
      const distance = Math.hypot(
        (itemCenterX - centerX) / Math.max(1, layout.width),
        (itemCenterY - centerY) / Math.max(1, layout.height),
      );

      if (distance < bestDistance) {
        bestId = item.id;
        bestDistance = distance;
      }
    });

    return bestId;
  }, [mediaBoardViewport.zoom, mediaBoardVisibleRect, mediaSearchVisibleItemIds, visibleMediaBoardPlacements]);
  const isMediaBoardDeepZoomActive = viewMode === 'board' && mediaBoardViewport.zoom >= MEDIA_BOARD_ORIGINAL_FOCUS_ZOOM;

  const pulseMediaPanelRevealTarget = useCallback((itemId: string, scrollIntoView: boolean): boolean => {
    const target = getMediaPanelAnimatedTarget(mediaPanelContentRef.current, itemId);
    if (!target) {
      return false;
    }

    if (scrollIntoView) {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    }

    target.classList.remove('media-panel-reveal-pulse');
    void target.offsetWidth;
    target.classList.add('media-panel-reveal-pulse');

    if (mediaRevealPulseTimerRef.current !== null) {
      window.clearTimeout(mediaRevealPulseTimerRef.current);
    }
    mediaRevealPulseTimerRef.current = window.setTimeout(() => {
      target.classList.remove('media-panel-reveal-pulse');
      mediaRevealPulseTimerRef.current = null;
    }, MEDIA_PANEL_REVEAL_PULSE_MS);

    return true;
  }, []);

  const prepareMediaSourceReveal = useCallback((request: MediaSourceRevealRequest) => {
    if (request.requestId <= lastHandledRevealRequestIdRef.current) {
      return;
    }

    const item = allProjectItemsById.get(request.mediaFileId);
    if (!item) {
      return;
    }

    lastHandledRevealRequestIdRef.current = request.requestId;
    setSelection([request.mediaFileId]);
    setMediaSearchQuery('');

    const ancestorFolderIds = getAncestorFolderIds(item, folders);
    if (viewMode === 'classic' && ancestorFolderIds.length > 0) {
      useMediaStore.setState((state) => ({
        expandedFolderIds: [...new Set([...state.expandedFolderIds, ...ancestorFolderIds])],
      }));
    } else if (viewMode === 'icons') {
      setGridFolderId(item.parentId ?? null);
    }

    setPendingMediaReveal(request);
  }, [allProjectItemsById, folders, setSelection, viewMode]);

  useEffect(() => {
    const handleMediaSourceReveal = (event: Event) => {
      if (!isMediaSourceRevealEvent(event)) {
        return;
      }
      prepareMediaSourceReveal(event.detail);
    };

    window.addEventListener(MEDIA_SOURCE_REVEAL_EVENT, handleMediaSourceReveal);

    const lastRequest = getLastMediaSourceRevealRequest();
    if (
      lastRequest
      && Date.now() - lastRequest.createdAt <= MEDIA_PANEL_REVEAL_REQUEST_MAX_AGE_MS
    ) {
      prepareMediaSourceReveal(lastRequest);
    }

    return () => window.removeEventListener(MEDIA_SOURCE_REVEAL_EVENT, handleMediaSourceReveal);
  }, [prepareMediaSourceReveal]);

  useLayoutEffect(() => {
    if (!pendingMediaReveal) {
      return;
    }

    const item = allProjectItemsById.get(pendingMediaReveal.mediaFileId);
    if (!item) {
      setPendingMediaReveal(null);
      return;
    }

    if (viewMode === 'classic') {
      const list = itemListRef.current;
      const rowIndex = classicRows.findIndex((row) => row.item.id === pendingMediaReveal.mediaFileId);
      if (!list || rowIndex < 0) {
        return;
      }

      const targetTop = rowIndex * CLASSIC_ROW_HEIGHT;
      const targetScrollTop = Math.max(0, targetTop - Math.max(0, (list.clientHeight - CLASSIC_ROW_HEIGHT) / 2));
      if (Math.abs(list.scrollTop - targetScrollTop) > 1) {
        list.scrollTop = targetScrollTop;
        setClassicListViewport({
          scrollTop: targetScrollTop,
          height: list.clientHeight,
        });
      }
    } else if (viewMode === 'icons') {
      if ((item.parentId ?? null) !== gridFolderId) {
        return;
      }
    } else if (viewMode === 'board') {
      const placement = mediaBoardPlacementsById.get(pendingMediaReveal.mediaFileId);
      const canvas = boardCanvasRef.current;
      if (!placement || !canvas) {
        return;
      }

      const zoom = Math.max(MEDIA_BOARD_PAN_ZOOM_MIN, Math.min(MEDIA_BOARD_PAN_ZOOM_MAX, mediaBoardViewport.zoom || 1));
      const centerX = placement.layout.x + (placement.layout.width / 2);
      const centerY = placement.layout.y + (placement.layout.height / 2);
      const nextViewport = {
        zoom,
        panX: (canvas.clientWidth / 2) - (centerX * zoom),
        panY: (canvas.clientHeight / 2) - (centerY * zoom),
      };

      if (
        Math.abs(mediaBoardViewport.panX - nextViewport.panX) > 1
        || Math.abs(mediaBoardViewport.panY - nextViewport.panY) > 1
        || Math.abs(mediaBoardViewport.zoom - nextViewport.zoom) > 0.0001
      ) {
        setMediaBoardViewport(nextViewport);
      }
    }

    let secondFrameId: number | null = null;
    let retryTimerId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        const pulsed = pulseMediaPanelRevealTarget(pendingMediaReveal.mediaFileId, viewMode !== 'board');
        if (pulsed) {
          setPendingMediaReveal(null);
          return;
        }

        retryTimerId = window.setTimeout(() => {
          if (pulseMediaPanelRevealTarget(pendingMediaReveal.mediaFileId, viewMode !== 'board')) {
            setPendingMediaReveal(null);
          }
        }, 120);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
      }
      if (retryTimerId !== null) {
        window.clearTimeout(retryTimerId);
      }
    };
  }, [
    allProjectItemsById,
    classicRows,
    gridFolderId,
    mediaBoardPlacementsById,
    mediaBoardViewport,
    pendingMediaReveal,
    pulseMediaPanelRevealTarget,
    viewMode,
  ]);

  const getMediaBoardPlacementAtPoint = useCallback((point: { x: number; y: number }) => {
    for (let index = mediaBoardLayout.placements.length - 1; index >= 0; index -= 1) {
      const placement = mediaBoardLayout.placements[index];
      const { layout } = placement;
      if (
        point.x >= layout.x
        && point.x <= layout.x + layout.width
        && point.y >= layout.y
        && point.y <= layout.y + layout.height
      ) {
        return placement;
      }
    }
    return null;
  }, [mediaBoardLayout.placements]);

  const visibleMediaBoardThumbnailKey = useMemo(() => {
    if (!mediaBoardRenderLod.requestThumbnails) return '';

    const centerX = (mediaBoardVisibleRect.left + mediaBoardVisibleRect.right) / 2;
    const centerY = (mediaBoardVisibleRect.top + mediaBoardVisibleRect.bottom) / 2;
    const requestLimit = mediaBoardRenderLod.overviewCanvas
      ? MEDIA_BOARD_OVERVIEW_THUMBNAIL_REQUEST_LIMIT
      : MEDIA_BOARD_THUMBNAIL_REQUEST_LIMIT;

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
      .slice(0, requestLimit)
      .map((entry) => entry.id)
      .join('\n');
  }, [mediaBoardRenderLod.overviewCanvas, mediaBoardRenderLod.requestThumbnails, mediaBoardVisibleRect, visibleMediaBoardPlacements]);

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

  const scheduleMediaBoardOverviewRedraw = useCallback(() => {
    if (boardOverviewRedrawFrameRef.current !== null) return;
    boardOverviewRedrawFrameRef.current = window.requestAnimationFrame(() => {
      boardOverviewRedrawFrameRef.current = null;
      setMediaBoardOverviewImageVersion((version) => (version + 1) % 100000);
    });
  }, []);

  useLayoutEffect(() => {
    if (viewMode !== 'board' || !mediaBoardRenderLod.overviewCanvas) return;
    const canvas = boardOverviewCanvasRef.current;
    if (!canvas) return;

    const zoom = Math.max(mediaBoardViewport.zoom, MEDIA_BOARD_PAN_ZOOM_MIN);
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const rect = mediaBoardVisibleRect;
    const boardWidth = Math.max(1, rect.right - rect.left);
    const boardHeight = Math.max(1, rect.bottom - rect.top);
    const pixelWidth = Math.max(1, Math.ceil(boardWidth * zoom * dpr));
    const pixelHeight = Math.max(1, Math.ceil(boardHeight * zoom * dpr));

    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, -rect.left * zoom * dpr, -rect.top * zoom * dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';

    const cache = boardOverviewImageCacheRef.current;
    const visibleItemIds = new Set<string>();
    const getLoadedOverviewImage = (item: MediaBoardItem): HTMLImageElement | null => {
      if (!isImportedMediaFileItem(item) || !item.thumbnailUrl) return null;

      visibleItemIds.add(item.id);
      const cached = cache.get(item.id);
      if (cached?.src === item.thumbnailUrl) {
        return cached.status === 'loaded' ? cached.image : null;
      }

      const image = new Image();
      const record = { src: item.thumbnailUrl, image, status: 'loading' as const };
      cache.set(item.id, record);
      image.onload = () => {
        cache.set(item.id, { ...record, status: 'loaded' });
        scheduleMediaBoardOverviewRedraw();
      };
      image.onerror = () => {
        cache.set(item.id, { ...record, status: 'error' });
      };
      image.decoding = 'async';
      image.src = item.thumbnailUrl;
      return null;
    };

    visibleMediaBoardPlacements.forEach((placement) => {
      if (placement.isDraggingPreview || selectedIdSet.has(placement.item.id)) return;
      drawMediaBoardOverviewItem(
        ctx,
        placement,
        getLoadedOverviewImage(placement.item),
        zoom,
        Boolean(mediaSearchVisibleItemIds && !mediaSearchVisibleItemIds.has(placement.item.id)),
      );
    });

    cache.forEach((_, itemId) => {
      if (!visibleItemIds.has(itemId)) cache.delete(itemId);
    });
  }, [
    mediaBoardOverviewImageVersion,
    mediaBoardRenderLod.overviewCanvas,
    mediaBoardViewport.zoom,
    mediaBoardVisibleRect,
    mediaSearchVisibleItemIds,
    scheduleMediaBoardOverviewRedraw,
    selectedIdSet,
    viewMode,
    visibleMediaBoardPlacements,
  ]);

  const screenToMediaBoard = useCallback((clientX: number, clientY: number) => {
    const rect = boardCanvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const viewport = mediaBoardViewportRef.current;
    return {
      x: (clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (clientY - rect.top - viewport.panY) / viewport.zoom,
    };
  }, []);

  const openBoardAI = useCallback(() => {
    setGenerativeTrayExpanded(true);
    closeContextMenu();
  }, [closeContextMenu]);

  const handleNewMediaBoardAnnotation = useCallback(() => {
    const point = contextMenu?.boardPosition;
    if (!point) {
      closeContextMenu();
      return;
    }

    createMediaBoardAnnotation(point);
    setSelection([]);
    closeContextMenu();
  }, [closeContextMenu, contextMenu?.boardPosition, createMediaBoardAnnotation, setSelection]);

  const {
    startMediaBoardAnnotationDrag,
    startMediaBoardAnnotationResize,
  } = useMediaBoardAnnotationGestures({
    closeContextMenu,
    mediaBoardViewportRef,
    setSelectedMediaBoardAnnotationId,
    setSelection,
    suppressNextMediaBoardContextMenu,
    updateMediaBoardAnnotation,
  });

  const {
    handleMediaBoardAnnotationContextMenu,
    handleMediaBoardAnnotationEditToggle,
    handleMediaBoardAnnotationFocus,
    requestMediaBoardAnnotationTextFocus,
  } = useMediaBoardAnnotationCommands({
    boardRootRef: boardCanvasRef,
    consumeSuppressedMediaBoardContextMenu,
    setAnnotationContextMenu: setContextMenu,
    setSelectedMediaBoardAnnotationId,
    setSelection,
    updateMediaBoardAnnotation,
  });

  const visibleMediaBoardAnnotations = useMemo(() => (
    getVisibleMediaBoardAnnotations(
      mediaBoardAnnotations,
      mediaBoardVisibleRect,
      selectedMediaBoardAnnotationId,
    )
  ), [mediaBoardAnnotations, mediaBoardVisibleRect, selectedMediaBoardAnnotationId]);

  const setMediaBoardPerformanceMode = useCallback((enabled: boolean) => {
    boardWrapperRef.current?.classList.toggle('board-interacting', enabled);
  }, []);

  const applyMediaBoardViewportPreview = useCallback((viewport: MediaBoardViewport) => {
    const inner = boardCanvasInnerRef.current;
    if (inner) {
      inner.style.transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`;
      inner.style.setProperty('--media-board-ui-scale', String(getMediaBoardUiScale(viewport.zoom)));
    }
    // Keep the background grid in sync during interaction (it stays visible now),
    // applying the same parallax it gets on commit so it doesn't jump. (#188)
    const wrapper = boardWrapperRef.current;
    if (wrapper) {
      wrapper.style.setProperty('--media-board-grid-x', `${viewport.panX * MEDIA_BOARD_GRID_PARALLAX}px`);
      wrapper.style.setProperty('--media-board-grid-y', `${viewport.panY * MEDIA_BOARD_GRID_PARALLAX}px`);
      wrapper.style.setProperty('--media-board-grid-size', `${getMediaBoardGridSize(viewport.zoom)}px`);
    }
  }, []);

  const startMediaBoardPanGesture = useCallback((e: React.MouseEvent, options?: { clearSelectionOnTap?: boolean }) => {
    if (e.button === 1) {
      e.preventDefault();
    }
    closeContextMenu();

    const startX = e.clientX;
    const startY = e.clientY;
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
  }, [applyMediaBoardViewportPreview, closeContextMenu, setMediaBoardPerformanceMode, setSelection]);

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
    handleContextMenu(e, undefined, targetGroup?.id ?? null, point);
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

  const getMediaBoardExternalDragPayload = useCallback((item: MediaBoardItem) => {
    if (isMediaBoardFolder(item)) return null;

    return createExternalDragPayloadForProjectItem(item, {
      activeCompositionId,
      requireMediaFileObject: true,
      slotGridProgress: useTimelineStore.getState().slotGridProgress,
    });
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
    const startViewport = { ...mediaBoardViewportRef.current };
    let liveViewport = { ...startViewport };
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
      applyMediaBoardViewportPreview(liveViewport);
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
        mediaBoardViewportRef.current = liveViewport;
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
    applyMediaBoardViewportPreview,
    mediaBoardItemIds,
    mediaBoardLayout.placements,
    mediaBoardPlacementsById,
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
    const current = mediaBoardViewportRef.current;
    const nextZoom = Math.min(
      MEDIA_BOARD_PAN_ZOOM_MAX,
      Math.max(MEDIA_BOARD_PAN_ZOOM_MIN, current.zoom * zoomDelta),
    );
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const nextViewport = {
      zoom: nextZoom,
      panX: cursorX - ((cursorX - current.panX) * (nextZoom / current.zoom)),
      panY: cursorY - ((cursorY - current.panY) * (nextZoom / current.zoom)),
    };

    mediaBoardViewportRef.current = nextViewport;
    setMediaBoardPerformanceMode(true);

    if (boardInteractionFrameRef.current === null) {
      boardInteractionFrameRef.current = window.requestAnimationFrame(() => {
        boardInteractionFrameRef.current = null;
        applyMediaBoardViewportPreview(mediaBoardViewportRef.current);
      });
    }

    if (boardWheelCommitTimerRef.current !== null) {
      window.clearTimeout(boardWheelCommitTimerRef.current);
    }
    boardWheelCommitTimerRef.current = window.setTimeout(() => {
      boardWheelCommitTimerRef.current = null;
      const committedViewport = mediaBoardViewportRef.current;
      setMediaBoardViewport(committedViewport);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setMediaBoardPerformanceMode(false));
      });
    }, 90);
  }, [applyMediaBoardViewportPreview, setMediaBoardPerformanceMode]);

  const handleMediaBoardMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const annotationTarget = target.closest('.media-board-annotation');
    if (target.closest('.media-board-node, .media-board-group.folder-group, button, input, .context-menu')) return;

    if (mediaBoardRenderLod.overviewCanvas) {
      const hitPlacement = getMediaBoardPlacementAtPoint(screenToMediaBoard(e.clientX, e.clientY));
      if (hitPlacement && !isMediaBoardFolder(hitPlacement.item)) {
        if (e.button === 2) {
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey) {
            startMediaBoardMarqueeGesture(e);
            return;
          }
          if (!selectedIds.includes(hitPlacement.item.id)) {
            setSelection([hitPlacement.item.id]);
          }
          startMediaBoardNodeMoveGesture(e, hitPlacement.item);
          return;
        }

        if (e.button === 0) {
          e.stopPropagation();
          if (e.detail >= 2) return;
          handleItemClick(hitPlacement.item.id, e);
          startMediaBoardPanGesture(e);
          return;
        }
      }
    }

    if (e.button === 2) {
      startMediaBoardMarqueeGesture(e);
      return;
    }

    if (e.button !== 0 && e.button !== 1) return;
    startMediaBoardPanGesture(e, { clearSelectionOnTap: !annotationTarget && e.button === 0 && !e.ctrlKey && !e.metaKey });
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

  const handleMediaBoardDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!mediaBoardRenderLod.overviewCanvas) return;
    const target = e.target as HTMLElement;
    if (target.closest('.media-board-node, .media-board-group.folder-group, .media-board-annotation, button, input, .context-menu')) return;
    const hitPlacement = getMediaBoardPlacementAtPoint(screenToMediaBoard(e.clientX, e.clientY));
    if (!hitPlacement || isMediaBoardFolder(hitPlacement.item)) return;
    e.preventDefault();
    e.stopPropagation();
    void handleItemDoubleClick(hitPlacement.item);
  }, [
    getMediaBoardPlacementAtPoint,
    handleItemDoubleClick,
    mediaBoardRenderLod.overviewCanvas,
    screenToMediaBoard,
  ]);

  const handleMediaBoardContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.media-board-node, .media-board-group.folder-group, .media-board-annotation, button, input, .context-menu')) return;

    if (mediaBoardRenderLod.overviewCanvas) {
      const hitPlacement = getMediaBoardPlacementAtPoint(screenToMediaBoard(e.clientX, e.clientY));
      if (hitPlacement && !isMediaBoardFolder(hitPlacement.item)) {
        if (consumeSuppressedMediaBoardContextMenu()) {
          e.preventDefault();
          return;
        }
        handleContextMenu(e, hitPlacement.item.id);
        return;
      }
    }

    handleMediaBoardWorkspaceContextMenu(e);
  }, [
    consumeSuppressedMediaBoardContextMenu,
    getMediaBoardPlacementAtPoint,
    handleContextMenu,
    handleMediaBoardWorkspaceContextMenu,
    mediaBoardRenderLod.overviewCanvas,
    screenToMediaBoard,
  ]);

  const handleMediaBoardNodeMouseDown = useCallback((e: React.MouseEvent, item: MediaBoardItem) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input')) return;

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

  const handleMediaBoardCanvasDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      setIsExternalDragOver(true);
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-media-panel-item') ? 'move' : 'copy';
    updateMediaBoardInsertionFromNativeDrag(e);
  }, [updateMediaBoardInsertionFromNativeDrag]);

  const handleMediaBoardCanvasDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget === e.target) {
      setMediaBoardInsertionPreview(null);
    }
  }, []);

  const resetMediaBoardLayout = useCallback(() => {
    setMediaBoardOrder({});
    setMediaBoardGroupOffsets({});
    setMediaBoardLayouts({});
    setMediaBoardViewport(DEFAULT_BOARD_VIEWPORT);
  }, []);

  const mediaBoardOverviewCanvasStyle = useMemo<React.CSSProperties>(() => ({
    left: mediaBoardVisibleRect.left,
    top: mediaBoardVisibleRect.top,
    width: Math.max(1, mediaBoardVisibleRect.right - mediaBoardVisibleRect.left),
    height: Math.max(1, mediaBoardVisibleRect.bottom - mediaBoardVisibleRect.top),
  }), [mediaBoardVisibleRect]);

  const requestMediaBoardThumbnail = useCallback((id: string) => {
    void ensureFileThumbnail(id);
  }, [ensureFileThumbnail]);

  const renderMediaBoardView = () => (
    <MediaBoardView
      wrapperRef={boardWrapperRef}
      canvasRef={boardCanvasRef}
      canvasInnerRef={boardCanvasInnerRef}
      overviewCanvasRef={boardOverviewCanvasRef}
      viewport={mediaBoardViewport}
      renderLod={mediaBoardRenderLod}
      overviewCanvasStyle={mediaBoardOverviewCanvasStyle}
      isMediaSearchActive={isMediaSearchActive}
      mediaSearchResultCount={mediaSearchResultCount}
      totalItems={totalItems}
      itemCount={mediaBoardItems.length}
      folderCount={mediaBoardLayout.groups.filter((group) => group.id !== null).length}
      folders={folders}
      visibleGroups={visibleMediaBoardGroups}
      visibleInsertGaps={visibleMediaBoardInsertGaps}
      visiblePlacements={visibleMediaBoardPlacements}
      visibleRect={mediaBoardVisibleRect}
      focusedOriginalMediaId={focusedMediaBoardOriginalId}
      videoPosterFallbackIds={mediaBoardVideoPosterFallbackIds}
      marquee={mediaBoardMarquee}
      selectedIdSet={selectedIdSet}
      mediaSearchVisibleItemIds={mediaSearchVisibleItemIds}
      renamingId={renamingId}
      renameValue={renameValue}
      onRenameValueChange={setRenameValue}
      onFinishRename={finishRename}
      onCancelRename={() => setRenamingId(null)}
      onStartRename={startRename}
      onOpenAI={openBoardAI}
      onResetLayout={resetMediaBoardLayout}
      onCanvasWheel={handleMediaBoardWheel}
      onCanvasMouseDown={handleMediaBoardMouseDown}
      onCanvasDoubleClick={handleMediaBoardDoubleClick}
      onCanvasContextMenu={handleMediaBoardContextMenu}
      onCanvasDragOver={handleMediaBoardCanvasDragOver}
      onCanvasDragLeave={handleMediaBoardCanvasDragLeave}
      onCanvasDrop={handleMediaBoardDrop}
      onNodeMouseDown={handleMediaBoardNodeMouseDown}
      onItemDoubleClick={(item) => { void handleItemDoubleClick(item); }}
      onItemContextMenu={handleContextMenu}
      consumeSuppressedContextMenu={consumeSuppressedMediaBoardContextMenu}
      onGroupDragOver={handleMediaBoardGroupDragOver}
      onGroupDrop={handleMediaBoardGroupDrop}
      onRequestThumbnail={requestMediaBoardThumbnail}
      refreshFileUrls={refreshFileUrls}
      buildTooltip={buildGridTooltip}
      formatDuration={formatDuration}
      getProjectItemIconType={getProjectItemIconType}
      getGaussianSplatResolutionLabel={getGaussianSplatResolutionLabel}
      getMediaFileContainerLabel={getMediaFileContainerLabel}
      getMediaFileCodecLabel={getMediaFileCodecLabel}
    >
      <MediaBoardAnnotationLayer
        annotations={visibleMediaBoardAnnotations}
        selectedAnnotationId={selectedMediaBoardAnnotationId}
        onAnnotationContextMenu={handleMediaBoardAnnotationContextMenu}
        onAnnotationFocus={handleMediaBoardAnnotationFocus}
        onEditToggle={handleMediaBoardAnnotationEditToggle}
        onRequestTextFocus={requestMediaBoardAnnotationTextFocus}
        onStartDrag={startMediaBoardAnnotationDrag}
        onStartResize={startMediaBoardAnnotationResize}
        onUpdateAnnotation={updateMediaBoardAnnotation}
      />
    </MediaBoardView>
  );
  const {
    filesNeedReload,
    filesNeedReloadCount,
    showRelinkDialog,
    openRelinkDialog,
    closeRelinkDialog,
  } = useMediaPanelRelinkStatus(files);

  return (
    <div
      ref={mediaPanelRootRef}
      className={`media-panel ${isExternalDragOver ? 'drop-target' : ''}`}
      onDrop={handleRootDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onMouseMove={handleMediaPanelMouseMove}
      onClick={() => { if (contextMenu) closeContextMenu(); }}
    >
      <MediaFloatingFeedbackPortal items={floatingTexts} />
      {/* Header */}
      <MediaPanelHeader
        query={mediaSearchQuery}
        onQueryChange={setMediaSearchQuery}
        isSearchActive={isMediaSearchActive}
        searchResultCount={mediaSearchResultCount}
        totalItems={totalItems}
        filesNeedReload={filesNeedReload}
        filesNeedReloadCount={filesNeedReloadCount}
        onOpenRelinkDialog={openRelinkDialog}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        onImport={handleImport}
        addDropdownOpen={addDropdownOpen}
        onAddDropdownOpenChange={setAddDropdownOpen}
        onNewComposition={handleNewComposition}
        onNewFolder={handleNewFolder}
        onNewText={handleNewText}
        onNewSolid={handleNewSolid}
        onNewMesh={handleNewMesh}
        onNewText3D={handleNewText3D}
        onNewCamera={handleNewCamera}
        onNewSplatEffector={handleNewSplatEffector}
        onImportGaussianSplat={handleImportGaussianSplat}
        onNewMathScene={handleNewMathScene}
        onNewMotionShape={handleNewMotionShape}
      />
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Item list with column headers */}
      <div className={`media-panel-content media-panel-content-${viewMode}`} ref={mediaPanelContentRef}>
        {totalItems === 0 ? (
          <MediaNoMediaEmptyState onContextMenu={handleContextMenu} />
        ) : isMediaSearchActive && mediaSearchResultCount === 0 ? (
          <MediaNoSearchResultsEmptyState
            query={mediaSearchQuery}
            onContextMenu={handleContextMenu}
          />
        ) : viewMode === 'classic' ? (
          <MediaClassicListChrome
            wrapperRef={itemListRef}
            isVerticalScrolling={isClassicListVerticalScrolling}
            isHorizontallyScrolled={isClassicListHorizontallyScrolled}
            onScroll={handleClassicListScroll}
            onMouseDown={handleMarqueeMouseDown}
            onContextMenu={handleContextMenu}
            nameColumnWidth={nameColumnWidth}
            columnWidths={dynamicMediaColumnWidths}
            columnOrder={columnOrder}
            draggingColumn={draggingColumn}
            dragOverColumn={dragOverColumn}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onColumnDragStart={handleColumnDragStart}
            onColumnDragOver={handleColumnDragOver}
            onColumnDragLeave={handleColumnDragLeave}
            onColumnDrop={handleColumnDrop}
            onColumnDragEnd={handleColumnDragEnd}
            onColumnSort={handleColumnSort}
            onNameColumnResizeStart={handleResizeStart}
            topSpacerHeight={classicTopSpacerHeight}
            bottomSpacerHeight={classicBottomSpacerHeight}
            visibleRows={classicVisibleRows}
            renderRow={({ item, depth }) => renderClassicRow(item, depth)}
            marquee={marquee}
          />
        ) : viewMode === 'icons' ? (
          <MediaGridChrome
            wrapperRef={itemListRef}
            items={gridItems}
            showBreadcrumb={!isMediaSearchActive && Boolean(gridFolderId)}
            breadcrumbItems={gridBreadcrumb}
            onSelectFolder={setGridFolderId}
            onMouseDown={handleMarqueeMouseDown}
            onContextMenu={handleContextMenu}
            renderItem={renderGridItem}
            marquee={marquee}
          />
        ) : (
          renderMediaBoardView()
        )}
      </div>

      <MediaGenerationTrayMount
        suppressed={isMediaBoardDeepZoomActive && !isGenerativeTrayExpanded}
        expanded={isGenerativeTrayExpanded}
        onExpandedChange={setGenerativeTrayExpanded}
      />
      {/* Drop overlay - shown when dragging files from outside */}
      {isExternalDragOver && (
        <MediaDropOverlay />
      )}

      {/* Context Menu */}
      {contextMenu && (() => {
        const annotationContextMenu = renderMediaAnnotationContextMenuMount({
          annotationId: contextMenu.annotationId,
          annotations: mediaBoardAnnotations,
          colorOptions: MEDIA_BOARD_ANNOTATION_COLOR_OPTIONS,
          menuRef: contextMenuRef,
          x: contextMenuPosition?.x ?? contextMenu.x,
          y: contextMenuPosition?.y ?? contextMenu.y,
          onUpdateColor: (annotationId, target, value) => {
            updateMediaBoardAnnotation(annotationId, { [target]: value });
          },
          onClose: closeContextMenu,
        });

        if (annotationContextMenu) {
          return annotationContextMenu;
        }

        return (
          <MediaPanelProjectContextMenuMount
            contextMenu={contextMenu}
            menuRef={contextMenuRef}
            x={contextMenuPosition?.x ?? contextMenu.x}
            y={contextMenuPosition?.y ?? contextMenu.y}
            selectedIds={selectedIds}
            items={allProjectItems}
            files={files}
            folders={folders}
            composerReferenceMediaFileIds={composerReferenceMediaFileIds}
            viewMode={viewMode}
            hasClipboard={hasMediaClipboard()}
            proxyFolderName={proxyFolderName}
            actions={{
              onNewBoardAnnotation: handleNewMediaBoardAnnotation,
              onClose: closeContextMenu,
              onImport: handleImport,
              onPaste: handlePasteItems,
              onToggleAiPromptReferences: handleToggleAiPromptReferences,
              onStartRename: startRename,
              onMoveToFolder: mediaContextLocalHandlers.onMoveToFolder,
              onOpenCompositionSettings: openCompositionSettings,
              onOpenSolidSettings: mediaContextLocalHandlers.onOpenSolidSettings,
              onCancelProxyGeneration: cancelProxyGeneration,
              onGenerateProxy: generateProxy,
              onRegenerateThumbnails: handleRegenerateMediaThumbnails,
              onRegenerateAudioProxy: handleRegenerateMediaAudioProxy,
              onRegenerateWaveform: handleRegenerateMediaWaveform,
              onRegenerateSpectrogram: handleRegenerateMediaSpectrogram,
              onShowRawInExplorer: mediaContextExplorerHandlers.onShowRawInExplorer,
              onShowProxyInExplorer: mediaContextExplorerHandlers.onShowProxyInExplorer,
              onPickProxyFolder: mediaContextExplorerHandlers.onPickProxyFolder,
              onCopy: handleCopySelected,
              onDuplicate: handleDuplicateSelected,
              onDelete: handleDelete,
              onNewComposition: handleNewComposition,
              onNewFolder: handleNewFolder,
              onNewText: handleNewText,
              onNewSolid: handleNewSolid,
              onNewMesh: handleNewMesh,
              onNewText3D: handleNewText3D,
              onNewCamera: handleNewCamera,
              onNewSplatEffector: handleNewSplatEffector,
              onImportGaussianSplat: handleImportGaussianSplat,
              onNewMathScene: handleNewMathScene,
              onNewMotionShape: handleNewMotionShape,
            }}
          />
        );
      })()}

      {/* Media Delete Confirmation */}
      {deleteConfirmation && (() => {
        const impact = getMediaDeleteImpact(deleteConfirmation.mediaFiles, deleteConfirmation.usages);
        const compositionNames = [...new Map(
          deleteConfirmation.usages.flatMap(usage =>
            usage.compositions.map(composition => [composition.compositionId, composition.compositionName] as const)
          )
        ).values()];

        return (
          <div
            className="media-delete-dialog-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !deleteConfirmationBusy) {
                setDeleteConfirmation(null);
              }
            }}
          >
            <div
              className="media-delete-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="media-delete-dialog-title"
            >
              <div className="media-delete-dialog-kicker">Delete media</div>
              <h3 id="media-delete-dialog-title">Delete {impact.fileLabel}?</h3>
              {impact.clipCount > 0 && (
                <p>
                  {impact.clipCount} clip{impact.clipCount === 1 ? '' : 's'} in {impact.compositionCount} composition{impact.compositionCount === 1 ? '' : 's'} will be removed from the timeline.
                </p>
              )}
              {compositionNames.length > 0 && (
                <div className="media-delete-dialog-comps">
                  {compositionNames.slice(0, 4).join(', ')}
                  {compositionNames.length > 4 ? `, +${compositionNames.length - 4} more` : ''}
                </div>
              )}
              <div className="media-delete-dialog-warning">
                This also deletes raw source files, proxies, analyses, transcripts, waveform caches, thumbnails, and related audio-analysis artifacts from the project folder.
              </div>
              <div className="media-delete-dialog-actions">
                <button
                  type="button"
                  className="media-delete-dialog-button secondary"
                  disabled={deleteConfirmationBusy}
                  onClick={() => setDeleteConfirmation(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="media-delete-dialog-button danger"
                  disabled={deleteConfirmationBusy}
                  onClick={confirmMediaDelete}
                >
                  {deleteConfirmationBusy ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
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
        <RelinkDialog onClose={closeRelinkDialog} />
      )}
    </div>
  );
}
