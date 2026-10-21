// Moves projects out of the temporary IndexedDB fallback into this browser's
// persistent project storage (OPFS) once OPFS works again: in a later tab, after
// the browser granted storage, or when MasterSelects runs from the Home Screen.
// A source is removed only after its copy was verified; failures keep it.

import { Logger } from '../../logger';
import { RepositoryError, type RepositoryDescriptor } from '../repository/contracts';
import { browserRepositoryLocationId, createOpfsRepositoryBackend } from '../repository/backends/opfsBackend';
import { moveRepositoryLocationIdentity } from '../repository/backends/repositoryLocationIdentity';
import { supportsRepositoryWritableStreams } from '../repository/backends/directoryBackend';
import { readJson } from '../repository/archive/streamIO';
import { flushEditorRepository, getActiveRepositorySession, isScratchRepository, readEditorRepositoryProject } from '../repository/lifecycle/editorRepositoryLifecycle';
import { getBrowserStorageKind, getBrowserStorageRootOf, openPersistentBrowserRoot, switchBrowserStorageToOpfs } from '../core/browserStorageRoot';
import { fallbackStoreExists } from '../core/indexedDbEntryStore';
import { ensurePersistentStorage, listProjectFolderNames } from '../core/projectRootAccess';
import { addRecentOpfsProject, getRecentProjects, removeRecentProject } from '../recentProjects';
import { copyDirectoryVerified, freeFolderName } from './verifiedDirectoryCopy';
import { isTemporaryProjectLocation } from './permanentSaveOptions';
import { verifyProjectSwitch } from './projectSwitchVerification';

const log = Logger.create('PermanentSave');
const PROBE_FILE = '.masterselects-storage-probe';

/** True when OPFS opens and accepts a write in this tab right now (never throws). */
export async function canUsePersistentBrowserStorage(): Promise<boolean> {
  if (!supportsRepositoryWritableStreams()) return false;
  try {
    const root = await openPersistentBrowserRoot();
    const probe = await root.getFileHandle(PROBE_FILE, { create: true });
    const writable = await probe.createWritable();
    await writable.write(new Uint8Array([1]));
    await writable.close();
    await root.removeEntry(PROBE_FILE).catch(() => {});
    return true;
  } catch (error) {
    log.debug('Persistent browser storage is not available in this tab', error);
    return false;
  }
}

/** Project folders still held in the fallback database, other than the open project. */
export async function listTemporaryProjects(): Promise<string[]> {
  if (getBrowserStorageKind() !== 'indexeddb' && !await fallbackStoreExists()) return [];
  const names = await listProjectFolderNames(await getBrowserStorageRootOf('indexeddb'));
  const active = getActiveRepositorySession()?.location;
  return isTemporaryProjectLocation(active) && active?.kind === 'opfs' ? names.filter(name => name !== active.path) : names;
}

async function readDescriptor(path: string): Promise<{ backend: Awaited<ReturnType<typeof createOpfsRepositoryBackend>>; descriptor: RepositoryDescriptor } | null> {
  const backend = await createOpfsRepositoryBackend(path, 'indexeddb');
  if (!await backend.stat('project.msrepo.json')) return null;
  return { backend, descriptor: await readJson<RepositoryDescriptor>(backend, 'project.msrepo.json', 65536) };
}

/**
 * Removes a fallback project folder whose persistent copy was verified. A folder
 * that another tab holds open is kept (returns false) instead of being pulled away.
 */
export async function removeTemporaryCopy(path: string): Promise<boolean> {
  const repository = await readDescriptor(path);
  const owner = repository ? await repository.backend.acquireOwner(repository.descriptor.repositoryId) : null;
  if (repository && !owner) {
    log.warn('Temporary project copy is still open elsewhere; it was kept', { path });
    return false;
  }
  try {
    const root = await getBrowserStorageRootOf('indexeddb');
    await root.removeEntry(path, { recursive: true });
    log.info('Removed the verified temporary project copy', { path });
    return true;
  } finally { await owner?.release(); }
}

async function forgetRecentEntry(path: string): Promise<void> {
  const entry = getRecentProjects().find(item => item.backend === 'opfs' && item.path === path);
  if (entry) await removeRecentProject(entry.id);
}

export interface MovedProject { from: string; to: string; removedTemporary: boolean }

/** Moves one project that is not open here; it is locked against other tabs while copying. */
export async function moveTemporaryProject(name: string, onFile?: (path: string) => void): Promise<MovedProject> {
  const repository = await readDescriptor(name);
  const owner = repository ? await repository.backend.acquireOwner(repository.descriptor.repositoryId) : null;
  if (repository && !owner) throw new RepositoryError('ownership', `"${name}" is open in another tab. Close it there and try again.`);
  const target = await openPersistentBrowserRoot();
  const folder = await freeFolderName(target, name);
  try {
    const source = await (await getBrowserStorageRootOf('indexeddb')).getDirectoryHandle(name);
    try {
      const copied = await copyDirectoryVerified(source, await target.getDirectoryHandle(folder, { create: true }), onFile);
      log.info('Temporary project copied and verified in persistent browser storage', { name, folder, ...copied });
      // The copy keeps its repository identity: hand the writer registration to it, or it would open read-only.
      if (repository && !await moveRepositoryLocationIdentity(repository.descriptor.repositoryId, repository.backend.locationId, browserRepositoryLocationId('opfs', folder))) {
        log.warn('The moved project could not take over its writer registration; it may open read-only', { name, folder });
      }
    } catch (error) {
      // Only the incomplete target is discarded; the source stays untouched.
      await target.removeEntry(folder, { recursive: true }).catch(() => {});
      throw error;
    }
    await (await getBrowserStorageRootOf('indexeddb')).removeEntry(name, { recursive: true });
  } finally { await owner?.release(); }
  if (folder !== name) await forgetRecentEntry(name);
  return { from: name, to: folder, removedTemporary: true };
}

export interface ActiveProjectMove extends MovedProject { persisted: boolean }

/**
 * Opens a copy of the open project in OPFS as the project core's own session
 * (projectFileService.createProjectInBrowserStorage), so thumbnails, waveforms and
 * caches follow the copy instead of the temporary folder removed afterwards.
 */
export type OpenBrowserStorageCopy = (path: string, name: string) => Promise<boolean>;

/**
 * Copies the open temporary project (history, journals, workspace views) into
 * OPFS as a new repository, opens it there, verifies it and only then retires the
 * temporary copy. The browser recovery area itself is never deleted.
 */
export async function moveActiveProjectToPersistentBrowserStorage(openCopy: OpenBrowserStorageCopy): Promise<ActiveProjectMove> {
  const session = getActiveRepositorySession();
  if (!session || !isTemporaryProjectLocation(session.location) || session.location.kind !== 'opfs') {
    throw new RepositoryError('conflict', 'The open project is not in temporary storage.');
  }
  if (!session.opening.writable) throw new RepositoryError('ownership', 'This tab can only read the project. Take over editing first.');
  if (!await canUsePersistentBrowserStorage()) {
    throw new RepositoryError('unsupported', 'This browser still refuses its permanent project storage. Save to a folder or download a .msproj archive instead.');
  }
  const persisted = await ensurePersistentStorage();
  const from = session.location.path;
  const scratch = isScratchRepository();
  const name = readEditorRepositoryProject()?.name?.trim() || 'Untitled Project';
  await flushEditorRepository();
  const revisionId = session.coordinator.getProjection().revisionId;
  const folder = await freeFolderName(await openPersistentBrowserRoot(), name);
  if (!await openCopy(folder, name)) throw new RepositoryError('io', 'The permanent copy could not be created. The temporary project was kept.');
  await verifyProjectSwitch(session, revisionId, location => location.kind === 'opfs' && location.path === folder && location.store === 'opfs');
  switchBrowserStorageToOpfs();
  await addRecentOpfsProject(folder, readEditorRepositoryProject());
  let removedTemporary = false;
  if (!scratch) {
    try {
      removedTemporary = await removeTemporaryCopy(from);
      if (removedTemporary && folder !== from) await forgetRecentEntry(from);
    } catch (error) { log.warn('The verified project is open; removing its temporary copy failed', error); }
  }
  return { from, to: folder, removedTemporary, persisted };
}
