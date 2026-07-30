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

interface NativeAnalysisRange {
  frames: unknown[];
  sampleInterval: number;
  faceAnalysis?: unknown;
  createdAt: number;
}

interface NativeAnalysisFile {
  schemaVersion?: 2 | 3;
  mediaFileId: string;
  analyses: Record<string, NativeAnalysisRange>;
  sceneDescriptions?: {
    segments: unknown[];
    createdAt: number;
  };
}

export function joinProjectPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/\\/g, '/').replace(/\/+$/, ''))
    .join('/');
}

export function normalizeNativePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function nativeAnalysisPath(projectPath: string, mediaId: string): string {
  return joinProjectPath(projectPath, PROJECT_FOLDERS.ANALYSIS, `${mediaId}.json`);
}

function nativeAnalysisRangeKey(inPoint: number, outPoint: number): string {
  return `${inPoint.toFixed(3)}-${outPoint.toFixed(3)}`;
}

function timestampFromFrame(frame: unknown): number {
  if (typeof frame !== 'object' || frame === null || !('timestamp' in frame)) return 0;
  const timestamp = (frame as { timestamp?: unknown }).timestamp;
  return typeof timestamp === 'number' ? timestamp : 0;
}

async function readNativeAnalysisFile(projectPath: string, mediaId: string): Promise<NativeAnalysisFile | null> {
  const buffer = await NativeHelperClient.getDownloadedFile(nativeAnalysisPath(projectPath, mediaId));
  if (!buffer) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(buffer)) as NativeAnalysisFile;
    return parsed && typeof parsed === 'object' && parsed.analyses ? parsed : null;
  } catch {
    return null;
  }
}

async function writeNativeAnalysisFile(projectPath: string, mediaId: string, analysis: NativeAnalysisFile): Promise<boolean> {
  const folderPath = joinProjectPath(projectPath, PROJECT_FOLDERS.ANALYSIS);
  await NativeHelperClient.createDir(folderPath);
  return NativeHelperClient.writeFileBinary(
    nativeAnalysisPath(projectPath, mediaId),
    new TextEncoder().encode(JSON.stringify(analysis, null, 2)),
  );
}

export async function saveAnalysisNative(
  projectPath: string | null | undefined,
  mediaId: string,
  inPoint: number,
  outPoint: number,
  frames: unknown[],
  sampleInterval: number,
  faceAnalysis?: unknown,
): Promise<boolean> {
  if (!projectPath) return false;
  const analysis = await readNativeAnalysisFile(projectPath, mediaId) ?? {
    schemaVersion: 2 as const,
    mediaFileId: mediaId,
    analyses: {},
  };
  analysis.schemaVersion = 3;
  analysis.analyses[nativeAnalysisRangeKey(inPoint, outPoint)] = {
    frames,
    sampleInterval,
    faceAnalysis,
    createdAt: Date.now(),
  };
  return writeNativeAnalysisFile(projectPath, mediaId, analysis);
}

export async function getAnalysisNative(
  projectPath: string | null | undefined,
  mediaId: string,
  inPoint: number,
  outPoint: number,
): Promise<{ frames: unknown[]; sampleInterval: number; faceAnalysis?: unknown } | null> {
  if (!projectPath) return null;
  const analysis = await readNativeAnalysisFile(projectPath, mediaId);
  const range = analysis?.analyses[nativeAnalysisRangeKey(inPoint, outPoint)];
  return range
    ? { frames: range.frames, sampleInterval: range.sampleInterval, faceAnalysis: range.faceAnalysis }
    : null;
}

export async function getAnalysisRangesNative(
  projectPath: string | null | undefined,
  mediaId: string,
): Promise<string[]> {
  if (!projectPath) return [];
  return Object.keys((await readNativeAnalysisFile(projectPath, mediaId))?.analyses ?? {});
}

export async function getAllAnalysisMergedNative(
  projectPath: string | null | undefined,
  mediaId: string,
): Promise<{ frames: unknown[]; sampleInterval: number } | null> {
  if (!projectPath) return null;
  const ranges = Object.values((await readNativeAnalysisFile(projectPath, mediaId))?.analyses ?? {});
  if (ranges.length === 0) return null;
  const frames = ranges.flatMap(range => range.frames).toSorted(
    (left, right) => timestampFromFrame(left) - timestampFromFrame(right),
  );
  const seen = new Set<number>();
  const deduplicatedFrames = frames.filter((frame) => {
    const timestamp = Math.round(timestampFromFrame(frame) * 1000);
    if (seen.has(timestamp)) return false;
    seen.add(timestamp);
    return true;
  });
  return {
    frames: deduplicatedFrames,
    sampleInterval: Math.min(...ranges.map(range => range.sampleInterval)),
  };
}

export async function saveSceneDescriptionsNative(
  projectPath: string | null | undefined,
  mediaId: string,
  segments: unknown[],
): Promise<boolean> {
  if (!projectPath) return false;
  const analysis = await readNativeAnalysisFile(projectPath, mediaId) ?? {
    schemaVersion: 3 as const,
    mediaFileId: mediaId,
    analyses: {},
  };
  analysis.schemaVersion = 3;
  analysis.sceneDescriptions = {
    segments,
    createdAt: Date.now(),
  };
  return writeNativeAnalysisFile(projectPath, mediaId, analysis);
}

export async function getSceneDescriptionsNative(
  projectPath: string | null | undefined,
  mediaId: string,
): Promise<unknown[] | null> {
  if (!projectPath) return null;
  return (await readNativeAnalysisFile(projectPath, mediaId))?.sceneDescriptions?.segments ?? null;
}

export async function deleteSceneDescriptionsNative(
  projectPath: string | null | undefined,
  mediaId: string,
): Promise<boolean> {
  if (!projectPath) return false;
  const analysis = await readNativeAnalysisFile(projectPath, mediaId);
  if (!analysis?.sceneDescriptions) return true;
  delete analysis.sceneDescriptions;
  if (Object.keys(analysis.analyses).length === 0) {
    return NativeHelperClient.deleteFile(nativeAnalysisPath(projectPath, mediaId));
  }
  analysis.schemaVersion = 3;
  return writeNativeAnalysisFile(projectPath, mediaId, analysis);
}

export async function deleteAnalysisRangeNative(
  projectPath: string | null | undefined,
  mediaId: string,
  inPoint: number,
  outPoint: number,
): Promise<boolean> {
  if (!projectPath) return false;
  const analysis = await readNativeAnalysisFile(projectPath, mediaId);
  if (!analysis) return true;
  delete analysis.analyses[nativeAnalysisRangeKey(inPoint, outPoint)];
  if (Object.keys(analysis.analyses).length === 0) {
    return NativeHelperClient.deleteFile(nativeAnalysisPath(projectPath, mediaId));
  }
  return writeNativeAnalysisFile(projectPath, mediaId, analysis);
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
