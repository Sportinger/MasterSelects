import { fileSystemService } from '../fileSystemService';
import { projectDB } from '../projectDB';
import { projectFileService } from './ProjectFileService';
import {
  createMediaSourceReplacementPatch,
  createMediaSourceReplacementResetPatch,
  updateTimelineClips,
  type UpdateTimelineClipsOptions,
} from '../../stores/mediaStore/slices/fileManageSlice';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import {
  collectTimelineAudioCacheRefsFromClips,
  invalidateTimelineMediaCaches,
  type TimelineAudioCacheRefClip,
} from '../timeline/timelineCacheInvalidation';
import {
  collectMediaFileObjectUrls,
  createMediaObjectUrl,
  createPrimaryMediaObjectUrl,
  getGaussianSplatSequenceFrameObjectUrlKey,
  getModelSequenceFrameObjectUrlKey,
  revokeMediaFileObjectUrls,
} from './mediaObjectUrlManager';
import type {
  GaussianSplatSequenceData,
  GaussianSplatSequenceFrame,
  ModelSequenceData,
  ModelSequenceFrame,
} from '../../types';
import type { RelinkCandidate, RelinkMatch } from './relink/relinkMatching';

export {
  createRelinkCandidateMapFromHandles,
  findRelinkMatch,
  getRelinkExpectedFileNames,
  setRelinkHandlePath,
} from './relink/relinkMatching';
export type {
  RelinkCandidate,
  RelinkCandidateMap,
  RelinkMatch,
} from './relink/relinkMatching';

export type RelinkApplyOptions = Pick<UpdateTimelineClipsOptions, 'generateThumbnails'>;

function isAbsolutePath(value: string | undefined): boolean {
  if (!value) return false;
  const platform = typeof navigator === 'undefined'
    ? ''
    : ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
      ?? navigator.platform
      ?? navigator.userAgent);
  return /win/i.test(platform)
    ? /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
    : value.startsWith('/');
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

function getSingleRelinkTarget(mediaFile: MediaFile, candidate: RelinkCandidate): string {
  if (mediaFile.projectPath) return mediaFile.projectPath;
  const relativePath = candidate.relativePath
    ?.replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
  return relativePath || candidate.name;
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

function replaceMediaFile(mediaFileId: string, nextFile: Partial<MediaFile>): void {
  useMediaStore.setState((state) => ({
    files: state.files.map((file) => {
      if (file.id !== mediaFileId) return file;
      const nextBlobUrls = collectMediaFileObjectUrls({ ...file, ...nextFile });
      revokeMediaFileObjectUrls(file, { keepUrls: nextBlobUrls });
      return {
        ...file,
        ...nextFile,
        hasFileHandle: true,
      };
    }),
  }));
}

function collectActiveTimelineClipsForRelink(mediaFileId: string): TimelineAudioCacheRefClip[] {
  return useTimelineStore.getState().clips
    .filter((clip) => clip.source?.mediaFileId === mediaFileId)
    .map((clip) => ({
      id: clip.id ?? undefined,
      audioState: clip.audioState,
    }));
}

async function invalidateRelinkSourceReplacementCaches(mediaFile: MediaFile): Promise<void> {
  const clips = collectActiveTimelineClipsForRelink(mediaFile.id);
  await invalidateTimelineMediaCaches({
    reason: 'source-replace',
    mediaFileId: mediaFile.id,
    ...(mediaFile.fileHash ? { fileHash: mediaFile.fileHash } : {}),
    clipIds: clips.map(clip => clip.id).filter((id): id is string => Boolean(id)),
    sourceAudioAnalysisRefs: mediaFile.audioAnalysisRefs,
    explicitAudioRefs: collectTimelineAudioCacheRefsFromClips(clips),
  });
}

async function applyNativeSingleRelink(
  mediaFile: MediaFile,
  match: Extract<RelinkMatch, { kind: 'single' }>,
): Promise<boolean> {
  const targetPath = getSingleRelinkTarget(mediaFile, match.candidate);
  const absolutePath =
    match.candidate.absolutePath ??
    projectFileService.resolveRawFilePath(targetPath) ??
    mediaFile.absolutePath;

  await invalidateRelinkSourceReplacementCaches(mediaFile);
  await storeHandle(mediaFile.id, match.candidate.handle);

  replaceMediaFile(mediaFile.id, {
    ...createMediaSourceReplacementResetPatch(),
    file: undefined,
    url: '',
    filePath: absolutePath ?? targetPath,
    absolutePath,
    projectPath: targetPath,
    fileSize: mediaFile.fileSize,
  });

  return true;
}

async function applySingleRelink(
  mediaFile: MediaFile,
  match: Extract<RelinkMatch, { kind: 'single' }>,
  options: RelinkApplyOptions = {},
): Promise<boolean> {
  if (projectFileService.activeBackend === 'native' && !match.candidate.file) {
    return applyNativeSingleRelink(mediaFile, match);
  }

  const targetPath = getSingleRelinkTarget(mediaFile, match.candidate);
  const restored = await copyCandidateToProject(match.candidate, targetPath);
  const url = createPrimaryMediaObjectUrl(mediaFile.id, restored.file, { revokeExisting: false });
  const sourceReplacementPatch = await createMediaSourceReplacementPatch(restored.file);

  await invalidateRelinkSourceReplacementCaches(mediaFile);
  await storeHandle(mediaFile.id, restored.handle ?? match.candidate.handle);
  if (restored.handle) {
    await storeHandle(`${mediaFile.id}_project`, restored.handle);
  }

  replaceMediaFile(mediaFile.id, {
    ...sourceReplacementPatch,
    file: restored.file,
    url,
    filePath: match.candidate.absolutePath ?? restored.file.name ?? match.candidate.name,
    absolutePath: match.candidate.absolutePath ?? mediaFile.absolutePath,
    projectPath: restored.projectPath ?? mediaFile.projectPath,
    fileSize: restored.file.size || mediaFile.fileSize,
  });

  await updateTimelineClips(mediaFile.id, restored.file, {
    ...options,
    invalidateCaches: false,
    fileHash: sourceReplacementPatch.fileHash,
  });
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
      modelUrl: undefined,
    };
  }

  const firstFrame = frames[0];
  await invalidateRelinkSourceReplacementCaches(mediaFile);
  replaceMediaFile(mediaFile.id, {
    ...createMediaSourceReplacementResetPatch(),
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
  options: RelinkApplyOptions = {},
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
    const modelUrl = createMediaObjectUrl(
      mediaFile.id,
      getModelSequenceFrameObjectUrlKey(index),
      restored.file,
      { revokeExisting: false },
    );
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
  const sourceReplacementPatch = await createMediaSourceReplacementPatch(firstFile);

  await invalidateRelinkSourceReplacementCaches(mediaFile);
  replaceMediaFile(mediaFile.id, {
    ...sourceReplacementPatch,
    file: firstFile,
    url: firstFrame.modelUrl,
    modelSequence,
    filePath: firstFrame.sourcePath,
    absolutePath: firstFrame.absolutePath,
    projectPath: firstFrame.projectPath,
    fileSize: frames.reduce((sum, frame) => sum + (frame.file?.size ?? 0), 0) || mediaFile.fileSize,
  });

  await updateTimelineClips(mediaFile.id, firstFile, {
    ...options,
    invalidateCaches: false,
    fileHash: sourceReplacementPatch.fileHash,
  });
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
      splatUrl: undefined,
    };
  }

  const firstFrame = frames[0];
  const totalFileSize = frames.reduce((sum, frame) => sum + (frame.fileSize ?? 0), 0);
  await invalidateRelinkSourceReplacementCaches(mediaFile);
  replaceMediaFile(mediaFile.id, {
    ...createMediaSourceReplacementResetPatch(),
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
  options: RelinkApplyOptions = {},
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
    const splatUrl = createMediaObjectUrl(
      mediaFile.id,
      getGaussianSplatSequenceFrameObjectUrlKey(index),
      restored.file,
      { revokeExisting: false },
    );
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
  const sourceReplacementPatch = await createMediaSourceReplacementPatch(firstFile);

  await invalidateRelinkSourceReplacementCaches(mediaFile);
  replaceMediaFile(mediaFile.id, {
    ...sourceReplacementPatch,
    file: firstFile,
    url: firstFrame.splatUrl,
    gaussianSplatSequence,
    filePath: firstFrame.sourcePath,
    absolutePath: firstFrame.absolutePath,
    projectPath: firstFrame.projectPath,
    fileSize: totalFileSize || mediaFile.fileSize,
    splatFrameCount: gaussianSplatSequence.frameCount,
  });

  await updateTimelineClips(mediaFile.id, firstFile, {
    ...options,
    invalidateCaches: false,
    fileHash: sourceReplacementPatch.fileHash,
  });
  return true;
}

export async function applyRelinkMatch(
  mediaFileId: string,
  match: RelinkMatch,
  options: RelinkApplyOptions = {},
): Promise<boolean> {
  const mediaFile = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
  if (!mediaFile) return false;

  if (match.kind === 'single') {
    return applySingleRelink(mediaFile, match, options);
  }
  if (match.kind === 'model-sequence') {
    return applyModelSequenceRelink(mediaFile, match, options);
  }
  return applyGaussianSplatSequenceRelink(mediaFile, match, options);
}
