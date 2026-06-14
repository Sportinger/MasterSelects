import type { TimelineClip } from './types';
import type { SerializableClip } from '../../types';
import { clonePersistedClipAudioState } from '../../services/audio/clipAudioStatePersistence';
import { mathSceneRenderer } from '../../services/mathScene/MathSceneRenderer';
import { cloneClipNodeGraph } from '../../services/nodeGraph';
import { serializeVideoBakeRegion } from './videoBakeSlice';
import { blobUrlManager } from './helpers/blobUrlManager';
import type { RestoredRuntimePatch } from './vectorRuntimeRestore';
import {
  createDataOnlyRestoredGaussianSplatSource,
  createDataOnlyRestoredGaussianAvatarSource,
  createDataOnlyRestoredModelSource,
  type RestoredGaussianAvatarMediaFileInfo,
  type RestoredGaussianSplatMediaFileInfo,
  type RestoredModelMediaFileInfo,
} from './restoredMediaSource';

export {
  startRestoredVectorRuntimeRestore,
} from './vectorRuntimeRestore';
export type { RestoredRuntimePatch } from './vectorRuntimeRestore';

export function isMotionSourceType(
  sourceType: SerializableClip['sourceType'],
): sourceType is 'motion-shape' | 'motion-null' | 'motion-adjustment' {
  return (
    sourceType === 'motion-shape' ||
    sourceType === 'motion-null' ||
    sourceType === 'motion-adjustment'
  );
}

export function restorePersistedClipVideoState(serializedClip: SerializableClip): TimelineClip['videoState'] {
  return serializedClip.videoState
    ? {
        ...structuredClone(serializedClip.videoState),
        bakeRegions: serializedClip.videoState.bakeRegions?.map(serializeVideoBakeRegion),
      }
    : undefined;
}

type RestoredNestedClipCommonOptions = {
  clipId: string;
  name?: string;
  file: File;
  source: TimelineClip['source'];
  isLoading: boolean;
  needsReload?: boolean;
};

function createRestoredNestedClipCommon(
  serializedClip: SerializableClip,
  options: RestoredNestedClipCommonOptions,
): TimelineClip {
  const text3DProperties = serializedClip.text3DProperties
    ? { ...serializedClip.text3DProperties }
    : undefined;

  return {
    id: options.clipId,
    trackId: serializedClip.trackId,
    name: options.name ?? serializedClip.name,
    file: options.file,
    mediaFileId: serializedClip.mediaFileId || undefined,
    startTime: serializedClip.startTime,
    duration: serializedClip.duration,
    inPoint: serializedClip.inPoint,
    outPoint: serializedClip.outPoint,
    source: options.source,
    thumbnails: serializedClip.thumbnails,
    linkedClipId: serializedClip.linkedClipId,
    linkedGroupId: serializedClip.linkedGroupId,
    videoState: restorePersistedClipVideoState(serializedClip),
    audioState: clonePersistedClipAudioState(serializedClip.audioState),
    waveform: serializedClip.waveform,
    waveformChannels: serializedClip.waveformChannels,
    transform: serializedClip.transform,
    effects: serializedClip.effects || [],
    transitionIn: serializedClip.transitionIn ? structuredClone(serializedClip.transitionIn) : undefined,
    transitionOut: serializedClip.transitionOut ? structuredClone(serializedClip.transitionOut) : undefined,
    colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
    nodeGraph: cloneClipNodeGraph(serializedClip.nodeGraph),
    masks: serializedClip.masks || [],
    reversed: serializedClip.reversed,
    speed: serializedClip.speed,
    preservesPitch: serializedClip.preservesPitch,
    is3D: serializedClip.is3D,
    meshType: serializedClip.meshType,
    text3DProperties,
    isLoading: options.isLoading,
    needsReload: options.needsReload,
  };
}

export function createRestoredNestedMediaClip(
  serializedClip: SerializableClip,
  options: RestoredNestedClipCommonOptions,
): TimelineClip {
  return createRestoredNestedClipCommon(serializedClip, options);
}

export function createRestoredNestedCompositionClip(
  serializedClip: SerializableClip,
  options: {
    clipId: string;
    compositionId?: string;
    compositionName: string;
    naturalDuration: number;
    nestedClips?: TimelineClip[];
    nestedTracks?: TimelineClip['nestedTracks'];
    isLoading?: boolean;
  },
): TimelineClip {
  return {
    ...createRestoredNestedClipCommon(serializedClip, {
      clipId: options.clipId,
      file: new File([], options.compositionName),
      source: {
        type: 'video',
        naturalDuration: options.naturalDuration,
      },
      isLoading: options.isLoading ?? false,
    }),
    isComposition: true,
    compositionId: options.compositionId ?? serializedClip.compositionId,
    nestedClips: options.nestedClips ?? [],
    nestedTracks: options.nestedTracks ?? [],
  };
}

function getPrimitiveMeshClipName(serializedClip: SerializableClip): string {
  if (serializedClip.meshType === 'text3d') {
    const textName = serializedClip.text3DProperties?.text?.trim().slice(0, 30);
    return textName || serializedClip.name || '3D Text';
  }

  return serializedClip.name || serializedClip.meshType || 'Mesh';
}

export function isRestoredPrimitiveMeshClip(serializedClip: SerializableClip): boolean {
  return (
    serializedClip.sourceType === 'model' &&
    Boolean(serializedClip.meshType) &&
    !serializedClip.modelSequence
  );
}

export function createRestoredPrimitiveMeshClip(
  serializedClip: SerializableClip,
  clipId = serializedClip.id,
): TimelineClip | null {
  if (!isRestoredPrimitiveMeshClip(serializedClip)) {
    return null;
  }

  const text3DProperties = serializedClip.text3DProperties
    ? { ...serializedClip.text3DProperties }
    : undefined;

  return {
    ...createRestoredNestedClipCommon(serializedClip, {
      clipId,
      name: getPrimitiveMeshClipName(serializedClip),
      file: new File([], `mesh-${serializedClip.meshType}.dat`, { type: 'application/octet-stream' }),
      source: {
        type: 'model',
        meshType: serializedClip.meshType,
        mediaFileId: serializedClip.mediaFileId || undefined,
        naturalDuration: Number.MAX_SAFE_INTEGER,
        threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
        ...(text3DProperties ? { text3DProperties } : {}),
      },
      isLoading: false,
    }),
    is3D: serializedClip.is3D ?? true,
    meshType: serializedClip.meshType,
    text3DProperties,
    wireframe: false,
  };
}

export function createRestoredMotionClip(
  serializedClip: SerializableClip,
  clipId: string,
): TimelineClip | null {
  if (!isMotionSourceType(serializedClip.sourceType) || !serializedClip.motion) {
    return null;
  }

  return {
    ...createRestoredNestedClipCommon(serializedClip, {
      clipId,
      name: serializedClip.name || 'Motion',
      file: new File([JSON.stringify(serializedClip.motion)], `${serializedClip.sourceType}.msmotion`, { type: 'application/json' }),
      source: {
        type: serializedClip.sourceType,
        mediaFileId: serializedClip.mediaFileId || undefined,
        naturalDuration: serializedClip.duration,
      },
      isLoading: false,
    }),
    motion: structuredClone(serializedClip.motion),
  };
}

export function createRestoredMathSceneClip(
  serializedClip: SerializableClip,
  clipId: string,
  options: {
    width?: number;
    height?: number;
    renderTime?: number;
  } = {},
): TimelineClip | null {
  if (serializedClip.sourceType !== 'math-scene' || !serializedClip.mathScene) {
    return null;
  }

  const canvas = mathSceneRenderer.createCanvas(options.width, options.height);
  const clip = createRestoredNestedClipCommon(serializedClip, {
    clipId,
    name: serializedClip.name || 'Math Scene',
    file: new File([JSON.stringify(serializedClip.mathScene)], 'math-scene.json', { type: 'application/json' }),
    source: {
      type: 'math-scene',
      textCanvas: canvas,
      mediaFileId: serializedClip.mediaFileId || undefined,
      naturalDuration: serializedClip.duration,
    },
    isLoading: false,
    needsReload: false,
  });

  clip.mathScene = structuredClone(serializedClip.mathScene);
  clip.waveform = serializedClip.waveform;
  clip.waveformChannels = serializedClip.waveformChannels;
  mathSceneRenderer.renderClip(clip, options.renderTime ?? 0);
  return clip;
}

export function createManagedRestoredImageUrl(clipId: string, file: File | Blob): string {
  return blobUrlManager.create(clipId, file, 'image');
}

export function createDataOnlyRestoredImageSource(
  clipId: string,
  serializedClip: SerializableClip,
  duration: number,
  mediaFile: {
    file?: File;
    url?: string;
    duration?: number;
    absolutePath?: string;
  },
): TimelineClip['source'] | null {
  const imageUrl = mediaFile.file
    ? createManagedRestoredImageUrl(clipId, mediaFile.file)
    : mediaFile.url;

  if (!imageUrl) {
    return null;
  }

  return {
    type: 'image',
    mediaFileId: serializedClip.mediaFileId,
    naturalDuration: serializedClip.naturalDuration || mediaFile.duration || duration,
    imageUrl,
    ...(mediaFile.absolutePath ? { filePath: mediaFile.absolutePath } : {}),
  };
}

export function createManagedRestoredModelSource(
  clipId: string,
  serializedClip: SerializableClip,
  duration: number,
  mediaFile: RestoredModelMediaFileInfo,
): NonNullable<TimelineClip['source']> | null {
  const reusableSource = createDataOnlyRestoredModelSource(
    serializedClip,
    duration,
    mediaFile,
  );
  if (reusableSource) {
    return reusableSource;
  }

  if (!mediaFile.file) {
    return null;
  }

  const modelUrl = blobUrlManager.create(clipId, mediaFile.file, 'model');
  return createDataOnlyRestoredModelSource(
    serializedClip,
    duration,
    mediaFile,
    modelUrl,
  );
}

export function createManagedRestoredGaussianSplatSource(
  clipId: string,
  serializedClip: SerializableClip,
  duration: number,
  mediaFile: RestoredGaussianSplatMediaFileInfo,
): NonNullable<TimelineClip['source']> | null {
  const reusableSource = createDataOnlyRestoredGaussianSplatSource(
    serializedClip,
    duration,
    mediaFile,
  );
  if (reusableSource) {
    return reusableSource;
  }

  if (!mediaFile.file) {
    return null;
  }

  const gaussianSplatUrl = blobUrlManager.create(clipId, mediaFile.file, 'file');
  return createDataOnlyRestoredGaussianSplatSource(
    serializedClip,
    duration,
    mediaFile,
    gaussianSplatUrl,
  );
}

export function createManagedRestoredGaussianAvatarSource(
  clipId: string,
  serializedClip: SerializableClip,
  duration: number,
  mediaFile: RestoredGaussianAvatarMediaFileInfo,
): NonNullable<TimelineClip['source']> | null {
  const reusableSource = createDataOnlyRestoredGaussianAvatarSource(
    serializedClip,
    duration,
    mediaFile,
  );
  if (reusableSource) {
    return reusableSource;
  }

  if (!mediaFile.file) {
    return null;
  }

  const gaussianAvatarUrl = blobUrlManager.create(clipId, mediaFile.file, 'model');
  return createDataOnlyRestoredGaussianAvatarSource(
    serializedClip,
    duration,
    mediaFile,
    gaussianAvatarUrl,
  );
}

export type RestoredSpatialSourceType = 'model' | 'gaussian-splat' | 'gaussian-avatar';

export type RestoredSpatialMediaFileInfo =
  RestoredModelMediaFileInfo &
  RestoredGaussianSplatMediaFileInfo &
  RestoredGaussianAvatarMediaFileInfo;

export function isRestoredSpatialSourceType(
  sourceType: SerializableClip['sourceType'] | undefined,
): sourceType is RestoredSpatialSourceType {
  return (
    sourceType === 'model' ||
    sourceType === 'gaussian-splat' ||
    sourceType === 'gaussian-avatar'
  );
}

export function createManagedRestoredSpatialSource(
  clipId: string,
  serializedClip: SerializableClip,
  duration: number,
  mediaFile: RestoredSpatialMediaFileInfo,
): NonNullable<TimelineClip['source']> | null {
  if (serializedClip.sourceType === 'model') {
    return createManagedRestoredModelSource(clipId, serializedClip, duration, mediaFile);
  }

  if (serializedClip.sourceType === 'gaussian-splat') {
    return createManagedRestoredGaussianSplatSource(clipId, serializedClip, duration, mediaFile);
  }

  if (serializedClip.sourceType === 'gaussian-avatar') {
    return createManagedRestoredGaussianAvatarSource(clipId, serializedClip, duration, mediaFile);
  }

  return null;
}

export function applyRestoredSpatialClipFields(
  clip: TimelineClip,
  serializedClip: SerializableClip,
  source?: NonNullable<TimelineClip['source']> | null,
): boolean {
  if (!isRestoredSpatialSourceType(serializedClip.sourceType)) {
    return false;
  }

  if (source) {
    clip.source = source;
  }

  if (serializedClip.sourceType === 'model') {
    applyRestoredNestedModelFields(clip, serializedClip);
  } else if (serializedClip.sourceType === 'gaussian-splat') {
    applyRestoredNestedGaussianSplatFields(clip);
  } else {
    applyRestoredNestedGaussianAvatarFields(clip);
  }

  return true;
}

export function applyManagedRestoredSpatialSource(
  clip: TimelineClip,
  serializedClip: SerializableClip,
  duration: number,
  mediaFile: RestoredSpatialMediaFileInfo,
  options: {
    applyFieldsWhenSourceMissing?: boolean;
  } = {},
): { handled: boolean; restored: boolean; source: NonNullable<TimelineClip['source']> | null } {
  if (!isRestoredSpatialSourceType(serializedClip.sourceType)) {
    return { handled: false, restored: false, source: null };
  }

  const source = createManagedRestoredSpatialSource(
    clip.id,
    serializedClip,
    duration,
    mediaFile,
  );
  if (source || options.applyFieldsWhenSourceMissing) {
    applyRestoredSpatialClipFields(clip, serializedClip, source);
  }

  return { handled: true, restored: !!source, source };
}

export function applyRestoredNestedModelFields(
  clip: TimelineClip,
  serializedClip: SerializableClip,
): void {
  clip.is3D = true;
  clip.meshType = serializedClip.meshType;
  clip.text3DProperties = serializedClip.text3DProperties
    ? { ...serializedClip.text3DProperties }
    : undefined;
  clip.isLoading = false;
}

export function applyRestoredNestedGaussianSplatFields(clip: TimelineClip): void {
  clip.is3D = true;
  clip.isLoading = false;
}

export function applyRestoredNestedGaussianAvatarFields(clip: TimelineClip): void {
  clip.is3D = true;
  clip.isLoading = false;
}

export function patchNestedClipTree(
  clips: readonly TimelineClip[],
  targetClipId: string,
  patch: RestoredRuntimePatch,
): { clips: TimelineClip[]; patched: boolean } {
  let patched = false;

  const nextClips = clips.map((clip) => {
    if (clip.id === targetClipId) {
      patched = true;
      return { ...clip, ...patch };
    }

    if (clip.nestedClips?.length) {
      const nestedResult = patchNestedClipTree(clip.nestedClips, targetClipId, patch);
      if (nestedResult.patched) {
        patched = true;
        return {
          ...clip,
          nestedClips: nestedResult.clips,
        };
      }
    }

    return clip;
  });

  return {
    clips: patched ? nextClips : clips as TimelineClip[],
    patched,
  };
}

export function patchNestedClipInCompositionClip(
  clips: readonly TimelineClip[],
  compClipId: string,
  nestedClipId: string,
  patch: RestoredRuntimePatch,
): { clips: TimelineClip[]; patched: boolean } {
  let patched = false;

  const nextClips = clips.map((clip) => {
    if (clip.id !== compClipId || !clip.nestedClips?.length) {
      return clip;
    }

    const nestedResult = patchNestedClipTree(clip.nestedClips, nestedClipId, patch);
    if (!nestedResult.patched) {
      return clip;
    }

    patched = true;
    return {
      ...clip,
      nestedClips: nestedResult.clips,
    };
  });

  return {
    clips: patched ? nextClips : clips as TimelineClip[],
    patched,
  };
}
