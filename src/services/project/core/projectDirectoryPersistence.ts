import { Logger } from '../../logger';
import { projectDB } from '../../projectDB';
import {
  getTabLastProjectHandleKey,
  LEGACY_LAST_PROJECT_HANDLE_KEY,
  storeLastOpfsProjectName,
} from '../tabProjectPersistence';
import { ensurePersistentStorage, resolveProjectRootMode } from './projectRootAccess';

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
    ? navigator.storage.getDirectory()
    : projectDB.getStoredHandle('projectsFolder');
}

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
  } catch (error) {
    log.warn('Failed to store last project:', error);
  }
}
