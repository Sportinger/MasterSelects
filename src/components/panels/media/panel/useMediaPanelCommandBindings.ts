import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { MediaPanelContextMenu } from '../context/types';
import {
  useMediaContextLocalHandlers,
  type MediaContextSolidSettingsDialogState,
} from '../context/useMediaContextLocalHandlers';
import { useMediaContextFrameExtractionHandlers } from '../context/useMediaContextFrameExtractionHandlers';
import { useMediaContextExplorerHandlers } from '../context/useMediaContextExplorerHandlers';
import type { MediaFolder, useMediaStore } from '../../../../stores/mediaStore';
import { useMediaPanelAddImportCommands } from './useMediaPanelAddImportCommands';
import { useMediaPanelSelectionCommands } from './useMediaPanelSelectionCommands';
import { useMediaPanelSourceMonitorBadges } from './useMediaPanelSourceMonitorBadges';
import type { MediaPanelViewMode } from './types';

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

interface UseMediaPanelCommandBindingsInput {
  fileInputRef: RefObject<HTMLInputElement | null>;
  fileSystemSupported: boolean;
  contextMenu: MediaPanelContextMenu | null;
  viewMode: MediaPanelViewMode;
  gridFolderId: string | null;
  selectedIds: string[];
  folders: MediaFolder[];
  compositionCount: number;
  setGridFolderId: Dispatch<SetStateAction<string | null>>;
  setContextMenu: Dispatch<SetStateAction<MediaPanelContextMenu | null>>;
  closeContextMenu: () => void;
  setSelectedMediaBoardAnnotationId: (id: string | null) => void;
  setGenerativeTrayExpanded: Dispatch<SetStateAction<boolean>>;
  setSolidSettingsDialog: Dispatch<SetStateAction<MediaContextSolidSettingsDialogState | null>>;
  getAiReferenceMediaFileIds: () => string[];
  updateAiReferenceMediaFileIds: (referenceMediaFileIds: string[]) => void;
  importFile: MediaStoreState['importFile'];
  importFiles: MediaStoreState['importFiles'];
  importFilesWithHandles: MediaStoreState['importFilesWithHandles'];
  importFilesWithPicker: MediaStoreState['importFilesWithPicker'];
  createComposition: MediaStoreState['createComposition'];
  createFolder: MediaStoreState['createFolder'];
  showInExplorer: MediaStoreState['showInExplorer'];
  pickProxyFolder: MediaStoreState['pickProxyFolder'];
  moveToFolder: MediaStoreState['moveToFolder'];
  openSourceMonitorCrop: MediaStoreState['openSourceMonitorCrop'];
  setSelection: MediaStoreState['setSelection'];
  addToSelection: MediaStoreState['addToSelection'];
  removeFromSelection: MediaStoreState['removeFromSelection'];
  toggleFolderExpanded: MediaStoreState['toggleFolderExpanded'];
  openCompositionTab: MediaStoreState['openCompositionTab'];
  reloadFile: MediaStoreState['reloadFile'];
  setSourceMonitorFile: MediaStoreState['setSourceMonitorFile'];
  ensureFileThumbnail: MediaStoreState['ensureFileThumbnail'];
  generateAudioProxy: MediaStoreState['generateAudioProxy'];
  generateMediaWaveform: MediaStoreState['generateMediaWaveform'];
  generateMediaSpectrogram: MediaStoreState['generateMediaSpectrogram'];
  copyMediaItems: MediaStoreState['copyMediaItems'];
  duplicateMediaItems: MediaStoreState['duplicateMediaItems'];
  pasteMediaItems: MediaStoreState['pasteMediaItems'];
  hasMediaClipboard: MediaStoreState['hasMediaClipboard'];
  createTextItem: MediaStoreState['createTextItem'];
  getOrCreateTextFolder: MediaStoreState['getOrCreateTextFolder'];
  createSolidItem: MediaStoreState['createSolidItem'];
  getOrCreateSolidFolder: MediaStoreState['getOrCreateSolidFolder'];
  createMeshItem: MediaStoreState['createMeshItem'];
  getOrCreateMeshFolder: MediaStoreState['getOrCreateMeshFolder'];
  createCameraItem: MediaStoreState['createCameraItem'];
  getOrCreateCameraFolder: MediaStoreState['getOrCreateCameraFolder'];
  createSplatEffectorItem: MediaStoreState['createSplatEffectorItem'];
  getOrCreateSplatEffectorFolder: MediaStoreState['getOrCreateSplatEffectorFolder'];
  createMathSceneItem: MediaStoreState['createMathSceneItem'];
  getOrCreateMathSceneFolder: MediaStoreState['getOrCreateMathSceneFolder'];
  createMotionShapeItem: MediaStoreState['createMotionShapeItem'];
  getOrCreateMotionShapeFolder: MediaStoreState['getOrCreateMotionShapeFolder'];
  importGaussianSplat: MediaStoreState['importGaussianSplat'];
  handleDelete: () => Promise<void>;
}

export function useMediaPanelCommandBindings({
  fileInputRef,
  fileSystemSupported,
  contextMenu,
  viewMode,
  gridFolderId,
  selectedIds,
  folders,
  compositionCount,
  setGridFolderId,
  setContextMenu,
  closeContextMenu,
  setSelectedMediaBoardAnnotationId,
  setGenerativeTrayExpanded,
  setSolidSettingsDialog,
  getAiReferenceMediaFileIds,
  updateAiReferenceMediaFileIds,
  importFile,
  importFiles,
  importFilesWithHandles,
  importFilesWithPicker,
  createComposition,
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
  createSplatEffectorItem,
  getOrCreateSplatEffectorFolder,
  createMathSceneItem,
  getOrCreateMathSceneFolder,
  createMotionShapeItem,
  getOrCreateMotionShapeFolder,
  importGaussianSplat,
  handleDelete,
}: UseMediaPanelCommandBindingsInput) {
  const mediaContextExplorerHandlers = useMediaContextExplorerHandlers({
    showInExplorer,
    pickProxyFolder,
    closeContextMenu,
  });
  const mediaContextLocalHandlers = useMediaContextLocalHandlers({
    moveToFolder,
    openSourceMonitorCrop,
    setSolidSettingsDialog,
    closeContextMenu,
  });
  const mediaContextFrameExtractionHandlers = useMediaContextFrameExtractionHandlers({
    closeContextMenu,
    importFile,
    setSelection,
  });
  const handleBadgeClick = useMediaPanelSourceMonitorBadges();

  const addImportCommands = useMediaPanelAddImportCommands({
    fileInputRef,
    fileSystemSupported,
    contextMenu,
    viewMode,
    gridFolderId,
    selectedIds,
    folders,
    compositionCount,
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

  const selectionCommands = useMediaPanelSelectionCommands({
    selectedIds,
    viewMode,
    setGridFolderId,
    setContextMenu,
    closeContextMenu,
    setSelectedMediaBoardAnnotationId,
    setGenerativeTrayExpanded,
    getActiveParentId: addImportCommands.getActiveParentId,
    getAiReferenceMediaFileIds,
    updateAiReferenceMediaFileIds,
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
    folders,
    createFolder,
    importFiles,
    importFilesWithHandles,
    handleDelete,
  });

  return {
    mediaContextExplorerHandlers,
    mediaContextLocalHandlers,
    mediaContextFrameExtractionHandlers,
    handleBadgeClick,
    ...addImportCommands,
    ...selectionCommands,
  };
}
