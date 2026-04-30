import { loadGaussianSplatAsset } from '../../../engine/gaussian/loaders';
import { Logger } from '../../../services/logger';
import { projectDB } from '../../../services/projectDB';
import { projectFileService } from '../../../services/projectFileService';
import { fileSystemService } from '../../../services/fileSystemService';
import type { GaussianSplatSequenceData, GaussianSplatSequenceFrame } from '../../../types';
import {
  buildGaussianSplatSequenceData,
  cloneGaussianSplatBounds,
  getGaussianSplatSequenceDuration,
  type GaussianSplatSequenceImportEntry,
  type GroupedGaussianSplatSequence,
} from '../../../utils/gaussianSplatSequence';
import { useSettingsStore } from '../../settingsStore';
import type { MediaFile } from '../types';
import { readGaussianSplatFileStats, summarizeGaussianSplatSequenceStats } from './gaussianSplatStats';

const log = Logger.create('GaussianSplatSequenceImport');

function shouldCopyFramesToProject(
  entries: GaussianSplatSequenceImportEntry[],
  forceCopyToProject = false,
): boolean {
  const { copyMediaToProject } = useSettingsStore.getState();
  const hasVolatileFrames = entries.some((entry) => !entry.handle);
  return projectFileService.isProjectOpen() && (
    copyMediaToProject ||
    forceCopyToProject ||
    hasVolatileFrames ||
    entries.length > 1
  );
}

function buildSequenceRawFolderName(sequenceName: string): string {
  const normalized = sequenceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized || 'splat-sequence';
}

function getSequenceFrameHandleCacheKey(id: string, index: number): string {
  return `${id}_frame_${index}`;
}

async function resolveSequenceSharedBounds(
  entry: GaussianSplatSequenceImportEntry | undefined,
): Promise<GaussianSplatSequenceData['sharedBounds']> {
  if (!entry?.file) {
    return undefined;
  }

  try {
    const asset = await loadGaussianSplatAsset(entry.file);
    return cloneGaussianSplatBounds(asset.metadata.boundingBox);
  } catch (error) {
    log.warn('Failed to resolve gaussian splat sequence shared bounds', {
      fileName: entry.file.name,
      error,
    });
    return undefined;
  }
}

async function maybeCopyFramesToProject(
  sequenceName: string,
  entries: GaussianSplatSequenceImportEntry[],
  forceCopyToProject = false,
  onFrameCopied?: () => void,
): Promise<Array<{ handle?: FileSystemFileHandle; relativePath?: string }>> {
  if (!shouldCopyFramesToProject(entries, forceCopyToProject)) {
    return entries.map(() => ({}));
  }

  const folderName = buildSequenceRawFolderName(sequenceName);
  const copies: Array<{ handle?: FileSystemFileHandle; relativePath?: string }> = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const copied = await projectFileService.copyToRawFolder(
      entry.file,
      `${folderName}/${entry.file.name}`,
    );
    copies.push({
      handle: copied?.handle,
      relativePath: copied?.relativePath,
    });
    onFrameCopied?.();
  }

  return copies;
}

export interface ProcessGaussianSplatSequenceImportParams<T extends GaussianSplatSequenceImportEntry = GaussianSplatSequenceImportEntry> {
  id: string;
  parentId?: string | null;
  sequence: GroupedGaussianSplatSequence<T>;
  forceCopyToProject?: boolean;
  onProgress?: (progress: number) => void;
}

export async function processGaussianSplatSequenceImport<T extends GaussianSplatSequenceImportEntry>(
  params: ProcessGaussianSplatSequenceImportParams<T>,
): Promise<MediaFile> {
  const { id, parentId, sequence, forceCopyToProject, onProgress } = params;
  const firstEntry = sequence.entries[0];
  if (!firstEntry) {
    throw new Error('Gaussian splat sequence import requires at least one frame');
  }

  const reportProgress = (value: number) => {
    onProgress?.(Math.max(0, Math.min(100, Math.round(value))));
  };
  const willCopyFrames = shouldCopyFramesToProject(sequence.entries, forceCopyToProject === true);
  const totalWorkUnits = Math.max(1, sequence.entries.length * (willCopyFrames ? 2 : 1));
  let completedWorkUnits = 0;
  const advanceProgress = () => {
    completedWorkUnits += 1;
    reportProgress(Math.min(99, (completedWorkUnits / totalWorkUnits) * 100));
  };

  reportProgress(0);

  const copiedFrames = await maybeCopyFramesToProject(
    sequence.sequenceName,
    sequence.entries,
    forceCopyToProject === true,
    advanceProgress,
  );

  if (firstEntry.handle) {
    fileSystemService.storeFileHandle(id, firstEntry.handle);
    await projectDB.storeHandle(`media_${id}`, firstEntry.handle);
  }

  const firstProjectHandle = copiedFrames[0]?.handle;
  if (firstProjectHandle) {
    fileSystemService.storeFileHandle(`${id}_project`, firstProjectHandle);
    await projectDB.storeHandle(`media_${id}_project`, firstProjectHandle);
  }

  const frames: GaussianSplatSequenceFrame[] = [];
  for (let index = 0; index < sequence.entries.length; index += 1) {
    const entry = sequence.entries[index];
    const frameStats = await readGaussianSplatFileStats(entry.file);
    if (entry.handle) {
      const frameHandleKey = getSequenceFrameHandleCacheKey(id, index);
      fileSystemService.storeFileHandle(frameHandleKey, entry.handle);
      await projectDB.storeHandle(`media_${frameHandleKey}`, entry.handle);
    }
    frames.push({
      name: entry.file.name,
      projectPath: copiedFrames[index]?.relativePath,
      sourcePath: entry.absolutePath ?? entry.file.name,
      absolutePath: entry.absolutePath,
      file: entry.file,
      splatUrl: URL.createObjectURL(entry.file),
      splatCount: frameStats.splatCount,
      fileSize: frameStats.fileSize,
      container: frameStats.container,
      codec: frameStats.codec,
    });
    advanceProgress();
  }

  const sharedBounds = await resolveSequenceSharedBounds(firstEntry);
  const sequenceStats = summarizeGaussianSplatSequenceStats(frames);
  const baseGaussianSplatSequence = buildGaussianSplatSequenceData(frames, {
    fps: 30,
    playbackMode: 'clamp',
    sequenceName: sequence.sequenceName,
    sharedBounds,
  });
  const gaussianSplatSequence: GaussianSplatSequenceData = {
    ...baseGaussianSplatSequence,
    totalSplatCount: sequenceStats.totalSplatCount,
    minSplatCount: sequenceStats.minSplatCount,
    maxSplatCount: sequenceStats.maxSplatCount,
    totalFileSize: sequenceStats.fileSize,
    container: sequenceStats.container,
    codec: sequenceStats.codec,
  };

  const duration = getGaussianSplatSequenceDuration(gaussianSplatSequence);
  const totalSize = sequence.entries.reduce((sum, entry) => sum + (entry.file.size || 0), 0);

  const mediaFile: MediaFile = {
    id,
    name: sequence.displayName,
    type: 'gaussian-splat',
    parentId: parentId ?? null,
    createdAt: Date.now(),
    file: firstEntry.file,
    url: frames[0]?.splatUrl ?? '',
    gaussianSplatSequence,
    duration,
    fps: gaussianSplatSequence.fps,
    container: sequenceStats.container ? `${sequenceStats.container} Seq` : undefined,
    codec: sequenceStats.codec,
    fileSize: sequenceStats.fileSize || totalSize,
    splatCount: sequenceStats.splatCount,
    totalSplatCount: sequenceStats.totalSplatCount,
    splatFrameCount: gaussianSplatSequence.frameCount,
    hasFileHandle: !!firstEntry.handle || !!firstProjectHandle,
    filePath: firstEntry.absolutePath ?? firstEntry.handle?.name ?? firstEntry.file.name,
    absolutePath: firstEntry.absolutePath,
    projectPath: copiedFrames[0]?.relativePath,
    isImporting: false,
  };

  log.info('Imported gaussian splat sequence', {
    id,
    frameCount: gaussianSplatSequence.frameCount,
    fps: gaussianSplatSequence.fps,
    name: mediaFile.name,
  });

  reportProgress(100);
  return mediaFile;
}
