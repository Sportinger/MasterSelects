import { Logger } from '../../logger';
import { shouldPreferAutosave } from './autosaveRecovery';
import type { ProjectFile } from '../types/project.types';

const log = Logger.create('ProjectCore');

export const PROJECT_FILE_NAME = 'project.json';
export const PROJECT_AUTOSAVE_FILE_NAME = 'project.autosave.json';

function isSwapFileAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && 'message' in error
    && error.name === 'AbortError'
    && typeof error.message === 'string'
    && error.message.includes('Failed to create swap file');
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
    if (!isSwapFileAbortError(error)) {
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
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const content = JSON.stringify(data, null, 2);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (error) {
      lastError = error;
      if (!isSwapFileAbortError(error) || attempt === 2) {
        break;
      }
      await wait(150 * (attempt + 1));
    }
  }

  throw lastError;
}
