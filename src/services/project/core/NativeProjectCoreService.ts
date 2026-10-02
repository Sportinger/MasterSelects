import { updateEditorRepositoryProjectFields } from '../repository/transaction/editorRepositorySession';
import { NativeHelperClient } from '../../nativeHelper/NativeHelperClient';
import type { ProjectFile, ProjectMediaFile, ProjectComposition, ProjectFolder } from '../types';
import { addRecentNativeProject, addRecentOpfsProject } from '../recentProjects';
import { getTabNativeLastProjectPathKey, LEGACY_NATIVE_LAST_PROJECT_PATH_KEY } from '../tabProjectPersistence';
import { createRepositoryAt, openRepositoryProject, renameRepositoryProject, createIndependentProjectBackup, repositoryHasUnsavedChanges } from '../repository/lifecycle/repositoryProjectOperations';
import { closeEditorRepository, flushEditorRepository, getActiveRepositorySession, readEditorRepositoryProject, isScratchRepository } from '../repository/lifecycle/editorRepositoryLifecycle';

export class NativeProjectCoreService {
  private projectPath: string | null = null;
  isSupported(): boolean { return NativeHelperClient.isConnected(); }
  getProjectPath(): string | null { return this.projectPath; }
  getProjectHandle(): null { return null; }
  getProjectData(): ProjectFile | null { return readEditorRepositoryProject(); }
  isProjectOpen(): boolean { return Boolean(getActiveRepositorySession()) && !isScratchRepository(); }
  hasUnsavedChanges(): boolean { return repositoryHasUnsavedChanges(); }
  markDirty(): void { /* Domain transactions own continuous persistence. */ }
  needsPermission(): boolean { return false; }
  getPendingProjectName(): null { return null; }
  async requestPendingPermission(): Promise<boolean> { return false; }
  async createProject(name: string, preserveCurrent = false): Promise<boolean> {
    const root = await NativeHelperClient.getProjectRoot(); return root ? this.createProjectAtPath(root, name, preserveCurrent) : false;
  }
  async createProjectAtPath(parent: string, name: string, preserveCurrent = false): Promise<boolean> {
    const path = parent.replace(/[\\/]$/, '') + '/' + name;
    await NativeHelperClient.grantPath(parent); if (!await NativeHelperClient.createDir(path)) return false;
    await createRepositoryAt({ kind: 'native', path }, name, preserveCurrent); await this.adoptSession(); return true;
  }
  async loadProject(path: string): Promise<boolean> {
    await NativeHelperClient.grantPath(path); await openRepositoryProject({ kind: 'native', path }); await this.adoptSession(); return true;
  }
  private async adoptSession(): Promise<void> {
    const session = getActiveRepositorySession(); if (!session) throw new Error('Repository activation did not finish');
    this.projectPath = session.location.kind === 'native' ? session.location.path : null;
    if (session.location.kind === 'opfs') await addRecentOpfsProject(session.location.path, this.getProjectData());
    if (this.projectPath) {
      sessionStorage.setItem(getTabNativeLastProjectPathKey(), this.projectPath);
      localStorage.setItem(LEGACY_NATIVE_LAST_PROJECT_PATH_KEY, this.projectPath);
      await addRecentNativeProject(this.projectPath, this.getProjectData());
    }
  }
  async saveProject(): Promise<boolean> { return flushEditorRepository(); }
  async closeProject(): Promise<void> { await closeEditorRepository(); this.projectPath = null; }
  async createBackup(): Promise<boolean> { return createIndependentProjectBackup(); }
  async renameProject(name: string): Promise<boolean> { return renameRepositoryProject(name); }
  async restoreLastProject(): Promise<boolean> {
    const repositoryPath = sessionStorage.getItem('ms.repository.last-opfs-path');
    if (repositoryPath) { await openRepositoryProject({ kind: 'opfs', path: repositoryPath }); await this.adoptSession(); return true; }
    const path = sessionStorage.getItem(getTabNativeLastProjectPathKey()) ?? localStorage.getItem(LEGACY_NATIVE_LAST_PROJECT_PATH_KEY);
    return path ? this.loadProject(path) : false;
  }
  updateProjectData(updates: Partial<ProjectFile>): void { const session = getActiveRepositorySession(); if (session) updateEditorRepositoryProjectFields(session, updates); }
  updateMedia(media: ProjectMediaFile[]): void { this.updateProjectData({ media }); }
  updateCompositions(compositions: ProjectComposition[]): void { this.updateProjectData({ compositions }); }
  updateFolders(folders: ProjectFolder[]): void { this.updateProjectData({ folders }); }
  async listProjects(): Promise<Array<{ name: string; path: string; modified: number }>> {
    const root = await NativeHelperClient.getProjectRoot(); if (!root) return [];
    const projects: Array<{ name: string; path: string; modified: number }> = [];
    for (const entry of await NativeHelperClient.listDir(root)) if (entry.kind === 'directory') {
      const path = root.replace(/[\\/]$/, '') + '/' + entry.name;
      const files = await NativeHelperClient.listDir(path);
      if (files.some(file => file.kind === 'file' && (file.name === 'project.msrepo.json' || file.name === 'project.json' || file.name.endsWith('.msproj')))) projects.push({ name: entry.name, path, modified: entry.modified });
    }
    return projects.toSorted((a, b) => b.modified - a.modified);
  }
}
