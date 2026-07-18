import { Logger } from '../../logger';
import { NativeHelperClient } from '../../nativeHelper/NativeHelperClient';
import { PROJECT_FOLDERS } from '../core/constants';
import {
  addFileNameSuffix,
  buildRawTargetPath,
  getRawRelativePath,
  parseRawRelativePath,
} from '../core/rawPath';
import { getAudioProxyFileName } from '../domains/ProxyStorageService';
import { setRelinkHandlePath } from '../relink/relinkMatching';

const log = Logger.create('ProjectFileService');

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

export function joinProjectPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/\\/g, '/').replace(/\/+$/, ''))
    .join('/');
}

export function normalizeNativePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

export async function pickNativeFolder(title: string, defaultPath?: string | null): Promise<string | null> {
  const fallbackPath = defaultPath ? normalizeNativePath(defaultPath) : '';
  const result = await NativeHelperClient.pickFolderDetailed(title, fallbackPath || undefined);

  if (result.path) {
    const selectedPath = normalizeNativePath(result.path);
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

  const selectedPath = normalizeNativePath(enteredPath);
  await NativeHelperClient.grantPath(selectedPath);
  return selectedPath;
}

function getMimeTypeFromFileName(fileName: string): string {
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

export async function copyToRawFolderNative(
  projectPath: string | null | undefined,
  file: File,
  fileName?: string,
): Promise<{ handle?: FileSystemFileHandle; relativePath: string; alreadyExisted: boolean } | null> {
  if (!projectPath) {
    log.warn('No native project open, cannot copy to Raw folder');
    return null;
  }

  const rawFolderPath = joinProjectPath(projectPath, PROJECT_FOLDERS.RAW);
  const target = buildRawTargetPath(fileName, file.name);
  const targetFolderPath = target.folderPath
    ? joinProjectPath(rawFolderPath, target.folderPath)
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

  const fullPath = joinProjectPath(targetFolderPath, finalName);
  const success = await NativeHelperClient.writeFileBinary(fullPath, file);

  if (!success) {
    return null;
  }

  return {
    relativePath: getRawRelativePath(target.folderPath, finalName),
    alreadyExisted: false,
  };
}

export async function getFileFromRawNative(
  projectPath: string | null | undefined,
  relativePath: string,
): Promise<{ file: File; handle?: FileSystemFileHandle } | null> {
  if (!projectPath) {
    return null;
  }

  const target = parseRawRelativePath(relativePath);
  if (!target) {
    return null;
  }

  const fullPath = joinProjectPath(projectPath, target.relativePath);
  const fileBuffer = await NativeHelperClient.getDownloadedFile(fullPath);

  if (!fileBuffer) {
    return null;
  }

  return {
    file: new File([fileBuffer], target.fileName, {
      type: getMimeTypeFromFileName(target.fileName),
    }),
  };
}

export async function deleteRawFileNative(
  projectPath: string | null | undefined,
  relativePath: string,
): Promise<boolean> {
  if (!projectPath) {
    return false;
  }

  const target = parseRawRelativePath(relativePath);
  if (!target) {
    return false;
  }

  const fullPath = joinProjectPath(projectPath, target.relativePath);
  return NativeHelperClient.deleteFile(fullPath);
}

export function resolveRawFilePathNative(
  projectPath: string | null | undefined,
  relativePath: string | undefined,
): string | null {
  if (!projectPath || !relativePath) {
    return null;
  }

  const target = parseRawRelativePath(relativePath);
  if (!target) {
    return null;
  }

  return joinProjectPath(projectPath, target.relativePath);
}

function createNativeFileHandle(fullPath: string, name: string): FileSystemFileHandle {
  const handle = {
    kind: 'file',
    name,
    getFile: async () => {
      const fileBuffer = await NativeHelperClient.getDownloadedFile(fullPath);
      if (!fileBuffer) {
        throw new DOMException(`Could not read ${fullPath}`, 'NotFoundError');
      }
      return new File([fileBuffer], name, {
        type: getMimeTypeFromFileName(name),
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

export async function scanNativeFolder(rootPath: string): Promise<Map<string, FileSystemFileHandle>> {
  const foundFiles = new Map<string, FileSystemFileHandle>();

  const scanDirectory = async (directoryPath: string, parentPath = ''): Promise<void> => {
    const entries = await NativeHelperClient.listDir(directoryPath);
    for (const entry of entries) {
      const fullPath = joinProjectPath(directoryPath, entry.name);
      const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      if (entry.kind === 'file') {
        const handle = createNativeFileHandle(fullPath, entry.name);
        setRelinkHandlePath(handle, relativePath);
        foundFiles.set(fullPath.toLowerCase(), handle);
      } else if (entry.kind === 'directory') {
        await scanDirectory(fullPath, relativePath);
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

export async function scanDirectoryHandle(root: FileSystemDirectoryHandle): Promise<Map<string, FileSystemFileHandle>> {
  const foundFiles = new Map<string, FileSystemFileHandle>();

  const scanDirectory = async (directory: FileSystemDirectoryHandle, parentPath = ''): Promise<void> => {
    for await (const entry of (directory as IterableDirectoryHandle).values()) {
      const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      if (entry.kind === 'file') {
        setRelinkHandlePath(entry, relativePath);
        foundFiles.set(relativePath.toLowerCase(), entry);
      } else if (entry.kind === 'directory') {
        await scanDirectory(entry, relativePath);
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

export async function saveProxyAudioNative(
  projectPath: string | null | undefined,
  mediaId: string,
  blob: Blob,
): Promise<boolean> {
  if (!projectPath) {
    log.error('No native project path for audio proxy save!');
    return false;
  }

  const folderPath = joinProjectPath(projectPath, PROJECT_FOLDERS.AUDIO_PROXIES);
  await NativeHelperClient.createDir(folderPath);
  return NativeHelperClient.writeFileBinary(
    joinProjectPath(folderPath, getAudioProxyFileName(mediaId)),
    blob,
  );
}

export async function getProxyAudioNative(
  projectPath: string | null | undefined,
  mediaId: string,
): Promise<File | null> {
  if (!projectPath) return null;
  const fileName = getAudioProxyFileName(mediaId);
  const fullPath = joinProjectPath(projectPath, PROJECT_FOLDERS.AUDIO_PROXIES, fileName);
  const buffer = await NativeHelperClient.getDownloadedFile(fullPath);
  return buffer
    ? new File([buffer], fileName, { type: 'audio/wav' })
    : null;
}

export async function hasProxyAudioNative(
  projectPath: string | null | undefined,
  mediaId: string,
): Promise<boolean> {
  if (!projectPath) return false;
  const fullPath = joinProjectPath(projectPath, PROJECT_FOLDERS.AUDIO_PROXIES, getAudioProxyFileName(mediaId));
  const result = await NativeHelperClient.exists(fullPath);
  return result.exists && result.kind === 'file';
}
