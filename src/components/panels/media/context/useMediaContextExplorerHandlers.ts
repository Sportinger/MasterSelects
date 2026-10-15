import { useCallback } from 'react';
import { Logger } from '../../../../services/logger';
import type { MediaFile } from '../../../../stores/mediaStore';
import { projectDB } from '../../../../services/projectDB';
import { projectFileService } from '../../../../services/projectFileService';

const log = Logger.create('MediaDownload');

type MediaExplorerTarget = 'raw' | 'proxy';
type BrowserDownloadMediaFile = Pick<MediaFile, 'file' | 'hasFileHandle' | 'id' | 'name' | 'projectPath' | 'url'>;

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
  onDownloadMediaFile: (mediaFile: MediaFile) => Promise<void>;
  onShowRawInExplorer: (mediaFile: MediaFile) => Promise<void>;
  onShowProxyInExplorer: (mediaFile: MediaFile) => Promise<void>;
  onPickProxyFolder: () => Promise<void>;
}

export function canDownloadMediaFileInBrowser(item: Pick<MediaFile, 'file' | 'hasFileHandle' | 'projectPath' | 'url'>): boolean {
  return Boolean(item.file || item.projectPath || item.hasFileHandle || item.url);
}

async function getDownloadFileFromProject(item: BrowserDownloadMediaFile): Promise<File | null> {
  if (item.file) {
    return item.file;
  }

  if (item.projectPath && projectFileService.isProjectOpen()) {
    try {
      const result = await projectFileService.getFileFromRaw(item.projectPath);
      if (result?.file) return result.file;
    } catch (error) {
      log.warn('Project media could not be read for download; trying retained sources', error);
    }
  }

  if (!item.hasFileHandle) {
    return null;
  }

  try {
    const storedHandle = await projectDB.getStoredHandle(`media_${item.id}`);
    if (!storedHandle || storedHandle.kind !== 'file' || !('getFile' in storedHandle)) {
      return null;
    }

    const handle = storedHandle as FileSystemFileHandle;
    const permission = await handle.queryPermission({ mode: 'read' });
    const granted = permission === 'granted'
      || await handle.requestPermission({ mode: 'read' }) === 'granted';

    if (!granted) {
      return null;
    }

    // Await here so a deleted/moved file reaches this catch, not the UI event.
    return await handle.getFile();
  } catch (error) {
    log.warn('Stored media handle could not be read for download; trying retained URL', error);
    return null;
  }
}

export async function downloadMediaFileInBrowser(item: BrowserDownloadMediaFile): Promise<boolean> {
  const anchor = document.createElement('a');
  anchor.download = item.name;
  anchor.rel = 'noopener';

  let objectUrl: string | null = null;
  const file = await getDownloadFileFromProject(item);
  if (file) {
    objectUrl = URL.createObjectURL(file);
    anchor.href = objectUrl;
  } else if (item.url) {
    anchor.href = item.url;
  } else {
    return false;
  }

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }

  return true;
}

export function useMediaContextExplorerHandlers({
  showInExplorer,
  pickProxyFolder,
  closeContextMenu,
}: UseMediaContextExplorerHandlersInput): MediaContextExplorerHandlers {
  const onDownloadMediaFile = useCallback(async (item: MediaFile) => {
    const didDownload = await downloadMediaFileInBrowser(item);
    if (!didDownload) {
      alert('Media source is not available for browser download.');
    }
    closeContextMenu();
  }, [closeContextMenu]);

  const onShowRawInExplorer = useCallback(async (item: MediaFile) => {
    const result = await showInExplorer('raw', item.id);
    if (result.success) {
      alert(result.message);
    } else if (canDownloadMediaFileInBrowser(item)) {
      if (!await downloadMediaFileInBrowser(item)) {
        alert('Media source is not available for browser download.');
      }
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
    onDownloadMediaFile,
    onShowRawInExplorer,
    onShowProxyInExplorer,
    onPickProxyFolder,
  };
}
