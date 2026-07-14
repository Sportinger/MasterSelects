import { createTimelineMathSceneCanvasRuntime, createTimelineTransitionOverlayCanvasRuntime } from '../../../services/timeline/timelineGeneratedCanvasRuntime';
import type { TimelineClip } from '../../../types/timeline';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../mediaStore/types';
import { DEFAULT_LIGHT_CLIP_SETTINGS, mergeLightClipSettings } from '../../../types/light';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../../types/splatEffector';
import type { ClipboardClipData } from '../types';

const SYNC_RESTORED_SOURCE_TYPES = new Set([
  'text',
  'solid',
  'math-scene',
  'transition-overlay',
  'camera',
  'light',
  'splat-effector',
]);

export function clipRequiresAsyncMediaLoad(clipData: ClipboardClipData): boolean {
  return !clipData.isComposition &&
    !SYNC_RESTORED_SOURCE_TYPES.has(clipData.sourceType) &&
    !isPrimitiveMeshClip(clipData) &&
    !isMotionClip(clipData);
}

function isPrimitiveMeshClip(clipData: ClipboardClipData): boolean {
  return clipData.sourceType === 'model' && !!clipData.meshType;
}

function isMotionClip(clipData: ClipboardClipData): boolean {
  return clipData.sourceType === 'motion-shape' ||
    clipData.sourceType === 'motion-null' ||
    clipData.sourceType === 'motion-adjustment';
}

export function createPastedClipSource(
  clipData: ClipboardClipData,
  text3DProperties: TimelineClip['text3DProperties'],
): TimelineClip['source'] {
  if (isPrimitiveMeshClip(clipData)) {
    return {
      type: 'model',
      meshType: clipData.meshType,
      modelPrimitiveIndex: clipData.modelPrimitiveIndex,
      modelMaterialSettings: clipData.modelMaterialSettings,
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? Number.MAX_SAFE_INTEGER,
      threeDEffectorsEnabled: clipData.threeDEffectorsEnabled ?? true,
      ...(text3DProperties ? { text3DProperties } : {}),
    };
  }
  if (clipData.sourceType === 'camera') {
    return {
      type: 'camera',
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? Number.MAX_SAFE_INTEGER,
      cameraSettings: clipData.cameraSettings ? { ...clipData.cameraSettings } : { ...DEFAULT_SCENE_CAMERA_SETTINGS },
    };
  }
  if (clipData.sourceType === 'light') {
    return {
      type: 'light',
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? Number.MAX_SAFE_INTEGER,
      lightSettings: mergeLightClipSettings(clipData.lightSettings ?? DEFAULT_LIGHT_CLIP_SETTINGS),
    };
  }
  if (clipData.sourceType === 'splat-effector') {
    return {
      type: 'splat-effector',
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? Number.MAX_SAFE_INTEGER,
      splatEffectorSettings: clipData.splatEffectorSettings
        ? { ...clipData.splatEffectorSettings }
        : { ...DEFAULT_SPLAT_EFFECTOR_SETTINGS },
    };
  }
  if (clipData.sourceType === 'solid') {
    return { type: 'solid', mediaFileId: clipData.mediaFileId, naturalDuration: clipData.duration };
  }
  if (clipData.sourceType === 'text') {
    return { type: 'text', mediaFileId: clipData.mediaFileId, naturalDuration: clipData.naturalDuration ?? clipData.duration };
  }
  if (clipData.sourceType === 'math-scene' && clipData.mathScene) {
    return {
      type: 'math-scene',
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? clipData.duration,
      textCanvas: createTimelineMathSceneCanvasRuntime({ mathScene: clipData.mathScene, duration: clipData.duration }),
    };
  }
  if (clipData.sourceType === 'transition-overlay' && clipData.transitionOverlay) {
    return {
      type: 'transition-overlay',
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? clipData.duration,
      textCanvas: createTimelineTransitionOverlayCanvasRuntime({ overlay: clipData.transitionOverlay }),
      transitionOverlay: structuredClone(clipData.transitionOverlay),
    };
  }
  if (isMotionClip(clipData) && clipData.motion) {
    return { type: clipData.sourceType, mediaFileId: clipData.mediaFileId, naturalDuration: clipData.naturalDuration ?? clipData.duration };
  }
  if (isVectorAnimationSourceType(clipData.sourceType) && clipData.mediaFileId) {
    return {
      type: clipData.sourceType,
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? clipData.duration,
      vectorAnimationSettings: clipData.vectorAnimationSettings,
    };
  }
  return clipData.mediaFileId
    ? {
        type: clipData.sourceType,
        mediaFileId: clipData.mediaFileId,
        naturalDuration: clipData.naturalDuration,
        modelPrimitiveIndex: clipData.sourceType === 'model' ? clipData.modelPrimitiveIndex : undefined,
        modelMaterialSettings: clipData.sourceType === 'model' ? clipData.modelMaterialSettings : undefined,
        threeDEffectorsEnabled: clipData.threeDEffectorsEnabled ?? true,
      }
    : null;
}
