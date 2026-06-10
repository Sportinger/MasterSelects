import { Logger } from '../../logger';
import { fileSystemService } from '../../fileSystemService';
import { projectDB } from '../../projectDB';
import { projectFileService, type ProjectMediaFile } from '../../projectFileService';
import {
  cacheProjectFileHandle,
  getProjectRawPathCandidates,
  getStoredProjectFileHandle,
} from '../mediaSourceResolver';
import {
  createMediaObjectUrl,
  createPrimaryMediaObjectUrl,
  getGaussianSplatSequenceFrameObjectUrlKey,
  getModelSequenceFrameObjectUrlKey,
} from '../mediaObjectUrlManager';
import type {
  GaussianSplatSequenceData,
  GaussianSplatSequenceFrame,
  ModelSequenceData,
  ModelSequenceFrame,
} from '../../../types';

const log = Logger.create('ProjectSync');

export type ProjectMediaRuntimeSources = {
  representativeFile?: File;
  representativeUrl: string;
  representativeProjectPath: string | undefined;
  representativeAbsolutePath: string | undefined;
  thumbnailUrl?: string;
  modelSequence?: ModelSequenceData;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  hasFileHandle: boolean;
};

type ProjectFileServiceRawResolver = typeof projectFileService & {
  resolveRawFilePath?: (relativePath: string | undefined) => string | null;
  resolveRawFileUrl?: (relativePath: string | undefined) => string | null;
};

function isAbsoluteFilePath(value: string | undefined): boolean {
  return Boolean(value && (value.startsWith('/') || /^[A-Za-z]:[/\\]/.test(value)));
}

function resolveProjectRawFilePath(relativePath: string | undefined): string | null {
  const resolver = (projectFileService as ProjectFileServiceRawResolver).resolveRawFilePath;
  return typeof resolver === 'function' ? resolver.call(projectFileService, relativePath) : null;
}

function resolveProjectRawFileUrl(relativePath: string | undefined): string | null {
  const resolver = (projectFileService as ProjectFileServiceRawResolver).resolveRawFileUrl;
  return typeof resolver === 'function' ? resolver.call(projectFileService, relativePath) : null;
}

function getSequenceFrameHandleCacheKey(mediaFileId: string, frameIndex: number): string {
  return mediaFileId + '_frame_' + frameIndex;
}

async function restoreSequenceFrameFromHandle(
  mediaFileId: string,
  frameIndex: number,
): Promise<{ file: File; handle: FileSystemFileHandle } | null> {
  const cacheKey = getSequenceFrameHandleCacheKey(mediaFileId, frameIndex);
  let handle = fileSystemService.getFileHandle(cacheKey);

  if (!handle) {
    try {
      const storedHandle = await projectDB.getStoredHandle('media_' + cacheKey);
      if (storedHandle && storedHandle.kind === 'file' && 'getFile' in storedHandle) {
        handle = storedHandle as FileSystemFileHandle;
        fileSystemService.storeFileHandle(cacheKey, handle);
      }
    } catch (error) {
      log.warn('Could not restore sequence frame handle from IndexedDB', { mediaFileId, frameIndex, error });
      return null;
    }
  }

  if (!handle) return null;

  try {
    const permission = 'queryPermission' in handle
      ? await handle.queryPermission({ mode: 'read' })
      : 'granted';
    if (permission !== 'granted') return null;
    return { file: await handle.getFile(), handle };
  } catch (error) {
    log.warn('Could not read sequence frame handle', { mediaFileId, frameIndex, error });
    return null;
  }
}

async function hydrateModelSequence(
  pm: ProjectMediaFile,
  hydrateFiles: boolean,
): Promise<ModelSequenceData | undefined> {
  if (!pm.modelSequence) return undefined;

  const sequenceFrames: ModelSequenceFrame[] = [];
  for (let frameIndex = 0; frameIndex < pm.modelSequence.frames.length; frameIndex += 1) {
    const frame = pm.modelSequence.frames[frameIndex];
    let frameFile: File | undefined;
    let modelUrl: string | undefined;
    const frameFileUrl = resolveProjectRawFileUrl(frame.projectPath);
    if (!hydrateFiles && !modelUrl && frameFileUrl) modelUrl = frameFileUrl;

    if (hydrateFiles && !frameFile && frame.projectPath && projectFileService.isProjectOpen()) {
      try {
        const result = await projectFileService.getFileFromRaw(frame.projectPath);
        if (result?.file) {
          frameFile = result.file;
          modelUrl = createMediaObjectUrl(pm.id, getModelSequenceFrameObjectUrlKey(frameIndex), result.file);
        }
      } catch (error) {
        log.warn('Could not restore model sequence frame for ' + pm.name, { frame: frame.name, error });
      }
    }

    if (hydrateFiles && !frameFile) {
      const restoredFrame = await restoreSequenceFrameFromHandle(pm.id, frameIndex);
      if (restoredFrame) {
        frameFile = restoredFrame.file;
        modelUrl = createMediaObjectUrl(pm.id, getModelSequenceFrameObjectUrlKey(frameIndex), restoredFrame.file);
      }
    }

    sequenceFrames.push({
      name: frame.name,
      projectPath: frame.projectPath,
      sourcePath: frame.sourcePath,
      absolutePath: frame.absolutePath ?? resolveProjectRawFilePath(frame.projectPath) ?? undefined,
      file: frameFile,
      modelUrl,
    });
  }

  return { ...pm.modelSequence, frames: sequenceFrames };
}

async function hydrateGaussianSplatSequence(
  pm: ProjectMediaFile,
  hydrateFiles: boolean,
): Promise<GaussianSplatSequenceData | undefined> {
  if (!pm.gaussianSplatSequence) return undefined;

  const sequenceFrames: GaussianSplatSequenceFrame[] = [];
  for (let frameIndex = 0; frameIndex < pm.gaussianSplatSequence.frames.length; frameIndex += 1) {
    const frame = pm.gaussianSplatSequence.frames[frameIndex];
    let frameFile: File | undefined;
    let splatUrl: string | undefined;
    const frameFileUrl = resolveProjectRawFileUrl(frame.projectPath);
    if (!hydrateFiles && !splatUrl && frameFileUrl) splatUrl = frameFileUrl;

    if (hydrateFiles && !frameFile && frame.projectPath && projectFileService.isProjectOpen()) {
      try {
        const result = await projectFileService.getFileFromRaw(frame.projectPath);
        if (result?.file) {
          frameFile = result.file;
          splatUrl = createMediaObjectUrl(pm.id, getGaussianSplatSequenceFrameObjectUrlKey(frameIndex), result.file);
        }
      } catch (error) {
        log.warn('Could not restore gaussian splat sequence frame for ' + pm.name, { frame: frame.name, error });
      }
    }

    if (hydrateFiles && !frameFile) {
      const restoredFrame = await restoreSequenceFrameFromHandle(pm.id, frameIndex);
      if (restoredFrame) {
        frameFile = restoredFrame.file;
        splatUrl = createMediaObjectUrl(pm.id, getGaussianSplatSequenceFrameObjectUrlKey(frameIndex), restoredFrame.file);
      }
    }

    sequenceFrames.push({
      name: frame.name,
      projectPath: frame.projectPath,
      sourcePath: frame.sourcePath,
      absolutePath: frame.absolutePath ?? resolveProjectRawFilePath(frame.projectPath) ?? undefined,
      file: frameFile,
      splatUrl,
      splatCount: frame.splatCount,
      fileSize: frame.fileSize,
      container: frame.container,
      codec: frame.codec,
    });
  }

  return { ...pm.gaussianSplatSequence, frames: sequenceFrames };
}

export async function hydrateProjectMediaRuntimeSources(
  pm: ProjectMediaFile,
  hydrateFiles: boolean,
): Promise<ProjectMediaRuntimeSources> {
  let resolvedProjectPath = pm.projectPath;
  let handle: FileSystemFileHandle | undefined;
  let file: File | undefined;
  let url = '';
  let thumbnailUrl: string | undefined;

  if (hydrateFiles) {
    const storedProjectHandle = await getStoredProjectFileHandle(pm.id);
    if (storedProjectHandle) {
      try {
        file = await storedProjectHandle.getFile();
        handle = storedProjectHandle;
        url = createPrimaryMediaObjectUrl(pm.id, file);
        resolvedProjectPath = resolvedProjectPath || 'Raw/' + storedProjectHandle.name;
        await cacheProjectFileHandle(pm.id, storedProjectHandle, true);
        log.info('Restored file from project RAW handle:', pm.name);
      } catch (e) {
        log.warn('Could not access project RAW handle: ' + pm.name, e);
      }
    }
  }

  const modelSequence = await hydrateModelSequence(pm, hydrateFiles);
  const gaussianSplatSequence = await hydrateGaussianSplatSequence(pm, hydrateFiles);

  if (hydrateFiles && !file && projectFileService.isProjectOpen()) {
    for (const candidatePath of getProjectRawPathCandidates({
      mediaFileId: pm.id,
      projectPath: pm.projectPath,
      filePath: pm.sourcePath,
      name: pm.name,
    })) {
      try {
        const result = await projectFileService.getFileFromRaw(candidatePath);
        if (!result) continue;

        file = result.file;
        handle = result.handle;
        url = createPrimaryMediaObjectUrl(pm.id, file);
        resolvedProjectPath = candidatePath;
        const projectHandle = result.handle;
        if (projectHandle) await cacheProjectFileHandle(pm.id, projectHandle, true);
        log.info('Restored file from project RAW path:', pm.name);
        break;
      } catch (e) {
        log.warn('Could not access project RAW path for ' + pm.name + ': ' + candidatePath, e);
      }
    }
  }

  const representativeFile = file ?? modelSequence?.frames[0]?.file ?? gaussianSplatSequence?.frames[0]?.file;
  const representativeProjectPath =
    resolvedProjectPath ?? modelSequence?.frames[0]?.projectPath ?? gaussianSplatSequence?.frames[0]?.projectPath;
  const nativeRepresentativeUrl =
    !hydrateFiles && representativeProjectPath ? resolveProjectRawFileUrl(representativeProjectPath) ?? '' : '';
  const representativeUrl =
    url || modelSequence?.frames[0]?.modelUrl || gaussianSplatSequence?.frames[0]?.splatUrl || nativeRepresentativeUrl || '';
  const representativeAbsolutePath =
    resolveProjectRawFilePath(representativeProjectPath) ??
    (isAbsoluteFilePath(pm.sourcePath) ? pm.sourcePath : undefined) ??
    modelSequence?.frames[0]?.absolutePath ??
    gaussianSplatSequence?.frames[0]?.absolutePath;

  if (hydrateFiles && !file) {
    handle = fileSystemService.getFileHandle(pm.id);

    if (!handle) {
      try {
        const storedHandle = await projectDB.getStoredHandle('media_' + pm.id);
        if (storedHandle && storedHandle.kind === 'file') {
          handle = storedHandle as FileSystemFileHandle;
          fileSystemService.storeFileHandle(pm.id, handle);
          log.info('Retrieved handle from IndexedDB for: ' + pm.name);
        }
      } catch (e) {
        log.warn('Failed to get handle from IndexedDB: ' + pm.name, e);
      }
    }

    if (handle) {
      try {
        const permission = await handle.queryPermission({ mode: 'read' });
        if (permission === 'granted') {
          file = await handle.getFile();
          url = createPrimaryMediaObjectUrl(pm.id, file);
          log.info('Restored file from handle:', pm.name);
        } else {
          log.info('File needs permission:', pm.name);
        }
      } catch (e) {
        log.warn('Could not access file: ' + pm.name, e);
      }
    }
  }

  void file;
  void url;

  return {
    representativeFile,
    representativeUrl,
    representativeProjectPath,
    representativeAbsolutePath,
    thumbnailUrl,
    modelSequence,
    gaussianSplatSequence,
    hasFileHandle: !!handle || (!!representativeAbsolutePath && projectFileService.activeBackend === 'native'),
  };
}
