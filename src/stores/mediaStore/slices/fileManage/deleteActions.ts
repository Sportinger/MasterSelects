import type { MediaSliceCreator } from '../../types';
import { thumbnailCacheService } from '../../../../services/thumbnailCacheService';
import {
  collectTimelineAudioCacheRefsFromClips,
  invalidateTimelineMediaCaches,
} from '../../../../services/timeline/timelineCacheInvalidation';
import { useTimelineStore } from '../../../timeline';
import type { FileManageActions } from '../fileManageSlice';
import { createMediaFileDeleteMatcher } from './mediaReferenceMatcher';
import {
  collectMediaClipsByMatcherForCacheInvalidation,
  collectMediaFileUsages,
  type MediaFileUsageSummary,
} from './mediaUsagePlanner';
import {
  cleanupIndexedDbMediaArtifacts,
  removeMediaClipsFromAllCompositions,
  revokeMediaFileUrls,
} from './deleteRuntimeCleanup';
import { liveInputRuntime } from '../../../../services/mediaRuntime/liveInputRuntime';

export interface DeleteMediaFilesEverywhereResult {
  deletedMediaFileIds: string[];
  removedClipCount: number;
  usages: MediaFileUsageSummary[];
  artifactFailures: string[];
}

export const createFileDeleteActions: MediaSliceCreator<Pick<
  FileManageActions,
  'removeFile' | 'getMediaFileUsages' | 'deleteMediaFilesEverywhere'
>> = (set, get) => ({
  removeFile: (id: string) => {
    const file = get().files.find((f) => f.id === id);
    if (file) {
      if (file.liveInput) liveInputRuntime.release(id);
      thumbnailCacheService.evictFromMemory(id);
      revokeMediaFileUrls(file);
    }

    set((state) => ({
      files: state.files.filter((f) => f.id !== id),
      selectedIds: state.selectedIds.filter((sid) => sid !== id),
    }));
  },

  getMediaFileUsages: (ids: string[]) => {
    const state = get();
    return collectMediaFileUsages(
      ids,
      state.files,
      state.compositions,
      state.activeCompositionId,
    );
  },

  deleteMediaFilesEverywhere: async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)];
    const mediaFileIds = new Set(uniqueIds);
    const state = get();
    const filesToDelete = state.files.filter(file => mediaFileIds.has(file.id));
    filesToDelete.forEach((file) => {
      if (file.liveInput) liveInputRuntime.release(file.id);
    });
    const matcher = createMediaFileDeleteMatcher(filesToDelete, state.files);
    const clipsByMediaFileId = collectMediaClipsByMatcherForCacheInvalidation(
      filesToDelete,
      state.compositions,
      state.activeCompositionId,
      useTimelineStore.getState().clips,
      matcher,
    );
    const usages = collectMediaFileUsages(
      filesToDelete.map(file => file.id),
      state.files,
      state.compositions,
      state.activeCompositionId,
    );

    if (filesToDelete.length === 0) {
      return {
        deletedMediaFileIds: [],
        removedClipCount: 0,
        usages,
        artifactFailures: [],
      };
    }

    const { removedClipIds } = removeMediaClipsFromAllCompositions(
      set,
      get,
      matcher,
    );

    const deletedIds = new Set(filesToDelete.map(file => file.id));
    const remainingFiles = get().files.filter(file => !deletedIds.has(file.id));
    // Removing media from a project must never delete files from disk. This
    // includes project-local RAW copies and generated project-folder artifacts;
    // they are intentionally left in place so Media Panel deletion is always
    // non-destructive outside the project model.
    const artifactFailures: string[] = [];
    for (const file of filesToDelete) {
      const fileHashIsShared = Boolean(
        file.fileHash && remainingFiles.some(remaining => remaining.fileHash === file.fileHash)
      );
      const cacheClips = clipsByMediaFileId.get(file.id) ?? [];
      await invalidateTimelineMediaCaches({
        reason: 'media-delete',
        mediaFileId: file.id,
        ...(file.fileHash ? { fileHash: file.fileHash } : {}),
        clipIds: cacheClips.map(clip => clip.id).filter((id): id is string => Boolean(id)),
        sourceAudioAnalysisRefs: file.audioAnalysisRefs,
        explicitAudioRefs: collectTimelineAudioCacheRefsFromClips(cacheClips),
        preserveSharedFileHashArtifacts: fileHashIsShared,
      });
      await cleanupIndexedDbMediaArtifacts(file, { deleteHashArtifacts: !fileHashIsShared });
      revokeMediaFileUrls(file);
    }

    set((current) => ({
      files: current.files.filter(file => !deletedIds.has(file.id)),
      selectedIds: current.selectedIds.filter(id => !deletedIds.has(id)),
      sourceMonitorFileId: current.sourceMonitorFileId && deletedIds.has(current.sourceMonitorFileId)
        ? null
        : current.sourceMonitorFileId,
      sourceMonitorInPoint: current.sourceMonitorFileId && deletedIds.has(current.sourceMonitorFileId)
        ? null
        : current.sourceMonitorInPoint,
      sourceMonitorOutPoint: current.sourceMonitorFileId && deletedIds.has(current.sourceMonitorFileId)
        ? null
        : current.sourceMonitorOutPoint,
      sourceMonitorPlaybackRequestId: current.sourceMonitorFileId && deletedIds.has(current.sourceMonitorFileId)
        ? current.sourceMonitorPlaybackRequestId + 1
        : current.sourceMonitorPlaybackRequestId,
    }));

    return {
      deletedMediaFileIds: [...deletedIds],
      removedClipCount: removedClipIds.size,
      usages,
      artifactFailures,
    };
  },
});
