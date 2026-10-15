import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import { fileSystemService } from '../../../services/fileSystemService';
import { projectFileService } from '../../../services/project/ProjectFileService';
import {
  getProjectRawPathCandidates,
  getStoredProjectFileHandle,
} from '../../../services/project/mediaSourceResolver';
import { getClipMediaFileId } from './admission';

const log = Logger.create('ClipPreparation');

export type ClipFileDataCache = Map<string, Promise<ArrayBuffer | null>>;

export function getClipSourceCacheKey(clip: TimelineClip, mediaFile?: MediaFile | null): string {
  const mediaFileId = getClipMediaFileId(clip);
  if (mediaFileId) {
    return `media:${mediaFileId}`;
  }

  const filePath = mediaFile?.filePath || mediaFile?.projectPath || clip.source?.filePath;
  if (filePath) {
    return `path:${filePath}`;
  }

  const url = mediaFile?.url || clip.source?.videoElement?.currentSrc || clip.source?.videoElement?.src;
  if (url) {
    return `url:${url}`;
  }

  if (clip.file) {
    return `file:${clip.file.name}:${clip.file.size}:${clip.file.lastModified}`;
  }

  return `clip:${clip.id}`;
}

export function getFastModeFileSizeStats(
  videoClips: TimelineClip[],
  mediaFiles: MediaFile[]
): { totalBytes: number; largestBytes: number; largestClipName: string | null; uniqueSourceCount: number } {
  let totalBytes = 0;
  let largestBytes = 0;
  let largestClipName: string | null = null;
  const countedSources = new Set<string>();

  for (const clip of videoClips) {
    if (clip.source?.type !== 'video') {
      continue;
    }

    const mediaFileId = getClipMediaFileId(clip);
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const sourceKey = getClipSourceCacheKey(clip, mediaFile);
    const fileSize = mediaFile?.fileSize ?? clip.file?.size ?? 0;

    if (!countedSources.has(sourceKey)) {
      countedSources.add(sourceKey);
      totalBytes += fileSize;
    }

    if (fileSize > largestBytes) {
      largestBytes = fileSize;
      largestClipName = clip.name;
    }
  }

  return { totalBytes, largestBytes, largestClipName, uniqueSourceCount: countedSources.size };
}

async function* exportFileCandidates(
  clip: TimelineClip,
  mediaFile?: MediaFile | null
): AsyncGenerator<{ file: File; origin: string }> {
  const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId || '';
  const projectHandle = await getStoredProjectFileHandle(mediaFileId);
  if (projectHandle) {
    try {
      yield { file: await projectHandle.getFile(), origin: 'project handle' };
    } catch (e) {
      log.warn(`Project RAW handle failed for ${clip.name}:`, e);
    }
  }

  if (projectFileService.isProjectOpen()) {
    for (const candidatePath of getProjectRawPathCandidates({
      mediaFileId,
      projectPath: mediaFile?.projectPath,
      filePath: mediaFile?.filePath,
      name: clip.name,
    })) {
      try {
        const result = await projectFileService.getFileFromRaw(candidatePath);
        if (result) {
          yield { file: result.file, origin: 'project RAW' };
        }
      } catch (e) {
        log.warn(`Project RAW file load failed for ${clip.name} at ${candidatePath}:`, e);
      }
    }
  }

  const storedHandle = mediaFile?.hasFileHandle && mediaFileId
    ? fileSystemService.getFileHandle(mediaFileId)
    : null;
  if (storedHandle) {
    try {
      yield { file: await storedHandle.getFile(), origin: 'media handle' };
    } catch (e) {
      log.warn(`Media file handle failed for ${clip.name}:`, e);
    }
  }

  if (mediaFile?.file) {
    yield { file: mediaFile.file, origin: 'media file' };
  }

  if (clip.file) {
    yield { file: clip.file, origin: 'clip file' };
  }

}

// HTMLVideo preparation only needs a File; FAST export must also verify that
// its bytes are readable before it stops searching the candidate chain.
export async function resolveClipExportFile(
  clip: TimelineClip,
  mediaFile?: MediaFile | null
): Promise<File | null> {
  for await (const candidate of exportFileCandidates(clip, mediaFile)) return candidate.file;
  return null;
}

export async function loadClipFileData(
  clip: TimelineClip,
  mediaFile?: MediaFile | null
): Promise<ArrayBuffer | null> {
  const attemptedFiles = new Set<File>();
  for await (const { file, origin } of exportFileCandidates(clip, mediaFile)) {
    if (attemptedFiles.has(file)) continue;
    attemptedFiles.add(file);
    try {
      const data = await file.arrayBuffer();
      if (data.byteLength > 0) return data;
      log.warn(`Empty export file for ${clip.name} (${origin}); trying the next source`);
    } catch (error) {
      log.warn(`Resolved export file access failed for ${clip.name} (${origin}):`, error);
    }
  }

  const video = clip.source?.videoElement;
  const urls = new Set([mediaFile?.url, video?.currentSrc, video?.src].filter((url): url is string => Boolean(url)));
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        log.warn(`Export source request failed for ${clip.name}: HTTP ${response.status}`);
        continue;
      }
      const data = await response.arrayBuffer();
      if (data.byteLength > 0) return data;
      log.warn(`Empty export source response for ${clip.name}; trying the next source`);
    } catch (error) {
      log.warn(`Export source URL fetch failed for ${clip.name}:`, error);
    }
  }

  return null;
}

export async function loadClipFileDataCached(
  clip: TimelineClip,
  mediaFile: MediaFile | null | undefined,
  cache: ClipFileDataCache
): Promise<ArrayBuffer | null> {
  const sourceKey = getClipSourceCacheKey(clip, mediaFile);
  let promise = cache.get(sourceKey);
  if (!promise) {
    promise = loadClipFileData(clip, mediaFile);
    cache.set(sourceKey, promise);
  }
  return promise;
}
