import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import { fileSystemService } from '../../../services/fileSystemService';
import { projectFileService } from '../../../services/projectFileService';
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

export async function resolveClipExportFile(
  clip: TimelineClip,
  mediaFile?: MediaFile | null
): Promise<File | null> {
  const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId || '';
  const projectHandle = await getStoredProjectFileHandle(mediaFileId);
  if (projectHandle) {
    try {
      return await projectHandle.getFile();
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
          return result.file;
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
      return await storedHandle.getFile();
    } catch (e) {
      log.warn(`Media file handle failed for ${clip.name}:`, e);
    }
  }

  if (mediaFile?.file) {
    return mediaFile.file;
  }

  if (clip.file) {
    return clip.file;
  }

  return null;
}

export async function loadClipFileData(
  clip: TimelineClip,
  mediaFile?: MediaFile | null
): Promise<ArrayBuffer | null> {
  let fileData: ArrayBuffer | null = null;

  const resolvedFile = await resolveClipExportFile(clip, mediaFile);
  if (!fileData && resolvedFile) {
    try {
      fileData = await resolvedFile.arrayBuffer();
    } catch (e) {
      log.warn(`Resolved export file access failed for ${clip.name}:`, e);
    }
  }

  if (!fileData && mediaFile?.url) {
    try {
      const response = await fetch(mediaFile.url);
      fileData = await response.arrayBuffer();
    } catch (e) {
      log.warn(`Media blob URL fetch failed for ${clip.name}:`, e);
    }
  }

  if (!fileData && clip.source?.videoElement?.src) {
    try {
      const response = await fetch(clip.source.videoElement.src);
      fileData = await response.arrayBuffer();
    } catch (e) {
      log.warn(`Video src fetch failed for ${clip.name}:`, e);
    }
  }

  return fileData;
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
