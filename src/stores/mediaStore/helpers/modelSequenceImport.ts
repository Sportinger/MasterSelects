import { Logger } from '../../../services/logger';
import { projectDB } from '../../../services/projectDB';
import { projectFileService } from '../../../services/projectFileService';
import { fileSystemService } from '../../../services/fileSystemService';
import type { ModelSequenceData, ModelSequenceFrame } from '../../../types';
import {
  buildModelSequenceData,
  getModelSequenceDuration,
  type GroupedModelSequence,
  type ModelSequenceImportEntry,
} from '../../../utils/modelSequence';
import { useSettingsStore } from '../../settingsStore';
import type { MediaFile } from '../types';

const log = Logger.create('ModelSequenceImport');

function shouldCopyFramesToProject(
  entries: ModelSequenceImportEntry[],
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
  return normalized || 'glb-sequence';
}

function getSequenceFrameHandleCacheKey(id: string, index: number): string {
  return `${id}_frame_${index}`;
}

async function maybeCopyFramesToProject(
  sequenceName: string,
  entries: ModelSequenceImportEntry[],
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

export interface ProcessModelSequenceImportParams<T extends ModelSequenceImportEntry = ModelSequenceImportEntry> {
  id: string;
  parentId?: string | null;
  sequence: GroupedModelSequence<T>;
  forceCopyToProject?: boolean;
  onProgress?: (progress: number) => void;
}

export async function processModelSequenceImport<T extends ModelSequenceImportEntry>(
  params: ProcessModelSequenceImportParams<T>,
): Promise<MediaFile> {
  const { id, parentId, sequence, forceCopyToProject, onProgress } = params;
  const firstEntry = sequence.entries[0];
  if (!firstEntry) {
    throw new Error('Model sequence import requires at least one frame');
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

  const frames: ModelSequenceFrame[] = [];
  for (let index = 0; index < sequence.entries.length; index += 1) {
    const entry = sequence.entries[index];
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
      modelUrl: URL.createObjectURL(entry.file),
    });
    advanceProgress();
  }

  const modelSequence: ModelSequenceData = buildModelSequenceData(frames, {
    fps: 30,
    playbackMode: 'clamp',
    sequenceName: sequence.sequenceName,
  });

  const duration = getModelSequenceDuration(modelSequence);
  const totalSize = sequence.entries.reduce((sum, entry) => sum + (entry.file.size || 0), 0);

  const mediaFile: MediaFile = {
    id,
    name: sequence.displayName,
    type: 'model',
    parentId: parentId ?? null,
    createdAt: Date.now(),
    file: firstEntry.file,
    url: frames[0]?.modelUrl ?? '',
    modelSequence,
    duration,
    fps: modelSequence.fps,
    fileSize: totalSize,
    hasFileHandle: !!firstEntry.handle || !!firstProjectHandle,
    filePath: firstEntry.absolutePath ?? firstEntry.handle?.name ?? firstEntry.file.name,
    absolutePath: firstEntry.absolutePath,
    projectPath: copiedFrames[0]?.relativePath,
    isImporting: false,
  };

  log.info('Imported GLB sequence', {
    id,
    frameCount: modelSequence.frameCount,
    fps: modelSequence.fps,
    name: mediaFile.name,
  });

  reportProgress(100);
  return mediaFile;
}
