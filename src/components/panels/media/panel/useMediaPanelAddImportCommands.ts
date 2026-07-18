import { useCallback, type ChangeEvent } from 'react';
import type { MediaPanelContextMenu } from '../context/types';
import { requestMediaBoardPlacement } from '../board/placementRequests';
import type { MediaPanelViewMode } from './types';
import type { MediaFolder, useMediaStore } from '../../../../stores/mediaStore';
import type { MeshPrimitiveType } from '../../../../stores/mediaStore/types';
import type { ShapePrimitive } from '../../../../types/motionDesign';

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

interface UseMediaPanelAddImportCommandsInput {
  fileInputRef: { current: HTMLInputElement | null };
  fileSystemSupported: boolean;
  contextMenu: MediaPanelContextMenu | null;
  viewMode: MediaPanelViewMode;
  gridFolderId: string | null;
  selectedIds: string[];
  folders: MediaFolder[];
  compositionCount: number;
  importFiles: MediaStoreState['importFiles'];
  importFilesWithPicker: MediaStoreState['importFilesWithPicker'];
  createComposition: MediaStoreState['createComposition'];
  openCompositionTab: MediaStoreState['openCompositionTab'];
  createFolder: MediaStoreState['createFolder'];
  createTextItem: MediaStoreState['createTextItem'];
  getOrCreateTextFolder: MediaStoreState['getOrCreateTextFolder'];
  createSolidItem: MediaStoreState['createSolidItem'];
  getOrCreateSolidFolder: MediaStoreState['getOrCreateSolidFolder'];
  createMeshItem: MediaStoreState['createMeshItem'];
  getOrCreateMeshFolder: MediaStoreState['getOrCreateMeshFolder'];
  createCameraItem: MediaStoreState['createCameraItem'];
  getOrCreateCameraFolder: MediaStoreState['getOrCreateCameraFolder'];
  createLightItem: MediaStoreState['createLightItem'];
  getOrCreateLightFolder: MediaStoreState['getOrCreateLightFolder'];
  createSplatEffectorItem: MediaStoreState['createSplatEffectorItem'];
  getOrCreateSplatEffectorFolder: MediaStoreState['getOrCreateSplatEffectorFolder'];
  createMathSceneItem: MediaStoreState['createMathSceneItem'];
  getOrCreateMathSceneFolder: MediaStoreState['getOrCreateMathSceneFolder'];
  createMotionShapeItem: MediaStoreState['createMotionShapeItem'];
  getOrCreateMotionShapeFolder: MediaStoreState['getOrCreateMotionShapeFolder'];
  importGaussianSplat: MediaStoreState['importGaussianSplat'];
  closeContextMenu: () => void;
}

export function useMediaPanelAddImportCommands({
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
  openCompositionTab,
  createFolder,
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
  closeContextMenu,
}: UseMediaPanelAddImportCommandsInput): {
  getActiveParentId: () => string | null;
  handleImport: () => Promise<void>;
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleNewComposition: () => void;
  handleNewFolder: () => void;
  handleNewText: () => void;
  handleNewText3D: () => void;
  handleNewSolid: () => void;
  handleNewMesh: (meshType: MeshPrimitiveType) => void;
  handleNewCamera: () => void;
  handleNewLight: () => void;
  handleNewSplatEffector: () => void;
  handleNewMathScene: () => void;
  handleNewMotionShape: (primitive: ShapePrimitive) => void;
  handleImportGaussianSplat: () => void;
} {
  const boardPosition = contextMenu?.boardPosition;
  const getActiveParentId = useCallback((): string | null => {
    if (contextMenu && contextMenu.parentId !== undefined) return contextMenu.parentId;
    if (viewMode === 'icons' && gridFolderId) return gridFolderId;
    if (selectedIds.length === 1) {
      const sel = folders.find(f => f.id === selectedIds[0]);
      if (sel) return sel.id;
    }
    return null;
  }, [contextMenu, viewMode, gridFolderId, selectedIds, folders]);

  const handleImport = useCallback(async () => {
    if (fileSystemSupported) {
      await importFilesWithPicker();
    } else {
      fileInputRef.current?.click();
    }
  }, [fileInputRef, fileSystemSupported, importFilesWithPicker]);

  const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await importFiles(e.target.files);
      e.target.value = '';
    }
  }, [importFiles]);

  const placeCreatedItems = useCallback((itemIds: string[]) => {
    if (!boardPosition) return;
    requestMediaBoardPlacement({ itemIds, point: boardPosition });
  }, [boardPosition]);

  const handleNewComposition = useCallback(() => {
    const composition = createComposition(`Comp ${compositionCount + 1}`, { parentId: getActiveParentId() });
    placeCreatedItems([composition.id]);
    openCompositionTab(composition.id);
    closeContextMenu();
  }, [closeContextMenu, compositionCount, createComposition, getActiveParentId, openCompositionTab, placeCreatedItems]);

  const handleNewFolder = useCallback(() => {
    const folder = createFolder('New Folder', getActiveParentId());
    placeCreatedItems([folder.id]);
    closeContextMenu();
  }, [closeContextMenu, createFolder, getActiveParentId, placeCreatedItems]);

  const handleNewText = useCallback(() => {
    const textFolderId = boardPosition ? getActiveParentId() : getOrCreateTextFolder();
    const id = createTextItem(undefined, textFolderId);
    placeCreatedItems([id]);
    closeContextMenu();
  }, [boardPosition, closeContextMenu, createTextItem, getActiveParentId, getOrCreateTextFolder, placeCreatedItems]);

  const handleNewText3D = useCallback(() => {
    const textFolderId = boardPosition ? getActiveParentId() : getOrCreateTextFolder();
    const id = createMeshItem('text3d', undefined, textFolderId);
    placeCreatedItems([id]);
    closeContextMenu();
  }, [boardPosition, closeContextMenu, createMeshItem, getActiveParentId, getOrCreateTextFolder, placeCreatedItems]);

  const handleNewSolid = useCallback(() => {
    const solidFolderId = boardPosition ? getActiveParentId() : getOrCreateSolidFolder();
    const id = createSolidItem(undefined, '#ffffff', solidFolderId);
    placeCreatedItems([id]);
    closeContextMenu();
  }, [boardPosition, closeContextMenu, createSolidItem, getActiveParentId, getOrCreateSolidFolder, placeCreatedItems]);

  const handleNewMesh = useCallback((meshType: MeshPrimitiveType) => {
    const meshFolderId = boardPosition ? getActiveParentId() : getOrCreateMeshFolder();
    const id = createMeshItem(meshType, undefined, meshFolderId);
    placeCreatedItems([id]);
    closeContextMenu();
  }, [boardPosition, closeContextMenu, createMeshItem, getActiveParentId, getOrCreateMeshFolder, placeCreatedItems]);

  const handleNewCamera = useCallback(() => {
    const cameraFolderId = boardPosition ? getActiveParentId() : getOrCreateCameraFolder();
    const id = createCameraItem(undefined, cameraFolderId);
    placeCreatedItems([id]);
    closeContextMenu();
  }, [boardPosition, closeContextMenu, createCameraItem, getActiveParentId, getOrCreateCameraFolder, placeCreatedItems]);

  const handleNewLight = useCallback(() => {
    const lightFolderId = boardPosition ? getActiveParentId() : getOrCreateLightFolder();
    const id = createLightItem(undefined, lightFolderId);
    placeCreatedItems([id]);
    closeContextMenu();
  }, [boardPosition, closeContextMenu, createLightItem, getActiveParentId, getOrCreateLightFolder, placeCreatedItems]);

  const handleNewSplatEffector = useCallback(() => {
    const effectorFolderId = boardPosition ? getActiveParentId() : getOrCreateSplatEffectorFolder();
    const id = createSplatEffectorItem(undefined, effectorFolderId);
    placeCreatedItems([id]);
    closeContextMenu();
  }, [boardPosition, closeContextMenu, createSplatEffectorItem, getActiveParentId, getOrCreateSplatEffectorFolder, placeCreatedItems]);

  const handleNewMathScene = useCallback(() => {
    const mathFolderId = boardPosition ? getActiveParentId() : getOrCreateMathSceneFolder();
    const id = createMathSceneItem(undefined, mathFolderId);
    placeCreatedItems([id]);
    closeContextMenu();
  }, [boardPosition, closeContextMenu, createMathSceneItem, getActiveParentId, getOrCreateMathSceneFolder, placeCreatedItems]);

  const handleNewMotionShape = useCallback((primitive: ShapePrimitive) => {
    const motionFolderId = boardPosition ? getActiveParentId() : getOrCreateMotionShapeFolder();
    const id = createMotionShapeItem(primitive, undefined, motionFolderId);
    placeCreatedItems([id]);
    closeContextMenu();
  }, [boardPosition, closeContextMenu, createMotionShapeItem, getActiveParentId, getOrCreateMotionShapeFolder, placeCreatedItems]);

  const handleImportGaussianSplat = useCallback(() => {
    const parentId = getActiveParentId();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ply,.compressed.ply,.splat,.ksplat,.spz,.sog,.lcc,.zip';
    input.onchange = async (e) => {
      const fileList = (e.target as HTMLInputElement).files;
      if (fileList && fileList.length > 0) {
        const imported = await importGaussianSplat(fileList[0], parentId);
        if (boardPosition) {
          requestMediaBoardPlacement({ itemIds: [imported.id], point: boardPosition });
        }
      }
    };
    input.click();
    closeContextMenu();
  }, [boardPosition, closeContextMenu, getActiveParentId, importGaussianSplat]);

  return {
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
    handleNewLight,
    handleNewSplatEffector,
    handleNewMathScene,
    handleNewMotionShape,
    handleImportGaussianSplat,
  };
}
