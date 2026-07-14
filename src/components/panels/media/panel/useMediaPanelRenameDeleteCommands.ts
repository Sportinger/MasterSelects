import { useCallback, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from 'react';
import { Logger } from '../../../../services/logger';
import type {
  CameraItem,
  Composition,
  LightItem,
  MathSceneItem,
  MediaFile,
  MediaFolder,
  MeshItem,
  MotionShapeItem,
  SignalAssetItem,
  SolidItem,
  SplatEffectorItem,
  TextItem,
  useMediaStore,
} from '../../../../stores/mediaStore';
import type { MediaFileUsageSummary } from '../../../../stores/mediaStore/slices/fileManageSlice';
import { isUserVisibleComposition } from '../../../../stores/mediaStore/compositionVisibility';

const log = Logger.create('MediaPanel');

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

export interface MediaDeleteConfirmationRequest {
  selectedIds: string[];
  fileIds: string[];
  mediaFiles: MediaFile[];
  usages: MediaFileUsageSummary[];
}

interface UseMediaPanelRenameDeleteCommandsInput {
  selectedIds: string[];
  files: MediaFile[];
  folders: MediaFolder[];
  compositions: Composition[];
  textItems: TextItem[];
  solidItems: SolidItem[];
  meshItems: MeshItem[];
  cameraItems: CameraItem[];
  lightItems?: LightItem[];
  splatEffectorItems: SplatEffectorItem[];
  mathSceneItems: MathSceneItem[];
  motionShapeItems: MotionShapeItem[];
  signalAssets: SignalAssetItem[];
  renameFile: MediaStoreState['renameFile'];
  renameSignalAsset: MediaStoreState['renameSignalAsset'];
  renameFolder: MediaStoreState['renameFolder'];
  updateComposition: MediaStoreState['updateComposition'];
  getMediaFileUsages: MediaStoreState['getMediaFileUsages'];
  deleteMediaFilesEverywhere: MediaStoreState['deleteMediaFilesEverywhere'];
  removeSignalAsset: MediaStoreState['removeSignalAsset'];
  removeComposition: MediaStoreState['removeComposition'];
  removeFolder: MediaStoreState['removeFolder'];
  removeTextItem: MediaStoreState['removeTextItem'];
  removeSolidItem: MediaStoreState['removeSolidItem'];
  removeMeshItem: MediaStoreState['removeMeshItem'];
  removeCameraItem: MediaStoreState['removeCameraItem'];
  removeLightItem?: MediaStoreState['removeLightItem'];
  removeSplatEffectorItem: MediaStoreState['removeSplatEffectorItem'];
  removeMathSceneItem: MediaStoreState['removeMathSceneItem'];
  removeMotionShapeItem: MediaStoreState['removeMotionShapeItem'];
  closeContextMenu: () => void;
}

export function getMediaDeleteImpact(
  mediaFiles: MediaFile[],
  usages: MediaFileUsageSummary[],
): { clipCount: number; compositionCount: number; fileLabel: string } {
  const clipCount = usages.reduce((total, usage) => total + usage.clipCount, 0);
  const compositionCount = new Set(usages.flatMap(usage => usage.compositions.map(composition => composition.compositionId))).size;
  const fileLabel = mediaFiles.length === 1
    ? `"${mediaFiles[0].name}"`
    : `${mediaFiles.length} media files`;

  return { clipCount, compositionCount, fileLabel };
}

export function useMediaPanelRenameDeleteCommands({
  selectedIds,
  files,
  folders,
  compositions,
  textItems,
  solidItems,
  meshItems,
  cameraItems,
  lightItems = [],
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
}: UseMediaPanelRenameDeleteCommandsInput): {
  renamingId: string | null;
  renameValue: string;
  renameTimerRef: { current: number | null };
  setRenamingId: Dispatch<SetStateAction<string | null>>;
  setRenameValue: Dispatch<SetStateAction<string>>;
  startRename: (id: string, currentName: string) => void;
  finishRename: () => void;
  handleNameClick: (e: ReactMouseEvent, id: string, currentName: string) => void;
  handleDelete: () => Promise<void>;
  deleteConfirmation: MediaDeleteConfirmationRequest | null;
  setDeleteConfirmation: Dispatch<SetStateAction<MediaDeleteConfirmationRequest | null>>;
  deleteConfirmationBusy: boolean;
  confirmMediaDelete: () => Promise<void>;
} {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameTimerRef = useRef<number | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<MediaDeleteConfirmationRequest | null>(null);
  const [deleteConfirmationBusy, setDeleteConfirmationBusy] = useState(false);

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
    const composition = compositions.filter(isUserVisibleComposition).find(c => c.id === renamingId);
    const signalAsset = signalAssets.find(item => item.id === renamingId);

    if (file) {
      renameFile(renamingId, renameValue.trim());
    } else if (signalAsset) {
      renameSignalAsset(renamingId, renameValue.trim());
    } else if (folder) {
      renameFolder(renamingId, renameValue.trim());
    } else if (composition) {
      updateComposition(renamingId, { name: renameValue.trim() });
    }

    setRenamingId(null);
  }, [renamingId, renameValue, files, folders, compositions, signalAssets, renameFile, renameSignalAsset, renameFolder, updateComposition]);

  const handleNameClick = useCallback((e: ReactMouseEvent, id: string, currentName: string) => {
    if (selectedIds.includes(id)) {
      e.stopPropagation();
      if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
      renameTimerRef.current = window.setTimeout(() => {
        renameTimerRef.current = null;
        startRename(id, currentName);
      }, 300);
    }
  }, [selectedIds, startRename]);

  const deleteSelectedItems = useCallback(async (idsToDelete: string[], fileIdsToDelete: string[]) => {
    const fileIdSet = new Set(fileIdsToDelete);
    const compositionIds = new Set(compositions.filter(isUserVisibleComposition).map((item) => item.id));
    const folderIds = new Set(folders.map((item) => item.id));
    const textItemIds = new Set(textItems.map((item) => item.id));
    const solidItemIds = new Set(solidItems.map((item) => item.id));
    const meshItemIds = new Set(meshItems.map((item) => item.id));
    const cameraItemIds = new Set(cameraItems.map((item) => item.id));
    const lightItemIds = new Set(lightItems.map((item) => item.id));
    const splatEffectorItemIds = new Set(splatEffectorItems.map((item) => item.id));
    const mathSceneItemIds = new Set(mathSceneItems.map((item) => item.id));
    const motionShapeItemIds = new Set(motionShapeItems.map((item) => item.id));
    const signalAssetIds = new Set(signalAssets.map((item) => item.id));

    if (fileIdsToDelete.length > 0) {
      const result = await deleteMediaFilesEverywhere(fileIdsToDelete);
      if (result.artifactFailures.length > 0) {
        log.warn('Some media artifacts could not be deleted', result.artifactFailures);
      }
    }

    idsToDelete.forEach(id => {
      if (fileIdSet.has(id)) return;
      if (compositionIds.has(id)) removeComposition(id);
      else if (folderIds.has(id)) removeFolder(id);
      else if (textItemIds.has(id)) removeTextItem(id);
      else if (solidItemIds.has(id)) removeSolidItem(id);
      else if (meshItemIds.has(id)) removeMeshItem(id);
      else if (cameraItemIds.has(id)) removeCameraItem(id);
      else if (lightItemIds.has(id)) removeLightItem?.(id);
      else if (splatEffectorItemIds.has(id)) removeSplatEffectorItem(id);
      else if (mathSceneItemIds.has(id)) removeMathSceneItem(id);
      else if (motionShapeItemIds.has(id)) removeMotionShapeItem(id);
      else if (signalAssetIds.has(id)) removeSignalAsset(id);
    });
    closeContextMenu();
  }, [compositions, folders, textItems, solidItems, meshItems, cameraItems, lightItems, splatEffectorItems, mathSceneItems, motionShapeItems, signalAssets, deleteMediaFilesEverywhere, removeSignalAsset, removeComposition, removeFolder, removeTextItem, removeSolidItem, removeMeshItem, removeCameraItem, removeLightItem, removeSplatEffectorItem, removeMathSceneItem, removeMotionShapeItem, closeContextMenu]);

  const handleDelete = useCallback(async () => {
    const selectedIdSet = new Set(selectedIds);
    const selectedFiles = files.filter(file => selectedIdSet.has(file.id));
    const selectedFileIds = selectedFiles.map((file) => file.id);

    if (selectedFiles.length > 0) {
      const usages = getMediaFileUsages(selectedFileIds);
      const hasProjectArtifacts = selectedFiles.some(file =>
        Boolean(
          file.projectPath ||
          file.fileHash ||
          file.audioAnalysisRefs ||
          file.proxyStatus ||
          file.audioProxyStatus ||
          file.hasProxyAudio ||
          file.proxyFrameCount ||
          file.thumbnailUrl ||
          file.transcriptStatus ||
          file.analysisStatus
        )
      );

      if (usages.length > 0 || hasProjectArtifacts) {
        setDeleteConfirmation({
          selectedIds: [...selectedIds],
          fileIds: selectedFileIds,
          mediaFiles: selectedFiles,
          usages,
        });
        closeContextMenu();
        return;
      }
    }

    await deleteSelectedItems([...selectedIds], selectedFileIds);
  }, [selectedIds, files, getMediaFileUsages, deleteSelectedItems, closeContextMenu]);

  const confirmMediaDelete = useCallback(async () => {
    if (!deleteConfirmation || deleteConfirmationBusy) return;
    setDeleteConfirmationBusy(true);
    try {
      await deleteSelectedItems(deleteConfirmation.selectedIds, deleteConfirmation.fileIds);
      setDeleteConfirmation(null);
    } catch (error) {
      log.error('Failed to delete media items', error);
    } finally {
      setDeleteConfirmationBusy(false);
    }
  }, [deleteConfirmation, deleteConfirmationBusy, deleteSelectedItems]);

  return {
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
  };
}
