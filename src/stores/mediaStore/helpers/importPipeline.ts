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
import { createRenderablePrimaryMediaObjectUrl } from '../../../services/project/mediaObjectUrlManager';
import { resolveProjectMediaSourceLocation } from '../../../services/project/mediaSourceRoots';
import { decideProjectMediaCopy, runHeldProjectMediaCopy, type ProjectMediaCopyDecision } from '../../../services/project/mediaCopy/projectMediaCopyPolicy';
import type { ProjectMediaCopyTicket } from '../../../services/project/mediaCopy/projectMediaCopyNotices';
import { watchMediaCopyPhases } from '../../../services/project/mediaCopy/mediaCopyPhaseTimings';
import { beginMediaImportTiming, type MediaImportTimer } from './importPhaseTimings';

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
  /**
   * Resolve as soon as metadata and thumbnail are ready; a needed copy into the project continues in the
   * background and is returned as `projectCopy` (the media keep the original File until it is durable).
   */
  copyInBackground?: boolean;
}

/** A finished copy into the project: the project-local file that becomes the media's canonical source. */
export interface ProjectCopySource {
  file: File;
  relativePath: string;
  handle?: FileSystemFileHandle;
  /**
   * The copy's notice entry, still pending: whoever switches the media to the copy settles it once that
   * switch is recorded in the project (until then the unload guard stays on). Runtime only; always set by
   * processImport.
   */
  ticket?: ProjectMediaCopyTicket;
}

export interface ImportResult {
  mediaFile: MediaFile;
  projectFileHandle?: FileSystemFileHandle;
  /**
   * Only with `copyInBackground` when a copy was started: resolves to the project copy, or null when the
   * copy failed (already reported through the project media copy notice, never silent). Never rejects.
   * The caller must settle it: switch the media to it (switchToProjectCopyWhenDurable) or, when the media
   * were not committed, releaseUnusedProjectCopy.
   */
  projectCopy?: Promise<ProjectCopySource | null>;
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
  // Every phase is timed (window.__MS_MEDIA_IMPORT__): a slow phone import must say where it waits.
  const timer = beginMediaImportTiming('pipeline', params.typeOverride ?? params.file.type ?? 'unknown', params.file.size);
  try {
    const result = await runImport(params, timer);
    timer.finish('ok');
    return result;
  } catch (error) {
    timer.finish('failed');
    throw error;
  }
}

async function runImport(params: ImportParams, timer: MediaImportTimer): Promise<ImportResult> {
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
    copyInBackground = false,
  } = params;

  onProgress?.(2);

  // Store handle if provided (for original file location)
  if (handle) {
    fileSystemService.storeFileHandle(id, handle);
    await projectDB.storeHandle(`media_${id}`, handle);
  }

  // Detect type using shared helper from clipSlice, or use override if provided
  const detectedType = await timer.time('classify', classifyMediaType(file));
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
    ? timer.time('metadata', getMediaInfo(file, type as 'video' | 'audio' | 'image'))
    : Promise.resolve(vectorAnimationInfo ?? { duration: 10, fileSize: file.size });
  const thumbnailPromise = generateThumbnail && type === 'video'
    ? infoPromise.then((metadata) => timer.time('thumbnail', createThumbnail(file, 'video', {
        videoCodecId: 'videoCodecId' in metadata ? metadata.videoCodecId : undefined,
        rotation: 'rotation' in metadata ? metadata.rotation : undefined,
        duration: metadata.duration,
      })))
    : generateThumbnail && type === 'image'
      ? timer.time('thumbnail', createThumbnail(file, 'image'))
      : Promise.resolve(undefined);
  const [info, rawThumbnail] = await Promise.all([infoPromise, thumbnailPromise]);
  onProgress?.(20);

  // Calculate hash for deduplication
  const fileHash = await timer.time('hash', calculateFileHash(file));
  onProgress?.(35);

  // Handle thumbnail deduplication (unified - was 3x duplicate)
  const thumbnailUrl = generateThumbnail
    ? await timer.time('thumbnail_store', handleThumbnailDedup(fileHash, rawThumbnail, id))
    : undefined;

  // Check for existing proxy (unified - was 3x duplicate)
  const proxyInfo = await timer.time('proxy_check', checkExistingProxy(
    fileHash,
    type,
    info.duration,
    'fps' in info ? info.fps : undefined
  ));
  onProgress?.(45);

  // Copy to Raw folder if enabled (unified - was 3x duplicate). Its sub-phases (copy_hash, copy_write,
  // ...) land in the timing report: this import's, or for a background copy its own 'background-copy' report.
  const copyDecision = await decideCopyToRaw(forceCopyToProject === true, { handle, absolutePath });
  let copyResult: { relativePath: string; handle?: FileSystemFileHandle } | null = null;
  let projectCopy: Promise<ProjectCopySource | null> | undefined;
  if (copyInBackground && copyDecision.copy) {
    // Placement does not wait: the media start on the original File and switch to the copy when it is durable.
    projectCopy = copyIntoProjectInBackground(file, id, copyDecision, projectFileName, type);
  } else {
    const stopCopyPhases = watchMediaCopyPhases(file, (phase, ms) => timer.add(phase, ms));
    try {
      const copied = await timer.time('copy', copyToRaw(file, id, copyDecision, projectFileName, false));
      if (copied) {
        try { canonicalFile = await timer.time('copy_switch', promoteProjectCopy(file, id, copied)) ?? canonicalFile; }
        catch (error) { copied.ticket.fail(error); throw error; }
        copied.ticket.done();
        copyResult = { relativePath: copied.relativePath, handle: copied.handle };
      }
    } finally {
      stopCopyPhases();
    }
  }
  onProgress?.(75);
  try {
    const gaussianSplatStats = type === 'gaussian-splat'
      ? await readGaussianSplatFileStats(canonicalFile)
      : undefined;
    const sourceLocation = await timer.time('source_location', resolveProjectMediaSourceLocation(handle));
    onProgress?.(95);

    // Build MediaFile
    const mediaFile: MediaFile = {
      id,
      name: file.name,
      type,
      parentId: parentId ?? null,
      createdAt: Date.now(),
      file: canonicalFile,
      url: await timer.time('object_url', createRenderablePrimaryMediaObjectUrl(id, canonicalFile)),
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
      ...(projectCopy ? { projectCopy } : {}),
    };
  } catch (error) {
    // A background copy already running must not be orphaned: it settles as unused (never "Copied").
    if (projectCopy) releaseUnusedProjectCopy(projectCopy, 'the import failed');
    throw error;
  }
}

/**
 * Makes the project-local RAW copy the canonical media source: promotes its handle to the primary
 * handle so timeline clips and exports do not depend on the original file, and returns the copy's File
 * (null when it cannot be opened; the media then keep the original for this session).
 */
async function promoteProjectCopy(
  original: File,
  id: string,
  copyResult: { relativePath: string; handle?: FileSystemFileHandle },
): Promise<File | null> {
  const projectHandle = copyResult.handle;
  if (projectHandle) {
    fileSystemService.storeFileHandle(id, projectHandle);
    await projectDB.storeHandle(`media_${id}`, projectHandle);
  }
  try {
    const projectFile = projectHandle
      ? await projectHandle.getFile()
      : (await projectFileService.getFileFromRaw(copyResult.relativePath))?.file;
    return projectFile ?? null;
  } catch (e) {
    log.warn('Failed to promote RAW copy as canonical media source', {
      id,
      name: original.name,
      projectPath: copyResult.relativePath,
      error: e,
    });
    return null;
  }
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
 * Whether the file is copied into the project's Raw folder: when the setting asks for it or the
 * link would not survive a reload (no handle, or a browser that cannot store handles).
 */
function decideCopyToRaw(
  forceCopyToProject: boolean,
  source: { handle?: FileSystemFileHandle; absolutePath?: string },
): Promise<ProjectMediaCopyDecision> {
  return decideProjectMediaCopy({
    copySetting: useSettingsStore.getState().copyMediaToProject,
    force: forceCopyToProject,
    handle: source.handle,
    absolutePath: source.absolutePath,
  });
}

/**
 * Runs the decided copy. A background copy is announced (visible "Copying into project" status) because the
 * user no longer waits for it; a failure is always reported and resolves to null. A finished copy comes
 * with its still-open ticket: the caller settles it once the copy is in use.
 */
async function copyToRaw(
  file: File,
  mediaId: string,
  decision: ProjectMediaCopyDecision,
  projectFileName: string | undefined,
  announce: boolean,
): Promise<{ relativePath: string; handle?: FileSystemFileHandle; ticket: ProjectMediaCopyTicket } | null> {
  const held = await runHeldProjectMediaCopy(file, decision, () => projectFileService.copyToRawFolder(file, projectFileName), { announce });
  if (!held) return null;
  const result = held.value;
  try {
    // Store the project file handle for the RAW copy
    if (result.handle) {
      fileSystemService.storeFileHandle(`${mediaId}_project`, result.handle);
      await projectDB.storeHandle(`media_${mediaId}_project`, result.handle);
    }
  } catch (error) {
    held.ticket.fail(error);
    throw error;
  }
  log.debug('Copied to Raw folder:', { path: result.relativePath, reason: decision.reason });
  return { relativePath: result.relativePath, handle: result.handle, ticket: held.ticket };
}

/**
 * The copy of a `copyInBackground` import: placement does not wait for it. Its sub-phases land in its own
 * 'background-copy' timing report. Resolves to the copy (ticket still open) or null after a reported
 * failure; it never rejects, so a copy nobody awaits any more can never become an unhandled rejection.
 */
async function copyIntoProjectInBackground(
  file: File,
  id: string,
  decision: ProjectMediaCopyDecision,
  projectFileName: string | undefined,
  type: MediaFile['type'],
): Promise<ProjectCopySource | null> {
  const copyTimer = beginMediaImportTiming('background-copy', type, file.size);
  const stopCopyPhases = watchMediaCopyPhases(file, (phase, ms) => copyTimer.add(phase, ms));
  try {
    const copied = await copyTimer.time('copy', copyToRaw(file, id, decision, projectFileName, true));
    if (!copied) { copyTimer.finish('failed'); return null; }
    let projectFile: File | null;
    try { projectFile = await copyTimer.time('copy_switch', promoteProjectCopy(file, id, copied)); }
    catch (error) { copied.ticket.fail(error); throw error; }
    copyTimer.finish('ok');
    return { relativePath: copied.relativePath, handle: copied.handle, ticket: copied.ticket, file: projectFile ?? file };
  } catch (error) {
    // Already reported through the copy's ticket (copyToRaw / promote): the media keep the original File.
    copyTimer.finish('failed');
    log.warn('Background copy into the project failed', { id, name: file.name, error });
    return null;
  } finally {
    stopCopyPhases();
  }
}

/**
 * Settles a background copy whose media were never committed (the import failed or its target changed
 * meanwhile): waits for it and records it as unused, so the status neither stays "copying" nor says
 * "Copied" for a file no media use. The file itself stays in Raw (see ProjectMediaCopyTicket.unused).
 */
export function releaseUnusedProjectCopy(projectCopy: Promise<ProjectCopySource | null>, reason: string): void {
  void projectCopy.then((copied) => {
    if (!copied) return;
    log.warn('A background copy into the project is not used: its import did not finish', { projectPath: copied.relativePath, reason });
    copied.ticket?.unused(reason);
  });
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
