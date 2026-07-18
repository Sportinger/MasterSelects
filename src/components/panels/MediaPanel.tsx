// Media Panel - Project browser like After Effects

import { useCallback, useRef, useState, useEffect, useLayoutEffect } from 'react';
import './MediaPanel.css';
import './media/MediaPanelWoodTheme.css';
import type { MediaContextSolidSettingsDialogState } from './media/context/useMediaContextLocalHandlers';
import { useMediaClassicListUiState } from './media/list/useMediaClassicListUiState';
import { MediaPanelContentView } from './media/panel/MediaPanelContentView';
import { MediaPanelHeader } from './media/panel/MediaPanelHeader';
import { MediaPanelOverlayMounts } from './media/panel/MediaPanelOverlayMounts';
import { useMediaPanelCommandBindings } from './media/panel/useMediaPanelCommandBindings';
import { useMediaPanelCompositionSettings } from './media/panel/useMediaPanelCompositionSettings';
import { useMediaPanelContextMenuState } from './media/panel/useMediaPanelContextMenuState';
import { useMediaPanelDragDropMarquee, type MediaPanelMarquee } from './media/panel/useMediaPanelDragDropMarquee';
import { useMediaPanelItemRenderers } from './media/panel/useMediaPanelItemRenderers';
import { useMediaPanelProjectItems } from './media/panel/useMediaPanelProjectItems';
import { useMediaPanelRelinkStatus } from './media/panel/useMediaPanelRelinkStatus';
import { useMediaPanelRenameDeleteCommands } from './media/panel/useMediaPanelRenameDeleteCommands';
import { useMediaPanelShellState, loadMediaPanelViewMode } from './media/panel/useMediaPanelShellState';
import { useMediaPanelSourceReveal } from './media/panel/useMediaPanelSourceReveal';
import { useMediaPanelStoreBindings } from './media/panel/useMediaPanelStoreBindings';
import { useMediaBoardAnnotationState } from './media/board/useMediaBoardAnnotationState';
import { useMediaBoardController } from './media/board/useMediaBoardController';
import { useMediaPanelPreviewTooltip } from './media/panel/useMediaPanelPreviewTooltip';
import { LiveInputDialog } from './media/LiveInputDialog';
import { requestMediaBoardPlacement } from './media/board/placementRequests';

import { useMediaStore } from '../../stores/mediaStore';
import { isUserVisibleComposition } from '../../stores/mediaStore/compositionVisibility';
import { useFlashBoardStore } from '../../stores/flashboardStore';
import { useTimelineStore } from '../../stores/timeline';
import { useSettingsStore } from '../../stores/settingsStore';
import type { LiveInputSource } from '../../types/liveInput';
import { liveInputRuntime } from '../../services/mediaRuntime/liveInputRuntime';

const MEDIA_PANEL_PROJECT_UI_LOADED_EVENT = 'media-panel-project-ui-loaded';

export function MediaPanel() {
  const {
    files,
    compositions,
    folders,
    textItems,
    solidItems,
    meshItems,
    cameraItems,
    lightItems,
    splatEffectorItems,
    mathSceneItems,
    motionShapeItems,
    signalAssets,
    selectedIds,
    duplicateMediaItems,
    copyMediaItems,
    pasteMediaItems,
    hasMediaClipboard,
    expandedFolderIds,
    fileSystemSupported,
    proxyFolderName,
    activeCompositionId,
    refreshFileUrls,
    ensureFileThumbnail,
  } = useMediaPanelStoreBindings();
  const composerReferenceMediaFileIds = useFlashBoardStore(state => state.composer.referenceMediaFileIds);
  const updateFlashBoardComposer = useFlashBoardStore(state => state.updateComposer);
  const woodThemeEnabled = useSettingsStore(state => state.mediaPanelWoodThemeEnabled);

  // Actions from getState() - stable, no subscription needed
  const {
    importFile,
    importFiles,
    importFilesWithPicker,
    importFilesWithHandles,
    createComposition,
    createFolder,
    createLiveInputItem,
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
    openSourceMonitorCrop,
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
    createLightItem,
    getOrCreateLightFolder,
    removeLightItem,
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
  const clearMediaBoardInsertionPreviewRef = useRef<() => void>(() => {});
  const {
    contextMenu,
    setContextMenu,
    closeContextMenu,
    contextMenuRef,
    contextMenuPosition,
  } = useMediaPanelContextMenuState();

  // Marquee selection state
  const [marquee, setMarquee] = useState<MediaPanelMarquee | null>(null);
  const [solidSettingsDialog, setSolidSettingsDialog] = useState<MediaContextSolidSettingsDialogState | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [internalDragId, setInternalDragId] = useState<string | null>(null);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [labelPickerItemId, setLabelPickerItemId] = useState<string | null>(null);
  const [labelPickerPos, setLabelPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [liveInputDialog, setLiveInputDialog] = useState<{
    parentId: string | null;
    boardPosition?: { x: number; y: number };
  } | null>(null);
  const {
    addDropdownOpen,
    setAddDropdownOpen,
    viewMode,
    setViewMode,
    handleViewModeChange,
    isGenerativeTrayExpanded,
    setGenerativeTrayExpanded,
    mediaSearchQuery,
    setMediaSearchQuery,
    gridFolderId,
    setGridFolderId,
  } = useMediaPanelShellState({ mediaPanelContentRef });
  const {
    classicListViewport,
    isClassicListVerticalScrolling,
    isClassicListHorizontallyScrolled,
    columnOrder,
    draggingColumn,
    dragOverColumn,
    sortColumn,
    sortDirection,
    nameColumnWidth,
    resetClassicListUiState,
    sortItems,
    handleClassicListScroll,
    scrollClassicListRowIntoView,
    handleColumnDragStart,
    handleColumnDragOver,
    handleColumnDragLeave,
    handleColumnDrop,
    handleColumnDragEnd,
    handleColumnSort,
    handleResizeStart,
  } = useMediaClassicListUiState({
    itemListRef,
    viewMode,
  });
  const handleNewLiveInput = useCallback(() => {
    setLiveInputDialog({
      parentId: contextMenu?.parentId ?? (viewMode === 'icons' ? gridFolderId : null),
      boardPosition: contextMenu?.boardPosition,
    });
    closeContextMenu();
  }, [closeContextMenu, contextMenu, gridFolderId, viewMode]);

  const handleCreateLiveInput = useCallback(async (source: LiveInputSource) => {
    if (!liveInputDialog) return;
    const id = `live-${crypto.randomUUID()}`;
    const connected = await liveInputRuntime.connect(id, source);
    const persistedSource = source.kind === 'video-device' && !source.deviceLabel
      ? { ...source, deviceLabel: connected.label }
      : source;
    const activeComposition = compositions.find((composition) => composition.id === activeCompositionId);
    const name = source.kind === 'composition-feedback'
      ? `${activeComposition?.name ?? 'Composition'} Feedback`
      : connected.label === 'Live Input'
        ? source.kind === 'display' ? 'Live Display' : 'Live Camera'
        : connected.label;
    createLiveInputItem(id, persistedSource, name, liveInputDialog.parentId);
    if (liveInputDialog.boardPosition) {
      requestMediaBoardPlacement({ itemIds: [id], point: liveInputDialog.boardPosition });
    }
    setLiveInputDialog(null);
  }, [activeCompositionId, compositions, createLiveInputItem, liveInputDialog]);

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
    lightItems,
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
    removeLightItem,
    removeSplatEffectorItem,
    removeMathSceneItem,
    removeMotionShapeItem,
    closeContextMenu,
  });
  const {
    createMediaBoardAnnotation,
    mediaBoardAnnotations,
    reloadMediaBoardAnnotations,
    selectedMediaBoardAnnotationId,
    setSelectedMediaBoardAnnotationId,
    updateMediaBoardAnnotation,
  } = useMediaBoardAnnotationState();

  const clearMediaBoardInsertionPreview = useCallback(() => {
    clearMediaBoardInsertionPreviewRef.current();
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

  const {
    handleImport,
    handleFileChange,
    handleNewComposition,
    handleNewFolder,
    handleNewText,
    handleNewText3D,
    handleNewSolid,
    handleNewMesh,
    handleNewCamera,
    handleNewLight,
    handleNewSplatEffector,
    handleNewMathScene,
    handleNewMotionShape,
    handleImportGaussianSplat,
    mediaPanelRootRef,
    floatingTexts,
    handleMediaPanelMouseMove,
    handleItemClick,
    handleItemDoubleClick,
    handleContextMenu,
    handleToggleAiPromptReferences,
    handleCopyPrompt,
    handleCreateCompositionFromMedia,
    handleRegenerateMediaThumbnails,
    handleRegenerateMediaAudioProxy,
    handleRegenerateMediaWaveform,
    handleRegenerateMediaSpectrogram,
    handleCopySelected,
    handleDuplicateSelected,
    handlePasteItems,
    mediaContextExplorerHandlers,
    mediaContextLocalHandlers,
    mediaContextFrameExtractionHandlers,
    handleBadgeClick,
  } = useMediaPanelCommandBindings({
    fileInputRef,
    fileSystemSupported,
    contextMenu,
    viewMode,
    gridFolderId,
    selectedIds,
    folders,
    compositionCount: compositions.filter(isUserVisibleComposition).length,
    setGridFolderId,
    setContextMenu,
    closeContextMenu,
    setSelectedMediaBoardAnnotationId,
    setGenerativeTrayExpanded,
    setSolidSettingsDialog,
    getAiReferenceMediaFileIds: () => useFlashBoardStore.getState().composer.referenceMediaFileIds ?? [],
    updateAiReferenceMediaFileIds: (referenceMediaFileIds) => updateFlashBoardComposer({ referenceMediaFileIds }),
    importFile,
    importFiles,
    importFilesWithHandles,
    importFilesWithPicker,
    createComposition,
    updateComposition,
    createFolder,
    showInExplorer,
    pickProxyFolder,
    moveToFolder,
    openSourceMonitorCrop,
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
    createTextItem,
    getOrCreateTextFolder,
    createSolidItem,
    getOrCreateSolidFolder,
    createMeshItem,
    getOrCreateMeshFolder,
    createCameraItem,
    getOrCreateCameraFolder,
    createLightItem,
    getOrCreateLightFolder,
    createSplatEffectorItem,
    getOrCreateSplatEffectorFolder,
    createMathSceneItem,
    getOrCreateMathSceneFolder,
    createMotionShapeItem,
    getOrCreateMotionShapeFolder,
    importGaussianSplat,
    handleDelete,
  });

  const {
    settingsDialog,
    setSettingsDialog,
    openCompositionSettings,
    saveCompositionSettings,
  } = useMediaPanelCompositionSettings({
    activeCompositionId,
    closeContextMenu,
    updateComposition,
  });

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
    lightItems,
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
  const mediaPreviewTooltip = useMediaPanelPreviewTooltip({ itemsById: allProjectItemsById });

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
  });

  const mediaBoardItems = allProjectItems;
  const mediaBoardController = useMediaBoardController({
    activeCompositionId,
    buildGridTooltip,
    closeContextMenu,
    contextMenuBoardPosition: contextMenu?.boardPosition,
    createMediaBoardAnnotation,
    ensureFileThumbnail,
    finishRename,
    folders,
    handleContextMenu,
    handleExternalDropImport,
    handleItemClick,
    handleItemDoubleClick,
    getSlotGridProgress: getTimelineSlotGridProgress,
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
  });
  const {
    handleNewMediaBoardAnnotation,
    isMediaBoardDeepZoomActive,
    renderMediaBoardView,
  } = mediaBoardController;

  useLayoutEffect(() => {
    clearMediaBoardInsertionPreviewRef.current = mediaBoardController.clearMediaBoardInsertionPreview;
    return () => {
      clearMediaBoardInsertionPreviewRef.current = () => {};
    };
  }, [mediaBoardController.clearMediaBoardInsertionPreview]);

  useMediaPanelSourceReveal({
    allProjectItemsById,
    boardCanvasRef: mediaBoardController.boardCanvasRef,
    classicRows,
    folders,
    gridFolderId,
    mediaBoardPlacementsById: mediaBoardController.mediaBoardPlacementsById,
    mediaBoardViewport: mediaBoardController.mediaBoardViewport,
    mediaPanelContentRef,
    scrollClassicListRowIntoView,
    setGridFolderId,
    setMediaBoardViewport: mediaBoardController.setMediaBoardViewport,
    setMediaSearchQuery,
    setSelection,
    viewMode,
  });

  const { reloadMediaBoardState } = mediaBoardController;
  useEffect(() => {
    const handleProjectUiLoaded = () => {
      resetClassicListUiState();
      setViewMode(loadMediaPanelViewMode());
      reloadMediaBoardState();
      setGridFolderId(null);
    };

    window.addEventListener(MEDIA_PANEL_PROJECT_UI_LOADED_EVENT, handleProjectUiLoaded);
    return () => window.removeEventListener(MEDIA_PANEL_PROJECT_UI_LOADED_EVENT, handleProjectUiLoaded);
  }, [reloadMediaBoardState, resetClassicListUiState, setGridFolderId, setViewMode]);
  const {
    filesNeedReload,
    filesNeedReloadCount,
    showRelinkDialog,
    openRelinkDialog,
    closeRelinkDialog,
  } = useMediaPanelRelinkStatus(files);
  const mediaPanelClassName = ['media-panel', woodThemeEnabled ? 'wood' : '', isExternalDragOver ? 'drop-target' : ''].filter(Boolean).join(' ');

  return (
    <div
      ref={mediaPanelRootRef}
      className={mediaPanelClassName}
      onDrop={handleRootDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onMouseMove={(event) => { handleMediaPanelMouseMove(event); mediaPreviewTooltip.handleMouseMove(event); }}
      onMouseLeave={mediaPreviewTooltip.handleMouseLeave}
      onClick={() => { if (contextMenu) closeContextMenu(); }}
    >
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
        onNewLiveInput={handleNewLiveInput}
        onNewMesh={handleNewMesh}
        onNewText3D={handleNewText3D}
        onNewCamera={handleNewCamera}
        onNewLight={handleNewLight}
        onNewSplatEffector={handleNewSplatEffector}
        onImportGaussianSplat={handleImportGaussianSplat}
        onNewMathScene={handleNewMathScene}
        onNewMotionShape={handleNewMotionShape}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <MediaPanelContentView
        viewMode={viewMode}
        contentRef={mediaPanelContentRef}
        totalItems={totalItems}
        isMediaSearchActive={isMediaSearchActive}
        mediaSearchResultCount={mediaSearchResultCount}
        mediaSearchQuery={mediaSearchQuery}
        onContextMenu={handleContextMenu}
        classic={{
          wrapperRef: itemListRef,
          isVerticalScrolling: isClassicListVerticalScrolling,
          isHorizontallyScrolled: isClassicListHorizontallyScrolled,
          onScroll: handleClassicListScroll,
          onMouseDown: handleMarqueeMouseDown,
          nameColumnWidth,
          columnWidths: dynamicMediaColumnWidths,
          columnOrder,
          draggingColumn,
          dragOverColumn,
          sortColumn,
          sortDirection,
          onColumnDragStart: handleColumnDragStart,
          onColumnDragOver: handleColumnDragOver,
          onColumnDragLeave: handleColumnDragLeave,
          onColumnDrop: handleColumnDrop,
          onColumnDragEnd: handleColumnDragEnd,
          onColumnSort: handleColumnSort,
          onNameColumnResizeStart: handleResizeStart,
          topSpacerHeight: classicTopSpacerHeight,
          bottomSpacerHeight: classicBottomSpacerHeight,
          visibleRows: classicVisibleRows,
          renderRow: renderClassicRow,
          marquee,
        }}
        icons={{
          wrapperRef: itemListRef,
          items: gridItems,
          showBreadcrumb: !isMediaSearchActive && Boolean(gridFolderId),
          breadcrumbItems: gridBreadcrumb,
          onSelectFolder: setGridFolderId,
          onMouseDown: handleMarqueeMouseDown,
          renderItem: renderGridItem,
          marquee,
        }}
        renderBoard={renderMediaBoardView}
      />
      {mediaPreviewTooltip.element}

      <MediaPanelOverlayMounts
        floatingTexts={floatingTexts}
        isMediaBoardDeepZoomActive={isMediaBoardDeepZoomActive}
        isGenerativeTrayExpanded={isGenerativeTrayExpanded}
        setGenerativeTrayExpanded={setGenerativeTrayExpanded}
        isExternalDragOver={isExternalDragOver}
        contextMenu={contextMenu}
        contextMenuRef={contextMenuRef}
        contextMenuPosition={contextMenuPosition}
        mediaBoardAnnotations={mediaBoardAnnotations}
        updateMediaBoardAnnotation={updateMediaBoardAnnotation}
        closeContextMenu={closeContextMenu}
        selectedIds={selectedIds}
        allProjectItems={allProjectItems}
        files={files}
        folders={folders}
        composerReferenceMediaFileIds={composerReferenceMediaFileIds}
        viewMode={viewMode}
        hasClipboard={hasMediaClipboard()}
        proxyFolderName={proxyFolderName}
        projectContextActions={{
          onNewBoardAnnotation: handleNewMediaBoardAnnotation,
          onClose: closeContextMenu,
          onImport: handleImport,
          onPaste: handlePasteItems,
          onToggleAiPromptReferences: handleToggleAiPromptReferences,
          onCopyPrompt: handleCopyPrompt,
          onStartRename: startRename,
          onMoveToFolder: mediaContextLocalHandlers.onMoveToFolder,
          onOpenCompositionSettings: openCompositionSettings,
          onCreateCompositionFromMedia: handleCreateCompositionFromMedia,
          onOpenImageCrop: mediaContextLocalHandlers.onOpenImageCrop,
          onOpenSolidSettings: mediaContextLocalHandlers.onOpenSolidSettings,
          onCancelProxyGeneration: cancelProxyGeneration,
          onGenerateProxy: generateProxy,
          onRegenerateThumbnails: handleRegenerateMediaThumbnails,
          onRegenerateAudioProxy: handleRegenerateMediaAudioProxy,
          onRegenerateWaveform: handleRegenerateMediaWaveform,
          onRegenerateSpectrogram: handleRegenerateMediaSpectrogram,
          onExtractVideoFrame: mediaContextFrameExtractionHandlers.onExtractVideoFrame,
          onDownloadMediaFile: mediaContextExplorerHandlers.onDownloadMediaFile,
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
          onNewLiveInput: handleNewLiveInput,
          onNewMesh: handleNewMesh,
          onNewText3D: handleNewText3D,
          onNewCamera: handleNewCamera,
          onNewLight: handleNewLight,
          onNewSplatEffector: handleNewSplatEffector,
          onImportGaussianSplat: handleImportGaussianSplat,
          onNewMathScene: handleNewMathScene,
          onNewMotionShape: handleNewMotionShape,
        }}
        deleteConfirmation={deleteConfirmation}
        deleteConfirmationBusy={deleteConfirmationBusy}
        setDeleteConfirmation={setDeleteConfirmation}
        confirmMediaDelete={confirmMediaDelete}
        settingsDialog={settingsDialog}
        setSettingsDialog={setSettingsDialog}
        saveCompositionSettings={saveCompositionSettings}
        solidSettingsDialog={solidSettingsDialog}
        setSolidSettingsDialog={setSolidSettingsDialog}
        updateSolidItem={updateSolidItem}
        labelPickerItemId={labelPickerItemId}
        labelPickerPos={labelPickerPos}
        setLabelPickerItemId={setLabelPickerItemId}
        setLabelPickerPos={setLabelPickerPos}
        setLabelColor={setLabelColor}
        showRelinkDialog={showRelinkDialog}
        closeRelinkDialog={closeRelinkDialog}
      />
      {liveInputDialog && (
        <LiveInputDialog
          activeComposition={compositions.find((composition) => composition.id === activeCompositionId) ?? null}
          onCreate={handleCreateLiveInput}
          onCancel={() => setLiveInputDialog(null)}
        />
      )}
    </div>
  );
}
