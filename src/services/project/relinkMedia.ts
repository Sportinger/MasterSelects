import { fileSystemService } from '../fileSystemService';
import { projectDB } from '../projectDB';
import { projectFileService } from './ProjectFileService';
import { updateTimelineClips } from '../../stores/mediaStore/slices/fileManageSlice';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import type {
  GaussianSplatSequenceData,
  GaussianSplatSequenceFrame,
  ModelSequenceData,
  ModelSequenceFrame,
} from '../../types';

export interface RelinkCandidate {
  name: string;
  file?: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
}

export type RelinkCandidateMap = Map<string, RelinkCandidate>;

export type RelinkMatch =
  | {
      kind: 'single';
      candidate: RelinkCandidate;
    }
  | {
      kind: 'model-sequence';
      frames: Array<{ index: number; candidate: RelinkCandidate }>;
    }
  | {
      kind: 'gaussian-splat-sequence';
      frames: Array<{ index: number; candidate: RelinkCandidate }>;
    };

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function isAbsolutePath(value: string | undefined): boolean {
  return Boolean(value && (value.startsWith('/') || /^[A-Za-z]:[/\\]/.test(value)));
}

function getNativeHandlePath(handle: FileSystemFileHandle | undefined): string | undefined {
  return (handle as (FileSystemFileHandle & { __nativePath?: string }) | undefined)?.__nativePath;
}

function getBaseName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizePath(value);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || undefined;
}

function normalizeKey(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

function uniqueNames(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const value of values) {
    const name = getBaseName(value) ?? value;
    if (!name) continue;
    const key = normalizeKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

function findCandidate(names: string[], candidates: RelinkCandidateMap): RelinkCandidate | undefined {
  for (const name of names) {
    const candidate = candidates.get(name.toLowerCase());
    if (candidate) return candidate;
  }
  return undefined;
}

function getModelFrameExpectedNames(frame: ModelSequenceFrame): string[] {
  return uniqueNames([
    frame.name,
    frame.sourcePath,
    frame.absolutePath,
    frame.projectPath,
  ]);
}

function getGaussianFrameExpectedNames(frame: GaussianSplatSequenceFrame): string[] {
  return uniqueNames([
    frame.name,
    frame.sourcePath,
    frame.absolutePath,
    frame.projectPath,
  ]);
}

export function getRelinkExpectedFileNames(mediaFile: MediaFile): string[] {
  if (mediaFile.modelSequence?.frames.length) {
    return mediaFile.modelSequence.frames.flatMap(getModelFrameExpectedNames);
  }

  if (mediaFile.gaussianSplatSequence?.frames.length) {
    return mediaFile.gaussianSplatSequence.frames.flatMap(getGaussianFrameExpectedNames);
  }

  return uniqueNames([
    mediaFile.name,
    mediaFile.filePath,
    mediaFile.absolutePath,
    mediaFile.projectPath,
    mediaFile.file?.name,
  ]);
}

export function findRelinkMatch(
  mediaFile: MediaFile,
  candidates: RelinkCandidateMap,
  options?: { directCandidate?: RelinkCandidate },
): RelinkMatch | null {
  const modelSequence = mediaFile.modelSequence;
  if (modelSequence?.frames.length) {
    const frames: Array<{ index: number; candidate: RelinkCandidate }> = [];

    for (let index = 0; index < modelSequence.frames.length; index += 1) {
      const frame = modelSequence.frames[index];
      const candidate = frame ? findCandidate(getModelFrameExpectedNames(frame), candidates) : undefined;
      if (!candidate) return null;
      frames.push({ index, candidate });
    }

    return { kind: 'model-sequence', frames };
  }

  const gaussianSplatSequence = mediaFile.gaussianSplatSequence;
  if (gaussianSplatSequence?.frames.length) {
    const frames: Array<{ index: number; candidate: RelinkCandidate }> = [];

    for (let index = 0; index < gaussianSplatSequence.frames.length; index += 1) {
      const frame = gaussianSplatSequence.frames[index];
      const candidate = frame ? findCandidate(getGaussianFrameExpectedNames(frame), candidates) : undefined;
      if (!candidate) return null;
      frames.push({ index, candidate });
    }

    return { kind: 'gaussian-splat-sequence', frames };
  }

  const matched = findCandidate(getRelinkExpectedFileNames(mediaFile), candidates)
    ?? options?.directCandidate;

  return matched ? { kind: 'single', candidate: matched } : null;
}

export async function createRelinkCandidateMapFromHandles(
  handles: Iterable<FileSystemFileHandle>,
): Promise<RelinkCandidateMap> {
  const candidates: RelinkCandidateMap = new Map();

  for (const handle of handles) {
    const candidate: RelinkCandidate = {
      name: handle.name,
      handle,
      absolutePath: getNativeHandlePath(handle),
    };
    candidates.set(candidate.name.toLowerCase(), candidate);
  }

  return candidates;
}

async function storeHandle(cacheKey: string, handle: FileSystemFileHandle | undefined): Promise<void> {
  if (!handle) return;

  fileSystemService.storeFileHandle(cacheKey, handle);
  try {
    await projectDB.storeHandle(`media_${cacheKey}`, handle);
  } catch {
    // Native-helper pseudo handles are useful for this session but cannot be stored in IndexedDB.
  }
}

async function readCandidateFile(candidate: RelinkCandidate): Promise<File> {
  if (candidate.file) {
    return candidate.file;
  }

  if (!candidate.handle) {
    throw new Error(`No readable file handle for ${candidate.name}`);
  }

  return candidate.handle.getFile();
}

function buildSequenceRawTarget(
  existingProjectPath: string | undefined,
  sequenceName: string | undefined,
  candidateFileName: string,
  fallbackFolder: string,
): string {
  if (existingProjectPath) {
    return existingProjectPath;
  }

  const folderName = (sequenceName || fallbackFolder)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallbackFolder;

  return `${folderName}/${candidateFileName}`;
}

async function copyCandidateToProject(
  candidate: RelinkCandidate,
  targetPath?: string,
): Promise<{ file: File; handle?: FileSystemFileHandle; projectPath?: string }> {
  let file = await readCandidateFile(candidate);
  let handle = candidate.handle;

  if (!projectFileService.isProjectOpen()) {
    return { file, handle };
  }

  const copied = await projectFileService.copyToRawFolder(file, targetPath ?? file.name);
  if (!copied) {
    return { file, handle };
  }

  const projectPath = copied.relativePath;
  handle = copied.handle ?? handle;

  if (copied.handle) {
    try {
      file = await copied.handle.getFile();
    } catch {
      file = await readCandidateFile(candidate);
    }
  } else {
    const restored = await projectFileService.getFileFromRaw(copied.relativePath);
    if (restored?.file) {
      file = restored.file;
      handle = restored.handle ?? handle;
    }
  }

  return { file, handle, projectPath };
}

function hasResolvableFramePath(frame: ModelSequenceFrame | GaussianSplatSequenceFrame): boolean {
  return Boolean(
    frame.projectPath ||
    isAbsolutePath(frame.absolutePath) ||
    isAbsolutePath(frame.sourcePath),
  );
}

export function isNativeProjectLinkedMedia(mediaFile: MediaFile): boolean {
  if (projectFileService.activeBackend !== 'native') {
    return false;
  }

  if (mediaFile.file) {
    return true;
  }

  if (
    mediaFile.projectPath ||
    isAbsolutePath(mediaFile.absolutePath) ||
    isAbsolutePath(mediaFile.filePath)
  ) {
    return true;
  }

  if (mediaFile.modelSequence?.frames.length) {
    return mediaFile.modelSequence.frames.every(hasResolvableFramePath);
  }

  if (mediaFile.gaussianSplatSequence?.frames.length) {
    return mediaFile.gaussianSplatSequence.frames.every(hasResolvableFramePath);
  }

  return false;
}

export function mediaNeedsRelink(mediaFile: MediaFile): boolean {
  return !mediaFile.file && !isNativeProjectLinkedMedia(mediaFile);
}

function isBlobUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith('blob:');
}

function replaceMediaFile(mediaFileId: string, nextFile: Partial<MediaFile>): void {
  useMediaStore.setState((state) => ({
    files: state.files.map((file) => {
      if (file.id !== mediaFileId) return file;
      if (isBlobUrl(file.url) && file.url !== nextFile.url) {
        URL.revokeObjectURL(file.url);
      }
      return {
        ...file,
        ...nextFile,
        hasFileHandle: true,
      };
    }),
  }));
}

async function applyNativeSingleRelink(
  mediaFile: MediaFile,
  match: Extract<RelinkMatch, { kind: 'single' }>,
): Promise<boolean> {
  const targetPath = mediaFile.projectPath ?? match.candidate.name;
  const absolutePath =
    match.candidate.absolutePath ??
    projectFileService.resolveRawFilePath(targetPath) ??
    mediaFile.absolutePath;

  await storeHandle(mediaFile.id, match.candidate.handle);

  replaceMediaFile(mediaFile.id, {
    file: undefined,
    url: '',
    filePath: absolutePath ?? targetPath,
    absolutePath,
    projectPath: targetPath,
    fileSize: mediaFile.fileSize,
  });

  return true;
}

async function applySingleRelink(mediaFile: MediaFile, match: Extract<RelinkMatch, { kind: 'single' }>): Promise<boolean> {
  if (projectFileService.activeBackend === 'native' && !match.candidate.file) {
    return applyNativeSingleRelink(mediaFile, match);
  }

  const targetPath = mediaFile.projectPath ?? match.candidate.name;
  const restored = await copyCandidateToProject(match.candidate, targetPath);
  const url = URL.createObjectURL(restored.file);

  await storeHandle(mediaFile.id, restored.handle ?? match.candidate.handle);
  if (restored.handle) {
    await storeHandle(`${mediaFile.id}_project`, restored.handle);
  }

  replaceMediaFile(mediaFile.id, {
    file: restored.file,
    url,
    filePath: match.candidate.absolutePath ?? restored.file.name ?? match.candidate.name,
    absolutePath: match.candidate.absolutePath ?? mediaFile.absolutePath,
    projectPath: restored.projectPath ?? mediaFile.projectPath,
    fileSize: restored.file.size || mediaFile.fileSize,
  });

  await updateTimelineClips(mediaFile.id, restored.file);
  return true;
}

async function applyNativeModelSequenceRelink(
  mediaFile: MediaFile,
  match: Extract<RelinkMatch, { kind: 'model-sequence' }>,
): Promise<boolean> {
  const sequence = mediaFile.modelSequence;
  if (!sequence) return false;

  const frames = [...sequence.frames];
  for (const { index, candidate } of match.frames) {
    const existingFrame = frames[index];
    if (!existingFrame) continue;

    const projectPath = buildSequenceRawTarget(
      existingFrame.projectPath,
      sequence.sequenceName,
      candidate.name,
      'glb-sequence',
    );
    const absolutePath =
      candidate.absolutePath ??
      projectFileService.resolveRawFilePath(projectPath) ??
      existingFrame.absolutePath;

    await storeHandle(`${mediaFile.id}_frame_${index}`, candidate.handle);
    if (index === 0) {
      await storeHandle(mediaFile.id, candidate.handle);
      await storeHandle(`${mediaFile.id}_project`, candidate.handle);
    }

    frames[index] = {
      ...existingFrame,
      name: candidate.name,
      sourcePath: absolutePath ?? candidate.name,
      absolutePath,
      projectPath,
    };
  }

  const firstFrame = frames[0];
  replaceMediaFile(mediaFile.id, {
    file: undefined,
    url: '',
    modelSequence: {
      ...sequence,
      frames,
    },
    filePath: firstFrame?.sourcePath,
    absolutePath: firstFrame?.absolutePath,
    projectPath: firstFrame?.projectPath,
    fileSize: mediaFile.fileSize,
  });

  return true;
}

async function applyModelSequenceRelink(
  mediaFile: MediaFile,
  match: Extract<RelinkMatch, { kind: 'model-sequence' }>,
): Promise<boolean> {
  if (projectFileService.activeBackend === 'native' && match.frames.every(({ candidate }) => !candidate.file)) {
    return applyNativeModelSequenceRelink(mediaFile, match);
  }

  const sequence = mediaFile.modelSequence;
  if (!sequence) return false;

  const frames = [...sequence.frames];
  let firstFile: File | undefined;

  for (const { index, candidate } of match.frames) {
    const existingFrame = frames[index];
    if (!existingFrame) continue;

    const restored = await copyCandidateToProject(
      candidate,
      buildSequenceRawTarget(existingFrame.projectPath, sequence.sequenceName, candidate.name, 'glb-sequence'),
    );
    const modelUrl = URL.createObjectURL(restored.file);
    const frameKey = `${mediaFile.id}_frame_${index}`;

    await storeHandle(frameKey, restored.handle ?? candidate.handle);
    if (index === 0) {
      await storeHandle(mediaFile.id, restored.handle ?? candidate.handle);
      if (restored.handle) {
        await storeHandle(`${mediaFile.id}_project`, restored.handle);
      }
    }

    frames[index] = {
      ...existingFrame,
      name: restored.file.name || candidate.name,
      file: restored.file,
      modelUrl,
      sourcePath: candidate.absolutePath ?? restored.file.name ?? candidate.name,
      absolutePath: candidate.absolutePath ?? existingFrame.absolutePath,
      projectPath: restored.projectPath ?? existingFrame.projectPath,
    };

    if (index === 0) {
      firstFile = restored.file;
    }
  }

  const modelSequence: ModelSequenceData = {
    ...sequence,
    frames,
  };
  const firstFrame = frames[0];
  if (!firstFile || !firstFrame?.modelUrl) return false;

  replaceMediaFile(mediaFile.id, {
    file: firstFile,
    url: firstFrame.modelUrl,
    modelSequence,
    filePath: firstFrame.sourcePath,
    absolutePath: firstFrame.absolutePath,
    projectPath: firstFrame.projectPath,
    fileSize: frames.reduce((sum, frame) => sum + (frame.file?.size ?? 0), 0) || mediaFile.fileSize,
  });

  await updateTimelineClips(mediaFile.id, firstFile);
  return true;
}

async function applyNativeGaussianSplatSequenceRelink(
  mediaFile: MediaFile,
  match: Extract<RelinkMatch, { kind: 'gaussian-splat-sequence' }>,
): Promise<boolean> {
  const sequence = mediaFile.gaussianSplatSequence;
  if (!sequence) return false;

  const frames = [...sequence.frames];
  for (const { index, candidate } of match.frames) {
    const existingFrame = frames[index];
    if (!existingFrame) continue;

    const projectPath = buildSequenceRawTarget(
      existingFrame.projectPath,
      sequence.sequenceName,
      candidate.name,
      'splat-sequence',
    );
    const absolutePath =
      candidate.absolutePath ??
      projectFileService.resolveRawFilePath(projectPath) ??
      existingFrame.absolutePath;

    await storeHandle(`${mediaFile.id}_frame_${index}`, candidate.handle);
    if (index === 0) {
      await storeHandle(mediaFile.id, candidate.handle);
      await storeHandle(`${mediaFile.id}_project`, candidate.handle);
    }

    frames[index] = {
      ...existingFrame,
      name: candidate.name,
      sourcePath: absolutePath ?? candidate.name,
      absolutePath,
      projectPath,
    };
  }

  const firstFrame = frames[0];
  const totalFileSize = frames.reduce((sum, frame) => sum + (frame.fileSize ?? 0), 0);
  replaceMediaFile(mediaFile.id, {
    file: undefined,
    url: '',
    gaussianSplatSequence: {
      ...sequence,
      frames,
      totalFileSize: totalFileSize || sequence.totalFileSize,
    },
    filePath: firstFrame?.sourcePath,
    absolutePath: firstFrame?.absolutePath,
    projectPath: firstFrame?.projectPath,
    fileSize: totalFileSize || mediaFile.fileSize,
    splatFrameCount: sequence.frameCount,
  });

  return true;
}

async function applyGaussianSplatSequenceRelink(
  mediaFile: MediaFile,
  match: Extract<RelinkMatch, { kind: 'gaussian-splat-sequence' }>,
): Promise<boolean> {
  if (projectFileService.activeBackend === 'native' && match.frames.every(({ candidate }) => !candidate.file)) {
    return applyNativeGaussianSplatSequenceRelink(mediaFile, match);
  }

  const sequence = mediaFile.gaussianSplatSequence;
  if (!sequence) return false;

  const frames = [...sequence.frames];
  let firstFile: File | undefined;

  for (const { index, candidate } of match.frames) {
    const existingFrame = frames[index];
    if (!existingFrame) continue;

    const restored = await copyCandidateToProject(
      candidate,
      buildSequenceRawTarget(existingFrame.projectPath, sequence.sequenceName, candidate.name, 'splat-sequence'),
    );
    const splatUrl = URL.createObjectURL(restored.file);
    const frameKey = `${mediaFile.id}_frame_${index}`;

    await storeHandle(frameKey, restored.handle ?? candidate.handle);
    if (index === 0) {
      await storeHandle(mediaFile.id, restored.handle ?? candidate.handle);
      if (restored.handle) {
        await storeHandle(`${mediaFile.id}_project`, restored.handle);
      }
    }

    frames[index] = {
      ...existingFrame,
      name: restored.file.name || candidate.name,
      file: restored.file,
      splatUrl,
      sourcePath: candidate.absolutePath ?? restored.file.name ?? candidate.name,
      absolutePath: candidate.absolutePath ?? existingFrame.absolutePath,
      projectPath: restored.projectPath ?? existingFrame.projectPath,
      fileSize: restored.file.size || existingFrame.fileSize,
    };

    if (index === 0) {
      firstFile = restored.file;
    }
  }

  const totalFileSize = frames.reduce((sum, frame) => sum + (frame.fileSize ?? frame.file?.size ?? 0), 0);
  const gaussianSplatSequence: GaussianSplatSequenceData = {
    ...sequence,
    frames,
    totalFileSize: totalFileSize || sequence.totalFileSize,
  };
  const firstFrame = frames[0];
  if (!firstFile || !firstFrame?.splatUrl) return false;

  replaceMediaFile(mediaFile.id, {
    file: firstFile,
    url: firstFrame.splatUrl,
    gaussianSplatSequence,
    filePath: firstFrame.sourcePath,
    absolutePath: firstFrame.absolutePath,
    projectPath: firstFrame.projectPath,
    fileSize: totalFileSize || mediaFile.fileSize,
    splatFrameCount: gaussianSplatSequence.frameCount,
  });

  await updateTimelineClips(mediaFile.id, firstFile);
  return true;
}

export async function applyRelinkMatch(mediaFileId: string, match: RelinkMatch): Promise<boolean> {
  const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
  if (!mediaFile) return false;

  if (match.kind === 'single') {
    return applySingleRelink(mediaFile, match);
  }
  if (match.kind === 'model-sequence') {
    return applyModelSequenceRelink(mediaFile, match);
  }
  return applyGaussianSplatSequenceRelink(mediaFile, match);
}
