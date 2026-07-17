import { Logger } from '../../logger';
import { type MediaFile, type MediaFolder } from '../../../stores/mediaStore';
import {
  getExpectedProxyFrameCount,
  getExpectedProxyFps,
  isProxyFrameIndexSetComplete,
} from '../../../stores/mediaStore/helpers/proxyCompleteness';
import { projectFileService, type ProjectFolder, type ProjectMediaFile } from '../../projectFileService';
import type { LabelColor } from '../../../stores/mediaStore/types';
import type { AnalysisStatus, TranscriptStatus, TranscriptWord } from '../../../types';
import { yieldToBrowser } from './loadProgress';
import { calcRangeCoverage, projectMediaCanHaveAudio } from './loadMediaCacheHydration';
import { hydrateProjectMediaRuntimeSources } from './loadMediaRuntimeSources';

const log = Logger.create('ProjectSync');

type ConvertProjectMediaOptions = {
  hydrateFiles?: boolean;
  deferCacheChecks?: boolean;
  onProgress?: (done: number, total: number, name: string) => void;
};

type StoreItemWithParent = {
  id: string;
  name?: string;
  parentId: string | null;
};

export async function convertProjectMediaToStore(
  projectMedia: ProjectMediaFile[],
  options: ConvertProjectMediaOptions = {},
): Promise<MediaFile[]> {
  const hydrateFiles = options.hydrateFiles !== false;
  const deferCacheChecks = options.deferCacheChecks === true;
  const files: MediaFile[] = [];
  const total = projectMedia.length;

  for (const pm of projectMedia) {
    if (pm.liveInput) {
      files.push({
        id: pm.id,
        name: pm.name,
        type: 'video',
        parentId: pm.folderId,
        createdAt: new Date(pm.importedAt).getTime(),
        url: '',
        duration: pm.duration,
        width: pm.width,
        height: pm.height,
        fps: pm.frameRate,
        hasAudio: false,
        labelColor: pm.labelColor as LabelColor | undefined,
        liveInput: structuredClone(pm.liveInput),
      });
      options.onProgress?.(files.length, total, pm.name);
      continue;
    }

    const runtimeSources = await hydrateProjectMediaRuntimeSources(pm, hydrateFiles);

    let transcriptStatus: TranscriptStatus = 'none';
    let transcript: TranscriptWord[] | undefined;
    let transcriptCoverage = 0;
    let transcribedRanges: [number, number][] | undefined;
    if (!deferCacheChecks && projectFileService.isProjectOpen()) {
      try {
        const saved = await projectFileService.getTranscript(pm.id);
        if (saved) {
          const words = saved.words as TranscriptWord[];
          if (words && words.length > 0) {
            transcriptStatus = 'ready';
            transcript = words;
            transcribedRanges = saved.transcribedRanges;
            if (pm.duration && pm.duration > 0) {
              transcriptCoverage = transcribedRanges?.length
                ? calcRangeCoverage(transcribedRanges, pm.duration)
                : calcRangeCoverage(transcript.map(w => [w.start, w.end]), pm.duration);
            }
          }
        }
      } catch { /* no transcript file */ }
    }

    let analysisStatus: AnalysisStatus = 'none';
    let analysisCoverage = 0;
    if (!deferCacheChecks && projectFileService.isProjectOpen()) {
      try {
        const ranges = await projectFileService.getAnalysisRanges(pm.id);
        if (ranges.length > 0) {
          analysisStatus = 'ready';
          if (pm.duration && pm.duration > 0) {
            const parsed: [number, number][] = ranges.map(key => {
              const [s, e] = key.split('-').map(Number);
              return [s, e];
            });
            analysisCoverage = calcRangeCoverage(parsed, pm.duration);
          }
        }
      } catch { /* no analysis file */ }
    }

    let proxyStatus: MediaFile['proxyStatus'] = 'none';
    let proxyFrameCount: number | undefined;
    let proxyProgress = 0;
    let proxyFps: number | undefined;
    let proxyFormat: MediaFile['proxyFormat'];
    if (pm.type === 'video' && pm.hasProxy && projectFileService.isProjectOpen()) {
      proxyFps = getExpectedProxyFps(pm.frameRate);
      if (deferCacheChecks) {
        proxyStatus = 'ready';
        proxyFrameCount = getExpectedProxyFrameCount(pm.duration, proxyFps) ?? undefined;
        proxyProgress = 100;
        proxyFormat = 'jpeg-sequence';
      } else {
        const proxyStorageKey = pm.fileHash || pm.id;
        const frameIndices = await projectFileService.getProxyFrameIndices(proxyStorageKey);
        if (isProxyFrameIndexSetComplete(frameIndices, pm.duration, proxyFps)) {
          proxyStatus = 'ready';
          proxyFrameCount = frameIndices.size;
          proxyProgress = 100;
          proxyFormat = 'jpeg-sequence';
        }
      }
    }

    const audioProxyStorageKey = pm.audioProxyStorageKey || pm.fileHash || pm.id;
    let audioProxyStatus: MediaFile['audioProxyStatus'] = 'none';
    let audioProxyProgress = 0;
    let hasProxyAudio = false;
    const shouldRestoreAudioProxy = pm.hasAudioProxy || projectMediaCanHaveAudio(pm);
    if (shouldRestoreAudioProxy && projectFileService.isProjectOpen()) {
      if (deferCacheChecks) {
        if (pm.hasAudioProxy) {
          audioProxyStatus = 'ready';
          audioProxyProgress = 100;
          hasProxyAudio = true;
        }
      } else {
        hasProxyAudio = await projectFileService.hasProxyAudio(audioProxyStorageKey);
        audioProxyStatus = hasProxyAudio ? 'ready' : 'none';
        audioProxyProgress = hasProxyAudio ? 100 : 0;
      }
    }

    files.push({
      id: pm.id,
      name: pm.name,
      type: pm.type,
      parentId: pm.folderId,
      createdAt: new Date(pm.importedAt).getTime(),
      file: runtimeSources.representativeFile,
      url: runtimeSources.representativeUrl,
      thumbnailUrl: runtimeSources.thumbnailUrl,
      duration: pm.duration,
      width: pm.width,
      height: pm.height,
      fps: pm.frameRate,
      codec: pm.codec ?? runtimeSources.gaussianSplatSequence?.codec,
      audioCodec: pm.audioCodec,
      container: pm.container ?? (runtimeSources.gaussianSplatSequence?.container ? runtimeSources.gaussianSplatSequence.container + ' Seq' : undefined),
      bitrate: pm.bitrate,
      fileSize: pm.fileSize ?? runtimeSources.gaussianSplatSequence?.totalFileSize,
      hasAudio: pm.hasAudio,
      splatCount: pm.splatCount ?? runtimeSources.gaussianSplatSequence?.frames[0]?.splatCount,
      totalSplatCount: pm.totalSplatCount ?? runtimeSources.gaussianSplatSequence?.totalSplatCount,
      splatFrameCount: pm.splatFrameCount ?? runtimeSources.gaussianSplatSequence?.frameCount,
      modelSequence: runtimeSources.modelSequence,
      gaussianSplatSequence: runtimeSources.gaussianSplatSequence,
      proxyStatus,
      proxyFrameCount,
      proxyFps: proxyStatus === 'ready' ? proxyFps : undefined,
      proxyProgress,
      proxyFormat,
      hasProxyAudio,
      audioProxyStatus,
      audioProxyProgress,
      audioProxyStorageKey,
      hasFileHandle: runtimeSources.hasFileHandle,
      filePath: pm.sourcePath,
      absolutePath: runtimeSources.representativeAbsolutePath,
      projectPath: runtimeSources.representativeProjectPath,
      fileHash: pm.fileHash,
      audioAnalysisRefs: pm.audioAnalysisRefs ? structuredClone(pm.audioAnalysisRefs) : undefined,
      stemInfo: pm.stemInfo ? structuredClone(pm.stemInfo) : undefined,
      waveform: pm.waveform ? [...pm.waveform] : undefined,
      waveformChannels: pm.waveformChannels?.map(channel => [...channel]),
      waveformStatus: pm.waveform?.length ? 'ready' : undefined,
      waveformProgress: pm.waveform?.length ? 100 : undefined,
      vectorAnimation: pm.vectorAnimation,
      labelColor: pm.labelColor as LabelColor | undefined,
      transcriptStatus,
      transcript,
      transcriptCoverage,
      transcribedRanges,
      analysisStatus,
      analysisCoverage,
    });

    options.onProgress?.(files.length, total, pm.name);
    if (files.length % 3 === 0) await yieldToBrowser();
  }

  return files;
}

export function convertProjectFolderToStore(projectFolders: ProjectFolder[]): MediaFolder[] {
  return projectFolders.map((pf) => ({
    id: pf.id,
    name: pf.name,
    parentId: pf.parentId,
    labelColor: pf.labelColor as LabelColor | undefined,
    isExpanded: true,
    createdAt: Date.now(),
  }));
}

export function normalizeFolderParents(folders: MediaFolder[]): MediaFolder[] {
  if (folders.length === 0) return folders;

  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  let repairedCount = 0;

  const hasBrokenParent = (folder: MediaFolder): boolean => {
    if (!folder.parentId) return false;
    if (folder.parentId === folder.id || !foldersById.has(folder.parentId)) return true;

    const seen = new Set<string>([folder.id]);
    let nextParentId: string | null = folder.parentId;
    while (nextParentId) {
      if (seen.has(nextParentId)) return true;
      seen.add(nextParentId);
      nextParentId = foldersById.get(nextParentId)?.parentId ?? null;
    }
    return false;
  };

  const normalized = folders.map((folder) => {
    if (!hasBrokenParent(folder)) return folder;
    repairedCount += 1;
    return { ...folder, parentId: null };
  });

  if (repairedCount > 0) {
    log.warn('Recovered folders with invalid parent references', { repairedCount, total: folders.length });
  }

  return repairedCount > 0 ? normalized : folders;
}

export function normalizeItemFolderParents<T extends StoreItemWithParent>(
  items: T[],
  validFolderIds: ReadonlySet<string>,
  itemKind: string,
): T[] {
  if (items.length === 0 || validFolderIds.size === 0) {
    const needsRootRepair = items.some((item) => Boolean(item.parentId));
    if (!needsRootRepair) return items;
  }

  let repairedCount = 0;
  const normalized = items.map((item) => {
    if (!item.parentId || validFolderIds.has(item.parentId)) return item;
    repairedCount += 1;
    return { ...item, parentId: null };
  });

  if (repairedCount > 0) {
    log.warn('Recovered media panel items with missing folder parents', { itemKind, repairedCount, total: items.length });
  }

  return repairedCount > 0 ? normalized : items;
}
