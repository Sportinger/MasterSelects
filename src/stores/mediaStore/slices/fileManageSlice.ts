// File management actions - remove, rename, reload
// SIMPLIFIED: Uses RAW folder for easy relinking

import type { Composition, MediaFile, MediaSliceCreator, MediaState } from '../types';
import type { CompositionTimelineData, SerializableClip, TimelineClip } from '../../../types';
import { projectFileService } from '../../../services/projectFileService';
import { fileSystemService } from '../../../services/fileSystemService';
import { projectDB } from '../../../services/projectDB';
import { useMediaStore } from '..';
import { useTimelineStore } from '../../timeline';
import { Logger } from '../../../services/logger';
import { engine } from '../../../engine/WebGPUEngine';
import { thumbnailCacheService } from '../../../services/thumbnailCacheService';
import { vectorAnimationRuntimeManager } from '../../../services/vectorAnimation/VectorAnimationRuntimeManager';
import { readLottieMetadata } from '../../../services/vectorAnimation/lottieMetadata';
import { readRiveMetadata } from '../../../services/vectorAnimation/riveMetadata';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';
import { createThumbnail, handleThumbnailDedup } from '../helpers/thumbnailHelpers';
import { resolveGaussianSplatSequenceData } from '../../../utils/gaussianSplatSequence';
import { compositionRenderer } from '../../../services/compositionRenderer';
import { collectAudioAnalysisArtifactIdsFromRefs } from '../../../services/audio/projectAudioState';
import { blobUrlManager } from '../../timeline/helpers/blobUrlManager';

const log = Logger.create('Reload');
const isBlobUrl = (value?: string): value is string => typeof value === 'string' && value.startsWith('blob:');
const activeThumbnailRequests = new Map<string, Promise<boolean>>();

export interface FileManageActions {
  removeFile: (id: string) => void;
  getMediaFileUsages: (ids: string[]) => MediaFileUsageSummary[];
  deleteMediaFilesEverywhere: (ids: string[]) => Promise<DeleteMediaFilesEverywhereResult>;
  renameFile: (id: string, name: string) => void;
  removeSignalAsset: (id: string) => void;
  renameSignalAsset: (id: string, name: string) => void;
  ensureFileThumbnail: (id: string) => Promise<boolean>;
  refreshFileUrls: (id: string, options?: { refreshThumbnail?: boolean }) => Promise<boolean>;
  reloadFile: (id: string) => Promise<boolean>;
  reloadAllFiles: () => Promise<number>;
}

export interface MediaFileCompositionUsage {
  compositionId: string;
  compositionName: string;
  clipCount: number;
}

export interface MediaFileUsageSummary {
  mediaFileId: string;
  mediaFileName: string;
  clipCount: number;
  compositions: MediaFileCompositionUsage[];
}

export interface DeleteMediaFilesEverywhereResult {
  deletedMediaFileIds: string[];
  removedClipCount: number;
  usages: MediaFileUsageSummary[];
  artifactFailures: string[];
}

type ClipWithMediaReference = {
  id: string;
  name?: string;
  mediaFileId?: string;
  file?: File;
  sourceType?: string;
  source?: {
    mediaFileId?: string;
    file?: File;
    filePath?: string;
    runtimeSourceId?: string;
    modelUrl?: string;
    gaussianAvatarUrl?: string;
    gaussianSplatUrl?: string;
    gaussianSplatFileName?: string;
    gaussianSplatFileHash?: string;
    gaussianSplatRuntimeKey?: string;
    videoElement?: HTMLVideoElement;
    audioElement?: HTMLAudioElement;
    imageElement?: HTMLImageElement;
  } | null;
};

function getClipMediaFileId(clip: ClipWithMediaReference): string | undefined {
  return clip.mediaFileId || clip.source?.mediaFileId;
}

function normalizeMediaReference(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
  return normalized || undefined;
}

function getBaseName(value: string | undefined): string | undefined {
  const normalized = normalizeMediaReference(value);
  if (!normalized) return undefined;
  return normalized.split('/').filter(Boolean).pop();
}

function addComparableString(target: Set<string>, value: string | undefined): void {
  const normalized = normalizeMediaReference(value);
  if (!normalized) return;
  target.add(normalized);
}

function pathReferencesMatch(a: string, b: string): boolean {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

interface MediaFileDeleteTarget {
  id: string;
  file?: File;
  fileHash?: string;
  references: Set<string>;
  uniqueNames: Set<string>;
}

interface MediaFileDeleteMatcher {
  targetIds: Set<string>;
  matchClip: (clip: ClipWithMediaReference) => string | undefined;
}

function createMediaFileDeleteMatcher(targetFiles: MediaFile[], allFiles: MediaFile[]): MediaFileDeleteMatcher {
  const targetIds = new Set(targetFiles.map(file => file.id));
  const fileNameCounts = new Map<string, number>();

  for (const file of allFiles) {
    const names = [
      normalizeMediaReference(file.name),
      getBaseName(file.projectPath),
      getBaseName(file.filePath),
      getBaseName(file.absolutePath),
    ].filter((value): value is string => Boolean(value));

    for (const name of new Set(names)) {
      fileNameCounts.set(name, (fileNameCounts.get(name) ?? 0) + 1);
    }
  }

  const targets: MediaFileDeleteTarget[] = targetFiles.map((file) => {
    const references = new Set<string>();
    const uniqueNames = new Set<string>();
    addComparableString(references, file.projectPath);
    addComparableString(references, file.filePath);
    addComparableString(references, file.absolutePath);
    addComparableString(references, file.url);
    addComparableString(references, file.thumbnailUrl);
    addComparableString(references, file.proxyVideoUrl);

    for (const name of [
      normalizeMediaReference(file.name),
      getBaseName(file.projectPath),
      getBaseName(file.filePath),
      getBaseName(file.absolutePath),
    ]) {
      if (name && fileNameCounts.get(name) === 1) {
        uniqueNames.add(name);
      }
    }

    return {
      id: file.id,
      file: file.file,
      fileHash: file.fileHash,
      references,
      uniqueNames,
    };
  });

  const matchClip = (clip: ClipWithMediaReference): string | undefined => {
    const directMediaFileId = getClipMediaFileId(clip);
    if (directMediaFileId && targetIds.has(directMediaFileId)) {
      return directMediaFileId;
    }

    const clipSource = clip.source;
    const clipFiles = [clip.file, clipSource?.file].filter((file): file is File => Boolean(file));
    const clipReferences = [
      clipSource?.filePath,
      clipSource?.runtimeSourceId,
      clipSource?.modelUrl,
      clipSource?.gaussianAvatarUrl,
      clipSource?.gaussianSplatUrl,
      clipSource?.gaussianSplatRuntimeKey,
      clipSource?.videoElement?.currentSrc || clipSource?.videoElement?.src,
      clipSource?.audioElement?.currentSrc || clipSource?.audioElement?.src,
      clipSource?.imageElement?.currentSrc || clipSource?.imageElement?.src,
    ]
      .map(normalizeMediaReference)
      .filter((value): value is string => Boolean(value));
    const clipNames = [
      clip.name,
      clip.file?.name,
      clipSource?.file?.name,
      clipSource?.gaussianSplatFileName,
      getBaseName(clipSource?.filePath),
      getBaseName(clipSource?.runtimeSourceId),
      getBaseName(clipSource?.gaussianSplatRuntimeKey),
    ]
      .map(normalizeMediaReference)
      .filter((value): value is string => Boolean(value));

    for (const target of targets) {
      if (target.file && clipFiles.some(file => file === target.file)) {
        return target.id;
      }

      if (target.fileHash && clipSource?.gaussianSplatFileHash === target.fileHash) {
        return target.id;
      }

      if (clipReferences.some(clipReference =>
        [...target.references].some(targetReference => pathReferencesMatch(clipReference, targetReference))
      )) {
        return target.id;
      }

      if (clipNames.some(name => target.uniqueNames.has(name))) {
        return target.id;
      }
    }

    return undefined;
  };

  return { targetIds, matchClip };
}

function getCompositionClipsForUsage(
  composition: Composition,
  activeCompositionId: string | null,
  activeTimelineClips: TimelineClip[],
): ClipWithMediaReference[] {
  if (composition.id === activeCompositionId && activeTimelineClips.length > 0) {
    return activeTimelineClips;
  }
  return composition.timelineData?.clips ?? [];
}

export function collectMediaFileUsages(
  ids: string[],
  files: MediaFile[],
  compositions: Composition[],
  activeCompositionId: string | null,
  activeTimelineClips: TimelineClip[] = useTimelineStore.getState().clips,
): MediaFileUsageSummary[] {
  const targetIds = new Set(ids);
  const targetFiles = files.filter(file => targetIds.has(file.id));
  const matcher = createMediaFileDeleteMatcher(targetFiles, files);
  const summaries = new Map<string, MediaFileUsageSummary>();
  const mediaFileNames = new Map(files.map(file => [file.id, file.name]));

  for (const id of targetIds) {
    summaries.set(id, {
      mediaFileId: id,
      mediaFileName: mediaFileNames.get(id) ?? id,
      clipCount: 0,
      compositions: [],
    });
  }

  for (const composition of compositions) {
    const clips = getCompositionClipsForUsage(composition, activeCompositionId, activeTimelineClips);
    const counts = new Map<string, number>();

    for (const clip of clips) {
      const mediaFileId = matcher.matchClip(clip);
      if (!mediaFileId || !targetIds.has(mediaFileId)) {
        continue;
      }
      counts.set(mediaFileId, (counts.get(mediaFileId) ?? 0) + 1);
    }

    for (const [mediaFileId, clipCount] of counts) {
      const summary = summaries.get(mediaFileId);
      if (!summary) continue;
      summary.clipCount += clipCount;
      summary.compositions.push({
        compositionId: composition.id,
        compositionName: composition.name,
        clipCount,
      });
    }
  }

  return [...summaries.values()].filter(summary => summary.clipCount > 0);
}

function revokeMediaFileUrls(file: MediaFile): void {
  if (isBlobUrl(file.url)) URL.revokeObjectURL(file.url);
  if (isBlobUrl(file.thumbnailUrl) && file.thumbnailUrl !== file.url) {
    URL.revokeObjectURL(file.thumbnailUrl);
  }
  if (isBlobUrl(file.proxyVideoUrl) && file.proxyVideoUrl !== file.url && file.proxyVideoUrl !== file.thumbnailUrl) {
    URL.revokeObjectURL(file.proxyVideoUrl);
  }
}

function cleanupTimelineClipResources(clip: TimelineClip): void {
  if (clip.source?.type === 'video' && clip.source.videoElement) {
    const video = clip.source.videoElement;
    video.pause();
    video.src = '';
    video.load();
    engine.cleanupVideo(video);
  }

  if (clip.source?.type === 'audio' && clip.source.audioElement) {
    const audio = clip.source.audioElement;
    audio.pause();
    audio.src = '';
    audio.load();
  }

  if (clip.mixdownAudio) {
    clip.mixdownAudio.pause();
    clip.mixdownAudio.src = '';
    clip.mixdownAudio.load();
  }

  if (isVectorAnimationSourceType(clip.source?.type)) {
    vectorAnimationRuntimeManager.destroyClipRuntime(clip.id, clip.source.type);
  }

  blobUrlManager.revokeAll(clip.id);
}

function clearRemovedClipLinks<T extends { linkedClipId?: string }>(clip: T, removedClipIds: Set<string>): T {
  if (clip.linkedClipId && removedClipIds.has(clip.linkedClipId)) {
    return { ...clip, linkedClipId: undefined };
  }
  return clip;
}

function removeActiveTimelineClipsByMediaMatcher(matcher: MediaFileDeleteMatcher): Set<string> {
  const timelineStore = useTimelineStore.getState();
  const clipsToRemove = timelineStore.clips.filter(clip => Boolean(matcher.matchClip(clip)));
  const removedClipIds = new Set(clipsToRemove.map(clip => clip.id));

  if (removedClipIds.size === 0) {
    return removedClipIds;
  }

  for (const clip of clipsToRemove) {
    cleanupTimelineClipResources(clip);
  }

  const removedKeyframeIds = new Set<string>();
  const nextClipKeyframes = new Map(timelineStore.clipKeyframes);
  for (const clipId of removedClipIds) {
    for (const keyframe of nextClipKeyframes.get(clipId) ?? []) {
      removedKeyframeIds.add(keyframe.id);
    }
    nextClipKeyframes.delete(clipId);
  }

  useTimelineStore.setState({
    clips: timelineStore.clips
      .filter(clip => !removedClipIds.has(clip.id))
      .map(clip => clearRemovedClipLinks(clip, removedClipIds)),
    layers: timelineStore.layers.filter(layer => !layer || !removedClipIds.has(layer.id)),
    selectedLayerId: timelineStore.selectedLayerId && removedClipIds.has(timelineStore.selectedLayerId)
      ? null
      : timelineStore.selectedLayerId,
    selectedClipIds: new Set([...timelineStore.selectedClipIds].filter(id => !removedClipIds.has(id))),
    primarySelectedClipId: timelineStore.primarySelectedClipId && removedClipIds.has(timelineStore.primarySelectedClipId)
      ? null
      : timelineStore.primarySelectedClipId,
    clipKeyframes: nextClipKeyframes,
    selectedKeyframeIds: new Set([...timelineStore.selectedKeyframeIds].filter(id => !removedKeyframeIds.has(id))),
    keyframeRecordingEnabled: new Set(
      [...timelineStore.keyframeRecordingEnabled].filter(key =>
        ![...removedClipIds].some(clipId => key.startsWith(`${clipId}:`))
      )
    ),
  });

  const nextTimelineStore = useTimelineStore.getState();
  nextTimelineStore.updateDuration();
  nextTimelineStore.invalidateCache();

  return removedClipIds;
}

function removeMediaClipsFromTimelineData(
  timelineData: CompositionTimelineData | undefined,
  matcher: MediaFileDeleteMatcher,
): { timelineData: CompositionTimelineData | undefined; removedClipIds: Set<string> } {
  const removedClipIds = new Set<string>();
  if (!timelineData) {
    return { timelineData, removedClipIds };
  }

  for (const clip of timelineData.clips) {
    if (matcher.matchClip(clip)) {
      removedClipIds.add(clip.id);
    }
  }

  if (removedClipIds.size === 0) {
    return { timelineData, removedClipIds };
  }

  const clips = timelineData.clips
    .filter(clip => !removedClipIds.has(clip.id))
    .map(clip => clearRemovedClipLinks(clip, removedClipIds)) as SerializableClip[];

  return {
    timelineData: { ...timelineData, clips },
    removedClipIds,
  };
}

function removeMediaClipsFromAllCompositions(
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  get: () => MediaState,
  matcher: MediaFileDeleteMatcher,
): { removedClipIds: Set<string>; changedCompositionIds: Set<string> } {
  const removedClipIds = removeActiveTimelineClipsByMediaMatcher(matcher);
  const changedCompositionIds = new Set<string>();
  const activeCompositionId = get().activeCompositionId;
  const activeTimelineData = activeCompositionId && removedClipIds.size > 0
    ? useTimelineStore.getState().getSerializableState()
    : null;

  set((state) => ({
    compositions: state.compositions.map((composition) => {
      if (composition.id === activeCompositionId && activeTimelineData) {
        changedCompositionIds.add(composition.id);
        return {
          ...composition,
          duration: activeTimelineData.duration,
          timelineData: activeTimelineData,
        };
      }

      const result = removeMediaClipsFromTimelineData(composition.timelineData, matcher);
      if (result.removedClipIds.size === 0) {
        return composition;
      }

      for (const clipId of result.removedClipIds) {
        removedClipIds.add(clipId);
      }
      changedCompositionIds.add(composition.id);
      return {
        ...composition,
        timelineData: result.timelineData,
      };
    }),
  }));

  for (const compositionId of changedCompositionIds) {
    compositionRenderer.invalidateCompositionAndParents(compositionId);
  }

  return { removedClipIds, changedCompositionIds };
}

async function cleanupIndexedDbMediaArtifacts(file: MediaFile, options?: { deleteHashArtifacts?: boolean }): Promise<void> {
  const proxyKeys = [...new Set([
    file.id,
    options?.deleteHashArtifacts === false ? undefined : file.fileHash,
  ].filter((key): key is string => Boolean(key)))];
  const cleanupTasks: Promise<unknown>[] = [
    projectDB.deleteMediaFile(file.id),
    projectDB.deleteAnalysis(file.id),
    projectDB.deleteSourceThumbnails(file.id),
    projectDB.deleteHandle(`media_${file.id}`),
    ...proxyKeys.map(key => projectDB.deleteProxyFrames(key)),
  ];

  if (file.fileHash && options?.deleteHashArtifacts !== false) {
    cleanupTasks.push(projectDB.deleteThumbnail(file.fileHash));
  }

  await Promise.allSettled(cleanupTasks);
}

export const createFileManageSlice: MediaSliceCreator<FileManageActions> = (set, get) => ({
  removeFile: (id: string) => {
    const file = get().files.find((f) => f.id === id);
    if (file) {
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
    const matcher = createMediaFileDeleteMatcher(filesToDelete, state.files);
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
    const artifactFailures: string[] = [];
    for (const file of filesToDelete) {
      const rawPathIsShared = Boolean(
        file.projectPath && remainingFiles.some(remaining => remaining.projectPath === file.projectPath)
      );
      const fileHashIsShared = Boolean(
        file.fileHash && remainingFiles.some(remaining => remaining.fileHash === file.fileHash)
      );
      const artifactResult = await projectFileService.deleteMediaFileArtifacts({
        mediaId: file.id,
        projectPath: rawPathIsShared ? undefined : file.projectPath,
        fileHash: fileHashIsShared ? undefined : file.fileHash,
        audioArtifactRefs: collectAudioAnalysisArtifactIdsFromRefs(file.audioAnalysisRefs),
      });

      artifactFailures.push(...artifactResult.failed);
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

  renameFile: (id: string, name: string) => {
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, name } : f)),
    }));
  },

  removeSignalAsset: (id: string) => {
    set((state) => ({
      signalAssets: state.signalAssets.filter((item) => item.id !== id),
      selectedIds: state.selectedIds.filter((sid) => sid !== id),
    }));
  },

  renameSignalAsset: (id: string, name: string) => {
    set((state) => ({
      signalAssets: state.signalAssets.map((item) => (
        item.id === id
          ? {
              ...item,
              name,
              asset: {
                ...item.asset,
                name,
                updatedAt: new Date().toISOString(),
              },
            }
          : item
      )),
    }));
  },

  ensureFileThumbnail: async (id: string) => {
    const existingRequest = activeThumbnailRequests.get(id);
    if (existingRequest) return existingRequest;

    const request = (async () => {
      const mediaFile = get().files.find((f) => f.id === id);
      if (!mediaFile?.id || mediaFile.thumbnailUrl || mediaFile.isImporting) {
        return Boolean(mediaFile?.thumbnailUrl);
      }
      if (mediaFile.type !== 'image' && mediaFile.type !== 'video') {
        return false;
      }

      let thumbnailUrl: string | undefined;

      try {
        if (mediaFile.fileHash && projectFileService.isProjectOpen()) {
          const existingBlob = await projectFileService.getThumbnail(mediaFile.fileHash);
          if (existingBlob && existingBlob.size > 0) {
            thumbnailUrl = URL.createObjectURL(existingBlob);
            void projectDB.saveThumbnail({
              fileHash: mediaFile.fileHash,
              blob: existingBlob,
              createdAt: Date.now(),
            });
          }
        }

        if (!thumbnailUrl && mediaFile.fileHash) {
          const storedThumbnail = await projectDB.getThumbnail(mediaFile.fileHash);
          if (storedThumbnail?.blob && storedThumbnail.blob.size > 0) {
            thumbnailUrl = URL.createObjectURL(storedThumbnail.blob);
            if (projectFileService.isProjectOpen()) {
              void projectFileService.saveThumbnail(mediaFile.fileHash, storedThumbnail.blob);
            }
          }
        }

        let sourceFile = mediaFile.file;
        if (!thumbnailUrl && !sourceFile && mediaFile.projectPath && projectFileService.isProjectOpen()) {
          const result = await projectFileService.getFileFromRaw(mediaFile.projectPath);
          sourceFile = result?.file;
        }

        if (!thumbnailUrl && sourceFile) {
          const generatedThumbnail = await createThumbnail(sourceFile, mediaFile.type);
          thumbnailUrl = await handleThumbnailDedup(mediaFile.fileHash, generatedThumbnail);
        }

        if (!thumbnailUrl) {
          return false;
        }

        let applied = false;
        set((state) => ({
          files: state.files.map((file) => {
            if (file.id !== id) return file;
            if (file.thumbnailUrl) return file;
            applied = true;
            return { ...file, thumbnailUrl };
          }),
        }));

        if (!applied && isBlobUrl(thumbnailUrl)) {
          URL.revokeObjectURL(thumbnailUrl);
        }

        return applied || Boolean(get().files.find((file) => file.id === id)?.thumbnailUrl);
      } catch (error) {
        log.warn('Failed to ensure media thumbnail', {
          id,
          name: mediaFile.name,
          error,
        });
        if (thumbnailUrl && isBlobUrl(thumbnailUrl)) {
          URL.revokeObjectURL(thumbnailUrl);
        }
        return false;
      }
    })().finally(() => {
      activeThumbnailRequests.delete(id);
    });

    activeThumbnailRequests.set(id, request);
    return request;
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
        thumbnailUrl = await createThumbnail(mediaFile.file, 'image');
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
    } else if (isVectorAnimationSourceType(sourceType)) {
      try {
        const metadata = sourceType === 'lottie'
          ? await readLottieMetadata(file)
          : await readRiveMetadata(file);
        const runtime = await vectorAnimationRuntimeManager.prepareClipSource({
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
            type: sourceType,
            textCanvas: runtime.canvas,
            naturalDuration: metadata.duration ?? clip.duration,
            mediaFileId,
          },
        });
      } catch (error) {
        log.warn('Failed to reload vector animation for clip', { clipName: clip.name, sourceType, error });
        timelineStore.updateClip(clip.id, {
          needsReload: false,
          isLoading: false,
        });
      }
    } else if (sourceType === 'model') {
      // 3D Model — create blob URL for the shared scene loader
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
