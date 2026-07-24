// Project File Service Facade
// Delegates to domain services while maintaining the original API for backward compatibility
// Supports two backends: FSA (Chrome) and Native Helper (Firefox)

import { Logger } from '../logger';
import { FileStorageService, fileStorageService } from './core/FileStorageService';
import { NativeFileStorageService, nativeFileStorageService } from './core/NativeFileStorageService';
import { NativeProjectCoreService } from './core/NativeProjectCoreService';
import { NativeHelperClient } from '../nativeHelper/NativeHelperClient';
import { ProjectCoreService } from './core/ProjectCoreService';
import { AnalysisService } from './domains/AnalysisService';
import { TranscriptService } from './domains/TranscriptService';
import { CacheService } from './domains/CacheService';
import { ProxyStorageService, type ProxyFrameScanProgressCallback, type ProxyFrameWriter } from './domains/ProxyStorageService';
import { RawMediaService } from './domains/RawMediaService';
import { PROJECT_FOLDERS } from './core/constants';
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

export type {
  DeleteMediaFileArtifactsOptions,
  DeleteMediaFileArtifactsResult,
} from './fileService/artifactCleanup';

const log = Logger.create('ProjectFileService');

export type ProjectBackend = 'fsa' | 'native';

class ProjectFileService {
  // Domain services
  private readonly coreService: ProjectCoreService;
  private readonly fileStorage: FileStorageService;
  private readonly analysisService: AnalysisService;
  private readonly transcriptService: TranscriptService;
  private readonly cacheService: CacheService;
  private readonly proxyStorageService: ProxyStorageService;
  private readonly rawMediaService: RawMediaService;

  // Native Helper backend (lazy-initialized)
  private nativeCoreService: NativeProjectCoreService | null = null;
  private nativeFileStorage: NativeFileStorageService | null = null;
  private _activeBackend: ProjectBackend = 'fsa';

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
      activeBackend: this._activeBackend,
      coreService: this.coreService,
      fileStorage: this.fileStorage,
      nativeCoreService: this.nativeCoreService,
      nativeFileStorage: this.nativeFileStorage,
    };
  }

  private get rawMediaRoutingContext(): rawMediaRouting.RawMediaRoutingContext {
    return {
      activeBackend: this._activeBackend,
      coreService: this.coreService,
      nativeCoreService: this.nativeCoreService,
      rawMediaService: this.rawMediaService,
      getProjectData: () => this.core.getProjectData(),
      markDirty: () => this.core.markDirty(),
      ensureNativeBackendReady: () => this.ensureNativeBackendReady(),
    };
  }

  private get artifactStorageContext(): artifactStorageDelegates.ArtifactStorageContext {
    return {
      activeBackend: this._activeBackend,
      getProjectHandle: () => this.coreService.getProjectHandle(),
      getNativeProjectPath: () => this.nativeCoreService?.getProjectPath() ?? null,
      cacheService: this.cacheService,
      proxyStorageService: this.proxyStorageService,
      analysisService: this.analysisService,
      transcriptService: this.transcriptService,
      deleteFile: (subFolder, fileName) => this.deleteFile(subFolder as keyof typeof PROJECT_FOLDERS, fileName),
      deleteEntry: (subFolder, entryName, options) => this.deleteEntry(subFolder as keyof typeof PROJECT_FOLDERS, entryName, options),
    };
  }

  private get artifactCleanupContext(): MediaArtifactCleanupContext {
    return {
      activeBackend: this._activeBackend,
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

  private ensureNativeBackend(): NativeProjectCoreService {
    if (!this.nativeCoreService) {
      this.nativeCoreService = new NativeProjectCoreService();
      this.nativeFileStorage = nativeFileStorageService;
    }
    this._activeBackend = 'native';
    return this.nativeCoreService;
  }

  private async ensureNativeBackendReady(): Promise<NativeProjectCoreService | null> {
    const nativeCore = this.ensureNativeBackend();

    if (!NativeHelperClient.isConnected()) {
      const connected = await NativeHelperClient.connect();
      if (!connected) {
        log.warn('Native Helper backend requested but helper is not connected');
        return null;
      }
    }

    const hasFsCommands = await NativeHelperClient.hasFsCommands();
    if (!hasFsCommands) {
      log.error('Native Helper does not support project file-system commands');
      return null;
    }

    return nativeCore;
  }

  // ============================================
  // BACKEND SELECTION
  // ============================================

  /** Get the currently active backend */
  get activeBackend(): ProjectBackend {
    return this._activeBackend;
  }

  /** Check if FSA (File System Access API) is available */
  get isFsaAvailable(): boolean {
    return typeof window !== 'undefined'
      && 'showDirectoryPicker' in window
      && 'showSaveFilePicker' in window;
  }

  /** Switch to native helper backend (for Firefox) */
  activateNativeBackend(): void {
    this.ensureNativeBackend();
    log.info('Switched to Native Helper backend');
  }

  /** Switch back to FSA backend (for Chrome) */
  activateFsaBackend(): void {
    this._activeBackend = 'fsa';
    log.info('Switched to FSA backend');
  }

  /** Get native core service (for native-specific operations like listProjects) */
  getNativeCoreService(): NativeProjectCoreService | null {
    return this.nativeCoreService;
  }

  /** Get native file storage (for native-specific operations like getFileUrl) */
  getNativeFileStorage(): NativeFileStorageService | null {
    return this.nativeFileStorage;
  }

  // ============================================
  // CORE SERVICE DELEGATION (routes to FSA or Native)
  // ============================================

  /** Helper to get the active core service */
  private get core(): ProjectCoreService | NativeProjectCoreService {
    if (this._activeBackend === 'native' && this.nativeCoreService) {
      return this.nativeCoreService;
    }
    return this.coreService;
  }

  isSupported(): boolean {
    if (this._activeBackend === 'native' || !this.isFsaAvailable) {
      return this.nativeCoreService?.isSupported() ?? false;
    }
    return this.coreService.isSupported();
  }

  getProjectHandle(): FileSystemDirectoryHandle | null {
    // Only FSA backend has a handle
    if (this._activeBackend === 'fsa' && this.isFsaAvailable) {
      return this.coreService.getProjectHandle();
    }
    return null;
  }

  /** Get project path (native backend) or null */
  getProjectPath(): string | null {
    if (this._activeBackend === 'native' && this.nativeCoreService) {
      return this.nativeCoreService.getProjectPath();
    }
    return null;
  }

  getProjectData(): ProjectFile | null {
    return this.core.getProjectData();
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

  async createProject(name: string): Promise<boolean> {
    if (this._activeBackend === 'native' || !this.isFsaAvailable) {
      const nativeCore = await this.ensureNativeBackendReady();
      if (!nativeCore) return false;

      const projectRoot = await NativeHelperClient.getProjectRoot();
      const parentPath = await pickNativeFolder(
        'Choose where to save your project',
        projectRoot,
      );

      if (!parentPath) return false;
      return nativeCore.createProjectAtPath(parentPath, name);
    }

    return this.core.createProject(name);
  }

  async createProjectInFolder(handle: FileSystemDirectoryHandle, name: string): Promise<boolean> {
    // Only FSA supports this
    return this.coreService.createProjectInFolder(handle, name);
  }

  async openProject(): Promise<boolean> {
    if (this._activeBackend === 'fsa' && this.isFsaAvailable) {
      return this.coreService.openProject();
    }
    const nativeCore = await this.ensureNativeBackendReady();
    if (!nativeCore) return false;

    const projectRoot = await NativeHelperClient.getProjectRoot();
    const projectPath = await pickNativeFolder(
      'Select an existing project folder',
      projectRoot,
    );

    if (!projectPath) return false;
    return nativeCore.loadProject(projectPath);
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
      ensureNativeBackendReady: () => this.ensureNativeBackendReady(),
      activateFsaBackend: () => this.activateFsaBackend(),
    }, id);
  }

  async loadProject(handleOrPath: FileSystemDirectoryHandle | string): Promise<boolean> {
    if (typeof handleOrPath === 'string') {
      const nativeCore = await this.ensureNativeBackendReady();
      return nativeCore
        ? nativeCore.loadProject(normalizeNativePath(handleOrPath))
        : false;
    }
    // FSA handle
    return this.coreService.loadProject(handleOrPath);
  }

  async saveProject(): Promise<boolean> {
    return this.core.saveProject();
  }

  closeProject(): void {
    this.core.closeProject();
  }

  async createBackup(): Promise<boolean> {
    return this.core.createBackup();
  }

  async renameProject(newName: string): Promise<boolean> {
    return this.core.renameProject(newName);
  }

  async restoreLastProject(): Promise<boolean> {
    if (this._activeBackend === 'native' || !this.isFsaAvailable) {
      const nativeCore = await this.ensureNativeBackendReady();
      return nativeCore ? nativeCore.restoreLastProject() : false;
    }

    return this.core.restoreLastProject();
  }

  async saveKeysFile(): Promise<void> {
    return this.core.saveKeysFile();
  }

  async loadKeysFile(): Promise<boolean> {
    return this.core.loadKeysFile();
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

  // ============================================
  // FILE STORAGE DELEGATION (routes to FSA or Native)
  // ============================================

  async getFileHandle(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string,
    create = false
  ): Promise<FileSystemFileHandle | null> {
    return getRoutedFileHandle(this.fileRoutingContext, subFolder, fileName, create);
  }

  async writeFile(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string,
    content: Blob | string
  ): Promise<boolean> {
    return writeRoutedFile(this.fileRoutingContext, subFolder, fileName, content);
  }

  async readFile(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string
  ): Promise<File | null> {
    return readRoutedFile(this.fileRoutingContext, subFolder, fileName);
  }

  async fileExists(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string
  ): Promise<boolean> {
    return routedFileExists(this.fileRoutingContext, subFolder, fileName);
  }

  async deleteFile(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string
  ): Promise<boolean> {
    return deleteRoutedFile(this.fileRoutingContext, subFolder, fileName);
  }

  async deleteEntry(
    subFolder: keyof typeof PROJECT_FOLDERS,
    entryName: string,
    options?: { recursive?: boolean }
  ): Promise<boolean> {
    return deleteRoutedEntry(this.fileRoutingContext, subFolder, entryName, options);
  }

  async listFiles(subFolder: keyof typeof PROJECT_FOLDERS): Promise<string[]> {
    return listRoutedFiles(this.fileRoutingContext, subFolder);
  }

  // ============================================
  // RAW MEDIA SERVICE DELEGATION
  // ============================================

  async copyToRawFolder(file: File, fileName?: string): Promise<{ handle?: FileSystemFileHandle; relativePath: string; alreadyExisted: boolean } | null> {
    return rawMediaRouting.copyToRawFolder(this.rawMediaRoutingContext, file, fileName);
  }

  async getFileFromRaw(relativePath: string): Promise<{ file: File; handle?: FileSystemFileHandle } | null> {
    return rawMediaRouting.getFileFromRaw(this.rawMediaRoutingContext, relativePath);
  }

  async deleteRawFile(relativePath: string | undefined): Promise<boolean> {
    return rawMediaRouting.deleteRawFile(this.rawMediaRoutingContext, relativePath);
  }

  resolveRawFilePath(relativePath: string | undefined): string | null {
    return rawMediaRouting.resolveRawFilePath(this.rawMediaRoutingContext, relativePath);
  }

  resolveRawFileUrl(relativePath: string | undefined): string | null {
    return rawMediaRouting.resolveRawFileUrl(this.rawMediaRoutingContext, relativePath);
  }

  async hasFileInRaw(fileName: string): Promise<boolean> {
    return rawMediaRouting.hasFileInRaw(this.rawMediaRoutingContext, fileName);
  }

  async scanRawFolder(): Promise<Map<string, FileSystemFileHandle>> {
    return rawMediaRouting.scanRawFolder(this.rawMediaRoutingContext);
  }

  async scanProjectFolder(): Promise<Map<string, FileSystemFileHandle>> {
    return rawMediaRouting.scanProjectFolder(this.rawMediaRoutingContext);
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
    return rawMediaRouting.saveDownload(this.rawMediaRoutingContext, blob, title, platform);
  }

  async checkDownloadExists(title: string, platform: string): Promise<boolean> {
    return rawMediaRouting.checkDownloadExists(this.rawMediaRoutingContext, title, platform);
  }

  async getDownloadFile(title: string, platform: string): Promise<File | null> {
    return rawMediaRouting.getDownloadFile(this.rawMediaRoutingContext, title, platform);
  }

  // ============================================
  // CACHE SERVICE DELEGATION
  // ============================================

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

  // ============================================
  // PROXY STORAGE SERVICE DELEGATION
  // ============================================

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

  // ============================================
  // ANALYSIS SERVICE DELEGATION
  // ============================================

  async saveAnalysis(
    mediaId: string,
    inPoint: number,
    outPoint: number,
    frames: unknown[],
    sampleInterval: number
  ): Promise<boolean> {
    return artifactStorageDelegates.saveAnalysis(this.artifactStorageContext, mediaId, inPoint, outPoint, frames, sampleInterval);
  }

  async getAnalysis(
    mediaId: string,
    inPoint: number,
    outPoint: number
  ): Promise<{ frames: unknown[]; sampleInterval: number } | null> {
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

  async deleteAnalysis(mediaId: string): Promise<boolean> {
    return artifactStorageDelegates.deleteAnalysis(this.artifactStorageContext, mediaId);
  }

  async deleteAnalysisRange(mediaId: string, inPoint: number, outPoint: number): Promise<boolean> {
    return artifactStorageDelegates.deleteAnalysisRange(this.artifactStorageContext, mediaId, inPoint, outPoint);
  }

  // ============================================
  // TRANSCRIPT SERVICE DELEGATION
  // ============================================

  async saveTranscript(mediaId: string, transcript: unknown, transcribedRanges?: [number, number][]): Promise<boolean> {
    return artifactStorageDelegates.saveTranscript(this.artifactStorageContext, mediaId, transcript, transcribedRanges);
  }

  async getTranscript(mediaId: string): Promise<{ words: unknown[]; transcribedRanges?: [number, number][] } | null> {
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

// Singleton instance
export const projectFileService = new ProjectFileService();
