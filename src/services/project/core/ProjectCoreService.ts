import { updateEditorRepositoryProjectFields } from '../repository/transaction/editorRepositorySession';
import { forgetAndroidProjectAutoRestoreUnless, isAndroidAutoRestoreProjectHandle } from '../androidProjectAutoRestore';
import { Logger } from '../../logger';
import { projectDB } from '../../projectDB';
import type { FileStorageService } from './FileStorageService';
import type { ProjectFile, ProjectMediaFile, ProjectComposition, ProjectFolder } from '../types';
import { acquireProjectRoot, getProjectWriteSupportError, resolveProjectRootMode, listProjectFolderNames } from './projectRootAccess';
import { directoryHandleExists, rememberLastProject, rememberLastStoredProject, rememberProjectParent } from './projectDirectoryPersistence';
import { addRecentFsaProject, addRecentOpfsProject, getRecentFsaProjectMediaFileIds, getRecentFsaProjectMediaSourceRootIds } from '../recentProjects';
import { requestMediaFileAccess, requestMediaSourceRootAccess } from '../mediaSourceRootAccess';
import { getTabLastProjectHandleKey, getTabOpfsLastProjectNameKey, LEGACY_LAST_PROJECT_HANDLE_KEY, LEGACY_OPFS_LAST_PROJECT_NAME_KEY } from '../tabProjectPersistence';
import { openRepositoryProject, createRepositoryAt, renameRepositoryProject, createIndependentProjectBackup, repositoryHasUnsavedChanges } from '../repository/lifecycle/repositoryProjectOperations';
import { closeEditorRepository, flushEditorRepository, getActiveRepositorySession, readEditorRepositoryProject, isScratchRepository } from '../repository/lifecycle/editorRepositoryLifecycle';
import { directoryForOpfs, isLegacyProjectLocation, opfsLocationExists } from '../repository/lifecycle/repositoryLocations';
import { requestLegacyImportTarget } from '../legacyImportTarget';
import type { RepositoryLocation } from '../repository/storageWorkerProtocol';
import { RepositoryError } from '../repository/contracts';
import type { NewProjectComposition } from '../repository/lifecycle/defaultProject';

const log = Logger.create('ProjectCore');
function readStoredName(key: string): string | null {
  try { return localStorage.getItem(key)?.trim() || null; } catch { return null; }
}
export class ProjectCoreService {
  private projectHandle: FileSystemDirectoryHandle | null = null;
  private pendingHandle: FileSystemDirectoryHandle | null = null;
  constructor(_fileStorage: FileStorageService) {}
  isSupported(): boolean { return resolveProjectRootMode() !== 'none'; }
  getProjectHandle(): FileSystemDirectoryHandle | null { return this.projectHandle; }
  getProjectData(): ProjectFile | null { return readEditorRepositoryProject(); }
  isProjectOpen(): boolean { return Boolean(getActiveRepositorySession()) && !isScratchRepository(); }
  hasUnsavedChanges(): boolean { return repositoryHasUnsavedChanges(); }
  markDirty(): void { /* Domain transactions and bounded workspace slots own persistence. */ }
  needsPermission(): boolean { return this.pendingHandle !== null; }
  getPendingProjectName(): string | null { return this.pendingHandle?.name ?? null; }
  async requestPendingPermission(): Promise<boolean> {
    const handle = this.pendingHandle; if (!handle) return false;
    if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') return false;
    // Same click as the folder prompt: media folders and linked files lost access with the browser session too.
    await requestMediaSourceRootAccess(await getRecentFsaProjectMediaSourceRootIds(handle));
    await requestMediaFileAccess(await getRecentFsaProjectMediaFileIds(handle));
    const opened = await this.loadProject(handle); if (opened) this.pendingHandle = null; return opened;
  }
  async createProject(name: string, preserveCurrent = false, composition?: NewProjectComposition): Promise<boolean> {
    this.assertWritableProjects();
    const root = await acquireProjectRoot(resolveProjectRootMode(), { throwOnFailure: true }); if (!root) return false;
    return this.createProjectInFolder(root, name, preserveCurrent, composition);
  }
  async createProjectInFolder(parent: FileSystemDirectoryHandle, name: string, preserveCurrent = false, composition?: NewProjectComposition): Promise<boolean> {
    this.assertWritableProjects();
    await rememberProjectParent(parent);
    const handle = await parent.getDirectoryHandle(name, { create: true });
    const location: RepositoryLocation = resolveProjectRootMode() === 'opfs' ? { kind: 'opfs', path: name } : { kind: 'fsa', handle };
    await createRepositoryAt(location, name, preserveCurrent, composition);
    await this.adoptSession(handle); return true;
  }
  /** Read-only OPFS (no writable streams) must fail before any folder or repository is created. */
  private assertWritableProjects(): void {
    const error = getProjectWriteSupportError();
    if (error) { log.warn(error); throw new RepositoryError('unsupported', error); }
  }
  async openProject(): Promise<boolean> {
    if (resolveProjectRootMode() !== 'fsa') throw new RepositoryError('unsupported', 'Project folder selection is unavailable');
    const handle = await acquireProjectRoot('fsa', { throwOnFailure: true }); return handle ? this.loadProject(handle) : false;
  }
  /**
   * Save permanently > Keep in this browser: duplicates the open project with its
   * history into this browser's persistent storage (OPFS) and adopts it, so routed
   * files (thumbnails, waveforms, caches) follow the copy. Recents are left to the
   * caller, which records the copy only after verifying it.
   */
  async createProjectInBrowserStorage(path: string, name: string): Promise<boolean> {
    await createRepositoryAt({ kind: 'opfs', path, store: 'opfs' }, name, true);
    await this.adoptSession(undefined, false); return true;
  }
  async listStoredProjects(): Promise<string[]> {
    const root = await acquireProjectRoot('opfs', { throwOnFailure: true }); return root ? listProjectFolderNames(root) : [];
  }
  async openStoredProject(path: string, options: { signal?: AbortSignal } = {}): Promise<boolean> {
    if (!await opfsLocationExists(path)) throw new RepositoryError('io', `"${path}" is no longer stored in this browser.`);
    await openRepositoryProject({ kind: 'opfs', path }, { signal: options.signal }); await this.adoptSession(await directoryForOpfs(path)); return true;
  }
  async loadProject(handle: FileSystemDirectoryHandle): Promise<boolean> {
    const location: RepositoryLocation = resolveProjectRootMode() === 'opfs' || isAndroidAutoRestoreProjectHandle(handle) ? { kind: 'opfs', path: handle.name } : { kind: 'fsa', handle };
    if (location.kind === 'fsa' && await isLegacyProjectLocation(location)) {
      // Old files stay untouched; the repository is added in place unless an earlier separate conversion exists.
      const target = await requestLegacyImportTarget(handle); if (!target) return false;
      await openRepositoryProject(location, { legacyTarget: { kind: 'fsa', handle: target } }); await this.adoptSession(target); return true;
    }
    await openRepositoryProject(location); await this.adoptSession(handle); return true;
  }
  private async adoptSession(fallback?: FileSystemDirectoryHandle, remember = true): Promise<void> {
    const session = getActiveRepositorySession(); if (!session) throw new Error('Repository activation did not finish');
    const handle = session.location.kind === 'opfs' ? await directoryForOpfs(session.location.path, session.location.store)
      : session.location.kind === 'fsa' ? session.location.handle : fallback;
    if (!handle) throw new Error('Repository activation has no project directory');
    this.projectHandle = handle; this.pendingHandle = null;
    if (!remember) return;
    // The last opened project is restored next time, whatever its backend (see rememberLastProject).
    forgetAndroidProjectAutoRestoreUnless(session.location.kind === 'opfs' ? session.location.path : null);
    if (session.location.kind === 'opfs') {
      await rememberLastStoredProject(session.location.path);
      await addRecentOpfsProject(session.location.path, this.getProjectData(), session.location.store);
    } else { await rememberLastProject(handle); await addRecentFsaProject(handle, this.getProjectData()); }
  }
  async saveProject(): Promise<boolean> { return flushEditorRepository(); }
  async closeProject(): Promise<void> { await closeEditorRepository(); this.projectHandle = null; }
  async createBackup(): Promise<boolean> { return createIndependentProjectBackup(); }
  async renameProject(name: string): Promise<boolean> { return renameRepositoryProject(name); }
  /**
   * Restores the newest opened project: this tab's live browser project, then this tab's last project, then
   * the last project of any tab. Opening a project replaces the record of the other backend (adoptSession),
   * so within one level a browser-storage name and a folder handle only coexist in records from older
   * versions; the browser-storage name, which needs no permission, is tried first.
   */
  async restoreLastProject(): Promise<boolean> {
    const live = sessionStorage.getItem('ms.repository.last-opfs-path');
    if (live) return this.restoreStoredProject(live);
    const levels: Array<{ name: string | null; handleKey: string }> = [
      { name: readStoredName(getTabOpfsLastProjectNameKey()), handleKey: getTabLastProjectHandleKey() },
      { name: readStoredName(LEGACY_OPFS_LAST_PROJECT_NAME_KEY), handleKey: LEGACY_LAST_PROJECT_HANDLE_KEY },
    ];
    for (const { name, handleKey } of levels) {
      if (name) return this.restoreStoredProject(name);
      if (resolveProjectRootMode() === 'opfs') continue;
      const outcome = await this.restoreFolderProject(handleKey);
      if (outcome !== 'none') return outcome === 'opened';
    }
    return false;
  }
  private async restoreStoredProject(name: string): Promise<boolean> {
    // A project removed from browser storage since then is simply not restored.
    if (await opfsLocationExists(name)) return this.openStoredProject(name);
    log.info('Last stored project no longer exists; nothing restored', { name }); return false;
  }
  /** 'none': no folder is remembered under this key, so a broader level may still apply. */
  private async restoreFolderProject(storedKey: string): Promise<'opened' | 'not-opened' | 'none'> {
    let handle: FileSystemDirectoryHandle;
    try {
      const stored = await projectDB.getStoredHandle(storedKey);
      if (!stored || stored.kind !== 'directory') return 'none';
      handle = stored as FileSystemDirectoryHandle;
      // Chrome keeps folder access only for the browsing session: after a browser restart the stored
      // handle asks again. It stays the same project; one click re-grants it (see requestPendingPermission).
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') { this.pendingHandle = handle; log.info('Last project needs folder access again', { name: handle.name, permission }); return 'not-opened'; }
      // Like a removed browser-storage project: a folder deleted or moved on disk is simply not restored.
      if (!await directoryHandleExists(handle)) {
        log.info('Last project folder no longer exists; nothing restored', { name: handle.name });
        await projectDB.deleteHandle(storedKey).catch(error => log.warn('Could not forget the missing last project folder', error));
        return 'not-opened';
      }
    } catch (error) { log.warn('Repository restore failed; previous session retained', error); return 'not-opened'; }
    // Opening failures still reach the caller, which reports them (as before this split).
    return await this.loadProject(handle) ? 'opened' : 'not-opened';
  }
  updateProjectData(updates: Partial<ProjectFile>): void { const session = getActiveRepositorySession(); if (session) updateEditorRepositoryProjectFields(session, updates); }
  updateMedia(media: ProjectMediaFile[]): void { this.updateProjectData({ media }); }
  updateCompositions(compositions: ProjectComposition[]): void { this.updateProjectData({ compositions }); }
  updateFolders(folders: ProjectFolder[]): void { this.updateProjectData({ folders }); }
}
