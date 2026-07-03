import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type React from 'react';

import type { MediaFolder, ProjectItem } from '../../../../stores/mediaStore';
import { getProjectItemIconType } from '../itemTypeGuards';
import { formatMediaDuration as formatDuration } from '../grid/format';
import {
  getGaussianSplatResolutionLabel,
  getMediaFileCodecLabel,
  getMediaFileContainerLabel,
} from '../list/classicListPlanning';
import { MediaBoardMount } from './MediaBoardMount';
import { getVisibleMediaBoardAnnotations, type MediaBoardAnnotation } from './annotations';
import type { MediaBoardAnnotationPatch, MediaBoardAnnotationPoint } from './useMediaBoardAnnotationState';
import { useMediaBoardAnnotationCommands } from './useMediaBoardAnnotationCommands';
import { useMediaBoardAnnotationGestures } from './useMediaBoardAnnotationGestures';
import { useMediaBoardDropBridge } from './useMediaBoardDropBridge';
import { useMediaBoardGestures } from './useMediaBoardGestures';
import { useMediaBoardLayoutController } from './useMediaBoardLayoutController';
import { useMediaBoardOverview } from './useMediaBoardOverview';
import { useMediaBoardViewport } from './useMediaBoardViewport';

type MediaBoardContextMenuHandler = (
  event: React.MouseEvent,
  itemId?: string,
  parentId?: string | null,
  boardPosition?: { x: number; y: number },
) => void;

export interface UseMediaBoardControllerOptions {
  activeCompositionId: string | null;
  buildGridTooltip: (item: ProjectItem, isFolder: boolean, isComp: boolean) => string;
  closeContextMenu: () => void;
  contextMenuBoardPosition: MediaBoardAnnotationPoint | null | undefined;
  createMediaBoardAnnotation: (point: MediaBoardAnnotationPoint) => string;
  ensureFileThumbnail: (id: string) => void | Promise<unknown>;
  finishRename: () => void;
  folders: MediaFolder[];
  handleContextMenu: MediaBoardContextMenuHandler;
  handleExternalDropImport: (dataTransfer: DataTransfer, folderId: string | null) => Promise<string[]>;
  handleItemClick: (itemId: string, event: React.MouseEvent) => void;
  handleItemDoubleClick: (item: ProjectItem) => void | Promise<void>;
  getSlotGridProgress: () => number;
  internalDragId: string | null;
  isMediaSearchActive: boolean;
  mediaBoardAnnotations: MediaBoardAnnotation[];
  mediaBoardItems: ProjectItem[];
  mediaSearchResultCount: number;
  mediaSearchVisibleItemIds: Set<string> | null;
  moveToFolder: (itemIds: string[], folderId: string | null) => void;
  refreshFileUrls: (id: string) => void | Promise<unknown>;
  reloadMediaBoardAnnotations: () => void;
  renameValue: string;
  renamingId: string | null;
  selectedIds: string[];
  selectedMediaBoardAnnotationId: string | null;
  setContextMenu: (menu: { x: number; y: number; annotationId: string }) => void;
  setDragOverFolderId: (id: string | null) => void;
  setGenerativeTrayExpanded: (expanded: boolean) => void;
  setInternalDragId: (id: string | null) => void;
  setIsExternalDragOver: (isOver: boolean) => void;
  setRenameValue: Dispatch<SetStateAction<string>>;
  setRenamingId: Dispatch<SetStateAction<string | null>>;
  setSelectedMediaBoardAnnotationId: (id: string | null) => void;
  setSelection: (ids: string[]) => void;
  sortItems: (items: ProjectItem[]) => ProjectItem[];
  startRename: (id: string, currentName: string) => void;
  totalItems: number;
  updateMediaBoardAnnotation: (id: string, patch: MediaBoardAnnotationPatch) => void;
  viewMode: string;
}

export function useMediaBoardController({
  activeCompositionId,
  buildGridTooltip,
  closeContextMenu,
  contextMenuBoardPosition,
  createMediaBoardAnnotation,
  ensureFileThumbnail,
  finishRename,
  folders,
  handleContextMenu,
  handleExternalDropImport,
  handleItemClick,
  handleItemDoubleClick,
  getSlotGridProgress,
  internalDragId,
  isMediaSearchActive,
  mediaBoardAnnotations,
  mediaBoardItems,
  mediaSearchResultCount,
  mediaSearchVisibleItemIds,
  moveToFolder,
  refreshFileUrls,
  reloadMediaBoardAnnotations,
  renameValue,
  renamingId,
  selectedIds,
  selectedMediaBoardAnnotationId,
  setContextMenu,
  setDragOverFolderId,
  setGenerativeTrayExpanded,
  setInternalDragId,
  setIsExternalDragOver,
  setRenameValue,
  setRenamingId,
  setSelectedMediaBoardAnnotationId,
  setSelection,
  sortItems,
  startRename,
  totalItems,
  updateMediaBoardAnnotation,
  viewMode,
}: UseMediaBoardControllerOptions) {
  const [mediaBoardMarquee, setMediaBoardMarquee] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const viewport = useMediaBoardViewport({ viewMode });
  const layout = useMediaBoardLayoutController({
    folders,
    mediaBoardItems,
    moveToFolder,
    setMediaBoardViewport: viewport.setMediaBoardViewport,
    sortItems,
    viewMode,
  });
  const overview = useMediaBoardOverview({
    ensureFileThumbnail,
    mediaBoardLayout: layout.mediaBoardLayout,
    mediaBoardRenderLod: viewport.mediaBoardRenderLod,
    mediaBoardViewport: viewport.mediaBoardViewport,
    mediaBoardVisibleRect: viewport.mediaBoardVisibleRect,
    mediaSearchVisibleItemIds,
    selectedIdSet,
    viewMode,
  });
  const gestures = useMediaBoardGestures({
    activeCompositionId,
    applyMediaBoardViewportPreview: viewport.applyMediaBoardViewportPreview,
    boardAutoPanFrameRef: viewport.boardAutoPanFrameRef,
    boardCanvasRef: viewport.boardCanvasRef,
    boardInteractionFrameRef: viewport.boardInteractionFrameRef,
    closeContextMenu,
    commitMediaBoardOrderChange: layout.commitMediaBoardOrderChange,
    getMediaBoardGroupAtPoint: layout.getMediaBoardGroupAtPoint,
    getMediaBoardInsertTarget: layout.getMediaBoardInsertTarget,
    getMediaBoardPlacementAtPoint: layout.getMediaBoardPlacementAtPoint,
    getMediaBoardTopLevelMoveIds: layout.getMediaBoardTopLevelMoveIds,
    getSlotGridProgress,
    handleContextMenu,
    handleItemClick,
    handleItemDoubleClick,
    mediaBoardItemIds: layout.mediaBoardItemIds,
    mediaBoardLayout: layout.mediaBoardLayout,
    mediaBoardPlacementsById: layout.mediaBoardPlacementsById,
    mediaBoardRenderLod: viewport.mediaBoardRenderLod,
    mediaBoardViewportRef: viewport.mediaBoardViewportRef,
    screenToMediaBoard: viewport.screenToMediaBoard,
    selectedIds,
    setMediaBoardInsertionPreview: layout.setMediaBoardInsertionPreview,
    setMediaBoardMarquee,
    setMediaBoardPerformanceMode: viewport.setMediaBoardPerformanceMode,
    setMediaBoardViewport: viewport.setMediaBoardViewport,
    setSelection,
    updateMediaBoardInsertionPreview: layout.updateMediaBoardInsertionPreview,
  });
  const dropBridge = useMediaBoardDropBridge({
    canMoveItemsToMediaBoardGroup: layout.canMoveItemsToMediaBoardGroup,
    commitMediaBoardOrderChange: layout.commitMediaBoardOrderChange,
    getMediaBoardGroupAtPoint: layout.getMediaBoardGroupAtPoint,
    getMediaBoardInsertTarget: layout.getMediaBoardInsertTarget,
    getMediaBoardTopLevelMoveIds: layout.getMediaBoardTopLevelMoveIds,
    handleExternalDropImport,
    internalDragId,
    mediaBoardPlacementsById: layout.mediaBoardPlacementsById,
    placeMediaBoardItemsAtPoint: layout.placeMediaBoardItemsAtPoint,
    screenToMediaBoard: viewport.screenToMediaBoard,
    selectedIds,
    setDragOverFolderId,
    setInternalDragId,
    setIsExternalDragOver,
    setMediaBoardInsertionPreview: layout.setMediaBoardInsertionPreview,
    updateMediaBoardInsertionPreview: layout.updateMediaBoardInsertionPreview,
  });
  const annotationGestures = useMediaBoardAnnotationGestures({
    closeContextMenu,
    mediaBoardViewportRef: viewport.mediaBoardViewportRef,
    setSelectedMediaBoardAnnotationId: (id) => setSelectedMediaBoardAnnotationId(id),
    setSelection,
    suppressNextMediaBoardContextMenu: gestures.suppressNextMediaBoardContextMenu,
    updateMediaBoardAnnotation,
  });
  const annotationCommands = useMediaBoardAnnotationCommands({
    boardRootRef: viewport.boardCanvasRef,
    consumeSuppressedMediaBoardContextMenu: gestures.consumeSuppressedMediaBoardContextMenu,
    setAnnotationContextMenu: setContextMenu,
    setSelectedMediaBoardAnnotationId: (id) => setSelectedMediaBoardAnnotationId(id),
    setSelection,
    updateMediaBoardAnnotation,
  });

  const openBoardAI = useCallback(() => {
    setGenerativeTrayExpanded(true);
    closeContextMenu();
  }, [closeContextMenu, setGenerativeTrayExpanded]);

  const handleNewMediaBoardAnnotation = useCallback(() => {
    const point = contextMenuBoardPosition;
    if (!point) {
      closeContextMenu();
      return;
    }
    createMediaBoardAnnotation(point);
    setSelection([]);
    closeContextMenu();
  }, [closeContextMenu, contextMenuBoardPosition, createMediaBoardAnnotation, setSelection]);

  const visibleMediaBoardAnnotations = useMemo(() => (
    getVisibleMediaBoardAnnotations(
      mediaBoardAnnotations,
      viewport.mediaBoardVisibleRect,
      selectedMediaBoardAnnotationId,
    )
  ), [mediaBoardAnnotations, selectedMediaBoardAnnotationId, viewport.mediaBoardVisibleRect]);

  const { reloadMediaBoardLayoutState } = layout;
  const { reloadMediaBoardViewport } = viewport;
  const reloadMediaBoardState = useCallback(() => {
    reloadMediaBoardViewport();
    reloadMediaBoardLayoutState();
    reloadMediaBoardAnnotations();
    setSelectedMediaBoardAnnotationId(null);
  }, [reloadMediaBoardAnnotations, reloadMediaBoardLayoutState, reloadMediaBoardViewport, setSelectedMediaBoardAnnotationId]);

  const renderMediaBoardView = () => (
    <MediaBoardMount
      boardWrapperRef={viewport.boardWrapperRef}
      boardCanvasRef={viewport.boardCanvasRef}
      boardCanvasInnerRef={viewport.boardCanvasInnerRef}
      boardOverviewCanvasRef={overview.boardOverviewCanvasRef}
      buildGridTooltip={buildGridTooltip}
      consumeSuppressedMediaBoardContextMenu={gestures.consumeSuppressedMediaBoardContextMenu}
      focusedMediaBoardOriginalId={overview.focusedMediaBoardOriginalId}
      formatDuration={formatDuration}
      folders={folders}
      getGaussianSplatResolutionLabel={getGaussianSplatResolutionLabel}
      getMediaFileCodecLabel={getMediaFileCodecLabel}
      getMediaFileContainerLabel={getMediaFileContainerLabel}
      getProjectItemIconType={getProjectItemIconType}
      handleContextMenu={handleContextMenu}
      handleMediaBoardAnnotationContextMenu={annotationCommands.handleMediaBoardAnnotationContextMenu}
      handleMediaBoardAnnotationEditToggle={annotationCommands.handleMediaBoardAnnotationEditToggle}
      handleMediaBoardAnnotationFocus={annotationCommands.handleMediaBoardAnnotationFocus}
      handleMediaBoardCanvasDragLeave={dropBridge.handleMediaBoardCanvasDragLeave}
      handleMediaBoardCanvasDragOver={dropBridge.handleMediaBoardCanvasDragOver}
      handleMediaBoardContextMenu={gestures.handleMediaBoardContextMenu}
      handleMediaBoardDoubleClick={gestures.handleMediaBoardDoubleClick}
      handleMediaBoardDrop={dropBridge.handleMediaBoardDrop}
      handleMediaBoardGroupDragOver={dropBridge.handleMediaBoardGroupDragOver}
      handleMediaBoardGroupDrop={dropBridge.handleMediaBoardGroupDrop}
      handleMediaBoardMouseDown={gestures.handleMediaBoardMouseDown}
      handleMediaBoardNodeMouseDown={gestures.handleMediaBoardNodeMouseDown}
      handleMediaBoardWheel={viewport.handleMediaBoardWheel}
      handleItemDoubleClick={handleItemDoubleClick}
      isMediaSearchActive={isMediaSearchActive}
      mediaBoardItemsLength={mediaBoardItems.length}
      mediaBoardMarquee={mediaBoardMarquee}
      mediaBoardOverviewCanvasStyle={overview.mediaBoardOverviewCanvasStyle}
      mediaBoardRenderLod={viewport.mediaBoardRenderLod}
      mediaBoardViewport={viewport.mediaBoardViewport}
      mediaBoardVisibleRect={viewport.mediaBoardVisibleRect}
      mediaSearchResultCount={mediaSearchResultCount}
      mediaSearchVisibleItemIds={mediaSearchVisibleItemIds}
      onOpenBoardAI={openBoardAI}
      refreshFileUrls={refreshFileUrls}
      renamingId={renamingId}
      renameValue={renameValue}
      requestMediaBoardAnnotationTextFocus={annotationCommands.requestMediaBoardAnnotationTextFocus}
      requestMediaBoardThumbnail={overview.requestMediaBoardThumbnail}
      resetMediaBoardLayout={layout.resetMediaBoardLayout}
      selectedIdSet={selectedIdSet}
      selectedMediaBoardAnnotationId={selectedMediaBoardAnnotationId}
      setRenameValue={setRenameValue}
      setRenamingId={setRenamingId}
      startMediaBoardAnnotationDrag={annotationGestures.startMediaBoardAnnotationDrag}
      startMediaBoardAnnotationResize={annotationGestures.startMediaBoardAnnotationResize}
      startRename={startRename}
      finishRename={finishRename}
      totalItems={totalItems}
      updateMediaBoardAnnotation={updateMediaBoardAnnotation}
      videoPosterFallbackIds={overview.mediaBoardVideoPosterFallbackIds}
      visibleMediaBoardAnnotations={visibleMediaBoardAnnotations}
      visibleMediaBoardGroups={overview.visibleMediaBoardGroups}
      visibleMediaBoardInsertGaps={overview.visibleMediaBoardInsertGaps}
      visibleMediaBoardPlacements={overview.visibleMediaBoardPlacements}
    />
  );

  return {
    boardCanvasRef: viewport.boardCanvasRef,
    clearMediaBoardInsertionPreview: layout.clearMediaBoardInsertionPreview,
    handleNewMediaBoardAnnotation,
    isMediaBoardDeepZoomActive: overview.isMediaBoardDeepZoomActive,
    mediaBoardAnnotations,
    mediaBoardPlacementsById: layout.mediaBoardPlacementsById,
    mediaBoardViewport: viewport.mediaBoardViewport,
    placeMediaBoardItemsAtPoint: layout.placeMediaBoardItemsAtPoint,
    reloadMediaBoardState,
    renderMediaBoardView,
    setMediaBoardViewport: viewport.setMediaBoardViewport,
    updateMediaBoardAnnotation,
  };
}
