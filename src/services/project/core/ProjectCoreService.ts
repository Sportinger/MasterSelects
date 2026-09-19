// Project lifecycle management service
// Handles create, open, save, close, rename, backup operations

import { Logger } from '../../logger';
import { projectSaveStatus, trackProjectSave } from '../projectSaveStatus';
import { projectDB } from '../../projectDB';
import { shouldSkipEmptyProjectSave } from './autosaveRecovery';
import { addRecentFsaProject, getRecentProjects, removeRecentFsaProject } from '../recentProjects';
import { createDefaultRulerLaneState } from '../../../timeline/tempo/rulerDefaults';
import {
  clearLastOpfsProjectName,
  getTabLastProjectHandleKey,
  LEGACY_LAST_PROJECT_HANDLE_KEY,
  readLastOpfsProjectName,
  storeLastOpfsProjectName,
} from '../tabProjectPersistence';

const log = Logger.create('ProjectCore');
import { FileStorageService } from './FileStorageService';
import { PROJECT_FOLDERS } from './constants';
import {
  PROJECT_AUTOSAVE_FILE_NAME,
  PROJECT_FILE_NAME,
  importLegacyFsaPackageEntries,
  readFsaProjectFile,
  readFsaProjectPackage,
  readLatestFsaProjectData,
  writeFsaProjectPackage,
  writeFsaProjectFile,
  writeFsaProjectJsonWithAutosaveFallback,
} from './projectCorePersistence';
import {
  getFsaProjectPackageSession,
  getProjectPackageFileName,
  getProjectMediaFolderName,
  ProjectPackageSession,
  registerFsaProjectPackageSession,
  unregisterFsaProjectPackageSession,
} from './projectPackage';
import {
  acquireProjectRoot,
  getProjectWriteSupportError,
  listProjectFolderNames,
  resolveProjectRootMode,
} from './projectRootAccess';
import type { ProjectComposition } from '../types/composition.types';
import type { ProjectFolder } from '../types/folder.types';
import type { ProjectMediaFile } from '../types/media.types';
import type { ProjectFile } from '../types/project.types';
import {
  copyFsaDirectoryContents,
  createFsaProjectBackup,
  fsaFolderContainsProject,
} from './fsaProjectDirectoryOperations';
import { recordProjectDirtyMark } from '../projectDirtyDiagnostics';

export class ProjectCoreService {
  private projectHandle: FileSystemDirectoryHandle | null = null;
  private projectData: ProjectFile | null = null;
  private isDirty = false;
  private dirtyRevision = 0;
  private saveQueue: Promise<void> = Promise.resolve();
  private pendingSave: { handle: FileSystemDirectoryHandle | null; promise: Promise<boolean> } | null = null;
  private pendingHandle: FileSystemDirectoryHandle | null = null;
  private permissionNeeded = false;
  private fileStorage: FileStorageService;

  constructor(fileStorage: FileStorageService) {
    this.fileStorage = fileStorage;
  }

  // ============================================
  // GETTERS & STATE CHECKS
  // ============================================

  isSupported(): boolean {
    return resolveProjectRootMode() !== 'none';
  }

  getProjectHandle(): FileSystemDirectoryHandle | null {
    return this.projectHandle;
  }

  getProjectData(): ProjectFile | null {
    return this.projectData;
  }

  isProjectOpen(): boolean {
    return this.projectHandle !== null && this.projectData !== null;
  }

  hasUnsavedChanges(): boolean {
    return this.isDirty;
  }

  markDirty(): void {
    recordProjectDirtyMark('fsa-core', this.isProjectOpen(), this.isDirty);
    this.isDirty = true;
    this.dirtyRevision += 1;
  }

  needsPermission(): boolean {
    return this.permissionNeeded && this.pendingHandle !== null;
  }

  getPendingProjectName(): string | null {
    return this.pendingHandle?.name || null;
  }

  // ============================================
  // PERMISSION HANDLING
  // ============================================

  async requestPendingPermission(): Promise<boolean> {
    if (!this.pendingHandle) return false;

    try {
      const result = await this.pendingHandle.requestPermission({ mode: 'readwrite' });
      if (result === 'granted') {
        const success = await this.loadProject(this.pendingHandle);
        if (success) {
          this.pendingHandle = null;
          this.permissionNeeded = false;
          return true;
        }
      }
    } catch (e) {
      log.warn('Failed to request permission:', e);
    }
    return false;
  }

  // ============================================
  // PROJECT OPERATIONS
  // ============================================

  async createProject(name: string): Promise<boolean> {
    const error = getProjectWriteSupportError();
    if (error) {
      log.warn(error);
      return false;
    }
    const handle = await acquireProjectRoot(resolveProjectRootMode());
    if (!handle) return false;

    try {
      // Remembering the folder is optional; the project itself lives on disk.
      await projectDB.storeHandle('projectsFolder', handle).catch(error => {
        log.warn('Could not cache projects folder; continuing with selected folder', error);
      });
      const projectFolder = await handle.getDirectoryHandle(name, { create: true });
      return await this.initializeProject(projectFolder, name);
    } catch (e) {
      log.error('Failed to create project:', e);
      return false;
    }
  }

  async createProjectInFolder(handle: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    const error = getProjectWriteSupportError();
    if (error || !this.isSupported()) {
      log.warn(error ?? 'File System Access API not supported');
      return false;
    }

    try {
      // Remembering the folder is optional; the project itself lives on disk.
      await projectDB.storeHandle('projectsFolder', handle).catch(error => {
        log.warn('Could not cache projects folder; continuing with selected folder', error);
      });
      const projectFolder = await handle.getDirectoryHandle(name, { create: true });
      return await this.initializeProject(projectFolder, name);
    } catch (e) {
      log.error('Failed to create project in folder:', e);
      return false;
    }
  }

  private async initializeProject(projectFolder: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    try {
      const mainCompId = `comp-${Date.now()}`;

      const initialProject: ProjectFile = {
        version: 1,
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          sampleRate: 48000,
        },
        media: [],
        compositions: [{
          id: mainCompId,
          name: 'Main Comp',
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 60,
          backgroundColor: '#000000',
          folderId: null,
          tracks: [
            { id: 'track-v1', name: 'Video 1', type: 'video', height: 60, locked: false, visible: true, muted: false, solo: false },
            { id: 'track-a1', name: 'Audio 1', type: 'audio', height: 40, locked: false, visible: true, muted: false, solo: false },
          ],
          clips: [],
          markers: [],
          // Multi-ruler infrastructure (issue #257) — default single Time lane.
          ...createDefaultRulerLaneState(),
        }],
        folders: [],
        activeCompositionId: mainCompId,
        openCompositionIds: [mainCompId],
        expandedFolderIds: [],
      };

      const packageSession = ProjectPackageSession.create(initialProject);
      this.configurePackageSession(projectFolder, packageSession);
      await this.fileStorage.createProjectFolders(projectFolder);
      await writeFsaProjectPackage(projectFolder, packageSession, initialProject);

      this.projectHandle = projectFolder;
      this.projectData = initialProject;
      this.isDirty = false;

      await this.storeLastProject(projectFolder);
      await addRecentFsaProject(projectFolder, initialProject);

      log.info(`Created project: ${name}`);
      return true;
    } catch (e) {
      log.error('Failed to initialize project:', e);
      return false;
    }
  }

  /**
   * Picker-based open. On OPFS there is nothing to pick, so callers list
   * `listStoredProjects()` and open by name instead.
   */
  async openProject(): Promise<boolean> {
    if (resolveProjectRootMode() !== 'fsa') return false;

    const handle = await acquireProjectRoot('fsa');
    if (!handle) return false;

    try {
      return await this.loadProject(handle);
    } catch (e) {
      log.error('Failed to open project:', e);
      return false;
    }
  }

  /** Project folder names; storage access failure must not masquerade as an empty root. */
  async listStoredProjects(): Promise<string[]> {
    const root = await acquireProjectRoot(resolveProjectRootMode(), { throwOnFailure: true });
    return root ? await listProjectFolderNames(root) : [];
  }

  async openStoredProject(name: string): Promise<boolean> {
    const root = await acquireProjectRoot(resolveProjectRootMode());
    if (!root) return false;

    try {
      return await this.loadProject(await root.getDirectoryHandle(name, { create: false }));
    } catch (e) {
      log.error(`Failed to open stored project "${name}":`, e);
      return false;
    }
  }

  async loadProject(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      const loadedPackage = await readFsaProjectPackage(handle);
      const projectData = loadedPackage?.projectData ?? await readLatestFsaProjectData(handle);

      if (projectData.version !== 1) {
        log.error('Unsupported project version:', projectData.version);
        return false;
      }

      if (loadedPackage) {
        this.configurePackageSession(handle, loadedPackage.session);
      } else {
        const migrationSession = ProjectPackageSession.create(projectData);
        migrationSession.setMediaFolderName(PROJECT_FOLDERS.RAW);
        await importLegacyFsaPackageEntries(handle, migrationSession);
        try {
          await writeFsaProjectPackage(handle, migrationSession, projectData);
          this.configurePackageSession(handle, migrationSession);
          log.info(`Migrated legacy project to ${migrationSession.getPackageFileName()}; original files were preserved`);
        } catch (migrationError) {
          log.warn('Could not migrate legacy project to .msproj; continuing in legacy mode', migrationError);
        }
      }

      await this.fileStorage.createProjectFolders(handle);

      this.projectHandle = handle;
      this.projectData = projectData;
      this.isDirty = false;

      await this.storeLastProject(handle);
      await addRecentFsaProject(handle, projectData);

      // Try to restore API keys from file if IndexedDB keys are empty
      log.info(`Opened project: ${projectData.name}`);
      return true;
    } catch (e) {
      log.error('Failed to load project:', e);
      return false;
    }
  }

  async saveProject(): Promise<boolean> {
    const session = this.projectHandle ? getFsaProjectPackageSession(this.projectHandle) : null;
    if (session?.isBatchingWrites) await session.waitForWriteBatch();
    // Concurrent artifact writes share one upcoming snapshot instead of each
    // reserializing the entire project. A write already in flight stays separate.
    if (this.pendingSave?.handle === this.projectHandle) return this.pendingSave.promise;
    const runSave = async () => {
      while (session?.isBatchingWrites) await session.waitForWriteBatch();
      if (this.pendingSave?.promise === queuedSave) this.pendingSave = null;
      return trackProjectSave(this.projectHandle, () => this.performSaveProject());
    };
    const queuedSave = this.saveQueue.then(runSave, runSave);
    this.pendingSave = { handle: this.projectHandle, promise: queuedSave };
    this.saveQueue = queuedSave.then(() => undefined, () => undefined);
    return queuedSave;
  }

  private async performSaveProject(): Promise<boolean> {
    if (!this.projectHandle || !this.projectData) {
      log.error('No project open');
      return false;
    }

    try {
      const savedRevision = this.dirtyRevision;
      const packageSession = getFsaProjectPackageSession(this.projectHandle);
      const autosaveData = packageSession
        ? null
        : await readFsaProjectFile(this.projectHandle, PROJECT_AUTOSAVE_FILE_NAME);
      if (shouldSkipEmptyProjectSave(this.projectData, autosaveData)) {
        log.warn('Skipped empty project save because project.autosave.json contains recoverable project data');
        // Recovery protection is not a successful write. Keep edits unsaved.
        return false;
      }

      this.projectData.updatedAt = new Date().toISOString();
      if (packageSession) {
        await writeFsaProjectPackage(this.projectHandle, packageSession, this.projectData);
      } else {
        await writeFsaProjectJsonWithAutosaveFallback(this.projectHandle, this.projectData);
      }

      if (this.dirtyRevision === savedRevision) {
        this.isDirty = false;
      }

      log.debug('Project saved');
      return true;
    } catch (e) {
      log.error('Failed to save project:', e);
      return false;
    }
  }

  closeProject(): void {
    projectSaveStatus.reset(this.projectHandle);
    if (this.projectHandle) unregisterFsaProjectPackageSession(this.projectHandle);
    this.projectHandle = null;
    this.projectData = null;
    this.isDirty = false;
    this.dirtyRevision += 1;
    log.info('Project closed');
  }

  // ============================================
  // BACKUP OPERATIONS
  // ============================================

  async createBackup(): Promise<boolean> {
    return this.projectHandle && this.projectData
      ? createFsaProjectBackup(this.projectHandle, this.fileStorage)
      : false;
  }

  // ============================================
  // RENAME OPERATIONS
  // ============================================

  async renameProject(newName: string): Promise<boolean> {
    if (!this.projectHandle || !this.projectData) {
      log.error('No project open');
      return false;
    }

    const trimmedName = newName.trim();
    if (!trimmedName || trimmedName === this.projectData.name) {
      return false;
    }

    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(trimmedName)) {
      log.error('Invalid characters in project name');
      return false;
    }

    try {
      const parentHandle = await projectDB.getStoredHandle('projectsFolder');
      if (!parentHandle || parentHandle.kind !== 'directory') {
        // No parent folder stored - just update the package display name.
        log.info(`No parent folder handle, updating display name only to "${trimmedName}"`);
        this.projectData.name = trimmedName;
        this.projectData.updatedAt = new Date().toISOString();
        await this.writeProjectState(this.projectHandle, this.projectData, true);
        await addRecentFsaProject(this.projectHandle, this.projectData);
        this.isDirty = false;
        return true;
      }

      const parentDir = parentHandle as FileSystemDirectoryHandle;

      // Verify we have write permission on the parent
      const permission = await parentDir.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        // No permission on parent - just update the package display name.
        log.info(`No write permission on parent folder, updating display name only to "${trimmedName}"`);
        this.projectData.name = trimmedName;
        this.projectData.updatedAt = new Date().toISOString();
        await this.writeProjectState(this.projectHandle, this.projectData, true);
        await addRecentFsaProject(this.projectHandle, this.projectData);
        this.isDirty = false;
        return true;
      }

      const oldName = this.projectHandle.name;
      const oldProjectHandle = this.projectHandle;

      // If the folder name already matches the new name, just update project data
      if (trimmedName === oldName) {
        this.projectData.name = trimmedName;
        this.projectData.updatedAt = new Date().toISOString();
        await this.writeProjectState(this.projectHandle, this.projectData, true);
        await addRecentFsaProject(this.projectHandle, this.projectData);
        this.isDirty = false;
        log.info(`Project display name updated to "${trimmedName}"`);
        return true;
      }

      // Check if a different folder with that name already exists
      let existingFolder: FileSystemDirectoryHandle | null = null;
      try {
        existingFolder = await parentDir.getDirectoryHandle(trimmedName, { create: false });
      } catch {
        // Good - folder doesn't exist
      }

      if (existingFolder) {
        // Check whether the destination contains either supported project format.
        if (await fsaFolderContainsProject(existingFolder)) {
          log.error(`Folder "${trimmedName}" already contains a project`);
          return false;
        }

        // Leftover folder without project.json - remove it
        log.debug(`Removing leftover folder: ${trimmedName}`);
        try {
          await parentDir.removeEntry(trimmedName, { recursive: true });
        } catch (e) {
          log.error('Failed to remove leftover folder:', e);
          return false;
        }
      }

      const newFolder = await parentDir.getDirectoryHandle(trimmedName, { create: true });
      const oldPackageSession = getFsaProjectPackageSession(this.projectHandle);
      const renamedMediaFolder = oldPackageSession && oldPackageSession.getMediaFolderName() !== PROJECT_FOLDERS.RAW
        ? {
          from: oldPackageSession.getMediaFolderName(),
          to: getProjectMediaFolderName(trimmedName),
        }
        : undefined;
      await copyFsaDirectoryContents(this.projectHandle, newFolder, renamedMediaFolder);

      const newPackageSession = oldPackageSession
        ? new ProjectPackageSession(
          oldPackageSession.getManifest(),
          oldPackageSession.getEntries(),
          oldPackageSession.getPackageFileName(),
        )
        : null;
      if (newPackageSession && renamedMediaFolder) {
        newPackageSession.setMediaFolderName(renamedMediaFolder.to);
      }

      this.projectData.name = trimmedName;
      this.projectData.updatedAt = new Date().toISOString();
      if (newPackageSession) this.configurePackageSession(newFolder, newPackageSession);
      await this.writeProjectState(newFolder, this.projectData, true);

      unregisterFsaProjectPackageSession(oldProjectHandle);
      this.projectHandle = newFolder;

      await this.storeLastProject(newFolder);
      await removeRecentFsaProject(oldProjectHandle);
      await addRecentFsaProject(newFolder, this.projectData);

      try {
        await parentDir.removeEntry(oldName, { recursive: true });
        log.debug(`Deleted old folder: ${oldName}`);
      } catch (e) {
        log.warn('Failed to delete old folder:', e);
      }

      this.isDirty = false;
      log.info(`Project renamed from "${oldName}" to "${trimmedName}"`);
      return true;
    } catch (e) {
      log.error('Failed to rename project:', e);
      return false;
    }
  }

  private configurePackageSession(
    handle: FileSystemDirectoryHandle,
    session: ProjectPackageSession,
  ): void {
    registerFsaProjectPackageSession(handle, session);
    // Sidecars join the next manual/timed project snapshot; importing is not a Save action.
    session.setPersistCallback(async () => { this.markDirty(); return true; });
  }

  private async writeProjectState(
    handle: FileSystemDirectoryHandle,
    projectData: ProjectFile,
    renamePackage = false,
  ): Promise<void> {
    const session = getFsaProjectPackageSession(handle);
    if (!session) {
      await writeFsaProjectFile(handle, PROJECT_FILE_NAME, projectData);
      return;
    }

    const previousFileName = session.getPackageFileName();
    if (renamePackage) session.setPackageFileName(getProjectPackageFileName(projectData.name));
    await writeFsaProjectPackage(handle, session, projectData);

    if (previousFileName !== session.getPackageFileName()) {
      try {
        await handle.removeEntry(previousFileName);
      } catch {
        // A copied/migrated project may not contain the previous package name.
      }
    }
  }

  // ============================================
  // RESTORE OPERATIONS
  // ============================================

  async restoreLastProject(): Promise<boolean> {
    if (resolveProjectRootMode() === 'opfs') {
      const storedName = readLastOpfsProjectName();
      const recentProjects = getRecentProjects();
      const recentEntry = recentProjects.find((entry) => (
        entry.backend === 'opfs' || entry.backend === 'fsa'
      ));
      const recentName = recentEntry?.path
        ?? (recentEntry?.backend === 'fsa' ? recentEntry.name : undefined);
      const candidates = [...new Set([storedName, recentName].filter((name): name is string => Boolean(name)))];

      for (const name of candidates) {
        if (await this.openStoredProject(name)) {
          return true;
        }
      }

      // Migration fallback for projects created before the project name was
      // persisted explicitly. A single OPFS project is unambiguous.
      const storedProjects = await this.listStoredProjects();
      if (storedProjects.length === 1) {
        return this.openStoredProject(storedProjects[0]!);
      }
      return false;
    }

    try {
      const handle = await projectDB.getStoredHandle(getTabLastProjectHandleKey())
        ?? await projectDB.getStoredHandle(LEGACY_LAST_PROJECT_HANDLE_KEY);
      if (!handle || handle.kind !== 'directory') return false;

      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        const loaded = await this.loadProject(handle as FileSystemDirectoryHandle);

        if (!loaded) {
          log.info('Project not found, trying to recreate...');
          return await this.recreateProjectFromParent();
        }

        return loaded;
      } else {
        this.pendingHandle = handle as FileSystemDirectoryHandle;
        this.permissionNeeded = true;
        log.info('Permission needed for:', handle.name);
        return false;
      }
    } catch (e) {
      log.warn('Failed to restore last project:', e);
      return await this.recreateProjectFromParent();
    }
  }

  private async recreateProjectFromParent(): Promise<boolean> {
    try {
      const parentHandle = await projectDB.getStoredHandle('projectsFolder');
      if (!parentHandle || parentHandle.kind !== 'directory') {
        log.info('No parent folder stored, cannot recreate');
        await this.clearStoredHandles();
        return false;
      }

      const permission = await parentHandle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        this.pendingHandle = parentHandle as FileSystemDirectoryHandle;
        this.permissionNeeded = true;
        log.info('Permission needed for parent folder');
        return false;
      }

      log.info('Recreating Untitled project...');
      const success = await this.createProjectInFolder(parentHandle as FileSystemDirectoryHandle, 'Untitled');
      if (success) {
        log.info('Successfully recreated Untitled project');
      }
      return success;
    } catch (e) {
      log.warn('Failed to recreate project from parent:', e);
      await this.clearStoredHandles();
      return false;
    }
  }

  private async clearStoredHandles(): Promise<void> {
    try {
      await projectDB.deleteHandle(getTabLastProjectHandleKey());
      clearLastOpfsProjectName();
      log.debug('Cleared stored project handle for this browser tab');
    } catch (e) {
      log.warn('Failed to clear stored handles:', e);
    }
  }

  // ============================================
  // UPDATE OPERATIONS
  // ============================================

  updateProjectData(updates: Partial<ProjectFile>): void {
    if (!this.projectData) return;
    Object.assign(this.projectData, updates);
    this.markDirty();
  }

  updateMedia(media: ProjectMediaFile[]): void {
    if (!this.projectData) return;
    this.projectData.media = media;
    this.markDirty();
  }

  updateCompositions(compositions: ProjectComposition[]): void {
    if (!this.projectData) return;
    this.projectData.compositions = compositions;
    this.markDirty();
  }

  updateFolders(folders: ProjectFolder[]): void {
    if (!this.projectData) return;
    this.projectData.folders = folders;
    this.markDirty();
  }

  private async storeLastProject(handle: FileSystemDirectoryHandle): Promise<void> {
    if (resolveProjectRootMode() === 'opfs') {
      storeLastOpfsProjectName(handle.name);
    }
    try {
      await Promise.all([
        projectDB.storeHandle(getTabLastProjectHandleKey(), handle),
        projectDB.storeHandle(LEGACY_LAST_PROJECT_HANDLE_KEY, handle),
      ]);
    } catch (e) {
      log.warn('Failed to store last project:', e);
    }
  }
}
