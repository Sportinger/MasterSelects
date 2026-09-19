import type { ClipMask, ColorCorrectionState } from '../../../types';

export type KeyframeTrackClip = {
  id: string;
  startTime: number;
  duration: number;
  is3D?: boolean;
  mediaFileId?: string;
  effects?: Array<{ id: string; type?: string; name: string; params: Record<string, unknown> }>;
  colorCorrection?: ColorCorrectionState;
  masks?: ClipMask[];
  flock?: import('../../../types/flock').FlockDefinition;
  source?: {
    type?: string;
    mediaFileId?: string;
    cameraSettings?: import('../../../stores/mediaStore/types').SceneCameraSettings;
    vectorAnimationSettings?: import('../../../types/vectorAnimation').VectorAnimationClipSettings;
    gaussianSplatSettings?: {
      render?: {
        useNativeRenderer?: boolean;
      };
    };
  } | null;
};

export type HeaderKeyframe = {
  id: string;
  time: number;
  property: string;
  value: number;
  easing: string;
};

export const usesCameraPropertyModel = (clip: KeyframeTrackClip | null | undefined): boolean => {
  if (!clip?.source) return false;
  return clip.source.type === 'camera';
};

export const shouldHide3DOnlyProperties = (clip: KeyframeTrackClip | null | undefined): boolean => {
  return !clip?.is3D && !usesCameraPropertyModel(clip);
};

export function getTimelineHeaderTransformPropertyOrder(
  clip: KeyframeTrackClip | null | undefined,
): string[] {
  return usesCameraPropertyModel(clip)
    ? ['camera.fov', 'camera.near', 'camera.far', 'camera.resolutionWidth', 'camera.resolutionHeight', 'opacity', 'position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z']
    : ['opacity', 'position.x', 'position.y', 'position.z', 'scale.all', 'scale.x', 'scale.y', 'scale.z', 'rotation.x', 'rotation.y', 'rotation.z'];
}
