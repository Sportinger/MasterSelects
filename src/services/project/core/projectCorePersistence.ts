import { isLinkedArtifactEntry, persistLinkedArtifacts, readLinkedArtifact } from './linkedArtifactFiles';
import { persistLinkedTerrain, readLinkedTerrain } from './linkedTerrainGeometry';
import { getProjectWriteSupportError, resolveProjectRootMode } from './projectRootAccess';
import { Logger } from '../../logger';
import { shouldPreferAutosave } from './autosaveRecovery';
import type { ProjectFile } from '../types/project.types';
import { PROJECT_FOLDERS, type ProjectFolderKey } from './constants';
import {
  decodeProjectPackage,
  getProjectPackageFileName,
  isPackagedProjectFolder,
  isProjectPackageFileName,
  ProjectPackageSession,
} from './projectPackage';

const log = Logger.create('ProjectCore');

export const PROJECT_FILE_NAME = 'project.json';
export const PROJECT_AUTOSAVE_FILE_NAME = 'project.autosave.json';

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

export interface LoadedFsaProjectPackage {
  projectData: ProjectFile;
  session: ProjectPackageSession;
}

function getWritablePackageBuffer(content: Uint8Array): ArrayBuffer {
  if (
    content.buffer instanceof ArrayBuffer
    && content.byteOffset === 0
    && content.byteLength === content.buffer.byteLength
  ) {
    return content.buffer;
  }

  return content.slice().buffer as ArrayBuffer;
}

function isSwapFileAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && 'message' in error
    && error.name === 'AbortError'
    && typeof error.message === 'string'
    && error.message.includes('Failed to create swap file');
}

function isStaleFileSystemStateError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'InvalidStateError';
}

function isRecoverableProjectWriteError(error: unknown): boolean {
  return isSwapFileAbortError(error) || isStaleFileSystemStateError(error);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readFsaProjectFile(
  handle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<ProjectFile | null> {
  try {
    const projectFile = await handle.getFileHandle(fileName);
    const file = await projectFile.getFile();
    const content = await file.text();
    return JSON.parse(content) as ProjectFile;
  } catch (error) {
    if (fileName !== PROJECT_AUTOSAVE_FILE_NAME) {
      throw error;
    }
    return null;
  }
}

export async function readLatestFsaProjectData(handle: FileSystemDirectoryHandle): Promise<ProjectFile> {
  const projectData = await readFsaProjectFile(handle, PROJECT_FILE_NAME);
  if (!projectData) {
    throw new Error('Project file missing');
  }

  const autosaveData = await readFsaProjectFile(handle, PROJECT_AUTOSAVE_FILE_NAME);

  if (shouldPreferAutosave(projectData, autosaveData)) {
    log.warn('Loaded project.autosave.json because it is newer or project.json appears empty');
    return autosaveData ?? projectData;
  }

  return projectData;
}

export async function writeFsaProjectJsonWithAutosaveFallback(
  handle: FileSystemDirectoryHandle,
  data: ProjectFile,
): Promise<void> {
  try {
    await writeFsaProjectFile(handle, PROJECT_FILE_NAME, data);
  } catch (error) {
    if (!isRecoverableProjectWriteError(error)) {
      throw error;
    }

    await writeFsaProjectFile(handle, PROJECT_AUTOSAVE_FILE_NAME, data);
    log.warn('project.json write failed; persisted latest state to project.autosave.json', error);
  }
}

export async function writeFsaProjectFile(
  handle: FileSystemDirectoryHandle,
  fileName: string,
  data: ProjectFile,
): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // Chromium can invalidate a FileSystemFileHandle when the file changed
      // outside the cached interface object. Reacquire it for every attempt.
      const fileHandle = await handle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (error) {
      lastError = error;
      if (!isRecoverableProjectWriteError(error) || attempt === 2) {
        break;
      }
      await wait(150 * (attempt + 1));
    }
  }

  throw lastError;
}

async function findFsaProjectPackageFile(
  handle: FileSystemDirectoryHandle,
): Promise<FileSystemFileHandle | null> {
  const packageFiles: FileSystemFileHandle[] = [];
  for await (const entry of (handle as IterableDirectoryHandle).values()) {
    if (entry.kind === 'file' && isProjectPackageFileName(entry.name)) {
      packageFiles.push(entry);
    }
  }
  if (packageFiles.length === 0) return null;
  if (packageFiles.length === 1) return packageFiles[0] ?? null;

  const preferredName = getProjectPackageFileName(handle.name).toLowerCase();
  return packageFiles.find((entry) => entry.name.toLowerCase() === preferredName)
    ?? packageFiles.toSorted((left, right) => left.name.localeCompare(right.name))[0]
    ?? null;
}

export async function readFsaProjectPackage(
  handle: FileSystemDirectoryHandle,
): Promise<LoadedFsaProjectPackage | null> {
  const packageHandle = await findFsaProjectPackageFile(handle);
  if (!packageHandle) return null;
  const file = await packageHandle.getFile();
  const archive = await decodeProjectPackage(await file.arrayBuffer(), (mediaFolder, path) => isLinkedArtifactEntry(path)
    ? readLinkedArtifact(handle, mediaFolder, path) : readLinkedTerrain(handle, mediaFolder, path));
  return {
    projectData: archive.projectData,
    session: ProjectPackageSession.fromArchive(archive, packageHandle.name),
  };
}

let packageWriteProgress: { phase: string; startedAt: number; updatedAt: number; chunks: number; bytes: number } | null = null;
export function getPackageWriteProgress() {
  return packageWriteProgress ? { ...packageWriteProgress, elapsedMs: Date.now() - packageWriteProgress.startedAt, idleMs: Date.now() - packageWriteProgress.updatedAt } : null;
}

async function openProjectPackageWritable(
  handle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<FileSystemWritableFileStream> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // Retry acquisition only: no archive bytes have been written yet.
      // Each attempt must reacquire the file handle, not reuse stale state.
      const fileHandle = await handle.getFileHandle(fileName, { create: true });
      return await fileHandle.createWritable();
    } catch (error) {
      if (!isRecoverableProjectWriteError(error) || attempt >= 2) throw error;
      await wait(150 * (attempt + 1));
    }
  }
}

export async function writeFsaProjectPackage(
  handle: FileSystemDirectoryHandle,
  session: ProjectPackageSession,
  projectData: ProjectFile,
): Promise<void> {
  const progress = { phase: 'opening', startedAt: Date.now(), updatedAt: Date.now(), chunks: 0, bytes: 0 };
  packageWriteProgress = progress;
  let writable: FileSystemWritableFileStream | undefined;
  try {
    const supportError = resolveProjectRootMode() === 'opfs' ? getProjectWriteSupportError() : null;
    if (supportError) throw new DOMException(supportError, 'NotSupportedError');
    // Snapshot sidecars once so files arriving during this save belong to the next save.
    const entries = new Map(session.getEntries());
    progress.phase = 'persisting-artifacts';
    const linkedArtifacts = await persistLinkedArtifacts(handle, session.getMediaFolderName(), entries);
    const linkedTerrain = await persistLinkedTerrain(handle, session.getMediaFolderName(), projectData);
    progress.phase = 'opening';
    writable = await openProjectPackageWritable(handle, session.getPackageFileName());
    progress.phase = 'compressing';
    // FSA writes have per-call IPC overhead. ZIP emits hundreds of tiny chunks;
    // aggregate them without buffering the entire archive in memory.
    const batch = new Uint8Array(1024 * 1024);
    let used = 0;
    const flush = async () => {
      if (!used) return;
      progress.phase = 'writing';
      await writable!.write(getWritablePackageBuffer(batch.subarray(0, used)));
      progress.chunks++; progress.bytes += used; progress.updatedAt = Date.now();
      used = 0;
      progress.phase = 'compressing';
    };
    await session.streamEncode(projectData, async (chunk) => {
      let offset = 0;
      while (offset < chunk.byteLength) {
        const count = Math.min(batch.byteLength - used, chunk.byteLength - offset);
        batch.set(chunk.subarray(offset, offset + count), used);
        offset += count; used += count;
        if (used === batch.byteLength) await flush();
      }
    }, linkedTerrain, linkedArtifacts, entries);
    await flush();
    progress.phase = 'closing'; progress.updatedAt = Date.now();
    await writable.close();
    progress.phase = 'complete'; progress.updatedAt = Date.now();
  } catch (error) {
    log.warn('Project package write failed before completion', { phase: progress.phase });
    progress.phase = 'failed'; progress.updatedAt = Date.now();
    await writable?.abort().catch(() => undefined);
    throw error;
  }
}

async function importLegacyDirectory(
  folder: FileSystemDirectoryHandle,
  entryPrefix: string,
  session: ProjectPackageSession,
): Promise<void> {
  for await (const entry of (folder as IterableDirectoryHandle).values()) {
    const path = `${entryPrefix}/${entry.name}`;
    if (entry.kind === 'directory') {
      await importLegacyDirectory(entry, path, session);
      continue;
    }
    const file = await entry.getFile();
    session.addMigratedEntry(path, new Uint8Array(await file.arrayBuffer()));
  }
}

export async function importLegacyFsaPackageEntries(
  handle: FileSystemDirectoryHandle,
  session: ProjectPackageSession,
): Promise<void> {
  for (const [folderKey, folderPath] of Object.entries(PROJECT_FOLDERS) as Array<[ProjectFolderKey, string]>) {
    if (!isPackagedProjectFolder(folderKey)) continue;
    const parts = folderPath.split('/').filter(Boolean);
    let folder: FileSystemDirectoryHandle = handle;
    try {
      for (const part of parts) folder = await folder.getDirectoryHandle(part, { create: false });
    } catch {
      continue;
    }
    await importLegacyDirectory(folder, folderPath, session);
  }
}
