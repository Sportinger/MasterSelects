import { useCallback, type ChangeEvent } from 'react';
import type { MediaPanelContextMenu } from '../context/types';
import { requestMediaBoardPlacement } from '../board/placementRequests';
import type { MediaImportAnchor, MediaPanelViewMode } from './types';
import type { MediaFolder, useMediaStore } from '../../../../stores/mediaStore';
import type { MeshPrimitiveType } from '../../../../stores/mediaStore/types';
import type { ShapePrimitive } from '../../../../types/motionDesign';
import { trackEditorControlCommitted } from '../../../../services/productAnalytics';
import { Logger } from '../../../../services/logger';
import type { NewCompositionSettingsRequest } from './useMediaPanelCompositionSettings';

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;
const log = Logger.create('MediaPanel');

function reportImportFailure(error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  log.warn('Media import failed', { error });
  const failures: unknown[] = error instanceof AggregateError ? error.errors : [error];
  const details = failures.map(failure => failure instanceof Error
    ? failure.message
    : typeof failure === 'string' ? failure : '').filter(Boolean).join('\n');
  alert(`Could not complete the media import.${details ? `\n\n${details}` : ''}`);
}

const DESKTOP_MEDIA_INPUT_ACCEPT = 'video/*,image/*,audio/*,.mp4,.mov,.m4v,.webm,.mkv,.mp3,.wav,.m4a,.jpg,.jpeg,.png,.heic';

function isIPadLikeDevice(): boolean {
  return typeof navigator !== 'undefined'
    && navigator.maxTouchPoints > 1
    && /Macintosh|iPad|iPhone|iPod/i.test(navigator.userAgent);
}

function isTouchFirstDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const hasTouch = navigator.maxTouchPoints > 0;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const hasCoarsePointer = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  return hasTouch && (isAndroid || hasCoarsePointer || isIPadLikeDevice());
}

export function getNativeMediaInputAccept(): string {
  // Mixed audio/extension filters make iPadOS jump straight to Files instead
  // of offering the system Photo Library picker.
  return isIPadLikeDevice() ? 'image/*,video/*' : DESKTOP_MEDIA_INPUT_ACCEPT;
}

export function shouldUseNativeMediaInput(fileSystemSupported: boolean): boolean {
  if (!fileSystemSupported || typeof navigator === 'undefined') return true;
  // Mobile browsers may expose partial desktop picker APIs, but a directly
  // activated native input is the reliable one-tap path on touch-first devices.
  return isTouchFirstDevice();
}

export function positionNativeMediaInputAtAnchor(
  input: HTMLInputElement,
  anchor: MediaImportAnchor,
): void {
  const maxX = Math.max(0, window.innerWidth - 1);
  const maxY = Math.max(0, window.innerHeight - 1);
  const x = Math.min(maxX, Math.max(0, anchor.x));
  const y = Math.min(maxY, Math.max(0, anchor.y));
  input.style.left = `${x}px`;
  input.style.top = `${y}px`;
}

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
  openNewCompositionSettings: (request: NewCompositionSettingsRequest) => void;
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
  openNewCompositionSettings,
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
  handleImport: (anchor?: MediaImportAnchor) => void;
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

  const handleImport = useCallback((anchor?: MediaImportAnchor) => {
    if (shouldUseNativeMediaInput(fileSystemSupported)) {
      const input = fileInputRef.current;
      if (!input) return;
      const pickerAnchor = anchor ?? (contextMenu
        ? { x: contextMenu.x, y: contextMenu.y }
        : null);
      if (pickerAnchor) positionNativeMediaInputAtAnchor(input, pickerAnchor);
      input.value = '';
      input.accept = getNativeMediaInputAccept();
      input.click();
      return;
    }
    void importFilesWithPicker().catch(reportImportFailure);
  }, [contextMenu, fileInputRef, fileSystemSupported, importFilesWithPicker]);

  const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const files = input.files ? Array.from(input.files) : [];

    // Release the native Photos picker synchronously. Import work may continue
    // for seconds, but Safari no longer needs to retain the selected input.
    input.value = '';
    if (files.length > 0) {
      try {
        await importFiles(files);
      } catch (error) {
        reportImportFailure(error);
      }
    }
  }, [importFiles]);

  const placeCreatedItems = useCallback((itemIds: string[]) => {
    if (!boardPosition) return;
    requestMediaBoardPlacement({ itemIds, point: boardPosition });
  }, [boardPosition]);

  const handleNewComposition = useCallback(() => {
    openNewCompositionSettings({
      name: `Comp ${compositionCount + 1}`,
      parentId: getActiveParentId(),
      ...(boardPosition ? { boardPosition } : {}),
    });
    closeContextMenu();
  }, [boardPosition, closeContextMenu, compositionCount, getActiveParentId, openNewCompositionSettings]);

  const handleNewFolder = useCallback(() => {
    const folder = createFolder('New Folder', getActiveParentId());
    placeCreatedItems([folder.id]);
    closeContextMenu();
  }, [closeContextMenu, createFolder, getActiveParentId, placeCreatedItems]);

  const handleNewText = useCallback(() => {
    const textFolderId = boardPosition ? getActiveParentId() : getOrCreateTextFolder();
    const id = createTextItem(undefined, textFolderId);
    placeCreatedItems([id]);
    trackEditorControlCommitted({
      area: 'text',
      controlId: 'create-text-item',
      controlKind: 'button',
      inputMethod: 'click',
      interaction: 'add',
      itemId: 'text-item',
      itemKind: 'other',
    });
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
