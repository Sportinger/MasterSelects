import type { TimelineClip } from '../../../stores/timeline/types';
import { DEFAULT_TEXT_3D_PROPERTIES } from '../../../stores/timeline/constants';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { Layer } from '../../../types/layers';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS, type GaussianSplatSettings } from '../../gaussian/types';
import {
  getGaussianSplatSequenceFrame,
  getGaussianSplatSequenceFrameRuntimeKey,
  getGaussianSplatSequenceFrameUrl,
  resolveGaussianSplatSequenceData,
} from '../../../utils/gaussianSplatSequence';
import { getModelSequenceFrameUrl, resolveModelSequenceData } from '../../../utils/modelSequence';
import { getInterpolatedMotionLayer } from '../../../utils/motionInterpolation';
import { getReusableModelUrl } from '../../../stores/timeline/restoredMediaSource';
import { mergeLightClipSettings } from '../../../types/light';
import { getInterpolatedClipLightSettings } from '../../../utils/keyframeInterpolation';
import type { Keyframe } from '../../../types/keyframes';
import type { ExportClipStateLike, FrameContextLike } from './contracts';

export function getClipMeshType(clip: TimelineClip) {
  return clip.meshType ?? clip.source?.meshType;
}

export function getClipMediaFile(clip: TimelineClip) {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (!mediaFileId) {
    return null;
  }
  return useMediaStore.getState().files.find((file) => file.id === mediaFileId) ?? null;
}

export function getClipText3DProperties(clip: TimelineClip) {
  const meshType = getClipMeshType(clip);
  if (meshType === 'text3d') {
    return clip.text3DProperties ?? clip.source?.text3DProperties ?? DEFAULT_TEXT_3D_PROPERTIES;
  }
  return clip.text3DProperties ?? clip.source?.text3DProperties;
}

export function getCompositionSize(compositionId: string | undefined): { width: number; height: number } {
  const composition = useMediaStore.getState().compositions.find(c => c.id === compositionId);
  return {
    width: composition?.width || 1920,
    height: composition?.height || 1080,
  };
}

export function buildModelSource(clip: TimelineClip, sourceTime: number): Layer['source'] {
  const meshType = getClipMeshType(clip);
  const text3DProperties = getClipText3DProperties(clip);
  const mediaFile = getClipMediaFile(clip);
  const modelSequence = resolveModelSequenceData(
    clip.source?.modelSequence,
    mediaFile?.modelSequence,
  );

  return {
    type: 'model',
    modelUrl: getModelSequenceFrameUrl(modelSequence, sourceTime, clip.source?.modelUrl ?? getReusableModelUrl(mediaFile)),
    modelPrimitiveIndex: clip.source?.modelPrimitiveIndex,
    modelMaterialSettings: clip.source?.modelMaterialSettings,
    ...(modelSequence ? { modelSequence } : {}),
    ...(meshType ? { meshType } : {}),
    ...(text3DProperties ? { text3DProperties } : {}),
  };
}

export function buildGaussianSplatSource(clip: TimelineClip, clipLocalTime: number): Layer['source'] {
  const mediaFile = getClipMediaFile(clip);
  const gaussianSplatSequence = resolveGaussianSplatSequenceData(
    clip.source?.gaussianSplatSequence,
    mediaFile?.gaussianSplatSequence,
  );
  const sequenceFrame = getGaussianSplatSequenceFrame(gaussianSplatSequence, clipLocalTime);
  const fileName =
    sequenceFrame?.name ??
    clip.source?.gaussianSplatFileName ??
    mediaFile?.file?.name ??
    clip.file?.name ??
    mediaFile?.name ??
    clip.name;
  const fileHash = gaussianSplatSequence
    ? undefined
    : (clip.source?.gaussianSplatFileHash ?? mediaFile?.fileHash);
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;

  return {
    type: 'gaussian-splat',
    file:
      sequenceFrame?.file ??
      mediaFile?.file ??
      clip.source?.file ??
      clip.file,
    gaussianSplatUrl: getGaussianSplatSequenceFrameUrl(gaussianSplatSequence, clipLocalTime, clip.source?.gaussianSplatUrl),
    gaussianSplatFileName: fileName,
    ...(fileHash ? { gaussianSplatFileHash: fileHash } : {}),
    gaussianSplatRuntimeKey: getGaussianSplatSequenceFrameRuntimeKey(
      gaussianSplatSequence,
      clipLocalTime,
      clip.source?.gaussianSplatRuntimeKey ??
        fileHash ??
        fileName ??
        clip.source?.gaussianSplatUrl ??
        clip.id,
    ),
    ...(gaussianSplatSequence ? { gaussianSplatSequence } : {}),
    ...(mediaFileId ? { mediaFileId } : {}),
    gaussianSplatSettings: buildExportGaussianSplatSettings(clip.source?.gaussianSplatSettings),
    mediaTime: clipLocalTime,
  };
}

export function buildMotionSource(clip: TimelineClip, clipLocalTime: number): Layer['source'] | null {
  if (clip.source?.type !== 'motion-shape' || clip.motion?.kind !== 'shape') {
    return null;
  }

  const keyframes = useTimelineStore.getState().clipKeyframes.get(clip.id) ?? [];
  return {
    type: 'motion',
    motion: getInterpolatedMotionLayer(clip, keyframes, clipLocalTime) ?? clip.motion,
  };
}

export function buildLightSource(
  clip: TimelineClip,
  clipLocalTime: number,
  ctx?: FrameContextLike,
  keyframes: readonly Keyframe[] = (clip as TimelineClip & { keyframes?: readonly Keyframe[] }).keyframes ?? [],
): Layer['source'] {
  const baseSettings = mergeLightClipSettings(clip.source?.type === 'light' ? clip.source.lightSettings : undefined);
  return {
    type: 'light',
    lightSettings: mergeLightClipSettings(
      ctx?.getInterpolatedLightSettings?.(clip.id, clipLocalTime)
        ?? getInterpolatedClipLightSettings([...keyframes], clipLocalTime, baseSettings),
    ),
  };
}

export function getExportVideoElement(
  clip: TimelineClip,
  clipStates: Map<string, ExportClipStateLike>,
): HTMLVideoElement | null {
  return clipStates.get(clip.id)?.preciseVideoElement ?? clip.source?.videoElement ?? null;
}

export function getExportImageElement(
  clip: TimelineClip,
  clipStates: Map<string, ExportClipStateLike>,
): HTMLImageElement | null {
  return clipStates.get(clip.id)?.exportImageElement ?? clip.source?.imageElement ?? null;
}

export function getVectorAnimationSettingsForExport(
  clip: TimelineClip,
  clipLocalTime: number,
  ctx?: FrameContextLike,
) {
  return ctx?.getInterpolatedVectorAnimationSettings?.(clip.id, clipLocalTime)
    ?? useTimelineStore.getState().getInterpolatedVectorAnimationSettings(clip.id, clipLocalTime);
}

function buildExportGaussianSplatSettings(
  settings: GaussianSplatSettings | undefined,
): GaussianSplatSettings {
  const baseSettings = settings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS;
  return {
    ...baseSettings,
    render: {
      ...DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render,
      ...baseSettings.render,
      useNativeRenderer: true,
      // Export should favor completeness and stable depth ordering over preview performance.
      maxSplats: 0,
      sortFrequency: 1,
    },
    temporal: {
      ...DEFAULT_GAUSSIAN_SPLAT_SETTINGS.temporal,
      ...baseSettings.temporal,
    },
    particle: {
      ...DEFAULT_GAUSSIAN_SPLAT_SETTINGS.particle,
      ...baseSettings.particle,
    },
  };
}
