import { updateEditorRepositoryProjectFields } from '../repository/transaction/editorRepositorySession';
import { isAndroidAutoRestoreProjectHandle } from '../androidProjectAutoRestore';
import { Logger } from '../../logger';
import { projectDB } from '../../projectDB';
import type { FileStorageService } from './FileStorageService';
import type { ProjectFile, ProjectMediaFile, ProjectComposition, ProjectFolder } from '../types';
import { acquireProjectRoot, resolveProjectRootMode, listProjectFolderNames } from './projectRootAccess';
import { rememberLastProject, rememberProjectParent } from './projectDirectoryPersistence';
import { addRecentFsaProject, addRecentOpfsProject } from '../recentProjects';
import { getTabLastProjectHandleKey, LEGACY_LAST_PROJECT_HANDLE_KEY, readLastOpfsProjectName } from '../tabProjectPersistence';
import { openRepositoryProject, createRepositoryAt, renameRepositoryProject, createIndependentProjectBackup, repositoryHasUnsavedChanges } from '../repository/lifecycle/repositoryProjectOperations';
import { closeEditorRepository, flushEditorRepository, getActiveRepositorySession, readEditorRepositoryProject, isScratchRepository } from '../repository/lifecycle/editorRepositoryLifecycle';
import { directoryForOpfs, isLegacyProjectLocation } from '../repository/lifecycle/repositoryLocations';
import { requestLegacyImportTarget } from '../legacyImportTarget';
import type { RepositoryLocation } from '../repository/storageWorkerProtocol';

const log = Logger.create('ProjectCore');
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
    const opened = await this.loadProject(handle); if (opened) this.pendingHandle = null; return opened;
  }
  async createProject(name: string, preserveCurrent = false): Promise<boolean> {
    const root = await acquireProjectRoot(resolveProjectRootMode()); if (!root) return false;
    return this.createProjectInFolder(root, name, preserveCurrent);
  }
  async createProjectInFolder(parent: FileSystemDirectoryHandle, name: string, preserveCurrent = false): Promise<boolean> {
    await rememberProjectParent(parent);
    const handle = await parent.getDirectoryHandle(name, { create: true });
    const location: RepositoryLocation = resolveProjectRootMode() === 'opfs' ? { kind: 'opfs', path: name } : { kind: 'fsa', handle };
    await createRepositoryAt(location, name, preserveCurrent);
    await this.adoptSession(handle); return true;
  }
  async openProject(): Promise<boolean> {
    if (resolveProjectRootMode() !== 'fsa') return false;
    const handle = await acquireProjectRoot('fsa'); return handle ? this.loadProject(handle) : false;
  }
  async listStoredProjects(): Promise<string[]> {
    const root = await acquireProjectRoot('opfs', { throwOnFailure: true }); return root ? listProjectFolderNames(root) : [];
  }
  async openStoredProject(path: string): Promise<boolean> {
    await openRepositoryProject({ kind: 'opfs', path }); await this.adoptSession(await directoryForOpfs(path)); return true;
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
  private async adoptSession(fallback: FileSystemDirectoryHandle): Promise<void> {
    const session = getActiveRepositorySession(); if (!session) throw new Error('Repository activation did not finish');
    const handle = session.location.kind === 'opfs' ? await directoryForOpfs(session.location.path)
      : session.location.kind === 'fsa' ? session.location.handle : fallback;
    this.projectHandle = handle; this.pendingHandle = null;
    if (session.location.kind === 'opfs') await addRecentOpfsProject(session.location.path, this.getProjectData());
    else { await rememberLastProject(handle); await addRecentFsaProject(handle, this.getProjectData()); }
  }
  async saveProject(): Promise<boolean> { return flushEditorRepository(); }
  async closeProject(): Promise<void> { await closeEditorRepository(); this.projectHandle = null; }
  async createBackup(): Promise<boolean> { return createIndependentProjectBackup(); }
  async renameProject(name: string): Promise<boolean> { return renameRepositoryProject(name); }
  async restoreLastProject(): Promise<boolean> {
    const repositoryPath = sessionStorage.getItem('ms.repository.last-opfs-path');
    if (repositoryPath) return this.openStoredProject(repositoryPath);
    if (resolveProjectRootMode() === 'opfs') { const name = readLastOpfsProjectName(); return name ? this.openStoredProject(name) : false; }
    try {
      const stored = await projectDB.getStoredHandle(getTabLastProjectHandleKey()) ?? await projectDB.getStoredHandle(LEGACY_LAST_PROJECT_HANDLE_KEY);
      if (!stored || stored.kind !== 'directory') return false;
      const handle = stored as FileSystemDirectoryHandle;
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') { this.pendingHandle = handle; return false; }
      return this.loadProject(handle);
    } catch (error) { log.warn('Repository restore failed; previous session retained', error); return false; }
  }
  updateProjectData(updates: Partial<ProjectFile>): void { const session = getActiveRepositorySession(); if (session) updateEditorRepositoryProjectFields(session, updates); }
  updateMedia(media: ProjectMediaFile[]): void { this.updateProjectData({ media }); }
  updateCompositions(compositions: ProjectComposition[]): void { this.updateProjectData({ compositions }); }
  updateFolders(folders: ProjectFolder[]): void { this.updateProjectData({ folders }); }
}
