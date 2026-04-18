// File management actions - remove, rename, reload
// SIMPLIFIED: Uses RAW folder for easy relinking

import type { MediaSliceCreator, MediaState } from '../types';
import { projectFileService } from '../../../services/projectFileService';
import { fileSystemService } from '../../../services/fileSystemService';
import { projectDB } from '../../../services/projectDB';
import { useMediaStore } from '..';
import { useTimelineStore } from '../../timeline';
import { Logger } from '../../../services/logger';
import { engine } from '../../../engine/WebGPUEngine';
import { thumbnailCacheService } from '../../../services/thumbnailCacheService';
import { lottieRuntimeManager } from '../../../services/vectorAnimation/LottieRuntimeManager';
import { readLottieMetadata } from '../../../services/vectorAnimation/lottieMetadata';
import { createThumbnail } from '../helpers/thumbnailHelpers';
import { resolveGaussianSplatSequenceData } from '../../../utils/gaussianSplatSequence';

const log = Logger.create('Reload');
const isBlobUrl = (value?: string): value is string => typeof value === 'string' && value.startsWith('blob:');

export interface FileManageActions {
  removeFile: (id: string) => void;
  renameFile: (id: string, name: string) => void;
  refreshFileUrls: (id: string, options?: { refreshThumbnail?: boolean }) => Promise<boolean>;
  reloadFile: (id: string) => Promise<boolean>;
  reloadAllFiles: () => Promise<number>;
}

export const createFileManageSlice: MediaSliceCreator<FileManageActions> = (set, get) => ({
  removeFile: (id: string) => {
    const file = get().files.find((f) => f.id === id);
    if (file?.url) URL.revokeObjectURL(file.url);
    if (file?.thumbnailUrl?.startsWith('blob:')) URL.revokeObjectURL(file.thumbnailUrl);

    set((state) => ({
      files: state.files.filter((f) => f.id !== id),
      selectedIds: state.selectedIds.filter((sid) => sid !== id),
    }));
  },

  renameFile: (id: string, name: string) => {
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, name } : f)),
    }));
  },

  refreshFileUrls: async (id: string, options) => {
    const mediaFile = get().files.find((f) => f.id === id);
    if (!mediaFile) return false;

    if (!mediaFile.file) {
      return (get() as MediaState & FileManageActions).reloadFile(id);
    }

    const refreshThumbnail = options?.refreshThumbnail ?? true;
    const oldUrl = mediaFile.url;
    const oldThumbnailUrl = mediaFile.thumbnailUrl;
    const url = URL.createObjectURL(mediaFile.file);
    let thumbnailUrl = mediaFile.thumbnailUrl;

    if (refreshThumbnail) {
      if (mediaFile.type === 'image') {
        thumbnailUrl = URL.createObjectURL(mediaFile.file);
      } else if (mediaFile.type === 'video') {
        thumbnailUrl = await createThumbnail(mediaFile.file, 'video');
      }
    }

    set((state) => ({
      files: state.files.map((file) =>
        file.id === id
          ? { ...file, url, thumbnailUrl }
          : file
      ),
    }));

    if (isBlobUrl(oldUrl)) {
      URL.revokeObjectURL(oldUrl);
    }

    if (refreshThumbnail && isBlobUrl(oldThumbnailUrl) && oldThumbnailUrl !== oldUrl) {
      URL.revokeObjectURL(oldThumbnailUrl);
    }

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

    // Revoke old URL
    if (mediaFile.url) URL.revokeObjectURL(mediaFile.url);

    // Create new URL
    const url = URL.createObjectURL(file);

    // Update store
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id ? { ...f, file, url, hasFileHandle: true } : f
      ),
    }));

    // Update timeline clips
    await updateTimelineClips(id, file);

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

      if (mediaFileToReload.url) URL.revokeObjectURL(mediaFileToReload.url);
      const url = URL.createObjectURL(file);

      set((state) => ({
        files: state.files.map((f) =>
          f.id === mediaFileToReload.id ? { ...f, file, url, hasFileHandle: true } : f
        ),
      }));

      await updateTimelineClips(mediaFileToReload.id, file);
      totalReloaded++;
    }

    log.info(`Complete: ${totalReloaded} files reloaded`);
    return totalReloaded;
  },
});

/**
 * Update timeline clips with reloaded file.
 * Creates the actual video/audio elements for the clip sources.
 * Exported for use by projectSync auto-relink.
 */
export async function updateTimelineClips(mediaFileId: string, file: File): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const mediaFile = useMediaStore.getState().files.find((entry) => entry.id === mediaFileId);
  const clips = timelineStore.clips.filter(
    c => c.source?.mediaFileId === mediaFileId && c.needsReload
  );

  if (clips.length === 0) {
    // Debug: check if there are clips that need reload but with different mediaFileId
    const allNeedReload = timelineStore.clips.filter(c => c.needsReload);
    if (allNeedReload.length > 0) {
      log.debug(`No clips matched for mediaFileId ${mediaFileId}, but ${allNeedReload.length} clips need reload`, {
        mediaFileId,
        clipMediaIds: allNeedReload.map(c => c.source?.mediaFileId).slice(0, 5),
      });
    }
    return;
  }

  const url = URL.createObjectURL(file);

  for (const clip of clips) {
    const sourceType = clip.source?.type;

    if (sourceType === 'video') {
      // Create video element
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';

      video.addEventListener('canplaythrough', () => {
        const naturalDuration = video.duration || clip.duration;
        timelineStore.updateClip(clip.id, {
          file,
          needsReload: false,
          isLoading: false,
          source: {
            type: 'video',
            videoElement: video,
            naturalDuration,
            mediaFileId,
          },
        });
        // Pre-cache frame via createImageBitmap for immediate scrubbing without play()
        engine.preCacheVideoFrame(video);
        void thumbnailCacheService.generateForSource(mediaFileId, video, naturalDuration);
      }, { once: true });

      video.addEventListener('error', () => {
        log.warn('Failed to load video for clip:', clip.name);
        timelineStore.updateClip(clip.id, {
          needsReload: false,
          isLoading: false,
        });
      }, { once: true });

      video.load();
    } else if (sourceType === 'audio') {
      // Create audio element
      const audio = document.createElement('audio');
      audio.src = url;
      audio.preload = 'auto';

      audio.addEventListener('canplaythrough', () => {
        const naturalDuration = audio.duration || clip.duration;
        timelineStore.updateClip(clip.id, {
          file,
          needsReload: false,
          isLoading: false,
          source: {
            type: 'audio',
            audioElement: audio,
            naturalDuration,
            mediaFileId,
          },
        });
      }, { once: true });

      audio.addEventListener('error', () => {
        log.warn('Failed to load audio for clip:', clip.name);
        timelineStore.updateClip(clip.id, {
          needsReload: false,
          isLoading: false,
        });
      }, { once: true });

      audio.load();
    } else if (sourceType === 'image') {
      // Create image element
      const img = new Image();
      img.src = url;
      img.crossOrigin = 'anonymous';

      img.addEventListener('load', () => {
        timelineStore.updateClip(clip.id, {
          file,
          needsReload: false,
          isLoading: false,
          source: {
            type: 'image',
            imageElement: img,
            mediaFileId,
          },
        });
      }, { once: true });

      img.addEventListener('error', () => {
        log.warn('Failed to load image for clip:', clip.name);
        timelineStore.updateClip(clip.id, {
          needsReload: false,
          isLoading: false,
        });
      }, { once: true });
    } else if (sourceType === 'lottie') {
      try {
        const metadata = await readLottieMetadata(file);
        const runtime = await lottieRuntimeManager.prepareClipSource({
          ...clip,
          file,
          source: {
            ...clip.source!,
            textCanvas: clip.source?.textCanvas,
          },
        }, file);

        timelineStore.updateClip(clip.id, {
          file,
          needsReload: false,
          isLoading: false,
          source: {
            ...clip.source!,
            type: 'lottie',
            textCanvas: runtime.canvas,
            naturalDuration: metadata.duration ?? clip.duration,
            mediaFileId,
          },
        });
      } catch (error) {
        log.warn('Failed to reload lottie for clip', { clipName: clip.name, error });
        timelineStore.updateClip(clip.id, {
          needsReload: false,
          isLoading: false,
        });
      }
    } else if (sourceType === 'model') {
      // 3D Model — create blob URL for Three.js loader
      const modelUrl = URL.createObjectURL(file);
      timelineStore.updateClip(clip.id, {
        file,
        needsReload: false,
        isLoading: false,
        source: {
          ...clip.source!,
          modelUrl,
        },
      });
    } else if (sourceType === 'gaussian-avatar') {
      // Gaussian avatar — create blob URL for the renderer
      const gaussianAvatarUrl = URL.createObjectURL(file);
      timelineStore.updateClip(clip.id, {
        file,
        needsReload: false,
        isLoading: false,
        source: {
          ...clip.source!,
          gaussianAvatarUrl,
          gaussianBlendshapes: clip.source?.gaussianBlendshapes || {},
        },
      });
    } else if (sourceType === 'gaussian-splat') {
      // Gaussian splat — create blob URL for the renderer
      const gaussianSplatSequence = resolveGaussianSplatSequenceData(
        clip.source?.gaussianSplatSequence,
        mediaFile?.gaussianSplatSequence,
      );
      const firstFrame = gaussianSplatSequence?.frames[0];
      const gaussianSplatUrl = firstFrame?.splatUrl ?? URL.createObjectURL(file);
      timelineStore.updateClip(clip.id, {
        file,
        needsReload: false,
        isLoading: false,
        source: {
          ...clip.source!,
          gaussianSplatUrl,
          gaussianSplatFileName: firstFrame?.name ?? file.name,
          gaussianSplatRuntimeKey:
            firstFrame?.projectPath ??
            firstFrame?.absolutePath ??
            firstFrame?.sourcePath ??
            firstFrame?.name,
          gaussianSplatSequence,
          gaussianSplatSettings: clip.source?.gaussianSplatSettings,
        },
      });
    } else {
      // Unknown type - just update the file reference
      timelineStore.updateClip(clip.id, {
        file,
        needsReload: false,
        isLoading: false,
      });
    }
  }

  log.debug(`Updated ${clips.length} timeline clips`);
}
