// Unified import pipeline - eliminates 3x duplicate import logic

import type { MediaFile, ProxyStatus } from '../types';
import { PROXY_FPS } from '../constants';
import { classifyMediaType } from '../../timeline/helpers/mediaTypeHelpers';
import { calculateFileHash } from './fileHashHelpers';
import { getMediaInfo } from './mediaInfoHelpers';
import { createThumbnail, handleThumbnailDedup } from './thumbnailHelpers';
import { projectFileService } from '../../../services/projectFileService';
import { fileSystemService } from '../../../services/fileSystemService';
import { projectDB } from '../../../services/projectDB';
import { useSettingsStore } from '../../settingsStore';
import { Logger } from '../../../services/logger';
import { prewarmGaussianSplatRuntime } from '../../../engine/scene/runtime/SharedSplatRuntimeCache';
import { prepareLottieAsset } from '../../../services/vectorAnimation/lottieMetadata';
import { readGaussianSplatFileStats } from './gaussianSplatStats';

const log = Logger.create('Import');

export interface ImportParams {
  file: File;
  id: string;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
  parentId?: string | null;
  forceCopyToProject?: boolean;
  /** Force a specific media type instead of auto-detecting (e.g. 'gaussian-avatar' for .zip files) */
  typeOverride?: MediaFile['type'];
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
  const { file, id, handle, absolutePath, parentId, forceCopyToProject, typeOverride } = params;

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
  let url = URL.createObjectURL(file);

  const vectorAnimationInfo = type === 'lottie'
    ? await prepareLottieAsset(file).then((prepared) => ({
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
  const [info, rawThumbnail] = await Promise.all([
    isMediaType
      ? getMediaInfo(file, type as 'video' | 'audio' | 'image')
      : Promise.resolve(vectorAnimationInfo ?? { duration: 10, fileSize: file.size }),
    type === 'video' || type === 'image'
      ? createThumbnail(file, type as 'video' | 'image')
      : Promise.resolve(undefined),
  ]);

  // Calculate hash for deduplication
  const fileHash = await calculateFileHash(file);

  // Handle thumbnail deduplication (unified - was 3x duplicate)
  const thumbnailUrl = await handleThumbnailDedup(fileHash, rawThumbnail);

  // Check for existing proxy (unified - was 3x duplicate)
  const proxyInfo = await checkExistingProxy(fileHash, type);

  // Copy to Raw folder if enabled (unified - was 3x duplicate)
  const copyResult = await copyToRawIfEnabled(file, id, forceCopyToProject === true);

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
        URL.revokeObjectURL(url);
        canonicalFile = projectFile;
        url = URL.createObjectURL(projectFile);
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

  // Build MediaFile
  const mediaFile: MediaFile = {
    id,
    name: file.name,
    type,
    parentId: parentId ?? null,
    createdAt: Date.now(),
    file: canonicalFile,
    url,
    thumbnailUrl,
    fileHash,
    hasFileHandle: !!copyResult || !!handle,
    filePath: handle?.name || file.name,
    absolutePath,
    projectPath: copyResult?.relativePath,
    ...info,
    ...proxyInfo,
    ...gaussianSplatStats,
  };

  if (type === 'gaussian-splat') {
    void Promise.resolve().then(() => {
      prewarmGaussianSplatRuntime({
        cacheKey: fileHash || id,
        fileHash,
        file: canonicalFile,
        fileName: canonicalFile.name || file.name,
      });
    });
  }

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
  type: string
): Promise<{
  proxyStatus: ProxyStatus;
  proxyFrameCount?: number;
  proxyFps?: number;
  proxyProgress?: number;
}> {
  if (!fileHash || type !== 'video' || !projectFileService.isProjectOpen()) {
    return { proxyStatus: 'none' };
  }

  const frameCount = await projectFileService.getProxyFrameCount(fileHash);
  if (frameCount > 0) {
    log.debug(`Found existing proxy: ${fileHash.slice(0, 8)} frames: ${frameCount}`);
    return {
      proxyStatus: 'ready',
      proxyFrameCount: frameCount,
      proxyFps: PROXY_FPS,
      proxyProgress: 100,
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
  forceCopyToProject = false
): Promise<{ relativePath: string; handle?: FileSystemFileHandle } | null> {
  const { copyMediaToProject } = useSettingsStore.getState();

  if ((!copyMediaToProject && !forceCopyToProject) || !projectFileService.isProjectOpen()) {
    return null;
  }

  const result = await projectFileService.copyToRawFolder(file);
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
