import type { MediaSliceCreator, MediaState } from '../../types';
import { fileSystemService } from '../../../../services/fileSystemService';
import { projectDB } from '../../../../services/projectDB';
import { projectFileService } from '../../../../services/projectFileService';
import {
  createManagedThumbnailUrl,
  createThumbnail,
} from '../../helpers/thumbnailHelpers';
import {
  createPrimaryMediaObjectUrl,
  revokeMediaFileObjectUrls,
} from '../../../../services/project/mediaObjectUrlManager';
import type { FileManageActions } from '../fileManageSlice';
import {
  collectActiveTimelineClipsForMediaFileId,
  invalidateMediaSourceReplacementCaches,
} from './sourceReplacementCache';
import { fileManageLog as log } from './log';
import {
  createMediaSourceReplacementPatch,
} from './sourceResolution';
import { revokeMediaFileUrls } from './deleteRuntimeCleanup';
import { updateTimelineClips } from './timelineClipReload';

function isBlobUrl(value?: string): value is string {
  return typeof value === 'string' && value.startsWith('blob:');
}

export const createMediaReloadActions: MediaSliceCreator<Pick<
  FileManageActions,
  'refreshFileUrls' | 'reloadFile' | 'reloadAllFiles'
>> = (set, get) => ({
  refreshFileUrls: async (id: string, options?: { refreshThumbnail?: boolean }) => {
    const mediaFile = get().files.find((f) => f.id === id);
    if (!mediaFile) return false;

    if (!mediaFile.file) {
      return (get() as MediaState & FileManageActions).reloadFile(id);
    }

    const refreshThumbnail = options?.refreshThumbnail ?? true;
    const url = createPrimaryMediaObjectUrl(id, mediaFile.file, { revokeExisting: false });
    let thumbnailUrl = mediaFile.thumbnailUrl;

    if (refreshThumbnail) {
      const generatedThumbnail = mediaFile.type === 'image' || mediaFile.type === 'video'
        ? await createThumbnail(mediaFile.file, mediaFile.type)
        : undefined;
      if (mediaFile.type === 'image') {
        thumbnailUrl = await createManagedThumbnailUrl(id, generatedThumbnail);
      } else if (mediaFile.type === 'video') {
        thumbnailUrl = await createManagedThumbnailUrl(id, generatedThumbnail);
      }
    }

    set((state) => ({
      files: state.files.map((file) =>
        file.id === id
          ? { ...file, url, thumbnailUrl }
          : file
      ),
    }));

    revokeMediaFileObjectUrls(mediaFile, {
      keepUrls: [url, thumbnailUrl].filter(isBlobUrl),
    });

    log.info('Refreshed media blob URLs', {
      id: mediaFile.id,
      name: mediaFile.name,
      refreshThumbnail,
    });
    return true;
  },

  /**
   * Reload a single file - tries RAW folder first, then falls back to file handle.
   */
  reloadFile: async (id: string) => {
    const mediaFile = get().files.find(f => f.id === id);
    if (!mediaFile) return false;

    let file: File | undefined;
    let handle: FileSystemFileHandle | undefined;

    // Try 1: Get from project RAW folder (we already have folder permission!)
    if (mediaFile.projectPath && projectFileService.isProjectOpen()) {
      const result = await projectFileService.getFileFromRaw(mediaFile.projectPath);
      if (result) {
        file = result.file;
        handle = result.handle;
        log.debug('Got file from RAW folder:', mediaFile.projectPath);
      }
    }

    // Try 2: Fallback to stored file handle
    if (!file) {
      const storedHandle = await projectDB.getStoredHandle(`media_${id}`);
      if (storedHandle && 'getFile' in storedHandle) {
        try {
          const permission = await (storedHandle as FileSystemFileHandle).queryPermission({ mode: 'read' });
          if (permission === 'granted') {
            file = await (storedHandle as FileSystemFileHandle).getFile();
            handle = storedHandle as FileSystemFileHandle;
            log.debug('Got file from stored handle:', mediaFile.name);
          } else {
            const newPermission = await (storedHandle as FileSystemFileHandle).requestPermission({ mode: 'read' });
            if (newPermission === 'granted') {
              file = await (storedHandle as FileSystemFileHandle).getFile();
              handle = storedHandle as FileSystemFileHandle;
              log.debug('Got file from stored handle (after permission):', mediaFile.name);
            }
          }
        } catch (e) {
          log.warn('Failed to get file from stored handle:', e);
        }
      }
    }

    if (!file) {
      log.warn('Could not reload file:', mediaFile.name);
      return false;
    }

    // Store handle if we got one
    if (handle) {
      fileSystemService.storeFileHandle(id, handle);
      await projectDB.storeHandle(`media_${id}`, handle);
    }

    revokeMediaFileUrls(mediaFile);
    await invalidateMediaSourceReplacementCaches(
      id,
      mediaFile,
      collectActiveTimelineClipsForMediaFileId(id),
    );

    // Create new URL
    const url = createPrimaryMediaObjectUrl(id, file);
    const sourceReplacementPatch = await createMediaSourceReplacementPatch(file);

    // Update store
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id ? { ...f, ...sourceReplacementPatch, file, url, hasFileHandle: true } : f
      ),
    }));

    // Update timeline clips
    await updateTimelineClips(id, file, {
      invalidateCaches: false,
      fileHash: sourceReplacementPatch.fileHash,
    });

    log.info('Success:', mediaFile.name);
    return true;
  },

  /**
   * Reload all files that need reloading.
   * SIMPLIFIED: Batch reload from RAW folder - no user prompts needed!
   */
  reloadAllFiles: async () => {
    const filesToReload = get().files.filter(f => !f.file);
    if (filesToReload.length === 0) {
      log.debug('No files need reloading');
      return 0;
    }

    log.info(`Reloading ${filesToReload.length} files...`);
    let totalReloaded = 0;

    for (const mediaFileToReload of filesToReload) {
      // Inline reload logic to avoid calling get().reloadFile()
      let file: File | undefined;
      let handle: FileSystemFileHandle | undefined;

      // Try 1: Get from project RAW folder
      if (mediaFileToReload.projectPath && projectFileService.isProjectOpen()) {
        const result = await projectFileService.getFileFromRaw(mediaFileToReload.projectPath);
        if (result) {
          file = result.file;
          handle = result.handle;
        }
      }

      // Try 2: Fallback to stored file handle
      if (!file) {
        const storedHandle = await projectDB.getStoredHandle(`media_${mediaFileToReload.id}`);
        if (storedHandle && 'getFile' in storedHandle) {
          try {
            const permission = await (storedHandle as FileSystemFileHandle).queryPermission({ mode: 'read' });
            if (permission === 'granted') {
              file = await (storedHandle as FileSystemFileHandle).getFile();
              handle = storedHandle as FileSystemFileHandle;
            }
          } catch {
            // Ignore
          }
        }
      }

      if (!file) continue;

      if (handle) {
        fileSystemService.storeFileHandle(mediaFileToReload.id, handle);
        await projectDB.storeHandle(`media_${mediaFileToReload.id}`, handle);
      }

      revokeMediaFileUrls(mediaFileToReload);
      await invalidateMediaSourceReplacementCaches(
        mediaFileToReload.id,
        mediaFileToReload,
        collectActiveTimelineClipsForMediaFileId(mediaFileToReload.id),
      );
      const url = createPrimaryMediaObjectUrl(mediaFileToReload.id, file);
      const sourceReplacementPatch = await createMediaSourceReplacementPatch(file);

      set((state) => ({
        files: state.files.map((f) =>
          f.id === mediaFileToReload.id ? { ...f, ...sourceReplacementPatch, file, url, hasFileHandle: true } : f
        ),
      }));

      await updateTimelineClips(mediaFileToReload.id, file, {
        invalidateCaches: false,
        fileHash: sourceReplacementPatch.fileHash,
      });
      totalReloaded++;
    }

    log.info(`Complete: ${totalReloaded} files reloaded`);
    return totalReloaded;
  },
});
