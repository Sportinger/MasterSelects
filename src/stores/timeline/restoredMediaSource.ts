import type { TimelineClip } from './types';
import type { GaussianSplatSequenceData, ModelSequenceData, SerializableClip } from '../../types';
import {
  DEFAULT_GAUSSIAN_SPLAT_SETTINGS,
  resolveGaussianSplatSettingsForSource,
} from '../../engine/gaussian/types';
import {
  getGaussianSplatSequenceFrameRuntimeKey,
  getGaussianSplatSequenceFrameUrl,
  getGaussianSplatSequenceReferenceFrame,
  resolveGaussianSplatSequenceData,
} from '../../utils/gaussianSplatSequence';
import { getModelSequenceFrameUrl, resolveModelSequenceData } from '../../utils/modelSequence';

export type DataOnlyRestoredMediaType = 'video' | 'audio';

export type RestoredMediaFileInfo = {
  duration?: number;
  absolutePath?: string;
};

export type RestoredModelMediaFileInfo = RestoredMediaFileInfo & {
  name?: string;
  url?: string;
  file?: File;
  modelSequence?: ModelSequenceData;
};

export type RestoredGaussianSplatMediaFileInfo = RestoredMediaFileInfo & {
  name?: string;
  url?: string;
  file?: File;
  gaussianSplatSequence?: GaussianSplatSequenceData;
};

export type RestoredGaussianAvatarMediaFileInfo = RestoredMediaFileInfo & {
  url?: string;
  file?: File;
};

function isUsableModelFile(file: File | undefined): file is File {
  return !!file && (typeof file.size !== 'number' || file.size > 0);
}

export function getReusableModelUrl(
  mediaFile: Pick<RestoredModelMediaFileInfo, 'url' | 'file'> | null | undefined,
): string | undefined {
  const url = mediaFile?.url;
  if (!url) {
    return undefined;
  }

  if (url.startsWith('blob:') && !isUsableModelFile(mediaFile?.file)) {
    return undefined;
  }

  return url;
}

export function getReusableGaussianSplatUrl(
  mediaFile: Pick<RestoredGaussianSplatMediaFileInfo, 'url' | 'file'> | null | undefined,
): string | undefined {
  const url = mediaFile?.url;
  if (!url) {
    return undefined;
  }

  if (url.startsWith('blob:') && !isUsableModelFile(mediaFile?.file)) {
    return undefined;
  }

  return url;
}

export function getReusableGaussianAvatarUrl(
  mediaFile: Pick<RestoredGaussianAvatarMediaFileInfo, 'url' | 'file'> | null | undefined,
): string | undefined {
  const url = mediaFile?.url;
  if (!url) {
    return undefined;
  }

  if (url.startsWith('blob:') && !isUsableModelFile(mediaFile?.file)) {
    return undefined;
  }

  return url;
}

export function createDataOnlyRestoredMediaSource(
  serializedClip: Pick<SerializableClip, 'mediaFileId' | 'naturalDuration'>,
  fallbackDuration: number,
  mediaFile?: RestoredMediaFileInfo,
  sourceType: DataOnlyRestoredMediaType = 'video',
): NonNullable<TimelineClip['source']> {
  return {
    type: sourceType,
    naturalDuration: serializedClip.naturalDuration || mediaFile?.duration || fallbackDuration,
    mediaFileId: serializedClip.mediaFileId,
    ...(mediaFile?.absolutePath ? { filePath: mediaFile.absolutePath } : {}),
  };
}

export function createDataOnlyRestoredVideoSource(
  serializedClip: Pick<SerializableClip, 'mediaFileId' | 'naturalDuration'>,
  fallbackDuration: number,
  mediaFile?: RestoredMediaFileInfo,
): NonNullable<TimelineClip['source']> {
  return createDataOnlyRestoredMediaSource(serializedClip, fallbackDuration, mediaFile, 'video');
}

export function createDataOnlyRestoredModelSource(
  serializedClip: Pick<
    SerializableClip,
    | 'mediaFileId'
    | 'naturalDuration'
    | 'modelSequence'
    | 'threeDEffectorsEnabled'
    | 'meshType'
    | 'text3DProperties'
  >,
  fallbackDuration: number,
  mediaFile?: RestoredModelMediaFileInfo,
  fallbackModelUrl?: string,
): NonNullable<TimelineClip['source']> | null {
  const modelSequence = resolveModelSequenceData(serializedClip.modelSequence, mediaFile?.modelSequence);
  const modelUrl = getModelSequenceFrameUrl(
    modelSequence,
    0,
    fallbackModelUrl ?? getReusableModelUrl(mediaFile),
  );

  if (!modelUrl) {
    return null;
  }

  return {
    type: 'model',
    modelUrl,
    modelFileName: mediaFile?.name,
    ...(modelSequence ? { modelSequence } : {}),
    naturalDuration: serializedClip.naturalDuration || mediaFile?.duration || fallbackDuration || 3600,
    mediaFileId: serializedClip.mediaFileId,
    threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
    ...(serializedClip.meshType ? { meshType: serializedClip.meshType } : {}),
    ...(serializedClip.text3DProperties ? { text3DProperties: { ...serializedClip.text3DProperties } } : {}),
  };
}

export function createDataOnlyRestoredGaussianSplatSource(
  serializedClip: Pick<
    SerializableClip,
    | 'mediaFileId'
    | 'naturalDuration'
    | 'gaussianSplatSequence'
    | 'gaussianSplatSettings'
    | 'threeDEffectorsEnabled'
  >,
  fallbackDuration: number,
  mediaFile?: RestoredGaussianSplatMediaFileInfo,
  fallbackGaussianSplatUrl?: string,
): NonNullable<TimelineClip['source']> | null {
  const gaussianSplatSequence = resolveGaussianSplatSequenceData(
    serializedClip.gaussianSplatSequence,
    mediaFile?.gaussianSplatSequence,
  );
  const fallbackUrl = fallbackGaussianSplatUrl ?? getReusableGaussianSplatUrl(mediaFile);
  const gaussianSplatUrl = getGaussianSplatSequenceFrameUrl(gaussianSplatSequence, 0, fallbackUrl);

  if (!gaussianSplatUrl) {
    return null;
  }

  const referenceFrame = getGaussianSplatSequenceReferenceFrame(gaussianSplatSequence);
  const gaussianSplatFileName =
    referenceFrame?.name ??
    mediaFile?.file?.name ??
    mediaFile?.name;

  return {
    type: 'gaussian-splat',
    gaussianSplatUrl,
    gaussianSplatFileName,
    gaussianSplatRuntimeKey: getGaussianSplatSequenceFrameRuntimeKey(
      gaussianSplatSequence,
      0,
      gaussianSplatUrl,
    ),
    ...(gaussianSplatSequence ? { gaussianSplatSequence } : {}),
    gaussianSplatSettings:
      resolveGaussianSplatSettingsForSource(serializedClip.gaussianSplatSettings, {
        fileName: gaussianSplatFileName,
        sequence: gaussianSplatSequence,
      }) || DEFAULT_GAUSSIAN_SPLAT_SETTINGS,
    naturalDuration: serializedClip.naturalDuration || mediaFile?.duration || fallbackDuration || 3600,
    mediaFileId: serializedClip.mediaFileId,
    threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
  };
}

export function createDataOnlyRestoredGaussianAvatarSource(
  serializedClip: Pick<
    SerializableClip,
    | 'mediaFileId'
    | 'naturalDuration'
    | 'gaussianBlendshapes'
  >,
  fallbackDuration: number,
  mediaFile?: RestoredGaussianAvatarMediaFileInfo,
  fallbackGaussianAvatarUrl?: string,
): NonNullable<TimelineClip['source']> | null {
  const gaussianAvatarUrl = fallbackGaussianAvatarUrl ?? getReusableGaussianAvatarUrl(mediaFile);
  if (!gaussianAvatarUrl) {
    return null;
  }

  return {
    type: 'gaussian-avatar',
    gaussianAvatarUrl,
    gaussianBlendshapes: serializedClip.gaussianBlendshapes || {},
    naturalDuration: serializedClip.naturalDuration || mediaFile?.duration || fallbackDuration || 3600,
    mediaFileId: serializedClip.mediaFileId,
  };
}
