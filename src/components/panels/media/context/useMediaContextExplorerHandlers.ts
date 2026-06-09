import { useCallback } from 'react';
import type { MediaFile } from '../../../../stores/mediaStore';

type MediaExplorerTarget = 'raw' | 'proxy';

interface MediaExplorerResult {
  success: boolean;
  message: string;
}

interface UseMediaContextExplorerHandlersInput {
  showInExplorer: (target: MediaExplorerTarget, mediaFileId: string) => Promise<MediaExplorerResult>;
  pickProxyFolder: () => Promise<unknown>;
  closeContextMenu: () => void;
}

export interface MediaContextExplorerHandlers {
  onShowRawInExplorer: (mediaFile: MediaFile) => Promise<void>;
  onShowProxyInExplorer: (mediaFile: MediaFile) => Promise<void>;
  onPickProxyFolder: () => Promise<void>;
}

export function useMediaContextExplorerHandlers({
  showInExplorer,
  pickProxyFolder,
  closeContextMenu,
}: UseMediaContextExplorerHandlersInput): MediaContextExplorerHandlers {
  const onShowRawInExplorer = useCallback(async (item: MediaFile) => {
    const result = await showInExplorer('raw', item.id);
    if (result.success) {
      alert(result.message);
    } else if (item.file) {
      const url = URL.createObjectURL(item.file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }
    closeContextMenu();
  }, [closeContextMenu, showInExplorer]);

  const onShowProxyInExplorer = useCallback(async (item: MediaFile) => {
    const result = await showInExplorer('proxy', item.id);
    alert(result.message);
    closeContextMenu();
  }, [closeContextMenu, showInExplorer]);

  const onPickProxyFolder = useCallback(async () => {
    await pickProxyFolder();
    closeContextMenu();
  }, [closeContextMenu, pickProxyFolder]);

  return {
    onShowRawInExplorer,
    onShowProxyInExplorer,
    onPickProxyFolder,
  };
}
