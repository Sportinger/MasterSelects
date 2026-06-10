import type { MediaSliceCreator } from '../../types';
import { projectDB } from '../../../../services/projectDB';
import { projectFileService } from '../../../../services/projectFileService';
import {
  createManagedThumbnailUrl,
  createThumbnail,
  handleThumbnailDedup,
} from '../../helpers/thumbnailHelpers';
import {
  createThumbnailMediaObjectUrl,
  getThumbnailMediaObjectUrlKey,
  mediaObjectUrlManager,
} from '../../../../services/project/mediaObjectUrlManager';
import type { FileManageActions } from '../fileManageSlice';
import { fileManageLog as log } from './log';
import { resolveMediaFileSourceFile } from './sourceResolution';

const activeThumbnailRequests = new Map<string, Promise<boolean>>();

function isBlobUrl(value?: string): value is string {
  return typeof value === 'string' && value.startsWith('blob:');
}

function revokeThumbnailObjectUrl(mediaId: string, thumbnailUrl: string | undefined): void {
  if (!isBlobUrl(thumbnailUrl)) {
    return;
  }

  const key = getThumbnailMediaObjectUrlKey();
  const managedThumbnailUrl = mediaObjectUrlManager.get(mediaId, key);
  if (managedThumbnailUrl === thumbnailUrl) {
    mediaObjectUrlManager.revoke(mediaId, key);
    return;
  }

  URL.revokeObjectURL(thumbnailUrl);
}

export const createMediaThumbnailActions: MediaSliceCreator<Pick<FileManageActions, 'ensureFileThumbnail'>> = (
  set,
  get,
) => ({
  ensureFileThumbnail: async (id: string, options: { force?: boolean } = {}) => {
    const requestKey = options.force ? `${id}:force` : id;
    const existingRequest = activeThumbnailRequests.get(requestKey);
    if (existingRequest) return existingRequest;

    const request = (async () => {
      const mediaFile = get().files.find((f) => f.id === id);
      if (!mediaFile?.id || (!options.force && mediaFile.thumbnailUrl) || mediaFile.isImporting) {
        return Boolean(mediaFile?.thumbnailUrl);
      }
      if (mediaFile.type !== 'image' && mediaFile.type !== 'video') {
        return false;
      }

      let thumbnailUrl: string | undefined;

      try {
        if (!options.force && mediaFile.fileHash && projectFileService.isProjectOpen()) {
          const existingBlob = await projectFileService.getThumbnail(mediaFile.fileHash);
          if (existingBlob && existingBlob.size > 0) {
            thumbnailUrl = createThumbnailMediaObjectUrl(mediaFile.id, existingBlob);
            void projectDB.saveThumbnail({
              fileHash: mediaFile.fileHash,
              blob: existingBlob,
              createdAt: Date.now(),
            });
          }
        }

        if (!options.force && !thumbnailUrl && mediaFile.fileHash) {
          const storedThumbnail = await projectDB.getThumbnail(mediaFile.fileHash);
          if (storedThumbnail?.blob && storedThumbnail.blob.size > 0) {
            thumbnailUrl = createThumbnailMediaObjectUrl(mediaFile.id, storedThumbnail.blob);
            if (projectFileService.isProjectOpen()) {
              void projectFileService.saveThumbnail(mediaFile.fileHash, storedThumbnail.blob);
            }
          }
        }

        const sourceFile = !thumbnailUrl ? await resolveMediaFileSourceFile(mediaFile) : null;

        if (!thumbnailUrl && sourceFile) {
          const generatedThumbnail = await createThumbnail(sourceFile, mediaFile.type);
          thumbnailUrl = options.force
            ? await createManagedThumbnailUrl(mediaFile.id, generatedThumbnail)
            : await handleThumbnailDedup(mediaFile.fileHash, generatedThumbnail, mediaFile.id);

          if (options.force && thumbnailUrl && mediaFile.fileHash) {
            try {
              const response = await fetch(thumbnailUrl);
              const blob = await response.blob();
              if (blob.size > 0) {
                await projectDB.saveThumbnail({
                  fileHash: mediaFile.fileHash,
                  blob,
                  createdAt: Date.now(),
                });
                if (projectFileService.isProjectOpen()) {
                  await projectFileService.saveThumbnail(mediaFile.fileHash, blob);
                }
              }
            } catch (error) {
              log.warn('Failed to persist regenerated thumbnail', {
                id,
                name: mediaFile.name,
                error,
              });
            }
          }
        }

        if (!thumbnailUrl) {
          return false;
        }

        let applied = false;
        const oldThumbnailUrl = mediaFile.thumbnailUrl;
        set((state) => ({
          files: state.files.map((file) => {
            if (file.id !== id) return file;
            if (!options.force && file.thumbnailUrl) return file;
            applied = true;
            return { ...file, thumbnailUrl };
          }),
        }));

        if (applied && options.force && oldThumbnailUrl !== thumbnailUrl) {
          revokeThumbnailObjectUrl(id, oldThumbnailUrl);
        }
        if (!applied) {
          revokeThumbnailObjectUrl(id, thumbnailUrl);
        }

        return applied || Boolean(get().files.find((file) => file.id === id)?.thumbnailUrl);
      } catch (error) {
        log.warn('Failed to ensure media thumbnail', {
          id,
          name: mediaFile.name,
          error,
        });
        revokeThumbnailObjectUrl(id, thumbnailUrl);
        return false;
      }
    })().finally(() => {
      activeThumbnailRequests.delete(requestKey);
    });

    activeThumbnailRequests.set(requestKey, request);
    return request;
  },
});
