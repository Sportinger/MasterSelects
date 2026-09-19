import { Logger } from '../../logger';
import { NativeHelperClient } from '../../nativeHelper/NativeHelperClient';
import type { NativeProjectCoreService } from '../core/NativeProjectCoreService';
import type { ProjectCoreService } from '../core/ProjectCoreService';
import { getNativeProjectFolderReadCandidates } from '../core/projectPackage';
import type { RawMediaService } from '../domains/RawMediaService';
import {
  copyToRawFolderNative,
  deleteRawFileNative,
  getFileFromRawNative,
  joinProjectPath,
  normalizeNativePath,
  pickNativeFolder,
  resolveRawFilePathNative,
  scanDirectoryHandle,
  scanNativeFolder,
} from './nativeBackend';

const log = Logger.create('ProjectFileService');

type ProjectFileStorageBackend = 'fsa' | 'native';
type ImportedMediaFile = NonNullable<Awaited<ReturnType<RawMediaService['importMediaFile']>>>;

interface RawMediaProjectData {
  media: ImportedMediaFile[];
}

export interface RawMediaRoutingContext {
  activeBackend: ProjectFileStorageBackend;
  coreService: ProjectCoreService;
  nativeCoreService: NativeProjectCoreService | null;
  rawMediaService: RawMediaService;
  getProjectData: () => RawMediaProjectData | null;
  markDirty: () => void;
  ensureNativeBackendReady: () => Promise<NativeProjectCoreService | null>;
}

export async function copyToRawFolder(
  context: RawMediaRoutingContext,
  file: File,
  fileName?: string,
): Promise<{ handle?: FileSystemFileHandle; relativePath: string; alreadyExisted: boolean } | null> {
  if (context.activeBackend === 'native' && context.nativeCoreService) {
    return copyToRawFolderNative(context.nativeCoreService.getProjectPath(), file, fileName);
  }

  const handle = context.coreService.getProjectHandle();
  if (!handle) {
    log.warn('No project open, cannot copy to Raw folder');
    return null;
  }
  return context.rawMediaService.copyToRawFolder(handle, file, fileName);
}

export async function getFileFromRaw(
  context: RawMediaRoutingContext,
  relativePath: string,
): Promise<{ file: File; handle?: FileSystemFileHandle } | null> {
  if (context.activeBackend === 'native' && context.nativeCoreService) {
    return getFileFromRawNative(context.nativeCoreService.getProjectPath(), relativePath);
  }

  const handle = context.coreService.getProjectHandle();
  if (!handle) return null;
  return context.rawMediaService.getFileFromRaw(handle, relativePath);
}

export async function deleteRawFile(context: RawMediaRoutingContext, relativePath: string | undefined): Promise<boolean> {
  if (!relativePath) {
    return false;
  }

  if (context.activeBackend === 'native' && context.nativeCoreService) {
    return deleteRawFileNative(context.nativeCoreService.getProjectPath(), relativePath);
  }

  const handle = context.coreService.getProjectHandle();
  if (!handle) return false;
  return context.rawMediaService.deleteFromRaw(handle, relativePath);
}

export function resolveRawFilePath(context: RawMediaRoutingContext, relativePath: string | undefined): string | null {
  if (context.activeBackend !== 'native' || !context.nativeCoreService || !relativePath) {
    return null;
  }

  return resolveRawFilePathNative(context.nativeCoreService.getProjectPath(), relativePath);
}

export function resolveRawFileUrl(context: RawMediaRoutingContext, relativePath: string | undefined): string | null {
  const fullPath = resolveRawFilePath(context, relativePath);
  return fullPath ? NativeHelperClient.getFileReferenceUrl(fullPath) : null;
}

export async function hasFileInRaw(context: RawMediaRoutingContext, fileName: string): Promise<boolean> {
  const handle = context.coreService.getProjectHandle();
  if (!handle) return false;
  return context.rawMediaService.hasFileInRaw(handle, fileName);
}

export async function scanRawFolder(context: RawMediaRoutingContext): Promise<Map<string, FileSystemFileHandle>> {
  if (context.activeBackend === 'native' && context.nativeCoreService) {
    const projectPath = context.nativeCoreService.getProjectPath();
    if (!projectPath) return new Map();
    const files = new Map<string, FileSystemFileHandle>();
    for (const folder of getNativeProjectFolderReadCandidates(projectPath, 'RAW')) {
      const scanned = await scanNativeFolder(joinProjectPath(projectPath, folder));
      for (const [key, handle] of scanned) if (!files.has(key)) files.set(key, handle);
    }
    return files;
  }

  const handle = context.coreService.getProjectHandle();
  if (!handle) return new Map();
  return context.rawMediaService.scanRawFolder(handle);
}

export async function scanProjectFolder(context: RawMediaRoutingContext): Promise<Map<string, FileSystemFileHandle>> {
  if (context.activeBackend === 'native' && context.nativeCoreService) {
    const projectPath = context.nativeCoreService.getProjectPath();
    if (!projectPath) return new Map();
    return scanNativeFolder(projectPath);
  }

  const handle = context.coreService.getProjectHandle();
  if (!handle) return new Map();
  return scanDirectoryHandle(handle);
}

export async function pickAndScanFolder(
  context: RawMediaRoutingContext,
  title = 'Search folder for media',
): Promise<{
  name: string;
  path?: string;
  files: Map<string, FileSystemFileHandle>;
} | null> {
  if (context.activeBackend !== 'native') {
    return null;
  }

  const nativeCore = await context.ensureNativeBackendReady();
  if (!nativeCore) {
    return null;
  }

  const defaultPath = nativeCore.getProjectPath() ?? await NativeHelperClient.getProjectRoot();
  const folderPath = await pickNativeFolder(title, defaultPath);
  if (!folderPath) {
    return null;
  }

  const normalizedPath = normalizeNativePath(folderPath);
  const name = normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath;
  return {
    name,
    path: normalizedPath,
    files: await scanNativeFolder(normalizedPath),
  };
}

export async function importMediaFile(
  context: RawMediaRoutingContext,
  file: File,
  fileHandle?: FileSystemFileHandle,
): Promise<ImportedMediaFile | null> {
  const projectData = context.getProjectData();
  if (!projectData) return null;

  const mediaFile = await context.rawMediaService.importMediaFile(file, fileHandle);
  if (!mediaFile) return null;

  projectData.media.push(mediaFile);
  context.markDirty();

  return mediaFile;
}

export async function saveDownload(
  context: RawMediaRoutingContext,
  blob: Blob,
  title: string,
  platform: string,
): Promise<File | null> {
  const handle = context.coreService.getProjectHandle();
  if (!handle) {
    log.warn('No project open, cannot save download to project');
    return null;
  }
  return context.rawMediaService.saveDownload(handle, blob, title, platform);
}

export async function checkDownloadExists(
  context: RawMediaRoutingContext,
  title: string,
  platform: string,
): Promise<boolean> {
  const handle = context.coreService.getProjectHandle();
  if (!handle) return false;
  return context.rawMediaService.checkDownloadExists(handle, title, platform);
}

export async function getDownloadFile(
  context: RawMediaRoutingContext,
  title: string,
  platform: string,
): Promise<File | null> {
  const handle = context.coreService.getProjectHandle();
  if (!handle) return null;
  return context.rawMediaService.getDownloadFile(handle, title, platform);
}
