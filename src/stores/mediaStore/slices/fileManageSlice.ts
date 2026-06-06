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
import { clearAINodeRuntimeCacheForClip } from '../../../services/nodeGraph';
import { calculateFileHash } from '../helpers/fileHashHelpers';
import { createThumbnail, handleThumbnailDedup } from '../helpers/thumbnailHelpers';
import {
  startMediaFileWaveformGeneration,
} from '../helpers/mediaWaveformHelpers';
import { resolveGaussianSplatSequenceData } from '../../../utils/gaussianSplatSequence';
import { compositionRenderer } from '../../../services/compositionRenderer';
import { collectAudioAnalysisArtifactIdsFromRefs } from '../../../services/audio/projectAudioState';
import { blobUrlManager } from '../../timeline/helpers/blobUrlManager';
import { audioExtractor } from '../../../engine/audio/AudioExtractor';
import {
  createFileAudioSourceFingerprint,
} from '../../../services/audio/ProcessedWaveformPyramidService';
import { SpectrogramTileSetGenerator } from '../../../services/audio/SpectrogramTileSetGenerator';
import { createCurrentAudioArtifactStore } from '../../../services/audio/timelineWaveformPyramidCache';
import {
  primeTimelineSpectrogramTileSetCache,
  readTimelineSpectrogramTileSet,
} from '../../../services/audio/timelineSpectrogramCache';
import {
  getModelSequenceFrameUrl,
  resolveModelSequenceData,
} from '../../../utils/modelSequence';
import {
  collectTimelineAudioCacheRefsFromClips,
  invalidateTimelineMediaCaches,
  type TimelineAudioCacheRefClip,
} from '../../../services/timeline/timelineCacheInvalidation';
import {
  createPrimaryMediaObjectUrl,
  createThumbnailMediaObjectUrl,
  getThumbnailMediaObjectUrlKey,
  mediaObjectUrlManager,
  revokeMediaFileObjectUrls,
} from '../../../services/project/mediaObjectUrlManager';

const log = Logger.create('Reload');
const isBlobUrl = (value?: string): value is string => typeof value === 'string' && value.startsWith('blob:');
const activeThumbnailRequests = new Map<string, Promise<boolean>>();
const activeMediaSpectrogramJobs = new Map<string, Promise<void>>();

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

export type MediaSourceReplacementPatch = Partial<Pick<
  MediaFile,
  | 'fileHash'
  | 'thumbnailUrl'
  | 'audioAnalysisRefs'
  | 'waveform'
  | 'waveformChannels'
  | 'waveformStatus'
  | 'waveformProgress'
  | 'proxyStatus'
  | 'proxyProgress'
  | 'proxyFrameCount'
  | 'proxyFps'
  | 'proxyFormat'
  | 'proxyVideoUrl'
  | 'hasProxyAudio'
  | 'audioProxyStatus'
  | 'audioProxyProgress'
  | 'audioProxyStorageKey'
  | 'audioProxyUrl'
>>;

export function createMediaSourceReplacementResetPatch(fileHash?: string): MediaSourceReplacementPatch {
  return {
    fileHash,
    thumbnailUrl: undefined,
    audioAnalysisRefs: undefined,
    waveform: undefined,
    waveformChannels: undefined,
    waveformStatus: 'idle',
    waveformProgress: undefined,
    proxyStatus: undefined,
    proxyProgress: undefined,
    proxyFrameCount: undefined,
    proxyFps: undefined,
    proxyFormat: undefined,
    proxyVideoUrl: undefined,
    hasProxyAudio: undefined,
    audioProxyStatus: undefined,
    audioProxyProgress: undefined,
    audioProxyStorageKey: undefined,
    audioProxyUrl: undefined,
  };
}

export async function createMediaSourceReplacementPatch(file: File): Promise<MediaSourceReplacementPatch> {
  const fileHash = await calculateFileHash(file);
  return createMediaSourceReplacementResetPatch(fileHash || undefined);
}

function mediaFileCanHaveAudio(mediaFile: MediaFile): boolean {
  if (mediaFile.type === 'audio') return true;
  if (mediaFile.type !== 'video') return false;
  return mediaFile.hasAudio !== false || Boolean(mediaFile.audioCodec);
}

async function resolveMediaFileSourceFile(mediaFile: MediaFile): Promise<File | null> {
  if (mediaFile.file && mediaFile.file.size > 0) {
    return mediaFile.file;
  }

  if (mediaFile.projectPath && projectFileService.isProjectOpen()) {
    const result = await projectFileService.getFileFromRaw(mediaFile.projectPath);
    if (result?.file) return result.file;
  }

  if (mediaFile.url) {
    try {
      const response = await fetch(mediaFile.url);
      if (response.ok) {
        const blob = await response.blob();
        return new File([blob], mediaFile.name, { type: blob.type || mediaFile.file?.type || '' });
      }
    } catch (error) {
      log.warn('Failed to resolve media source URL', { id: mediaFile.id, name: mediaFile.name, error });
    }
  }

  return null;
}

function updateMediaFileWaveform(
  set: (partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => void,
  id: string,
  updates: Partial<Pick<MediaFile, 'audioAnalysisRefs' | 'waveform' | 'waveformChannels' | 'waveformProgress' | 'waveformStatus'>>,
): void {
  set((state) => ({
    files: state.files.map((file) => (
      file.id === id
        ? { ...file, ...updates }
        : file
    )),
  }));
}

export interface FileManageActions {
  removeFile: (id: string) => void;
  getMediaFileUsages: (ids: string[]) => MediaFileUsageSummary[];
  deleteMediaFilesEverywhere: (ids: string[]) => Promise<DeleteMediaFilesEverywhereResult>;
  renameFile: (id: string, name: string) => void;
  removeSignalAsset: (id: string) => void;
  renameSignalAsset: (id: string, name: string) => void;
  ensureFileThumbnail: (id: string, options?: { force?: boolean }) => Promise<boolean>;
  generateMediaWaveform: (id: string, options?: { force?: boolean }) => Promise<void>;
  generateMediaSpectrogram: (id: string, options?: { force?: boolean }) => Promise<void>;
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
  audioState?: TimelineClip['audioState'];
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

function collectActiveTimelineClipsForMediaFileId(mediaFileId: string): TimelineAudioCacheRefClip[] {
  return useTimelineStore.getState().clips
    .filter(clip => getClipMediaFileId(clip) === mediaFileId)
    .map(clip => ({
      id: clip.id,
      audioState: clip.audioState,
    }));
}

function collectMediaClipsByMatcherForCacheInvalidation(
  targetFiles: MediaFile[],
  compositions: Composition[],
  activeCompositionId: string | null,
  activeTimelineClips: TimelineClip[],
  matcher: MediaFileDeleteMatcher,
): Map<string, TimelineAudioCacheRefClip[]> {
  const targetIds = new Set(targetFiles.map(file => file.id));
  const clipsByMediaFileId = new Map(
    targetFiles.map(file => [file.id, [] as TimelineAudioCacheRefClip[]])
  );

  for (const composition of compositions) {
    const clips = getCompositionClipsForUsage(composition, activeCompositionId, activeTimelineClips);
    for (const clip of clips) {
      const mediaFileId = matcher.matchClip(clip);
      if (!mediaFileId || !targetIds.has(mediaFileId)) {
        continue;
      }
      clipsByMediaFileId.get(mediaFileId)?.push({
        id: clip.id,
        audioState: clip.audioState,
      });
    }
  }

  return clipsByMediaFileId;
}

async function invalidateMediaSourceReplacementCaches(
  mediaFileId: string,
  mediaFile: Pick<MediaFile, 'fileHash' | 'audioAnalysisRefs'> | undefined,
  clips: readonly TimelineAudioCacheRefClip[],
): Promise<void> {
  await invalidateTimelineMediaCaches({
    reason: 'source-replace',
    mediaFileId,
    ...(mediaFile?.fileHash ? { fileHash: mediaFile.fileHash } : {}),
    clipIds: clips.map(clip => clip.id).filter((id): id is string => Boolean(id)),
    sourceAudioAnalysisRefs: mediaFile?.audioAnalysisRefs,
    explicitAudioRefs: collectTimelineAudioCacheRefsFromClips(clips),
  });
}

function createSourceReplacementClipAudioPatch(clip: TimelineClip): Partial<Pick<TimelineClip, 'audioState'>> {
  if (
    !clip.audioState?.sourceAudioRevisionId
    && !clip.audioState?.sourceAnalysisRefs
    && !clip.audioState?.processedAnalysisRefs
  ) {
    return {};
  }

  return {
    audioState: {
      ...clip.audioState,
      sourceAudioRevisionId: undefined,
      sourceAnalysisRefs: undefined,
      processedAnalysisRefs: undefined,
    },
  };
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
  revokeMediaFileObjectUrls(file);
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

  clearAINodeRuntimeCacheForClip(clip.id);
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
    const artifactFailures: string[] = [];
    for (const file of filesToDelete) {
      const rawPathIsShared = Boolean(
        file.projectPath && remainingFiles.some(remaining => remaining.projectPath === file.projectPath)
      );
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
            ? generatedThumbnail
            : await handleThumbnailDedup(mediaFile.fileHash, generatedThumbnail);

          if (options.force && generatedThumbnail && mediaFile.fileHash) {
            try {
              const response = await fetch(generatedThumbnail);
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

  generateMediaWaveform: async (id: string, options: { force?: boolean } = {}) => {
    const mediaFile = get().files.find((file) => file.id === id);
    if (!mediaFile || !mediaFileCanHaveAudio(mediaFile)) return;

    const sourceFile = await resolveMediaFileSourceFile(mediaFile);
    if (!sourceFile) {
      updateMediaFileWaveform(set, id, {
        waveformStatus: 'error',
        waveformProgress: 0,
      });
      return;
    }

    startMediaFileWaveformGeneration(
      {
        ...mediaFile,
        file: sourceFile,
      },
      (mediaFileId, updates) => updateMediaFileWaveform(set, mediaFileId, updates),
      (mediaFileId) => get().files.find((file) => file.id === mediaFileId),
      options,
    );
  },

  generateMediaSpectrogram: async (id: string, options: { force?: boolean } = {}) => {
    const mediaFile = get().files.find((file) => file.id === id);
    if (!mediaFile || !mediaFileCanHaveAudio(mediaFile)) return;

    const existingSpectrogramId = mediaFile.audioAnalysisRefs?.spectrogramTileSetIds?.[0];
    if (!options.force && existingSpectrogramId) return;

    const existingJob = activeMediaSpectrogramJobs.get(id);
    if (existingJob) {
      await existingJob;
      return;
    }

    const previousWaveformStatus = mediaFile.waveformStatus;
    const previousWaveformProgress = mediaFile.waveformProgress;

    const job = (async () => {
      try {
        updateMediaFileWaveform(set, id, {
          waveformStatus: 'generating',
          waveformProgress: 1,
        });

        const sourceFile = await resolveMediaFileSourceFile(mediaFile);
        if (!sourceFile) {
          updateMediaFileWaveform(set, id, {
            waveformStatus: 'error',
            waveformProgress: 0,
          });
          return;
        }

        const sourceFingerprint = await createFileAudioSourceFingerprint(sourceFile);
        updateMediaFileWaveform(set, id, { waveformProgress: 12 });

        const sourceBuffer = await audioExtractor.extractAudio(sourceFile, id);
        updateMediaFileWaveform(set, id, { waveformProgress: 35 });

        const store = createCurrentAudioArtifactStore();
        const generator = new SpectrogramTileSetGenerator({ artifactStore: store });
        const generated = await generator.generate({
          mediaFileId: id,
          sourceFingerprint,
          buffer: sourceBuffer,
          decoderId: 'masterselects.audio-extractor',
          decoderVersion: '1.0.0',
          metadata: {
            analysisKind: 'spectrogram-tiles',
            mediaFileName: mediaFile.name,
          },
        }, {
          onProgress: (progress) => {
            updateMediaFileWaveform(set, id, {
              waveformProgress: Math.min(99, Math.max(35, Math.round(35 + progress.percent * 0.64))),
            });
          },
        });

        const tileSet = await readTimelineSpectrogramTileSet(generated.manifest, store);
        primeTimelineSpectrogramTileSetCache([
          generated.artifact.id,
          generated.artifact.manifestRef.artifactId,
          generated.analysisRef.artifactId,
        ], tileSet);

        const refId = generated.artifact.manifestRef.artifactId;
        set((state) => ({
          files: state.files.map((file) => {
            if (file.id !== id) return file;
            return {
              ...file,
              audioAnalysisRefs: {
                ...(file.audioAnalysisRefs ?? {}),
                spectrogramTileSetIds: [refId],
              },
              waveformStatus: file.waveform?.length ? 'ready' : (previousWaveformStatus ?? 'idle'),
              waveformProgress: file.waveform?.length ? 100 : (previousWaveformProgress ?? 0),
            };
          }),
        }));
      } catch (error) {
        updateMediaFileWaveform(set, id, {
          waveformStatus: 'error',
          waveformProgress: 0,
        });
        log.warn('Failed to generate media spectrogram', {
          id,
          name: mediaFile.name,
          error,
        });
      }
    })().finally(() => {
      activeMediaSpectrogramJobs.delete(id);
    });

    activeMediaSpectrogramJobs.set(id, job);
    await job;
  },

  refreshFileUrls: async (id: string, options) => {
    const mediaFile = get().files.find((f) => f.id === id);
    if (!mediaFile) return false;

    if (!mediaFile.file) {
      return (get() as MediaState & FileManageActions).reloadFile(id);
    }

    const refreshThumbnail = options?.refreshThumbnail ?? true;
    const url = createPrimaryMediaObjectUrl(id, mediaFile.file, { revokeExisting: false });
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

/**
 * Update timeline clips with reloaded file.
 * Writes data-only clip sources for video/audio; runtime hydration happens lazily.
 * Exported for use by projectSync auto-relink.
 */
export type UpdateTimelineClipsOptions = {
  generateThumbnails?: boolean;
  invalidateCaches?: boolean;
  fileHash?: string;
};

export async function updateTimelineClips(
  mediaFileId: string,
  file: File,
  options: UpdateTimelineClipsOptions = {},
): Promise<void> {
  const generateThumbnails = options.generateThumbnails !== false;
  const shouldInvalidateCaches = options.invalidateCaches !== false;
  const timelineStore = useTimelineStore.getState();
  const mediaFile = useMediaStore.getState().files.find((entry) => entry.id === mediaFileId);
  const fileHash = options.fileHash ?? mediaFile?.fileHash;
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

  if (shouldInvalidateCaches) {
    await invalidateMediaSourceReplacementCaches(mediaFileId, mediaFile, clips);
  }

  let sharedFileUrl: string | undefined;
  const getSharedFileUrl = () => {
    sharedFileUrl ??= mediaFile?.url || createPrimaryMediaObjectUrl(mediaFileId, file);
    return sharedFileUrl;
  };

  for (const clip of clips) {
    const sourceType = clip.source?.type;

    if (sourceType === 'video') {
      const naturalDuration = clip.source?.naturalDuration || mediaFile?.duration || clip.duration;
      const sourceUrl = getSharedFileUrl();
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
        source: {
          type: 'video',
          naturalDuration,
          mediaFileId,
        },
      });
      if (generateThumbnails) {
        void thumbnailCacheService.generateForSourceUrl(mediaFileId, sourceUrl, naturalDuration, fileHash);
      }
    } else if (sourceType === 'audio') {
      const naturalDuration = clip.source?.naturalDuration || mediaFile?.duration || clip.duration;
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
        source: {
          type: 'audio',
          naturalDuration,
          mediaFileId,
        },
      });
    } else if (sourceType === 'image') {
      // Create image element
      const img = new Image();
      img.src = getSharedFileUrl();
      img.crossOrigin = 'anonymous';

      img.addEventListener('load', () => {
        timelineStore.updateClip(clip.id, {
          ...createSourceReplacementClipAudioPatch(clip),
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

        timelineStore.updateClip(clip.id, {
          ...createSourceReplacementClipAudioPatch(clip),
          file,
          needsReload: false,
          isLoading: false,
          source: {
            ...clip.source!,
            type: sourceType,
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
      const modelSequence = resolveModelSequenceData(
        clip.source?.modelSequence,
        mediaFile?.modelSequence,
      );
      const sequenceModelUrl = getModelSequenceFrameUrl(modelSequence, 0);
      const modelUrl = sequenceModelUrl ?? (mediaFile?.url || blobUrlManager.create(clip.id, file, 'model'));
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
        source: {
          ...clip.source!,
          modelUrl,
          ...(modelSequence ? { modelSequence } : {}),
        },
      });
    } else if (sourceType === 'gaussian-avatar') {
      // Gaussian avatar — create blob URL for the renderer
      const gaussianAvatarUrl = mediaFile?.url || blobUrlManager.create(clip.id, file, 'model');
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
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
      const gaussianSplatUrl = firstFrame?.splatUrl ?? (mediaFile?.url || blobUrlManager.create(clip.id, file, 'file'));
      timelineStore.updateClip(clip.id, {
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
        source: {
          ...clip.source!,
          gaussianSplatUrl,
          gaussianSplatFileName: firstFrame?.name ?? file.name,
          gaussianSplatFileHash: firstFrame ? undefined : fileHash,
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
        ...createSourceReplacementClipAudioPatch(clip),
        file,
        needsReload: false,
        isLoading: false,
      });
    }
  }

  log.debug(`Updated ${clips.length} timeline clips`);
}
