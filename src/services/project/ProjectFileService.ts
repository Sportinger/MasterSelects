import { repositoryFileHandle, repositoryFileNames, scanRepositoryFiles, copyRepositoryRaw, repositoryDownloadFolder } from './repository/lifecycle/repositoryFiles';
import { captureRepositoryDomainPublication } from './repository/artifacts/RepositoryDomainPublication';
import { getActiveRepositorySession, getActiveRepositoryDirectory } from './repository/lifecycle/editorRepositoryLifecycle';
import { Logger } from '../logger';
import { FileStorageService, fileStorageService } from './core/FileStorageService';
import type { NativeFileStorageService } from './core/NativeFileStorageService';
import type { NativeProjectCoreService } from './core/NativeProjectCoreService';
import { NativeHelperClient } from '../nativeHelper/NativeHelperClient';
import { ProjectBackendSelection, type ProjectBackend } from './fileService/projectBackendSelection';
import { ProjectCoreService } from './core/ProjectCoreService';
import { AnalysisService } from './domains/AnalysisService';
import { TranscriptService, type StoredTranscript } from './domains/TranscriptService';
import { CacheService } from './domains/CacheService';
import { ProxyStorageService, type ProxyFrameScanProgressCallback, type ProxyFrameWriter } from './domains/ProxyStorageService';
import { RawMediaService } from './domains/RawMediaService';
import { PROJECT_FOLDERS } from './core/constants';
import { ProjectBackendUnavailableError, selectOpenProjectRoute, type OpenProjectRoute } from './projectBackendAvailability';
import { isOpfsAvailable } from './core/projectRootAccess';
import {
  getFsaProjectPackageSession,
  getNativeProjectPackageSession,
  type ProjectPackageSession,
} from './core/projectPackage';
import {
  clearRecentProjects,
  getRecentProjects,
  removeRecentProject,
  type RecentProjectEntry,
} from './recentProjects';
import type { ProjectFile, ProjectMediaFile, ProjectComposition, ProjectFolder } from './types';
import * as artifactStorageDelegates from './fileService/artifactStorageDelegates';
import * as rawMediaRouting from './fileService/rawMediaRouting';
import {
  deleteAudioArtifact as deleteProjectAudioArtifact,
  deleteMediaFileArtifacts as deleteProjectMediaFileArtifacts,
  type DeleteMediaFileArtifactsOptions,
  type DeleteMediaFileArtifactsResult,
  type MediaArtifactCleanupContext,
} from './fileService/artifactCleanup';
import {
  deleteRoutedEntry,
  deleteRoutedFile,
  getRoutedFileHandle,
  listRoutedFiles,
  readRoutedFile,
  routedFileExists,
  type FileStorageRoutingContext,
  writeRoutedFile,
} from './fileService/fileStorageRouting';
import { openRecentProject as openRecentProjectFromRecent } from './fileService/recentProjectOpening';
import {
  normalizeNativePath,
  pickNativeFolder,
} from './fileService/nativeBackend';
import { isAndroidAutoRestoreProjectHandle } from './androidProjectAutoRestore';
import type { NewProjectComposition } from './repository/lifecycle/defaultProject';
export type {
  DeleteMediaFileArtifactsOptions,
  DeleteMediaFileArtifactsResult,
} from './fileService/artifactCleanup';
const log = Logger.create('ProjectFileService');
export type { ProjectBackend } from './fileService/projectBackendSelection';
class ProjectFileService {
  private readonly coreService: ProjectCoreService;
  private readonly fileStorage: FileStorageService;
  private readonly analysisService: AnalysisService;
  private readonly transcriptService: TranscriptService;
  private readonly cacheService: CacheService;
  private readonly proxyStorageService: ProxyStorageService;
  private readonly rawMediaService: RawMediaService;
  private readonly backends = new ProjectBackendSelection();
  constructor() {
    this.fileStorage = fileStorageService;
    this.coreService = new ProjectCoreService(this.fileStorage);
    this.analysisService = new AnalysisService(this.fileStorage);
    this.transcriptService = new TranscriptService(this.fileStorage);
    this.cacheService = new CacheService(this.fileStorage);
    this.proxyStorageService = new ProxyStorageService();
    this.rawMediaService = new RawMediaService(this.fileStorage);
  }
  private get fileRoutingContext(): FileStorageRoutingContext {
    return {
      activeBackend: this.backends.backend,
      coreService: this.coreService,
      fileStorage: this.fileStorage,
      nativeCoreService: this.backends.nativeCoreService,
      nativeFileStorage: this.backends.nativeFileStorage,
    };
  }
  private get rawMediaRoutingContext(): rawMediaRouting.RawMediaRoutingContext {
    return {
      activeBackend: this.backends.backend,
      coreService: this.coreService,
      nativeCoreService: this.backends.nativeCoreService,
      rawMediaService: this.rawMediaService,
      getProjectData: () => this.core.getProjectData(),
      markDirty: () => this.core.markDirty(),
      ensureNativeBackendReady: () => this.backends.selectReadyNative(),
    };
  }
  private get artifactStorageContext(): artifactStorageDelegates.ArtifactStorageContext {
    return {
      activeBackend: this.backends.backend,
      getProjectHandle: () => this.coreService.getProjectHandle(),
      getNativeProjectPath: () => this.backends.nativeCoreService?.getProjectPath() ?? null,
      cacheService: this.cacheService,
      proxyStorageService: this.proxyStorageService,
      analysisService: this.analysisService,
      transcriptService: this.transcriptService,
      writeFile: (subFolder, fileName, content) => this.writeFile(subFolder as keyof typeof PROJECT_FOLDERS, fileName, content),
      readFile: (subFolder, fileName) => this.readFile(subFolder as keyof typeof PROJECT_FOLDERS, fileName),
      deleteFile: (subFolder, fileName) => this.deleteFile(subFolder as keyof typeof PROJECT_FOLDERS, fileName),
      deleteEntry: (subFolder, entryName, options) => this.deleteEntry(subFolder as keyof typeof PROJECT_FOLDERS, entryName, options),
    };
  }
  private get artifactCleanupContext(): MediaArtifactCleanupContext {
    return {
      activeBackend: this.backends.backend,
      getProjectHandle: () => this.coreService.getProjectHandle(),
      deleteEntry: (subFolder, entryName, options) => this.deleteEntry(subFolder as keyof typeof PROJECT_FOLDERS, entryName, options),
      deleteRawFile: (relativePath) => this.deleteRawFile(relativePath),
      deleteThumbnail: (fileHash) => this.deleteThumbnail(fileHash),
      listFiles: (subFolder) => this.listFiles(subFolder as keyof typeof PROJECT_FOLDERS),
      deleteFile: (subFolder, fileName) => this.deleteFile(subFolder as keyof typeof PROJECT_FOLDERS, fileName),
      deleteAnalysis: (mediaId) => this.deleteAnalysis(mediaId),
      deleteTranscript: (mediaId) => this.deleteTranscript(mediaId),
      deleteWaveform: (mediaId) => this.deleteWaveform(mediaId),
      deleteProxy: (mediaId) => this.deleteProxy(mediaId),
    };
  }
  /** Get the currently active backend */
  get activeBackend(): ProjectBackend {
    const session = getActiveRepositorySession(); return session ? session.location.kind === 'native' ? 'native' : 'fsa' : this.backends.backend;
  }

  /**
   * Browser-private projects (OPFS) cannot retain a user-picked File across
   * reloads. Imports and manual relinks therefore have to promote the bytes
   * into the project's Raw folder even when the global copy setting is off.
   */
  requiresProjectLocalMediaCopies(): boolean {
    return this.backends.backend === 'fsa'
      && (
        !this.isFsaAvailable
        || isAndroidAutoRestoreProjectHandle(this.coreService.getProjectHandle())
      )
      && this.coreService.isProjectOpen();
  }

  /** Check if FSA (File System Access API) is available */
  get isFsaAvailable(): boolean {
    return typeof window !== 'undefined'
      && 'showDirectoryPicker' in window
      && 'showSaveFilePicker' in window;
  }

  /** Switch to native helper backend (for Firefox) */
  activateNativeBackend(): void {
    this.backends.selectNative();
    log.info('Switched to Native Helper backend');
  }

  /** Switch back to FSA backend (for Chrome) */
  activateFsaBackend(): void {
    this.backends.selectFsa();
    log.info('Switched to FSA backend');
  }

  /** Get native core service (for native-specific operations like listProjects) */
  getNativeCoreService(): NativeProjectCoreService | null {
    return this.backends.nativeCoreService;
  }

  /** Get native file storage (for native-specific operations like getFileUrl) */
  getNativeFileStorage(): NativeFileStorageService | null {
    return this.backends.nativeFileStorage;
  }

  /** Helper to get the active core service */
  private get core(): ProjectCoreService | NativeProjectCoreService {
    if (this.backends.backend === 'native' && this.backends.nativeCoreService) {
      return this.backends.nativeCoreService;
    }
    return this.coreService;
  }

  isSupported(): boolean {
    if (this.backends.backend === 'native' || !this.isFsaAvailable) {
      return (this.backends.nativeCoreService?.isSupported() ?? false) || this.coreService.isSupported();
    }
    return this.coreService.isSupported();
  }

  getProjectHandle(): FileSystemDirectoryHandle | null {
    return getActiveRepositoryDirectory() ?? this.coreService.getProjectHandle();
  }

  getProjectPath(): string | null {
    const session = getActiveRepositorySession(); if (session) return session.location.kind === 'native' ? session.location.path : null;
    if (this.backends.backend === 'native' && this.backends.nativeCoreService) {
      return this.backends.nativeCoreService.getProjectPath();
    }
    return null;
  }

  getProjectData(): ProjectFile | null {
    return this.core.getProjectData();
  }

  getProjectPackageSession(): ProjectPackageSession | null {
    if (getActiveRepositorySession()) return null;
    if (this.backends.backend === 'native') {
      const path = this.backends.nativeCoreService?.getProjectPath();
      return path ? getNativeProjectPackageSession(path) : null;
    }
    const handle = this.coreService.getProjectHandle();
    return handle ? getFsaProjectPackageSession(handle) : null;
  }

  isProjectOpen(): boolean {
    return this.core.isProjectOpen();
  }

  hasUnsavedChanges(): boolean {
    return this.core.hasUnsavedChanges();
  }

  markDirty(): void {
    this.core.markDirty();
  }

  needsPermission(): boolean {
    return this.core.needsPermission();
  }

  getPendingProjectName(): string | null {
    return this.core.getPendingProjectName();
  }

  async requestPendingPermission(): Promise<boolean> {
    return this.core.requestPendingPermission();
  }

  async createProject(name: string, preserveCurrent = false, composition?: NewProjectComposition): Promise<boolean> {
    if (this.backends.backend === 'native' || !this.isFsaAvailable) {
      const nativeCore = await this.backends.selectReadyNative();
      if (nativeCore) {
        const projectRoot = await NativeHelperClient.getProjectRoot();
        const parentPath = await pickNativeFolder(
          'Choose where to save your project',
          projectRoot,
        );

        if (!parentPath) return false;
        return nativeCore.createProjectAtPath(parentPath, name, preserveCurrent, composition);
      }
    }

    return this.core.createProject(name, preserveCurrent, composition);
  }

  async createProjectInFolder(handle: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    return this.coreService.createProjectInFolder(handle, name);
  }
  createProjectInBrowserStorage(path: string, name: string): Promise<boolean> { return this.coreService.createProjectInBrowserStorage(path, name); }

  async openProject(): Promise<boolean> {
    if (this.backends.backend === 'fsa' && this.isFsaAvailable) return this.coreService.openProject();
    const nativeCore = await this.backends.selectReadyNative();
    if (!nativeCore) throw new ProjectBackendUnavailableError();
    const projectPath = await pickNativeFolder('Select an existing project folder', await NativeHelperClient.getProjectRoot());
    return projectPath ? nativeCore.loadProject(projectPath) : false;
  }

  /** Without a folder picker or Native Helper, Open Project lists browser-stored projects instead. */
  async resolveOpenProjectRoute(): Promise<OpenProjectRoute> {
    return selectOpenProjectRoute({ folderPicker: this.backends.backend === 'fsa' && this.isFsaAvailable,
      nativeHelper: async () => Boolean(await this.backends.selectReadyNative()), browserStorage: isOpfsAvailable() });
  }

  getRecentProjects(): RecentProjectEntry[] {
    return getRecentProjects();
  }

  async removeRecentProject(id: string): Promise<void> {
    await removeRecentProject(id);
  }

  async clearRecentProjects(): Promise<void> {
    await clearRecentProjects();
  }

  async openRecentProject(id: string): Promise<boolean> {
    return openRecentProjectFromRecent({
      isFsaAvailable: this.isFsaAvailable,
      coreService: this.coreService,
      ensureNativeBackendReady: () => this.backends.selectReadyNative(),
      activateFsaBackend: () => this.activateFsaBackend(),
    }, id);
  }

  async loadProject(handleOrPath: FileSystemDirectoryHandle | string): Promise<boolean> {
    if (typeof handleOrPath === 'string') {
      const nativeCore = await this.backends.selectReadyNative();
      return nativeCore
        ? nativeCore.loadProject(normalizeNativePath(handleOrPath))
        : false;
    }
    return this.coreService.loadProject(handleOrPath);
  }

  async saveProject(): Promise<boolean> {
    return this.core.saveProject();
  }

  async closeProject(): Promise<void> {
    await this.core.closeProject();
  }

  async createBackup(): Promise<boolean> {
    return this.core.createBackup();
  }

  async renameProject(newName: string): Promise<boolean> {
    return this.core.renameProject(newName);
  }

  async restoreLastProject(): Promise<boolean> {
    if (this.backends.backend === 'native' || !this.isFsaAvailable) {
      const nativeCore = await this.backends.selectReadyNative();
      if (nativeCore) return nativeCore.restoreLastProject();
    }

    return this.core.restoreLastProject();
  }

  /** Project names available in browser storage (OPFS); empty on picker backends. */
  async listStoredProjects(): Promise<string[]> {
    return this.coreService.listStoredProjects();
  }

  async openStoredProject(name: string, options?: { signal?: AbortSignal }): Promise<boolean> {
    return this.coreService.openStoredProject(name, options);
  }

  updateProjectData(updates: Partial<ProjectFile>): void {
    this.core.updateProjectData(updates);
  }

  updateMedia(media: ProjectMediaFile[]): void {
    this.core.updateMedia(media);
  }

  updateCompositions(compositions: ProjectComposition[]): void {
    this.core.updateCompositions(compositions);
  }

  updateFolders(folders: ProjectFolder[]): void {
    this.core.updateFolders(folders);
  }


  async getFileHandle(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string,
    create = false
  ): Promise<FileSystemFileHandle | null> {
    if (captureRepositoryDomainPublication()) return repositoryFileHandle(subFolder, fileName, create);
    return getRoutedFileHandle(this.fileRoutingContext, subFolder, fileName, create);
  }

  async writeFile(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string,
    content: Blob | string
  ): Promise<boolean> {
    const host = captureRepositoryDomainPublication();
    return host ? host.writeFile(subFolder, fileName, content) : writeRoutedFile(this.fileRoutingContext, subFolder, fileName, content);
  }

  async readFile(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string
  ): Promise<File | null> {
    const host = captureRepositoryDomainPublication();
    return host ? host.readFile(subFolder, fileName) : readRoutedFile(this.fileRoutingContext, subFolder, fileName);
  }

  async fileExists(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string
  ): Promise<boolean> {
    const host = captureRepositoryDomainPublication();
    return host ? Boolean(await host.readFile(subFolder, fileName)) : routedFileExists(this.fileRoutingContext, subFolder, fileName);
  }

  async deleteFile(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string
  ): Promise<boolean> {
    const host = captureRepositoryDomainPublication();
    return host ? host.deleteFile(subFolder, fileName) : deleteRoutedFile(this.fileRoutingContext, subFolder, fileName);
  }

  async deleteEntry(
    subFolder: keyof typeof PROJECT_FOLDERS,
    entryName: string,
    options?: { recursive?: boolean }
  ): Promise<boolean> {
    const host = captureRepositoryDomainPublication();
    if (host) { const names = repositoryFileNames(subFolder).filter(name => name === entryName || options?.recursive && name.startsWith(entryName + '/'));
      for (const name of names) if (!await host.deleteFile(subFolder, name)) return false; return names.length > 0; }
    return deleteRoutedEntry(this.fileRoutingContext, subFolder, entryName, options);
  }

  async listFiles(subFolder: keyof typeof PROJECT_FOLDERS): Promise<string[]> {
    return captureRepositoryDomainPublication() ? repositoryFileNames(subFolder) : listRoutedFiles(this.fileRoutingContext, subFolder);
  }


  async copyToRawFolder(file: File, fileName?: string): Promise<{ handle?: FileSystemFileHandle; relativePath: string; alreadyExisted: boolean } | null> {
    if (captureRepositoryDomainPublication()) return copyRepositoryRaw(file, fileName);
    return rawMediaRouting.copyToRawFolder(this.rawMediaRoutingContext, file, fileName);
  }

  async getFileFromRaw(relativePath: string): Promise<{ file: File; handle?: FileSystemFileHandle } | null> {
    const host = captureRepositoryDomainPublication();
    if (host) { const name = relativePath.startsWith(PROJECT_FOLDERS.RAW + '/') ? relativePath.slice(PROJECT_FOLDERS.RAW.length + 1) : relativePath;
      const file = await host.readFile('RAW', name); return file ? { file } : null; }
    return rawMediaRouting.getFileFromRaw(this.rawMediaRoutingContext, relativePath);
  }

  async deleteRawFile(relativePath: string | undefined): Promise<boolean> {
    const host = captureRepositoryDomainPublication();
    if (host && relativePath) return host.deleteFile('RAW', relativePath.replace(/^Raw\//, ''));
    return rawMediaRouting.deleteRawFile(this.rawMediaRoutingContext, relativePath);
  }

  resolveRawFilePath(relativePath: string | undefined): string | null {
    if (captureRepositoryDomainPublication()) return null;
    return rawMediaRouting.resolveRawFilePath(this.rawMediaRoutingContext, relativePath);
  }

  resolveRawFileUrl(relativePath: string | undefined): string | null {
    if (captureRepositoryDomainPublication()) return null;
    return rawMediaRouting.resolveRawFileUrl(this.rawMediaRoutingContext, relativePath);
  }

  async hasFileInRaw(fileName: string): Promise<boolean> {
    const host = captureRepositoryDomainPublication();
    return host ? Boolean(await host.readFile('RAW', fileName)) : rawMediaRouting.hasFileInRaw(this.rawMediaRoutingContext, fileName);
  }

  async scanRawFolder(): Promise<Map<string, FileSystemFileHandle>> {
    return captureRepositoryDomainPublication() ? scanRepositoryFiles('RAW') : rawMediaRouting.scanRawFolder(this.rawMediaRoutingContext);
  }

  async scanProjectFolder(): Promise<Map<string, FileSystemFileHandle>> {
    return captureRepositoryDomainPublication() ? scanRepositoryFiles() : rawMediaRouting.scanProjectFolder(this.rawMediaRoutingContext);
  }

  async pickAndScanFolder(title = 'Search folder for media'): Promise<{
    name: string;
    path?: string;
    files: Map<string, FileSystemFileHandle>;
  } | null> {
    return rawMediaRouting.pickAndScanFolder(this.rawMediaRoutingContext, title);
  }

  async importMediaFile(file: File, fileHandle?: FileSystemFileHandle): Promise<ProjectMediaFile | null> {
    return rawMediaRouting.importMediaFile(this.rawMediaRoutingContext, file, fileHandle);
  }

  async saveDownload(blob: Blob, title: string, platform: string): Promise<File | null> {
    const host = captureRepositoryDomainPublication();
    if (host) { const name = repositoryDownloadFolder(platform) + '/' + RawMediaService.getDownloadFileName(title, RawMediaService.getDownloadExtension(blob));
      return await host.writeFile('DOWNLOADS', name, blob) ? host.readFile('DOWNLOADS', name) : null; }
    return rawMediaRouting.saveDownload(this.rawMediaRoutingContext, blob, title, platform);
  }

  async checkDownloadExists(title: string, platform: string): Promise<boolean> {
    if (captureRepositoryDomainPublication()) return Boolean(await this.getDownloadFile(title, platform));
    return rawMediaRouting.checkDownloadExists(this.rawMediaRoutingContext, title, platform);
  }

  async getDownloadFile(title: string, platform: string): Promise<File | null> {
    const host = captureRepositoryDomainPublication();
    if (host) { const stem = RawMediaService.sanitizeDownloadName(title) || 'download';
      for (const name of repositoryFileNames('DOWNLOADS')) if (name.startsWith(repositoryDownloadFolder(platform) + '/' + stem + '.')) return host.readFile('DOWNLOADS', name); return null; }
    return rawMediaRouting.getDownloadFile(this.rawMediaRoutingContext, title, platform);
  }


  async saveThumbnail(fileHash: string, blob: Blob): Promise<boolean> {
    return artifactStorageDelegates.saveThumbnail(this.artifactStorageContext, fileHash, blob);
  }

  async getThumbnail(fileHash: string): Promise<Blob | null> {
    return artifactStorageDelegates.getThumbnail(this.artifactStorageContext, fileHash);
  }

  async hasThumbnail(fileHash: string): Promise<boolean> {
    return artifactStorageDelegates.hasThumbnail(this.artifactStorageContext, fileHash);
  }

  async deleteThumbnail(fileHash: string): Promise<boolean> {
    return artifactStorageDelegates.deleteThumbnail(this.artifactStorageContext, fileHash);
  }

  async saveGaussianSplatRuntime(fileHash: string, variant: string, blob: Blob): Promise<boolean> {
    return artifactStorageDelegates.saveGaussianSplatRuntime(this.artifactStorageContext, fileHash, variant, blob);
  }

  async getGaussianSplatRuntime(fileHash: string, variant: string): Promise<File | null> {
    return artifactStorageDelegates.getGaussianSplatRuntime(this.artifactStorageContext, fileHash, variant);
  }

  async hasGaussianSplatRuntime(fileHash: string, variant: string): Promise<boolean> {
    return artifactStorageDelegates.hasGaussianSplatRuntime(this.artifactStorageContext, fileHash, variant);
  }

  async saveWaveform(mediaId: string, waveformData: Float32Array): Promise<boolean> {
    return artifactStorageDelegates.saveWaveform(this.artifactStorageContext, mediaId, waveformData);
  }

  async getWaveform(mediaId: string): Promise<Float32Array | null> {
    return artifactStorageDelegates.getWaveform(this.artifactStorageContext, mediaId);
  }

  async deleteWaveform(mediaId: string): Promise<boolean> {
    return artifactStorageDelegates.deleteWaveform(this.artifactStorageContext, mediaId);
  }


  async saveProxyFrame(mediaId: string, frameIndex: number, blob: Blob): Promise<boolean> {
    return artifactStorageDelegates.saveProxyFrame(this.artifactStorageContext, mediaId, frameIndex, blob);
  }

  async createProxyFrameWriter(mediaId: string): Promise<ProxyFrameWriter | null> {
    return artifactStorageDelegates.createProxyFrameWriter(this.artifactStorageContext, mediaId);
  }

  async getProxyFrame(mediaId: string, frameIndex: number): Promise<Blob | null> {
    return artifactStorageDelegates.getProxyFrame(this.artifactStorageContext, mediaId, frameIndex);
  }

  async hasProxy(mediaId: string): Promise<boolean> {
    return artifactStorageDelegates.hasProxy(this.artifactStorageContext, mediaId);
  }

  async getProxyFrameCount(mediaId: string): Promise<number> {
    return artifactStorageDelegates.getProxyFrameCount(this.artifactStorageContext, mediaId);
  }

  async getProxyFrameIndices(mediaId: string, onProgress?: ProxyFrameScanProgressCallback): Promise<Set<number>> {
    return artifactStorageDelegates.getProxyFrameIndices(this.artifactStorageContext, mediaId, onProgress);
  }

  async saveProxyVideo(mediaId: string, blob: Blob): Promise<boolean> {
    return artifactStorageDelegates.saveProxyVideo(this.artifactStorageContext, mediaId, blob);
  }

  async getProxyVideo(mediaId: string): Promise<File | null> {
    return artifactStorageDelegates.getProxyVideo(this.artifactStorageContext, mediaId);
  }

  async hasProxyVideo(mediaId: string): Promise<boolean> {
    return artifactStorageDelegates.hasProxyVideo(this.artifactStorageContext, mediaId);
  }

  async saveProxyAudio(mediaId: string, blob: Blob): Promise<boolean> {
    return artifactStorageDelegates.saveProxyAudio(this.artifactStorageContext, mediaId, blob);
  }

  async getProxyAudio(mediaId: string): Promise<File | null> {
    return artifactStorageDelegates.getProxyAudio(this.artifactStorageContext, mediaId);
  }

  async hasProxyAudio(mediaId: string): Promise<boolean> {
    return artifactStorageDelegates.hasProxyAudio(this.artifactStorageContext, mediaId);
  }

  async deleteProxy(mediaId: string): Promise<boolean> {
    return artifactStorageDelegates.deleteProxy(this.artifactStorageContext, mediaId);
  }


  async saveAnalysis(
    mediaId: string,
    inPoint: number,
    outPoint: number,
    frames: unknown[],
    sampleInterval: number,
    faceAnalysis?: unknown,
  ): Promise<boolean> {
    return artifactStorageDelegates.saveAnalysis(
      this.artifactStorageContext, mediaId, inPoint, outPoint, frames, sampleInterval, faceAnalysis,
    );
  }

  async getAnalysis(
    mediaId: string,
    inPoint: number,
    outPoint: number
  ): Promise<{ frames: unknown[]; sampleInterval: number; faceAnalysis?: unknown } | null> {
    return artifactStorageDelegates.getAnalysis(this.artifactStorageContext, mediaId, inPoint, outPoint);
  }

  async hasAnalysis(mediaId: string, inPoint: number, outPoint: number): Promise<boolean> {
    return artifactStorageDelegates.hasAnalysis(this.artifactStorageContext, mediaId, inPoint, outPoint);
  }

  async getAnalysisRanges(mediaId: string): Promise<string[]> {
    return artifactStorageDelegates.getAnalysisRanges(this.artifactStorageContext, mediaId);
  }

  async getAllAnalysisMerged(mediaId: string): Promise<{ frames: unknown[]; sampleInterval: number } | null> {
    return artifactStorageDelegates.getAllAnalysisMerged(this.artifactStorageContext, mediaId);
  }

  async saveSceneDescriptions(mediaId: string, segments: unknown[]): Promise<boolean> {
    return artifactStorageDelegates.saveSceneDescriptions(this.artifactStorageContext, mediaId, segments);
  }

  async getSceneDescriptions(mediaId: string): Promise<unknown[] | null> {
    return artifactStorageDelegates.getSceneDescriptions(this.artifactStorageContext, mediaId);
  }

  async deleteSceneDescriptions(mediaId: string): Promise<boolean> {
    return artifactStorageDelegates.deleteSceneDescriptions(this.artifactStorageContext, mediaId);
  }

  async deleteAnalysis(mediaId: string): Promise<boolean> {
    return artifactStorageDelegates.deleteAnalysis(this.artifactStorageContext, mediaId);
  }

  async deleteAnalysisRange(mediaId: string, inPoint: number, outPoint: number): Promise<boolean> {
    return artifactStorageDelegates.deleteAnalysisRange(this.artifactStorageContext, mediaId, inPoint, outPoint);
  }


  async saveTranscript(mediaId: string, transcript: unknown, transcribedRanges?: [number, number][]): Promise<boolean> {
    return artifactStorageDelegates.saveTranscript(this.artifactStorageContext, mediaId, transcript, transcribedRanges);
  }

  async getTranscript(mediaId: string): Promise<StoredTranscript | null> {
    return artifactStorageDelegates.getTranscript(this.artifactStorageContext, mediaId);
  }

  async getTranscribedRanges(mediaId: string): Promise<[number, number][]> {
    return artifactStorageDelegates.getTranscribedRanges(this.artifactStorageContext, mediaId);
  }

  async deleteTranscript(mediaId: string): Promise<boolean> {
    return artifactStorageDelegates.deleteTranscript(this.artifactStorageContext, mediaId);
  }

  async deleteAudioArtifact(ref: string): Promise<boolean> {
    return deleteProjectAudioArtifact(this.artifactCleanupContext, ref);
  }

  async deleteMediaFileArtifacts(options: DeleteMediaFileArtifactsOptions): Promise<DeleteMediaFileArtifactsResult> {
    return deleteProjectMediaFileArtifacts(this.artifactCleanupContext, options);
  }
}

export const projectFileService = (import.meta.hot?.data?.projectFileService as ProjectFileService | undefined) ?? new ProjectFileService();
if (import.meta.hot) { import.meta.hot.dispose(data => { data.projectFileService = projectFileService; }); import.meta.hot.accept(); }
