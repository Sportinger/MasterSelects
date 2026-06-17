import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { MediaFile, SolidItem } from '../../../../stores/mediaStore';

export interface MediaContextSolidSettingsDialogState {
  solidItemId: string;
  width: number;
  height: number;
  color: string;
}

interface UseMediaContextLocalHandlersInput {
  moveToFolder: (ids: string[], folderId: string | null) => void;
  openSourceMonitorCrop: (id: string) => void;
  setSolidSettingsDialog: Dispatch<SetStateAction<MediaContextSolidSettingsDialogState | null>>;
  closeContextMenu: () => void;
}

export interface MediaContextLocalHandlers {
  onMoveToFolder: (ids: readonly string[], folderId: string | null) => void;
  onOpenImageCrop: (mediaFile: MediaFile) => void;
  onOpenSolidSettings: (solidItem: SolidItem) => void;
}

export function useMediaContextLocalHandlers({
  moveToFolder,
  openSourceMonitorCrop,
  setSolidSettingsDialog,
  closeContextMenu,
}: UseMediaContextLocalHandlersInput): MediaContextLocalHandlers {
  const onMoveToFolder = useCallback((ids: readonly string[], folderId: string | null) => {
    moveToFolder([...ids], folderId);
  }, [moveToFolder]);

  const onOpenSolidSettings = useCallback((item: SolidItem) => {
    setSolidSettingsDialog({
      solidItemId: item.id,
      width: item.width,
      height: item.height,
      color: item.color,
    });
    closeContextMenu();
  }, [closeContextMenu, setSolidSettingsDialog]);

  const onOpenImageCrop = useCallback((mediaFile: MediaFile) => {
    openSourceMonitorCrop(mediaFile.id);
    closeContextMenu();
  }, [closeContextMenu, openSourceMonitorCrop]);

  return {
    onMoveToFolder,
    onOpenImageCrop,
    onOpenSolidSettings,
  };
}
