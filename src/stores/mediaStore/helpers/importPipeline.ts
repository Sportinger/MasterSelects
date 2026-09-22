// Unified import pipeline - eliminates 3x duplicate import logic

import type { MediaFile, ProxyFormat, ProxyStatus } from '../types';
import { classifyMediaType } from '../../timeline/helpers/mediaTypeHelpers';
import { calculateFileHash } from './fileHashHelpers';
import { getMediaInfo } from './mediaInfoHelpers';
import { createThumbnail, handleThumbnailDedup } from './thumbnailHelpers';
import {
  getExpectedProxyFps,
  isProxyFrameIndexSetComplete,
} from './proxyCompleteness';
import { projectFileService } from '../../../services/projectFileService';
import { fileSystemService } from '../../../services/fileSystemService';
import { projectDB } from '../../../services/projectDB';
import { useSettingsStore } from '../../settingsStore';
import { Logger } from '../../../services/logger';
import { prepareLottieAsset } from '../../../services/vectorAnimation/lottieMetadata';
import { prepareRiveAsset } from '../../../services/vectorAnimation/riveMetadata';
import { readGaussianSplatFileStats } from './gaussianSplatStats';
import { createPrimaryMediaObjectUrl } from '../../../services/project/mediaObjectUrlManager';
import { resolveProjectMediaSourceLocation } from '../../../services/project/mediaSourceRoots';

const log = Logger.create('Import');

export interface ImportParams {
  file: File;
  id: string;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
  parentId?: string | null;
  forceCopyToProject?: boolean;
  projectFileName?: string;
  /** Generate and persist the panel thumbnail before resolving the import. */
  generateThumbnail?: boolean;
  /** Force a specific media type instead of auto-detecting (e.g. 'gaussian-avatar' for .zip files) */
  typeOverride?: MediaFile['type'];
  /** Optional 0-100 progress callback for visible import placeholders. */
  onProgress?: (progress: number) => void;
}

export interface ImportResult {
  mediaFile: MediaFile;
  projectFileHandle?: FileSystemFileHandle;
}

/**
 * Generate unique ID.
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Unified import pipeline for all import methods.
 * Replaces duplicate logic in importFile, importFilesWithPicker, importFilesWithHandles.
 */
export async function processImport(params: ImportParams): Promise<ImportResult> {
  const {
    file,
    id,
    handle,
    absolutePath,
    parentId,
    forceCopyToProject,
    projectFileName,
    generateThumbnail = true,
    typeOverride,
    onProgress,
  } = params;

  onProgress?.(2);

  // Store handle if provided (for original file location)
  if (handle) {
    fileSystemService.storeFileHandle(id, handle);
    await projectDB.storeHandle(`media_${id}`, handle);
  }

  // Detect type using shared helper from clipSlice, or use override if provided
  const detectedType = await classifyMediaType(file);
  if (detectedType === 'unknown' && !typeOverride) {
    throw new Error(`Unsupported media type: ${file.name}`);
  }

  const type: MediaFile['type'] = typeOverride ?? detectedType as MediaFile['type'];
  let canonicalFile = file;
  onProgress?.(8);

  const vectorAnimationInfo = type === 'lottie' || type === 'rive'
    ? await (type === 'lottie' ? prepareLottieAsset(file) : prepareRiveAsset(file)).then((prepared) => ({
      duration: prepared.metadata.duration,
      fileSize: file.size,
      fps: prepared.metadata.fps,
      height: prepared.metadata.height,
      vectorAnimation: prepared.metadata,
      width: prepared.metadata.width,
    }))
    : null;

  // Get info and thumbnail in parallel (skip for 3D/vector formats - no HTML media metadata)
  const isMediaType = type === 'video' || type === 'audio' || type === 'image';
  const infoPromise = isMediaType
    ? getMediaInfo(file, type as 'video' | 'audio' | 'image')
    : Promise.resolve(vectorAnimationInfo ?? { duration: 10, fileSize: file.size });
  const thumbnailPromise = generateThumbnail && type === 'video'
    ? infoPromise.then((metadata) => createThumbnail(file, 'video', {
        videoCodecId: 'videoCodecId' in metadata ? metadata.videoCodecId : undefined,
        duration: metadata.duration,
      }))
    : generateThumbnail && type === 'image'
      ? createThumbnail(file, 'image')
      : Promise.resolve(undefined);
  const [info, rawThumbnail] = await Promise.all([infoPromise, thumbnailPromise]);
  onProgress?.(20);

  // Calculate hash for deduplication
  const fileHash = await calculateFileHash(file);
  onProgress?.(35);

  // Handle thumbnail deduplication (unified - was 3x duplicate)
  const thumbnailUrl = generateThumbnail
    ? await handleThumbnailDedup(fileHash, rawThumbnail, id)
    : undefined;

  // Check for existing proxy (unified - was 3x duplicate)
  const proxyInfo = await checkExistingProxy(
    fileHash,
    type,
    info.duration,
    'fps' in info ? info.fps : undefined
  );
  onProgress?.(45);

  // Copy to Raw folder if enabled (unified - was 3x duplicate)
  const copyResult = await copyToRawIfEnabled(
    file,
    id,
    forceCopyToProject === true,
    projectFileName,
    Boolean(handle || absolutePath),
  );
  onProgress?.(75);

  if (copyResult) {
    // The project-local RAW copy is the canonical media source. Promote it to the
    // primary handle so timeline clips and exports do not depend on the original file.
    const projectHandle = copyResult.handle;
    if (projectHandle) {
      fileSystemService.storeFileHandle(id, projectHandle);
      await projectDB.storeHandle(`media_${id}`, projectHandle);
    }

    try {
      const projectFile = projectHandle
        ? await projectHandle.getFile()
        : (await projectFileService.getFileFromRaw(copyResult.relativePath))?.file;

      if (projectFile) {
        canonicalFile = projectFile;
      }
    } catch (e) {
      log.warn('Failed to promote RAW copy as canonical media source', {
        id,
        name: file.name,
        projectPath: copyResult.relativePath,
        error: e,
      });
    }
  }

  const gaussianSplatStats = type === 'gaussian-splat'
    ? await readGaussianSplatFileStats(canonicalFile)
    : undefined;
  const sourceLocation = await resolveProjectMediaSourceLocation(handle);
  onProgress?.(95);

  // Build MediaFile
  const mediaFile: MediaFile = {
    id,
    name: file.name,
    type,
    parentId: parentId ?? null,
    createdAt: Date.now(),
    file: canonicalFile,
    url: createPrimaryMediaObjectUrl(id, canonicalFile),
    thumbnailUrl,
    fileHash,
    hasFileHandle: !!copyResult || !!handle,
    filePath: sourceLocation?.sourceRelativePath ?? handle?.name ?? file.name,
    absolutePath,
    projectPath: copyResult?.relativePath,
    sourceRootId: sourceLocation?.sourceRootId,
    sourceRelativePath: sourceLocation?.sourceRelativePath,
    ...info,
    ...proxyInfo,
    ...gaussianSplatStats,
  };

  onProgress?.(100);
  return {
    mediaFile,
    projectFileHandle: copyResult?.handle,
  };
}

/**
 * Check for existing proxy by hash.
 * UNIFIED: Replaces 3 duplicate blocks.
 */
async function checkExistingProxy(
  fileHash: string | undefined,
  type: string,
  duration?: number,
  fps?: number
): Promise<{
  proxyStatus: ProxyStatus;
  proxyFrameCount?: number;
  proxyFps?: number;
  proxyProgress?: number;
  proxyFormat?: ProxyFormat;
}> {
  if (!fileHash || type !== 'video' || !projectFileService.isProjectOpen()) {
    return { proxyStatus: 'none' };
  }

  const proxyFps = getExpectedProxyFps(fps);
  const frameIndices = await projectFileService.getProxyFrameIndices(fileHash);
  if (isProxyFrameIndexSetComplete(frameIndices, duration, proxyFps)) {
    log.debug(`Found existing JPEG proxy: ${fileHash.slice(0, 8)}`);
    return {
      proxyStatus: 'ready',
      proxyFrameCount: frameIndices.size,
      proxyFps,
      proxyProgress: 100,
      proxyFormat: 'jpeg-sequence',
    };
  }

  return { proxyStatus: 'none' };
}

/**
 * Copy file to Raw folder if setting enabled.
 * UNIFIED: Replaces 3 duplicate blocks.
 */
async function copyToRawIfEnabled(
  file: File,
  mediaId: string,
  forceCopyToProject = false,
  projectFileName?: string,
  hasPersistentSourceReference = false,
): Promise<{ relativePath: string; handle?: FileSystemFileHandle } | null> {
  const { copyMediaToProject } = useSettingsStore.getState();
  // A File obtained from an <input> or a drag/drop payload is only valid for
  // the current page lifetime. Even when the browser supports a persistent
  // project folder, the source itself is not reloadable unless the import also
  // supplied a FileSystemFileHandle (or a native absolute path).
  const requiresProjectLocalCopy =
    projectFileService.requiresProjectLocalMediaCopies() ||
    !hasPersistentSourceReference;

  if (
    (!copyMediaToProject && !forceCopyToProject && !requiresProjectLocalCopy)
    || !projectFileService.isProjectOpen()
  ) {
    return null;
  }

  const result = await projectFileService.copyToRawFolder(file, projectFileName);
  if (result) {
    // Store the project file handle for the RAW copy
    if (result.handle) {
      fileSystemService.storeFileHandle(`${mediaId}_project`, result.handle);
      await projectDB.storeHandle(`media_${mediaId}_project`, result.handle);
    }
    log.debug('Copied to Raw folder:', result.relativePath);
    return { relativePath: result.relativePath, handle: result.handle };
  }

  return null;
}

/**
 * Process multiple files in parallel batches.
 */
export async function batchImport<T>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<unknown>
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(processor));
  }
}
