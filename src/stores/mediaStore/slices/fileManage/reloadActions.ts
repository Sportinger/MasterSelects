import { bindEditorAsyncStore, captureEditorAsyncMutation } from '../../../../services/project/repository/transaction/editorAsyncMutation';
import type { MediaSliceCreator, MediaState } from '../../types';
import { fileSystemService } from '../../../../services/fileSystemService';
import { projectDB } from '../../../../services/projectDB';
import { projectFileService } from '../../../../services/projectFileService';
import {
  createManagedThumbnailUrl,
  createThumbnail,
} from '../../helpers/thumbnailHelpers';
import {
  createRenderablePrimaryMediaObjectUrl,
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
import { isRestoredMediaSourceCompatible } from '../../../../services/project/mediaSourceValidation';

function isBlobUrl(value?: string): value is string {
  return typeof value === 'string' && value.startsWith('blob:');
}

export const createMediaReloadActions: MediaSliceCreator<Pick<
  FileManageActions,
  'refreshFileUrls' | 'reloadFile' | 'reloadAllFiles'
>> = (baseSet, baseGet) => ({
  refreshFileUrls: async (id: string, options?: { refreshThumbnail?: boolean }) => {
    const binding = captureEditorAsyncMutation('Reload media');
    const { set, get } = bindEditorAsyncStore(baseSet, baseGet, binding);
    const mediaFile = get().files.find((f) => f.id === id);
    if (!mediaFile) return false;

    if (!mediaFile.file) {
      return (get() as MediaState & FileManageActions).reloadFile(id);
    }

    const sourceIsCurrent = () => binding.isCurrent() && baseGet().files.find(file => file.id === id)?.file === mediaFile.file;
    const refreshThumbnail = options?.refreshThumbnail ?? true;
    const url = await createRenderablePrimaryMediaObjectUrl(id, mediaFile.file, { revokeExisting: false });
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

    if (!sourceIsCurrent()) { URL.revokeObjectURL(url); if (thumbnailUrl !== mediaFile.thumbnailUrl && isBlobUrl(thumbnailUrl)) URL.revokeObjectURL(thumbnailUrl); return false; }
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
    const binding = captureEditorAsyncMutation('Reload media');
    const { set, get } = bindEditorAsyncStore(baseSet, baseGet, binding);
    const mediaFile = get().files.find(f => f.id === id);
    if (!mediaFile) return false;

    const sourceIsCurrent = () => binding.isCurrent() && baseGet().files.find(file => file.id === id)?.file === mediaFile.file;
    let file: File | undefined;
    let handle: FileSystemFileHandle | undefined;

    // Try 1: Get from project RAW folder (we already have folder permission!)
    if (mediaFile.projectPath && projectFileService.isProjectOpen()) {
      const result = await projectFileService.getFileFromRaw(mediaFile.projectPath);
      if (result && await isRestoredMediaSourceCompatible(mediaFile, result.file)) {
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

    if (file && !await isRestoredMediaSourceCompatible(mediaFile, file)) file = undefined;
    if (!file) {
      log.warn('Could not reload file:', mediaFile.name);
      return false;
    }

    if (!sourceIsCurrent()) return false;
    // Store handle if we got one
    if (handle) {
      fileSystemService.storeFileHandle(id, handle);
      await projectDB.storeHandle(`media_${id}`, handle);
    }

    if (!sourceIsCurrent()) return false;
    await invalidateMediaSourceReplacementCaches(
      id,
      mediaFile,
      collectActiveTimelineClipsForMediaFileId(id),
    );

    if (!sourceIsCurrent()) return false;
    const sourceReplacementPatch = await createMediaSourceReplacementPatch(file);
    if (!sourceIsCurrent()) return false;
    revokeMediaFileUrls(mediaFile);
    const url = await createRenderablePrimaryMediaObjectUrl(id, file);

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
    const binding = captureEditorAsyncMutation('Reload missing media');
    const files = baseGet().files.filter(file => !file.file);
    let total = 0;
    for (const file of files) {
      if (!binding.isCurrent()) return total;
      if (await (baseGet() as MediaState & FileManageActions).reloadFile(file.id)) total++;
    }
    return total;
  },
});
