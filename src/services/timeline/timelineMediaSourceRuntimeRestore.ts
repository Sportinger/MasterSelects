import type {
  GaussianSplatSequenceData,
  ModelSequenceData,
  SerializableClip,
  TimelineClip,
} from '../../types';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import type { VectorAnimationProvider } from '../../types/vectorAnimation';
import { NativeHelperClient } from '../nativeHelper/NativeHelperClient';
import {
  createPrimaryMediaObjectUrl,
  getPrimaryMediaObjectUrlKey,
  mediaObjectUrlManager,
} from '../project/mediaObjectUrlManager';

type TimelineClipSource = TimelineClip['source'];

export interface TimelineMediaReloadFile {
  id: string;
  duration?: number;
  file?: File;
  name?: string;
  url?: string;
}

export interface TimelineLoadStateMediaRuntimeReferenceAdapters {
  createObjectUrl?: (file: File) => string;
  createPrimaryObjectUrl?: (mediaFileId: string, file: File) => string;
  getReferencedFile?: (url: string, fileName: string) => Promise<File | null>;
  parseFileReferenceUrl?: (url: string) => unknown;
}

export interface TimelineLoadStateMediaRuntimeReference {
  deferMediaElementRestore: boolean;
  deferObjectUrlRestore: boolean;
  fileUrl?: string;
  loadFile?: File;
  restoredMediaFilePatch?: {
    file: File;
    hasFileHandle: true;
    url?: string;
  };
}

export interface TimelineMediaReloadPatch {
  file: File;
  is3D?: boolean;
  isLoading: false;
  needsReload: false;
  source: TimelineClipSource;
}

export interface TimelineLoadStateRestorePatch {
  file?: File;
  isLoading: false;
  needsReload?: false;
  source: TimelineClipSource;
}

export interface TimelineLoadStateImageRestoreAdapters {
  createManagedImageUrl: (clipId: string, file: File) => string;
  getPrimaryMediaObjectUrl?: (mediaFileId: string) => string | undefined;
}

export type TimelineLoadStateRuntimePatch = Partial<TimelineClip>;

export interface TimelineLoadStateVectorRuntimeRestoreStartOptions {
  clip: TimelineClip;
  serializedClip: SerializableClip;
  sourceType: VectorAnimationProvider;
  file: File;
  isCurrentSession: () => boolean;
  createReadyPatch: (source: NonNullable<TimelineClipSource>) => TimelineLoadStateRestorePatch;
  applyPatch: (patch: TimelineLoadStateRuntimePatch) => void;
  onReady: () => void;
  onError: (error: unknown) => void;
}

export interface TimelineLoadStateVectorRestoreAdapters {
  startVectorRuntimeRestore: (options: TimelineLoadStateVectorRuntimeRestoreStartOptions) => void;
}

export interface TimelineLoadStateSpatialMediaFile extends TimelineMediaReloadFile {
  absolutePath?: string;
  gaussianSplatSequence?: GaussianSplatSequenceData;
  modelSequence?: ModelSequenceData;
}

export interface TimelineLoadStateSpatialRestoreAdapters {
  applyManagedSpatialSource: (
    clip: TimelineClip,
    serializedClip: SerializableClip,
    duration: number,
    mediaFile: TimelineLoadStateSpatialMediaFile,
  ) => {
    handled: boolean;
    restored: boolean;
    source: NonNullable<TimelineClipSource> | null;
  };
}

export interface TimelineLoadStateSpatialRestoreResult {
  handled: boolean;
  restored: boolean;
  patch?: TimelineLoadStateRuntimePatch;
}

export interface CreateClipboardMediaReloadPatchParams {
  clipId: string;
  duration: number;
  mediaFile: TimelineMediaReloadFile;
  mediaFileId: string;
  source: TimelineClipSource;
  createImageUrl?: (params: { clipId: string; file: File }) => string;
}

function isObjectUrl(url: string | undefined): boolean {
  return Boolean(url?.startsWith('blob:'));
}

export function isLoadStateDeferredMediaElementSourceType(sourceType: unknown): boolean {
  return sourceType === 'video' || sourceType === 'audio';
}

export function shouldDeferLoadStateObjectUrlRestore(sourceType: unknown): boolean {
  return (
    isLoadStateDeferredMediaElementSourceType(sourceType) ||
    sourceType === 'image' ||
    sourceType === 'model' ||
    sourceType === 'gaussian-avatar' ||
    sourceType === 'gaussian-splat' ||
    isVectorAnimationSourceType(sourceType)
  );
}

function shouldResolveReferencedLoadStateFile(sourceType: unknown): boolean {
  return sourceType === 'image' || isVectorAnimationSourceType(sourceType);
}

export async function resolveLoadStateMediaRuntimeReference(params: {
  adapters?: TimelineLoadStateMediaRuntimeReferenceAdapters;
  mediaFile: TimelineMediaReloadFile;
  sourceType: unknown;
}): Promise<TimelineLoadStateMediaRuntimeReference> {
  const { adapters, mediaFile, sourceType } = params;
  const deferMediaElementRestore = isLoadStateDeferredMediaElementSourceType(sourceType);
  const deferObjectUrlRestore = shouldDeferLoadStateObjectUrlRestore(sourceType);
  const createObjectUrl = adapters?.createObjectUrl ?? ((file: File) => URL.createObjectURL(file));
  const createPrimaryObjectUrl = adapters?.createPrimaryObjectUrl
    ?? ((mediaFileId: string, file: File) => createPrimaryMediaObjectUrl(mediaFileId, file));
  const parseFileReferenceUrl = adapters?.parseFileReferenceUrl
    ?? ((url: string) => NativeHelperClient.parseFileReferenceUrl(url));
  const getReferencedFile = adapters?.getReferencedFile
    ?? ((url: string, fileName: string) => NativeHelperClient.getReferencedFile(url, fileName));

  let loadFile = mediaFile.file;
  let fileUrl = loadFile
    ? (deferObjectUrlRestore ? mediaFile.url : createObjectUrl(loadFile))
    : mediaFile.url;

  if (
    !loadFile &&
    fileUrl &&
    shouldResolveReferencedLoadStateFile(sourceType) &&
    parseFileReferenceUrl(fileUrl)
  ) {
    const referencedFile = await getReferencedFile(fileUrl, mediaFile.name ?? '');
    if (referencedFile) {
      loadFile = referencedFile;
      fileUrl = isVectorAnimationSourceType(sourceType)
        ? fileUrl
        : createPrimaryObjectUrl(mediaFile.id, referencedFile);

      return {
        deferMediaElementRestore,
        deferObjectUrlRestore,
        fileUrl,
        loadFile,
        restoredMediaFilePatch: {
          file: referencedFile,
          url: fileUrl,
          hasFileHandle: true,
        },
      };
    }
  }

  return {
    deferMediaElementRestore,
    deferObjectUrlRestore,
    fileUrl,
    loadFile,
  };
}

function getReloadNaturalDuration(params: {
  clipDuration: number;
  mediaDuration?: number;
  source: TimelineClipSource;
}): number {
  return params.source?.naturalDuration ?? params.mediaDuration ?? params.clipDuration;
}

function getLoadStateNaturalDuration(params: {
  clipDuration: number;
  mediaDuration?: number;
  naturalDuration?: number;
}): number {
  return params.naturalDuration || params.mediaDuration || params.clipDuration;
}

function resolveLoadStateImageRuntimeUrl(params: {
  adapters: TimelineLoadStateImageRestoreAdapters;
  clipId: string;
  fileUrl?: string;
  loadFile?: File;
  mediaFileId: string;
}): string | undefined {
  const { adapters, clipId, fileUrl, loadFile, mediaFileId } = params;
  if (!fileUrl) {
    return loadFile ? adapters.createManagedImageUrl(clipId, loadFile) : undefined;
  }

  if (!isObjectUrl(fileUrl)) {
    return fileUrl;
  }

  const getPrimaryMediaObjectUrl = adapters.getPrimaryMediaObjectUrl
    ?? ((id: string) => mediaObjectUrlManager.get(id, getPrimaryMediaObjectUrlKey()));
  if (getPrimaryMediaObjectUrl(mediaFileId) === fileUrl) {
    return fileUrl;
  }

  return loadFile ? adapters.createManagedImageUrl(clipId, loadFile) : fileUrl;
}

export function createLoadStateImageRestorePatch(params: {
  adapters: TimelineLoadStateImageRestoreAdapters;
  absolutePath?: string;
  clipDuration: number;
  clipId: string;
  fallbackFile: File;
  fileUrl?: string;
  loadFile?: File;
  mediaDuration?: number;
  mediaFileId: string;
  naturalDuration?: number;
}): TimelineLoadStateRestorePatch | null {
  const imageUrl = resolveLoadStateImageRuntimeUrl({
    adapters: params.adapters,
    clipId: params.clipId,
    fileUrl: params.fileUrl,
    loadFile: params.loadFile,
    mediaFileId: params.mediaFileId,
  });
  if (!imageUrl) {
    return null;
  }

  return {
    file: params.loadFile ?? params.fallbackFile,
    source: {
      type: 'image',
      mediaFileId: params.mediaFileId,
      naturalDuration: getLoadStateNaturalDuration({
        clipDuration: params.clipDuration,
        mediaDuration: params.mediaDuration,
        naturalDuration: params.naturalDuration,
      }),
      imageUrl,
      ...(params.absolutePath ? { filePath: params.absolutePath } : {}),
    },
    isLoading: false,
    needsReload: false,
  };
}

export function createLoadStateNativeVideoPathRestorePatch(params: {
  absolutePath: string;
  clipDuration: number;
  mediaDuration?: number;
  mediaFileId: string;
  naturalDuration?: number;
}): TimelineLoadStateRestorePatch {
  return {
    source: {
      type: 'video',
      naturalDuration: getLoadStateNaturalDuration({
        clipDuration: params.clipDuration,
        mediaDuration: params.mediaDuration,
        naturalDuration: params.naturalDuration,
      }),
      mediaFileId: params.mediaFileId,
      filePath: params.absolutePath,
    },
    isLoading: false,
    needsReload: false,
  };
}

export function createLoadStateDeferredMediaRestorePatch(params: {
  absolutePath?: string;
  clipDuration: number;
  fallbackFile: File;
  loadFile?: File;
  mediaDuration?: number;
  mediaFileId: string;
  naturalDuration?: number;
  sourceType: 'audio' | 'video';
}): TimelineLoadStateRestorePatch {
  return {
    file: params.loadFile ?? params.fallbackFile,
    source: {
      type: params.sourceType,
      naturalDuration: getLoadStateNaturalDuration({
        clipDuration: params.clipDuration,
        mediaDuration: params.mediaDuration,
        naturalDuration: params.naturalDuration,
      }),
      mediaFileId: params.mediaFileId,
      ...(params.absolutePath ? { filePath: params.absolutePath } : {}),
    },
    isLoading: false,
    needsReload: false,
  };
}

function createLoadStateVectorPendingSource(params: {
  mediaFileId?: string;
  naturalDuration?: number;
  serializedClip: SerializableClip;
  sourceType: VectorAnimationProvider;
}): NonNullable<TimelineClipSource> {
  return {
    type: params.sourceType,
    mediaFileId: params.mediaFileId ?? params.serializedClip.mediaFileId,
    naturalDuration: params.naturalDuration ?? params.serializedClip.naturalDuration,
    vectorAnimationSettings: params.serializedClip.vectorAnimationSettings,
  };
}

function createLoadStateVectorRuntimeClip(params: {
  clip: TimelineClip;
  file: File;
  serializedClip: SerializableClip;
  sourceType: VectorAnimationProvider;
}): TimelineClip {
  return {
    ...params.clip,
    file: params.file,
    source: createLoadStateVectorPendingSource({
      serializedClip: params.serializedClip,
      sourceType: params.sourceType,
    }),
  };
}

export function startLoadStateVectorRuntimeRestore(params: {
  adapters: TimelineLoadStateVectorRestoreAdapters;
  applyPatch: (patch: TimelineLoadStateRuntimePatch) => void;
  clip: TimelineClip;
  isCurrentTimelineSession: () => boolean;
  loadFile?: File;
  needsReloadWhenMissingFile: boolean;
  onError: (error: unknown) => void;
  onMissingFile: () => void;
  onReady: () => void;
  onStartError: (error: unknown) => void;
  serializedClip: SerializableClip;
  sourceType: VectorAnimationProvider;
}): boolean {
  if (!params.loadFile) {
    params.onMissingFile();
    params.applyPatch({
      isLoading: false,
      needsReload: params.needsReloadWhenMissingFile,
    });
    return true;
  }

  try {
    params.adapters.startVectorRuntimeRestore({
      clip: createLoadStateVectorRuntimeClip({
        clip: params.clip,
        file: params.loadFile,
        serializedClip: params.serializedClip,
        sourceType: params.sourceType,
      }),
      serializedClip: params.serializedClip,
      sourceType: params.sourceType,
      file: params.loadFile,
      isCurrentSession: params.isCurrentTimelineSession,
      createReadyPatch: (source) => ({
        file: params.loadFile!,
        source,
        isLoading: false,
        needsReload: false,
      }),
      applyPatch: params.applyPatch,
      onReady: params.onReady,
      onError: params.onError,
    });
  } catch (error) {
    if (!params.isCurrentTimelineSession()) {
      return true;
    }
    params.onStartError(error);
    params.applyPatch({ isLoading: false });
  }

  return true;
}

export function createLoadStateSpatialRestorePatch(params: {
  adapters: TimelineLoadStateSpatialRestoreAdapters;
  clip: TimelineClip;
  duration: number;
  mediaFile: TimelineLoadStateSpatialMediaFile;
  serializedClip: SerializableClip;
}): TimelineLoadStateSpatialRestoreResult {
  const workingClip: TimelineClip = { ...params.clip };
  const spatialResult = params.adapters.applyManagedSpatialSource(
    workingClip,
    params.serializedClip,
    params.duration,
    params.mediaFile,
  );

  if (!spatialResult.handled) {
    return { handled: false, restored: false };
  }

  if (!spatialResult.restored) {
    return {
      handled: true,
      restored: false,
      patch: { isLoading: false },
    };
  }

  return {
    handled: true,
    restored: true,
    patch: {
      source: workingClip.source,
      is3D: workingClip.is3D,
      meshType: workingClip.meshType,
      text3DProperties: workingClip.text3DProperties,
      isLoading: false,
    },
  };
}

export function createClipboardMediaReloadPatch(
  params: CreateClipboardMediaReloadPatchParams,
): TimelineMediaReloadPatch | null {
  const { clipId, duration, mediaFile, mediaFileId, source } = params;
  const file = mediaFile.file;
  const sourceType = source?.type;
  if (!file || !sourceType) {
    return null;
  }

  if (isVectorAnimationSourceType(sourceType)) {
    return {
      file,
      source: {
        type: sourceType,
        mediaFileId,
        naturalDuration: getReloadNaturalDuration({
          clipDuration: duration,
          mediaDuration: mediaFile.duration,
          source,
        }),
        vectorAnimationSettings: source.vectorAnimationSettings,
      },
      isLoading: false,
      needsReload: false,
    };
  }

  if (sourceType === 'video' || sourceType === 'audio') {
    return {
      file,
      source: {
        type: sourceType,
        naturalDuration: getReloadNaturalDuration({
          clipDuration: duration,
          mediaDuration: mediaFile.duration,
          source,
        }),
        mediaFileId,
      },
      isLoading: false,
      needsReload: false,
    };
  }

  if (sourceType === 'image') {
    const imageUrl = params.createImageUrl?.({ clipId, file }) ?? mediaFile.url;
    if (!imageUrl) {
      return null;
    }

    return {
      file,
      source: {
        type: 'image',
        imageUrl,
        naturalDuration: source.naturalDuration || duration,
        mediaFileId,
      },
      isLoading: false,
      needsReload: false,
    };
  }

  if (sourceType === 'model') {
    const modelUrl = mediaFile.url
      ?? createPrimaryMediaObjectUrl(mediaFile.id, file, { revokeExisting: false });

    return {
      file,
      is3D: true,
      source: {
        type: 'model',
        modelUrl,
        naturalDuration: source.naturalDuration || 3600,
        mediaFileId,
        modelPrimitiveIndex: source.modelPrimitiveIndex,
        modelMaterialSettings: source.modelMaterialSettings,
      },
      isLoading: false,
      needsReload: false,
    };
  }

  return null;
}
