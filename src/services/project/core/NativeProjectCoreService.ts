// Project lifecycle management via Native Helper
// Mirrors ProjectCoreService but uses string paths + NativeHelperClient
// instead of FileSystemDirectoryHandle. Enables project persistence in Firefox.

import { Logger } from '../../logger';
import { projectSaveStatus, trackProjectSave } from '../projectSaveStatus';
import { NativeHelperClient } from '../../nativeHelper/NativeHelperClient';
import { PROJECT_FOLDERS, MAX_BACKUPS, type ProjectFolderKey } from './constants';
import { shouldPreferAutosave, shouldSkipEmptyProjectSave } from './autosaveRecovery';
import { addRecentNativeProject, removeRecentNativeProject } from '../recentProjects';
import { createDefaultRulerLaneState } from '../../../timeline/tempo/rulerDefaults';
import {
  getTabNativeLastProjectPathKey,
  LEGACY_NATIVE_LAST_PROJECT_PATH_KEY,
} from '../tabProjectPersistence';
import type { ProjectFile, ProjectMediaFile, ProjectComposition, ProjectFolder } from '../types';
import {
  getNativeProjectPackageSession,
  getNativeProjectFolderPath,
  getProjectPackageFileName,
  getProjectMediaFolderName,
  isPackagedProjectFolder,
  isProjectPackageFileName,
  moveNativeProjectPackageSession,
  ProjectPackageSession,
  registerNativeProjectPackageSession,
  unregisterNativeProjectPackageSession,
} from './projectPackage';
import {
  importLegacyNativePackageEntries,
  readNativeProjectPackage,
  writeNativeProjectPackage,
} from './nativeProjectPackagePersistence';
import { recordProjectDirtyMark } from '../projectDirtyDiagnostics';

const log = Logger.create('NativeProjectCore');

const PROJECT_FILE_NAME = 'project.json';
const PROJECT_AUTOSAVE_FILE_NAME = 'project.autosave.json';

export class NativeProjectCoreService {
  private projectPath: string | null = null;
  private projectData: ProjectFile | null = null;
  private isDirty = false;
  private dirtyRevision = 0;
  private saveQueue: Promise<void> = Promise.resolve();
  private client = NativeHelperClient;

  // ============================================
  // GETTERS & STATE CHECKS
  // ============================================

  isSupported(): boolean {
    return this.client.isConnected();
  }

  getProjectPath(): string | null {
    return this.projectPath;
  }

  /** Compatibility: returns null since we don't use FSA handles */
  getProjectHandle(): null {
    return null;
  }

  getProjectData(): ProjectFile | null {
    return this.projectData;
  }

  isProjectOpen(): boolean {
    return this.projectPath !== null && this.projectData !== null;
  }

  hasUnsavedChanges(): boolean {
    return this.isDirty;
  }

  markDirty(): void {
    recordProjectDirtyMark('native-core', this.isProjectOpen(), this.isDirty);
    this.isDirty = true;
    this.dirtyRevision += 1;
  }

  /** Not needed for native mode — no permission prompts */
  needsPermission(): boolean {
    return false;
  }

  getPendingProjectName(): string | null {
    return null;
  }

  async requestPendingPermission(): Promise<boolean> {
    return false;
  }

  // ============================================
  // PATH HELPERS
  // ============================================

  private joinPath(...parts: string[]): string {
    // Normalize to forward slashes, then join
    return parts
      .map(p => p.replace(/\\/g, '/').replace(/\/+$/, ''))
      .join('/');
  }

  // ============================================
  // PROJECT OPERATIONS
  // ============================================

  async createProject(name: string): Promise<boolean> {
    if (!this.client.isConnected()) {
      log.error('Native Helper not connected');
      return false;
    }

    try {
      const projectRoot = await this.client.getProjectRoot();
      if (!projectRoot) {
        log.error('Cannot determine project root');
        return false;
      }

      const projectPath = this.joinPath(projectRoot, name);
      return await this.initializeProject(projectPath, name);
    } catch (e) {
      log.error('Failed to create project:', e);
      return false;
    }
  }

  async createProjectAtPath(basePath: string, name: string): Promise<boolean> {
    if (!this.client.isConnected()) {
      log.error('Native Helper not connected');
      return false;
    }

    try {
      await this.client.grantPath(basePath);
      const projectPath = this.joinPath(basePath, name);
      return await this.initializeProject(projectPath, name);
    } catch (e) {
      log.error('Failed to create project at path:', e);
      return false;
    }
  }

  private async initializeProject(projectPath: string, name: string): Promise<boolean> {
    try {
      // Create project folder
      if (!await this.client.createDir(projectPath)) {
        log.error('Failed to create project directory');
        return false;
      }

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
      this.configurePackageSession(projectPath, packageSession);
      await this.createProjectFolders(projectPath);
      if (!await writeNativeProjectPackage(this.client, projectPath, packageSession, initialProject)) {
        unregisterNativeProjectPackageSession(projectPath);
        log.error('Failed to write .msproj package');
        return false;
      }

      projectSaveStatus.reset(projectPath);
      this.projectPath = projectPath;
      this.projectData = initialProject;
      this.isDirty = false;

      this.storeLastProject(projectPath);
      await addRecentNativeProject(projectPath, initialProject);

      log.info(`Created project: ${name} at ${projectPath}`);
      return true;
    } catch (e) {
      log.error('Failed to initialize project:', e);
      return false;
    }
  }

  async loadProject(projectPath: string): Promise<boolean> {
    try {
      await this.client.grantPath(projectPath);
      const loadedPackage = await readNativeProjectPackage(this.client, projectPath);
      const projectData = loadedPackage?.projectData ?? await this.readLatestProjectData(projectPath);

      if (!projectData) {
        log.error('Cannot read project data at', projectPath);
        return false;
      }

      if (projectData.version !== 1) {
        log.error('Unsupported project version:', projectData.version);
        return false;
      }

      if (loadedPackage) {
        this.configurePackageSession(projectPath, loadedPackage.session);
      } else {
        const migrationSession = ProjectPackageSession.create(projectData);
        migrationSession.setMediaFolderName(PROJECT_FOLDERS.RAW);
        await importLegacyNativePackageEntries(this.client, projectPath, migrationSession);
        try {
          if (await writeNativeProjectPackage(this.client, projectPath, migrationSession, projectData)) {
            this.configurePackageSession(projectPath, migrationSession);
            log.info(`Migrated legacy project to ${migrationSession.getPackageFileName()}; original files were preserved`);
          }
        } catch (migrationError) {
          log.warn('Could not migrate legacy project to .msproj; continuing in legacy mode', migrationError);
        }
      }
      await this.createProjectFolders(projectPath);

      projectSaveStatus.reset(projectPath);
      this.projectPath = projectPath;
      this.projectData = projectData;
      this.isDirty = false;

      this.storeLastProject(projectPath);
      await addRecentNativeProject(projectPath, projectData);

      // Try to restore API keys from file if IndexedDB keys are empty
      log.info(`Opened project: ${projectData.name}`);
      return true;
    } catch (e) {
      log.error('Failed to load project:', e);
      return false;
    }
  }

  async saveProject(): Promise<boolean> {
    const session = this.projectPath ? getNativeProjectPackageSession(this.projectPath) : null;
    if (session?.isBatchingWrites) await session.waitForWriteBatch();
    const runSave = async () => {
      while (session?.isBatchingWrites) await session.waitForWriteBatch();
      return trackProjectSave(this.projectPath, () => this.performSaveProject());
    };
    const queuedSave = this.saveQueue.then(runSave, runSave);
    this.saveQueue = queuedSave.then(() => undefined, () => undefined);
    return queuedSave;
  }

  private async performSaveProject(): Promise<boolean> {
    if (!this.projectPath || !this.projectData) {
      log.error('No project open');
      return false;
    }

    try {
      const savedRevision = this.dirtyRevision;
      const packageSession = getNativeProjectPackageSession(this.projectPath);
      const autosaveData = packageSession
        ? null
        : await this.readProjectFile(this.projectPath, PROJECT_AUTOSAVE_FILE_NAME);
      if (shouldSkipEmptyProjectSave(this.projectData, autosaveData)) {
        log.warn('Skipped empty project save because project.autosave.json contains recoverable project data');
        // Recovery protection is not a successful write. Keep edits unsaved.
        return false;
      }

      this.projectData.updatedAt = new Date().toISOString();
      const saved = packageSession
        ? await writeNativeProjectPackage(this.client, this.projectPath, packageSession, this.projectData)
        : await this.client.writeFile(
          this.joinPath(this.projectPath, PROJECT_FILE_NAME),
          JSON.stringify(this.projectData, null, 2),
        );
      if (!saved) {
        log.error(`Failed to write ${packageSession ? '.msproj package' : 'project.json'}`);
        return false;
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
    projectSaveStatus.reset(this.projectPath);
    if (this.projectPath) unregisterNativeProjectPackageSession(this.projectPath);
    this.projectPath = null;
    this.projectData = null;
    this.isDirty = false;
    this.dirtyRevision += 1;
    log.info('Project closed');
  }

  // ============================================
  // BACKUP OPERATIONS
  // ============================================

  async createBackup(): Promise<boolean> {
    if (!this.projectPath || !this.projectData) {
      return false;
    }

    try {
      const packageSession = getNativeProjectPackageSession(this.projectPath);
      const projectFileName = packageSession?.getPackageFileName() ?? PROJECT_FILE_NAME;
      const content = await this.client.getDownloadedFile(this.joinPath(this.projectPath, projectFileName));
      if (!content) return false;

      const now = new Date();
      const timestamp = now.toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
      const backupFileName = `project_${timestamp}${packageSession ? '.msproj' : '.json'}`;
      const backupPath = this.joinPath(
        this.projectPath,
        getNativeProjectFolderPath(this.projectPath, 'BACKUPS'),
        backupFileName,
      );

      if (!await this.client.writeFileBinary(backupPath, content)) {
        return false;
      }

      log.debug(`Created backup: ${backupFileName}`);
      await this.cleanupOldBackups();

      return true;
    } catch (e) {
      log.error('Failed to create backup:', e);
      return false;
    }
  }

  private async cleanupOldBackups(): Promise<void> {
    if (!this.projectPath) return;

    try {
      const backupsDir = this.joinPath(this.projectPath, getNativeProjectFolderPath(this.projectPath, 'BACKUPS'));
      const entries = await this.client.listDir(backupsDir);

      const backups = entries
        .filter(e => e.kind === 'file' && e.name.startsWith('project_') && (e.name.endsWith('.json') || e.name.endsWith('.msproj')))
        .sort((a, b) => b.modified - a.modified);

      if (backups.length > MAX_BACKUPS) {
        const toRemove = backups.slice(MAX_BACKUPS);
        for (const backup of toRemove) {
          await this.client.deleteFile(this.joinPath(backupsDir, backup.name));
          log.debug(`Removed old backup: ${backup.name}`);
        }
      }
    } catch (e) {
      log.warn('Failed to cleanup old backups:', e);
    }
  }

  // ============================================
  // RENAME OPERATIONS
  // ============================================

  async renameProject(newName: string): Promise<boolean> {
    if (!this.projectPath || !this.projectData) {
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
      // Get parent directory
      const oldPath = this.projectPath;
      const existingPackageSession = getNativeProjectPackageSession(oldPath);
      const oldMediaFolderName = existingPackageSession?.getMediaFolderName() ?? null;
      const parts = this.projectPath.replace(/\\/g, '/').split('/');
      parts.pop(); // Remove current folder name
      const parentPath = parts.join('/');
      const newPath = this.joinPath(parentPath, trimmedName);

      // Check if destination already exists
      const { exists } = await this.client.exists(newPath);
      if (exists) {
        if (await this.pathContainsProject(newPath)) {
          log.error(`Folder "${trimmedName}" already contains a project`);
          return false;
        }
        // Leftover folder without project.json — remove it
        await this.client.deleteFile(newPath, true);
      }

      // Rename the folder
      if (!await this.client.rename(this.projectPath, newPath)) {
        // Rename failed — update the package display name in place.
        log.info(`Cannot rename folder, updating display name only to "${trimmedName}"`);
        this.projectData.name = trimmedName;
        this.projectData.updatedAt = new Date().toISOString();
        await this.renamePackageAndSave(this.projectPath, trimmedName);
        await addRecentNativeProject(this.projectPath, this.projectData);
        return true;
      }

      this.projectPath = newPath;
      const movedPackageSession = moveNativeProjectPackageSession(oldPath, newPath);
      if (movedPackageSession) {
        if (oldMediaFolderName && oldMediaFolderName !== PROJECT_FOLDERS.RAW) {
          const nextMediaFolderName = getProjectMediaFolderName(trimmedName);
          const mediaRenamed = oldMediaFolderName === nextMediaFolderName
            || await this.client.rename(
              this.joinPath(newPath, oldMediaFolderName),
              this.joinPath(newPath, nextMediaFolderName),
            );
          if (mediaRenamed) movedPackageSession.setMediaFolderName(nextMediaFolderName);
        }
        this.configurePackageSession(newPath, movedPackageSession);
      }
      this.projectData.name = trimmedName;
      this.projectData.updatedAt = new Date().toISOString();

      await this.renamePackageAndSave(newPath, trimmedName);

      this.storeLastProject(newPath);
      await removeRecentNativeProject(oldPath);
      await addRecentNativeProject(newPath, this.projectData);
      this.isDirty = false;

      log.info(`Project renamed to "${trimmedName}"`);
      return true;
    } catch (e) {
      log.error('Failed to rename project:', e);
      return false;
    }
  }

  // ============================================
  // RESTORE OPERATIONS
  // ============================================

  async restoreLastProject(): Promise<boolean> {
    const tabProjectKey = getTabNativeLastProjectPathKey();
    const tabPath = sessionStorage.getItem(tabProjectKey);
    const lastPath = tabPath ?? localStorage.getItem(LEGACY_NATIVE_LAST_PROJECT_PATH_KEY);
    if (!lastPath) return false;

    if (!this.client.isConnected()) {
      log.debug('Native Helper not connected, cannot restore project');
      return false;
    }

    try {
      await this.client.grantPath(lastPath);
      const { exists, kind } = await this.client.exists(lastPath);
      if (!exists || kind !== 'directory') {
        log.info('Last project folder no longer exists');
        sessionStorage.removeItem(tabProjectKey);
        if (tabPath === null) localStorage.removeItem(LEGACY_NATIVE_LAST_PROJECT_PATH_KEY);
        return false;
      }

      return await this.loadProject(lastPath);
    } catch (e) {
      log.warn('Failed to restore last project:', e);
      return false;
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

  // ============================================
  // HELPERS
  // ============================================

  private storeLastProject(path: string): void {
    try {
      sessionStorage.setItem(getTabNativeLastProjectPathKey(), path);
      localStorage.setItem(LEGACY_NATIVE_LAST_PROJECT_PATH_KEY, path);
    } catch (e) {
      log.warn('Failed to store last project path:', e);
    }
  }

  private async readProjectFile(projectPath: string, fileName: string): Promise<ProjectFile | null> {
    try {
      const content = await this.client.readFileText(this.joinPath(projectPath, fileName));
      if (!content) return null;
      return JSON.parse(content) as ProjectFile;
    } catch {
      return null;
    }
  }

  private async readLatestProjectData(projectPath: string): Promise<ProjectFile | null> {
    const projectData = await this.readProjectFile(projectPath, PROJECT_FILE_NAME);
    if (!projectData) return null;

    const autosaveData = await this.readProjectFile(projectPath, PROJECT_AUTOSAVE_FILE_NAME);

    if (shouldPreferAutosave(projectData, autosaveData)) {
      log.warn('Loaded project.autosave.json because it is newer or project.json appears empty');
      return autosaveData;
    }

    return projectData;
  }

  private configurePackageSession(projectPath: string, session: ProjectPackageSession): void {
    registerNativeProjectPackageSession(projectPath, session);
    // Sidecars join the next manual/timed project snapshot; importing is not a Save action.
    session.setPersistCallback(async () => { this.markDirty(); return true; });
  }

  private async createProjectFolders(projectPath: string): Promise<void> {
    const hasPackage = getNativeProjectPackageSession(projectPath) !== null;
    const createdPaths = new Set<string>();
    for (const folderKey of Object.keys(PROJECT_FOLDERS) as ProjectFolderKey[]) {
      if (hasPackage && isPackagedProjectFolder(folderKey)) continue;
      const folderPath = getNativeProjectFolderPath(projectPath, folderKey);
      if (createdPaths.has(folderPath)) continue;
      await this.client.createDir(this.joinPath(projectPath, folderPath));
      createdPaths.add(folderPath);
    }
  }

  private async renamePackageAndSave(projectPath: string, projectName: string): Promise<boolean> {
    const session = getNativeProjectPackageSession(projectPath);
    if (!session || !this.projectData) {
      return this.projectData
        ? this.client.writeFile(
          this.joinPath(projectPath, PROJECT_FILE_NAME),
          JSON.stringify(this.projectData, null, 2),
        )
        : false;
    }

    const previousFileName = session.getPackageFileName();
    session.setPackageFileName(getProjectPackageFileName(projectName));
    const saved = await writeNativeProjectPackage(this.client, projectPath, session, this.projectData);
    if (saved && previousFileName !== session.getPackageFileName()) {
      const previousPath = this.joinPath(projectPath, previousFileName);
      const { exists } = await this.client.exists(previousPath);
      if (exists) await this.client.deleteFile(previousPath);
    }
    return saved;
  }

  private async pathContainsProject(projectPath: string): Promise<boolean> {
    const entries = await this.client.listDir(projectPath);
    return entries.some((entry) => entry.kind === 'file'
      && (entry.name === PROJECT_FILE_NAME || isProjectPackageFileName(entry.name)));
  }

  // ============================================
  // PROJECT LISTING (for project picker UI)
  // ============================================

  /**
   * List all projects in the default project root
   */
  async listProjects(): Promise<Array<{ name: string; path: string; modified: number }>> {
    try {
      const projectRoot = await this.client.getProjectRoot();
      if (!projectRoot) return [];

      // Ensure root exists
      await this.client.createDir(projectRoot);

      const entries = await this.client.listDir(projectRoot);
      const projects: Array<{ name: string; path: string; modified: number }> = [];

      for (const entry of entries) {
        if (entry.kind !== 'directory') continue;

        const projectPath = this.joinPath(projectRoot, entry.name);
        if (await this.pathContainsProject(projectPath)) {
          projects.push({
            name: entry.name,
            path: projectPath,
            modified: entry.modified,
          });
        }
      }

      // Sort by most recently modified first
      projects.sort((a, b) => b.modified - a.modified);
      return projects;
    } catch (e) {
      log.error('Failed to list projects:', e);
      return [];
    }
  }
}
