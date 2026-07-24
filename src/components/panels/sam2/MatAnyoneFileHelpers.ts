import { useMediaStore } from '../../../stores/mediaStore';

type FileWithPath = File & { path?: string };

type MatAnyoneClipSourceLike = {
  type?: string;
  file?: File;
  filePath?: string;
  mediaFileId?: string;
  nativeDecoder?: { fps?: number; width?: number; height?: number };
  videoElement?: { videoWidth?: number; videoHeight?: number };
  naturalDuration?: number;
};

export type MatAnyoneClipLike = {
  id: string;
  name: string;
  mediaFileId?: string;
  file?: File;
  source?: MatAnyoneClipSourceLike | null;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed?: number;
  reversed?: boolean;
};

export type MatAnyoneResultLike = {
  foregroundPath: string;
  alphaPath: string;
  sourceClipId: string;
  sourceStartTime?: number;
  sourceDuration?: number;
  timelineStartTime?: number;
  timelineDuration?: number;
  sourceSpeed?: number;
};

export type MatAnyoneFramePlan = {
  startFrame: number;
  endFrame: number;
  sourceStartTime: number;
  sourceDuration: number;
  timelineStartTime: number;
  timelineDuration: number;
  sourceSpeed: number;
};

export type MatAnyoneFileClient = {
  getProjectRoot(timeoutMs?: number): Promise<string | null>;
  createDir(path: string, recursive?: boolean): Promise<boolean>;
};

export type MatAnyoneImportFileClient = {
  getDownloadedFile(path: string): Promise<ArrayBuffer | null>;
};

const VIDEO_EXTENSION_CANDIDATES = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'];
const INVALID_NATIVE_FILE_NAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
const MATANYONE_PROJECT_OUTPUT_FOLDER = 'MatAnyone2';
const MATANYONE_MEDIA_ROOT_FOLDER = 'AI Gen';
const MATANYONE_MEDIA_SUBFOLDER = 'Matting';

function isAbsolutePath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (/^[A-Za-z]:[\\/]fakepath[\\/]/i.test(path)) return false;
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\');
}

function getBaseName(path: string | null | undefined): string {
  const trimmed = path?.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

function guessMimeTypeFromPath(path: string): string {
  const extension = getBaseName(path).toLowerCase().split('.').pop();
  switch (extension) {
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

function hasFileExtension(name: string): boolean {
  return /\.[^./\\]+$/.test(getBaseName(name));
}

function sanitizeNativeFileName(name: string): string {
  const cleaned = Array.from(name, char =>
    char.charCodeAt(0) < 32 || INVALID_NATIVE_FILE_NAME_CHARS.has(char) ? '_' : char
  )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const fallback = cleaned || 'video.mp4';
  if (fallback.length <= 180) return fallback;

  const dotIndex = fallback.lastIndexOf('.');
  const extension = dotIndex > 0 ? fallback.slice(dotIndex, Math.min(fallback.length, dotIndex + 16)) : '';
  return `${fallback.slice(0, 180 - extension.length)}${extension}`;
}

export function joinNativePath(root: string, ...parts: string[]): string {
  const separator = root.includes('\\') ? '\\' : '/';
  const base = root.replace(/[\\/]+$/, '');
  const cleanedParts = parts.map(part => part.replace(/^[\\/]+|[\\/]+$/g, ''));
  return [base || root, ...cleanedParts].filter(Boolean).join(separator);
}

export function getOrCreateMattingMediaFolder(): string {
  const mediaStore = useMediaStore.getState();
  let rootFolder = mediaStore.folders.find(folder => folder.name === MATANYONE_MEDIA_ROOT_FOLDER && !folder.parentId);
  if (!rootFolder) {
    rootFolder = mediaStore.createFolder(MATANYONE_MEDIA_ROOT_FOLDER);
  }

  const latestMediaStore = useMediaStore.getState();
  let mattingFolder = latestMediaStore.folders.find(folder =>
    folder.name === MATANYONE_MEDIA_SUBFOLDER && folder.parentId === rootFolder.id
  );
  if (!mattingFolder) {
    mattingFolder = latestMediaStore.createFolder(MATANYONE_MEDIA_SUBFOLDER, rootFolder.id);
  }

  return mattingFolder.id;
}

export function buildMatAnyoneProjectFileName(result: MatAnyoneResultLike, filePath: string): string {
  const safeClipId = sanitizeNativeFileName(result.sourceClipId || 'clip');
  const fileName = sanitizeNativeFileName(getBaseName(filePath) || 'matanyone-result.mp4');
  return `${MATANYONE_PROJECT_OUTPUT_FOLDER}/${safeClipId}/${fileName}`;
}

export async function readNativeFileAsFile(nativeHelper: MatAnyoneImportFileClient, path: string): Promise<File> {
  const buffer = await nativeHelper.getDownloadedFile(path);
  if (!buffer) {
    throw new Error(`Could not read MatAnyone2 output: ${path}`);
  }

  const fileName = getBaseName(path) || 'matanyone-result.mp4';
  return new File([buffer], fileName, {
    type: guessMimeTypeFromPath(path),
    lastModified: Date.now(),
  });
}

function getMatAnyoneClipMedia(clip: MatAnyoneClipLike) {
  const source = clip.source;
  if (!source || source.type !== 'video') return { source, mediaFile: undefined, fps: 30 };

  const mediaFileId = source.mediaFileId ?? clip.mediaFileId;
  const mediaFile = mediaFileId
    ? useMediaStore.getState().files.find(file => file.id === mediaFileId)
    : undefined;
  const fps =
    source.nativeDecoder?.fps ??
    mediaFile?.fps ??
    30;
  return {
    source,
    mediaFile,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
  };
}

export function getMatAnyoneSourceDimensions(
  clip: MatAnyoneClipLike,
): { width: number; height: number } | null {
  const { source, mediaFile } = getMatAnyoneClipMedia(clip);
  const width = source?.nativeDecoder?.width ?? source?.videoElement?.videoWidth ?? mediaFile?.width;
  const height = source?.nativeDecoder?.height ?? source?.videoElement?.videoHeight ?? mediaFile?.height;
  if (!width || !height || width <= 0 || height <= 0) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

export function getMatAnyoneFramePlan(
  clip: MatAnyoneClipLike,
  maskTimelineTime: number,
): MatAnyoneFramePlan {
  if (!clip.source || clip.source.type !== 'video') {
    throw new Error('Selected clip is not a video.');
  }
  const speed = clip.speed ?? 1;
  if (!Number.isFinite(speed) || speed <= 0 || clip.reversed) {
    throw new Error('MatAnyone2 currently requires forward playback. Bake or un-reverse this clip first.');
  }
  const clipEnd = clip.startTime + clip.duration;
  const tolerance = 1e-4;
  if (maskTimelineTime < clip.startTime - tolerance || maskTimelineTime >= clipEnd + tolerance) {
    throw new Error('The mask was created outside the selected clip. Create it again on a visible clip frame.');
  }

  const { fps } = getMatAnyoneClipMedia(clip);
  const localTime = Math.max(0, Math.min(clip.duration, maskTimelineTime - clip.startTime));
  const requestedSourceStart = Math.min(clip.outPoint, clip.inPoint + localTime * speed);
  const startFrame = Math.max(0, Math.floor(requestedSourceStart * fps));
  const endFrame = Math.max(startFrame + 1, Math.ceil(clip.outPoint * fps));
  const sourceStartTime = startFrame / fps;
  const sourceDuration = Math.max(1 / fps, (endFrame - startFrame) / fps);
  const adjustedTimelineStart = Math.max(
    clip.startTime,
    clip.startTime + (sourceStartTime - clip.inPoint) / speed,
  );
  const availableTimelineDuration = Math.max(1 / fps / speed, clipEnd - adjustedTimelineStart);

  return {
    startFrame,
    endFrame,
    sourceStartTime,
    sourceDuration,
    timelineStartTime: adjustedTimelineStart,
    timelineDuration: Math.min(sourceDuration / speed, availableTimelineDuration),
    sourceSpeed: speed,
  };
}

export async function resolveMatAnyoneVideoPath(selectedClip: MatAnyoneClipLike): Promise<string | null> {
  const source = selectedClip.source;
  if (!source) return null;

  const [{ useMediaStore }, { NativeHelperClient }] = await Promise.all([
    import('../../../stores/mediaStore'),
    import('../../../services/nativeHelper/NativeHelperClient'),
  ]);

  const mediaFileId = source.mediaFileId ?? selectedClip.mediaFileId;
  const mediaFile = mediaFileId
    ? useMediaStore.getState().files.find(file => file.id === mediaFileId)
    : undefined;
  const sourceFile = source.file as FileWithPath | undefined;
  const clipFile = selectedClip.file as FileWithPath | undefined;
  const mediaStoreFile = mediaFile?.file as FileWithPath | undefined;

  const directCandidates = [
    source.filePath,
    mediaFile?.absolutePath,
    mediaFile?.filePath,
    sourceFile?.path,
    clipFile?.path,
    mediaStoreFile?.path,
  ];

  for (const candidate of directCandidates) {
    if (isAbsolutePath(candidate)) return candidate;
  }

  // A browser File is authoritative. Stage it before any basename search so a
  // duplicate file elsewhere on disk cannot silently become the input.
  const fileForUpload = sourceFile ?? clipFile ?? mediaStoreFile;
  if (fileForUpload) {
    const projectRoot = await NativeHelperClient.getProjectRoot().catch(() => null);
    if (projectRoot) {
      const tempDir = joinNativePath(projectRoot, 'matanyone-temp');
      const tempDirReady = await NativeHelperClient.createDir(tempDir, true).catch(() => false);
      if (tempDirReady) {
        const safeClipId = sanitizeNativeFileName(selectedClip.id || 'clip');
        const safeFileName = sanitizeNativeFileName(fileForUpload.name || selectedClip.name || 'video.mp4');
        const stagedPath = joinNativePath(tempDir, `${safeClipId}-${safeFileName}`);
        const uploaded = await NativeHelperClient.writeFileBinary(stagedPath, fileForUpload).catch(() => false);
        if (uploaded) return stagedPath;
      }
    }
  }

  const locateCandidates = new Set<string>();
  const addLocateCandidate = (value: string | null | undefined) => {
    const name = getBaseName(value);
    if (name && name !== '.' && name !== '..') {
      locateCandidates.add(name);
    }
  };

  addLocateCandidate(source.filePath);
  addLocateCandidate(mediaFile?.filePath);
  addLocateCandidate(mediaFile?.name);
  addLocateCandidate(sourceFile?.name);
  addLocateCandidate(clipFile?.name);
  addLocateCandidate(mediaStoreFile?.name);
  addLocateCandidate(selectedClip.name);

  for (const candidate of [...locateCandidates]) {
    if (!hasFileExtension(candidate)) {
      VIDEO_EXTENSION_CANDIDATES.forEach(extension => locateCandidates.add(`${candidate}${extension}`));
    }
  }

  for (const candidate of locateCandidates) {
    const located = await NativeHelperClient.locateFile(candidate).catch(() => null);
    if (located) return located;
  }

  return null;
}

export async function createMatAnyoneJobDir(
  nativeHelper: MatAnyoneFileClient,
  clipId: string,
): Promise<string | null> {
  const projectRoot = await nativeHelper.getProjectRoot().catch(() => null);
  if (!projectRoot) return null;

  const safeClipId = sanitizeNativeFileName(clipId || 'clip');
  const jobName = sanitizeNativeFileName(`job-${safeClipId}-${Date.now().toString(36)}`);
  const jobDir = joinNativePath(projectRoot, MATANYONE_PROJECT_OUTPUT_FOLDER, jobName);
  const created = await nativeHelper.createDir(jobDir, true).catch(() => false);
  return created ? jobDir : null;
}
