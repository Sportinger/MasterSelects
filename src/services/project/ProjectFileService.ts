// Project File Service Facade
// Delegates to domain services while maintaining the original API for backward compatibility
// Supports two backends: FSA (Chrome) and Native Helper (Firefox)

import { Logger } from '../logger';
import { FileStorageService, fileStorageService } from './core/FileStorageService';
import { NativeFileStorageService, nativeFileStorageService } from './core/NativeFileStorageService';
import { NativeProjectCoreService } from './core/NativeProjectCoreService';
import { NativeHelperClient } from '../nativeHelper/NativeHelperClient';

const log = Logger.create('ProjectFileService');
import { ProjectCoreService } from './core/ProjectCoreService';
import { AnalysisService } from './domains/AnalysisService';
import { TranscriptService } from './domains/TranscriptService';
import { CacheService } from './domains/CacheService';
import { ProxyStorageService, type ProxyFrameWriter } from './domains/ProxyStorageService';
import { RawMediaService } from './domains/RawMediaService';
import { PROJECT_FOLDERS, type ProjectFolderKey } from './core/constants';
import {
  addFileNameSuffix,
  buildRawTargetPath,
  getRawRelativePath,
  parseRawRelativePath,
} from './core/rawPath';
import type { ProjectFile, ProjectMediaFile, ProjectComposition, ProjectFolder } from './types';

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

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

  private joinPath(...parts: string[]): string {
    return parts
      .map((part) => part.replace(/\\/g, '/').replace(/\/+$/, ''))
      .join('/');
  }

  private normalizeNativePath(path: string): string {
    return path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
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

  private async pickNativeFolder(title: string, defaultPath?: string | null): Promise<string | null> {
    const fallbackPath = defaultPath ? this.normalizeNativePath(defaultPath) : '';
    const result = await NativeHelperClient.pickFolderDetailed(title, fallbackPath || undefined);

    if (result.path) {
      const selectedPath = this.normalizeNativePath(result.path);
      await NativeHelperClient.grantPath(selectedPath);
      return selectedPath;
    }

    if (result.cancelled) {
      return null;
    }

    log.warn('Native folder picker unavailable, falling back to manual path entry', {
      title,
      error: result.error,
    });

    const detectedRoot = fallbackPath || (await NativeHelperClient.getProjectRoot());
    const promptDefault = detectedRoot || '';
    const enteredPath = window.prompt(
      `${title}\n\nNative folder picker is unavailable here. Enter the folder path manually:`,
      promptDefault,
    );

    if (!enteredPath?.trim()) {
      return null;
    }

    const selectedPath = this.normalizeNativePath(enteredPath);
    await NativeHelperClient.grantPath(selectedPath);
    return selectedPath;
  }

  private getMimeTypeFromFileName(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';

    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      case 'mp4':
        return 'video/mp4';
      case 'mov':
        return 'video/quicktime';
      case 'webm':
        return 'video/webm';
      case 'glb':
        return 'model/gltf-binary';
      case 'gltf':
        return 'model/gltf+json';
      case 'obj':
        return 'model/obj';
      case 'mp3':
        return 'audio/mpeg';
      case 'wav':
        return 'audio/wav';
      case 'm4a':
        return 'audio/mp4';
      default:
        return 'application/octet-stream';
    }
  }

  private async copyToRawFolderNative(
    file: File,
    fileName?: string,
  ): Promise<{ handle?: FileSystemFileHandle; relativePath: string; alreadyExisted: boolean } | null> {
    const projectPath = this.nativeCoreService?.getProjectPath();

    if (!projectPath) {
      log.warn('No native project open, cannot copy to Raw folder');
      return null;
    }

    const rawFolderPath = this.joinPath(projectPath, PROJECT_FOLDERS.RAW);
    const target = buildRawTargetPath(fileName, file.name);
    const targetFolderPath = target.folderPath
      ? this.joinPath(rawFolderPath, target.folderPath)
      : rawFolderPath;

    await NativeHelperClient.createDir(targetFolderPath);

    const entries = await NativeHelperClient.listDir(targetFolderPath);

    let finalName = target.fileName;
    let counter = 0;
    while (true) {
      const existing = entries.find((entry) => entry.kind === 'file' && entry.name === finalName);
      if (!existing) {
        break;
      }

      if (existing.size === file.size) {
        return {
          relativePath: getRawRelativePath(target.folderPath, finalName),
          alreadyExisted: true,
        };
      }

      counter += 1;
      finalName = addFileNameSuffix(target.fileName, counter);
    }

    const fullPath = this.joinPath(targetFolderPath, finalName);
    const success = await NativeHelperClient.writeFileBinary(fullPath, file);

    if (!success) {
      return null;
    }

    return {
      relativePath: getRawRelativePath(target.folderPath, finalName),
      alreadyExisted: false,
    };
  }

  private async getFileFromRawNative(
    relativePath: string,
  ): Promise<{ file: File; handle?: FileSystemFileHandle } | null> {
    const projectPath = this.nativeCoreService?.getProjectPath();

    if (!projectPath) {
      return null;
    }

    const target = parseRawRelativePath(relativePath);
    if (!target) {
      return null;
    }

    const fullPath = this.joinPath(projectPath, target.relativePath);
    const fileBuffer = await NativeHelperClient.getDownloadedFile(fullPath);

    if (!fileBuffer) {
      return null;
    }

    return {
      file: new File([fileBuffer], target.fileName, {
        type: this.getMimeTypeFromFileName(target.fileName),
      }),
    };
  }

  private createNativeFileHandle(fullPath: string, name: string): FileSystemFileHandle {
    const handle = {
      kind: 'file',
      name,
      getFile: async () => {
        const fileBuffer = await NativeHelperClient.getDownloadedFile(fullPath);
        if (!fileBuffer) {
          throw new DOMException(`Could not read ${fullPath}`, 'NotFoundError');
        }
        return new File([fileBuffer], name, {
          type: this.getMimeTypeFromFileName(name),
        });
      },
      createWritable: async () => {
        throw new DOMException('Native helper file handles are read-only', 'NotAllowedError');
      },
      isSameEntry: async (other: FileSystemHandle) => other === handle,
      queryPermission: async () => 'granted' as PermissionState,
      requestPermission: async () => 'granted' as PermissionState,
    } as FileSystemFileHandle & { __nativePath?: string };

    handle.__nativePath = fullPath;
    return handle;
  }

  private async scanNativeFolder(rootPath: string): Promise<Map<string, FileSystemFileHandle>> {
    const foundFiles = new Map<string, FileSystemFileHandle>();

    const scanDirectory = async (directoryPath: string): Promise<void> => {
      const entries = await NativeHelperClient.listDir(directoryPath);
      for (const entry of entries) {
        const fullPath = this.joinPath(directoryPath, entry.name);
        if (entry.kind === 'file') {
          const key = entry.name.toLowerCase();
          if (!foundFiles.has(key)) {
            foundFiles.set(key, this.createNativeFileHandle(fullPath, entry.name));
          }
        } else if (entry.kind === 'directory') {
          await scanDirectory(fullPath);
        }
      }
    };

    try {
      await scanDirectory(rootPath);
    } catch (error) {
      log.debug('Native folder scan failed', { rootPath, error });
    }

    return foundFiles;
  }

  private async scanDirectoryHandle(root: FileSystemDirectoryHandle): Promise<Map<string, FileSystemFileHandle>> {
    const foundFiles = new Map<string, FileSystemFileHandle>();

    const scanDirectory = async (directory: FileSystemDirectoryHandle): Promise<void> => {
      for await (const entry of (directory as IterableDirectoryHandle).values()) {
        if (entry.kind === 'file') {
          const key = entry.name.toLowerCase();
          if (!foundFiles.has(key)) {
            foundFiles.set(key, entry);
          }
        } else if (entry.kind === 'directory') {
          await scanDirectory(entry);
        }
      }
    };

    try {
      await scanDirectory(root);
    } catch (error) {
      log.debug('Project folder scan failed', { folder: root.name, error });
    }

    return foundFiles;
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
      const parentPath = await this.pickNativeFolder(
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
    const projectPath = await this.pickNativeFolder(
      'Select an existing project folder',
      projectRoot,
    );

    if (!projectPath) return false;
    return nativeCore.loadProject(projectPath);
  }

  async loadProject(handleOrPath: FileSystemDirectoryHandle | string): Promise<boolean> {
    if (typeof handleOrPath === 'string') {
      const nativeCore = await this.ensureNativeBackendReady();
      return nativeCore
        ? nativeCore.loadProject(this.normalizeNativePath(handleOrPath))
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
    // Only FSA backend returns file handles
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.fileStorage.getFileHandle(handle, subFolder as ProjectFolderKey, fileName, create);
  }

  async writeFile(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string,
    content: Blob | string
  ): Promise<boolean> {
    if (this._activeBackend === 'native' && this.nativeFileStorage && this.nativeCoreService) {
      const path = this.nativeCoreService.getProjectPath();
      if (!path) return false;
      return this.nativeFileStorage.writeFile(path, subFolder as ProjectFolderKey, fileName, content);
    }
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.fileStorage.writeFile(handle, subFolder as ProjectFolderKey, fileName, content);
  }

  async readFile(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string
  ): Promise<File | null> {
    if (this._activeBackend === 'native' && this.nativeFileStorage && this.nativeCoreService) {
      // Native backend: read via HTTP and wrap in File object
      const path = this.nativeCoreService.getProjectPath();
      if (!path) return null;
      const buffer = await this.nativeFileStorage.readFileBinary(path, subFolder as ProjectFolderKey, fileName);
      if (!buffer) return null;
      return new File([buffer], fileName);
    }
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.fileStorage.readFile(handle, subFolder as ProjectFolderKey, fileName);
  }

  async fileExists(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string
  ): Promise<boolean> {
    if (this._activeBackend === 'native' && this.nativeFileStorage && this.nativeCoreService) {
      const path = this.nativeCoreService.getProjectPath();
      if (!path) return false;
      return this.nativeFileStorage.fileExists(path, subFolder as ProjectFolderKey, fileName);
    }
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.fileStorage.fileExists(handle, subFolder as ProjectFolderKey, fileName);
  }

  async deleteFile(
    subFolder: keyof typeof PROJECT_FOLDERS,
    fileName: string
  ): Promise<boolean> {
    if (this._activeBackend === 'native' && this.nativeFileStorage && this.nativeCoreService) {
      const path = this.nativeCoreService.getProjectPath();
      if (!path) return false;
      return this.nativeFileStorage.deleteFile(path, subFolder as ProjectFolderKey, fileName);
    }
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.fileStorage.deleteFile(handle, subFolder as ProjectFolderKey, fileName);
  }

  async listFiles(subFolder: keyof typeof PROJECT_FOLDERS): Promise<string[]> {
    if (this._activeBackend === 'native' && this.nativeFileStorage && this.nativeCoreService) {
      const path = this.nativeCoreService.getProjectPath();
      if (!path) return [];
      return this.nativeFileStorage.listFiles(path, subFolder as ProjectFolderKey);
    }
    const handle = this.coreService.getProjectHandle();
    if (!handle) return [];
    return this.fileStorage.listFiles(handle, subFolder as ProjectFolderKey);
  }

  // ============================================
  // RAW MEDIA SERVICE DELEGATION
  // ============================================

  async copyToRawFolder(file: File, fileName?: string): Promise<{ handle?: FileSystemFileHandle; relativePath: string; alreadyExisted: boolean } | null> {
    if (this._activeBackend === 'native' && this.nativeCoreService) {
      return this.copyToRawFolderNative(file, fileName);
    }

    const handle = this.coreService.getProjectHandle();
    if (!handle) {
      log.warn('No project open, cannot copy to Raw folder');
      return null;
    }
    return this.rawMediaService.copyToRawFolder(handle, file, fileName);
  }

  async getFileFromRaw(relativePath: string): Promise<{ file: File; handle?: FileSystemFileHandle } | null> {
    if (this._activeBackend === 'native' && this.nativeCoreService) {
      return this.getFileFromRawNative(relativePath);
    }

    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.rawMediaService.getFileFromRaw(handle, relativePath);
  }

  resolveRawFilePath(relativePath: string | undefined): string | null {
    if (this._activeBackend !== 'native' || !this.nativeCoreService || !relativePath) {
      return null;
    }

    const projectPath = this.nativeCoreService.getProjectPath();
    const target = parseRawRelativePath(relativePath);
    if (!projectPath || !target) {
      return null;
    }

    return this.joinPath(projectPath, target.relativePath);
  }

  resolveRawFileUrl(relativePath: string | undefined): string | null {
    const fullPath = this.resolveRawFilePath(relativePath);
    return fullPath ? NativeHelperClient.getFileReferenceUrl(fullPath) : null;
  }

  async hasFileInRaw(fileName: string): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.rawMediaService.hasFileInRaw(handle, fileName);
  }

  async scanRawFolder(): Promise<Map<string, FileSystemFileHandle>> {
    if (this._activeBackend === 'native' && this.nativeCoreService) {
      const projectPath = this.nativeCoreService.getProjectPath();
      if (!projectPath) return new Map();
      return this.scanNativeFolder(this.joinPath(projectPath, PROJECT_FOLDERS.RAW));
    }

    const handle = this.coreService.getProjectHandle();
    if (!handle) return new Map();
    return this.rawMediaService.scanRawFolder(handle);
  }

  async scanProjectFolder(): Promise<Map<string, FileSystemFileHandle>> {
    if (this._activeBackend === 'native' && this.nativeCoreService) {
      const projectPath = this.nativeCoreService.getProjectPath();
      if (!projectPath) return new Map();
      return this.scanNativeFolder(projectPath);
    }

    const handle = this.coreService.getProjectHandle();
    if (!handle) return new Map();
    return this.scanDirectoryHandle(handle);
  }

  async pickAndScanFolder(title = 'Search folder for media'): Promise<{
    name: string;
    path?: string;
    files: Map<string, FileSystemFileHandle>;
  } | null> {
    if (this._activeBackend !== 'native') {
      return null;
    }

    const nativeCore = await this.ensureNativeBackendReady();
    if (!nativeCore) {
      return null;
    }

    const defaultPath = nativeCore.getProjectPath() ?? await NativeHelperClient.getProjectRoot();
    const folderPath = await this.pickNativeFolder(title, defaultPath);
    if (!folderPath) {
      return null;
    }

    const normalizedPath = this.normalizeNativePath(folderPath);
    const name = normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath;
    return {
      name,
      path: normalizedPath,
      files: await this.scanNativeFolder(normalizedPath),
    };
  }

  async importMediaFile(file: File, fileHandle?: FileSystemFileHandle): Promise<ProjectMediaFile | null> {
    const projectData = this.core.getProjectData();
    if (!projectData) return null;

    const mediaFile = await this.rawMediaService.importMediaFile(file, fileHandle);
    if (!mediaFile) return null;

    // Add to project
    projectData.media.push(mediaFile);
    this.core.markDirty();

    return mediaFile;
  }

  async saveDownload(blob: Blob, title: string, platform: string): Promise<File | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) {
      log.warn('No project open, cannot save download to project');
      return null;
    }
    return this.rawMediaService.saveDownload(handle, blob, title, platform);
  }

  async checkDownloadExists(title: string, platform: string): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.rawMediaService.checkDownloadExists(handle, title, platform);
  }

  async getDownloadFile(title: string, platform: string): Promise<File | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.rawMediaService.getDownloadFile(handle, title, platform);
  }

  // ============================================
  // CACHE SERVICE DELEGATION
  // ============================================

  async saveThumbnail(fileHash: string, blob: Blob): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.cacheService.saveThumbnail(handle, fileHash, blob);
  }

  async getThumbnail(fileHash: string): Promise<Blob | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.cacheService.getThumbnail(handle, fileHash);
  }

  async hasThumbnail(fileHash: string): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.cacheService.hasThumbnail(handle, fileHash);
  }

  async saveGaussianSplatRuntime(fileHash: string, variant: string, blob: Blob): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.cacheService.saveGaussianSplatRuntime(handle, fileHash, variant, blob);
  }

  async getGaussianSplatRuntime(fileHash: string, variant: string): Promise<File | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.cacheService.getGaussianSplatRuntime(handle, fileHash, variant);
  }

  async hasGaussianSplatRuntime(fileHash: string, variant: string): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.cacheService.hasGaussianSplatRuntime(handle, fileHash, variant);
  }

  async saveWaveform(mediaId: string, waveformData: Float32Array): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.cacheService.saveWaveform(handle, mediaId, waveformData);
  }

  async getWaveform(mediaId: string): Promise<Float32Array | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.cacheService.getWaveform(handle, mediaId);
  }

  // ============================================
  // PROXY STORAGE SERVICE DELEGATION
  // ============================================

  async saveProxyFrame(mediaId: string, frameIndex: number, blob: Blob): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) {
      log.error('No project handle for proxy save!');
      return false;
    }
    return this.proxyStorageService.saveProxyFrame(handle, mediaId, frameIndex, blob);
  }

  async createProxyFrameWriter(mediaId: string): Promise<ProxyFrameWriter | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) {
      log.error('No project handle for proxy writer!');
      return null;
    }
    return this.proxyStorageService.createProxyFrameWriter(handle, mediaId);
  }

  async getProxyFrame(mediaId: string, frameIndex: number): Promise<Blob | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.proxyStorageService.getProxyFrame(handle, mediaId, frameIndex);
  }

  async hasProxy(mediaId: string): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.proxyStorageService.hasProxy(handle, mediaId);
  }

  async getProxyFrameCount(mediaId: string): Promise<number> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return 0;
    return this.proxyStorageService.getProxyFrameCount(handle, mediaId);
  }

  async getProxyFrameIndices(mediaId: string): Promise<Set<number>> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return new Set();
    return this.proxyStorageService.getProxyFrameIndices(handle, mediaId);
  }

  async saveProxyVideo(mediaId: string, blob: Blob): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) {
      log.error('No project handle for proxy video save!');
      return false;
    }
    return this.proxyStorageService.saveProxyVideo(handle, mediaId, blob);
  }

  async getProxyVideo(mediaId: string): Promise<File | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.proxyStorageService.getProxyVideo(handle, mediaId);
  }

  async hasProxyVideo(mediaId: string): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.proxyStorageService.hasProxyVideo(handle, mediaId);
  }

  async saveProxyAudio(mediaId: string, blob: Blob): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) {
      log.error('No project handle for audio proxy save!');
      return false;
    }
    return this.proxyStorageService.saveProxyAudio(handle, mediaId, blob);
  }

  async getProxyAudio(mediaId: string): Promise<File | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.proxyStorageService.getProxyAudio(handle, mediaId);
  }

  async hasProxyAudio(mediaId: string): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.proxyStorageService.hasProxyAudio(handle, mediaId);
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
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.analysisService.saveAnalysis(handle, mediaId, inPoint, outPoint, frames, sampleInterval);
  }

  async getAnalysis(
    mediaId: string,
    inPoint: number,
    outPoint: number
  ): Promise<{ frames: unknown[]; sampleInterval: number } | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.analysisService.getAnalysis(handle, mediaId, inPoint, outPoint);
  }

  async hasAnalysis(mediaId: string, inPoint: number, outPoint: number): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.analysisService.hasAnalysis(handle, mediaId, inPoint, outPoint);
  }

  async getAnalysisRanges(mediaId: string): Promise<string[]> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return [];
    return this.analysisService.getAnalysisRanges(handle, mediaId);
  }

  async getAllAnalysisMerged(mediaId: string): Promise<{ frames: unknown[]; sampleInterval: number } | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.analysisService.getAllAnalysisMerged(handle, mediaId);
  }

  async deleteAnalysis(mediaId: string): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.analysisService.deleteAnalysis(handle, mediaId);
  }

  // ============================================
  // TRANSCRIPT SERVICE DELEGATION
  // ============================================

  async saveTranscript(mediaId: string, transcript: unknown, transcribedRanges?: [number, number][]): Promise<boolean> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return false;
    return this.transcriptService.saveTranscript(handle, mediaId, transcript, transcribedRanges);
  }

  async getTranscript(mediaId: string): Promise<{ words: unknown[]; transcribedRanges?: [number, number][] } | null> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return null;
    return this.transcriptService.getTranscript(handle, mediaId);
  }

  async getTranscribedRanges(mediaId: string): Promise<[number, number][]> {
    const handle = this.coreService.getProjectHandle();
    if (!handle) return [];
    return this.transcriptService.getTranscribedRanges(handle, mediaId);
  }
}

// Singleton instance
export const projectFileService = new ProjectFileService();
