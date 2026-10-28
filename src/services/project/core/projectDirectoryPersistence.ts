import { Logger } from '../../logger';
import { projectDB } from '../../projectDB';
import {
  forgetLastOpfsProjectName,
  getTabLastProjectHandleKey,
  LEGACY_LAST_PROJECT_HANDLE_KEY,
  storeLastOpfsProjectName,
} from '../tabProjectPersistence';
import { ensurePersistentStorage, resolveProjectRootMode } from './projectRootAccess';
import { getBrowserStorageRoot } from './browserStorageRoot';

const log = Logger.create('ProjectDirectoryPersistence');

/** OPFS directories are re-derived by name; only user-picked roots need a cache. */
export async function rememberProjectParent(handle: FileSystemDirectoryHandle): Promise<void> {
  if (resolveProjectRootMode() === 'opfs') return;
  await ensurePersistentStorage();
  await projectDB.storeHandle('projectsFolder', handle).catch(error => {
    log.warn('Could not cache projects folder; continuing with selected folder', error);
  });
}

export async function readProjectParent(): Promise<FileSystemHandle | null> {
  return resolveProjectRootMode() === 'opfs'
    ? getBrowserStorageRoot()
    : projectDB.getStoredHandle('projectsFolder');
}

/**
 * "Last project" is one record per tab (plus the shared one a new tab falls back to), whatever the backend:
 * the newest opened project replaces the record of the other kind. A device with a folder picker also keeps
 * projects in browser storage (the phone creates them there), so remembering only one kind would restore
 * an older folder project instead of the browser project opened since.
 */
export async function rememberLastProject(handle: FileSystemDirectoryHandle): Promise<void> {
  if (resolveProjectRootMode() === 'opfs') {
    storeLastOpfsProjectName(handle.name);
    return;
  }
  await ensurePersistentStorage();
  try {
    await Promise.all([
      projectDB.storeHandle(getTabLastProjectHandleKey(), handle),
      projectDB.storeHandle(LEGACY_LAST_PROJECT_HANDLE_KEY, handle),
    ]);
    forgetLastOpfsProjectName();
  } catch (error) {
    log.warn('Failed to store last project:', error);
  }
}

/** A browser-storage project became the last project: it replaces any remembered folder project. */
export async function rememberLastStoredProject(path: string): Promise<void> {
  storeLastOpfsProjectName(path);
  try {
    await Promise.all([
      projectDB.deleteHandle(getTabLastProjectHandleKey()),
      projectDB.deleteHandle(LEGACY_LAST_PROJECT_HANDLE_KEY),
    ]);
  } catch (error) { log.warn('Could not forget the previous last project folder', error); }
}

/** A picked folder that was deleted or moved since its handle was stored rejects its first listing with NotFoundError. */
export async function directoryHandleExists(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await (handle as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }).keys().next();
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return false;
    throw error;
  }
}
