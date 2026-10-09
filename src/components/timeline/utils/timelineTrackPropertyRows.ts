import type { AnimatableProperty, ClipMask } from '../../../types';
import {
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
} from '../../../types/vectorAnimation';

export type TimelineTrackPropertyClip = {
  id: string;
  startTime: number;
  duration: number;
  is3D?: boolean;
  masks?: ClipMask[];
  effects?: Array<{ id: string; name: string; params: Record<string, unknown> }>;
  source?: {
    type?: string;
    gaussianSplatSettings?: {
      render?: {
        useNativeRenderer?: boolean;
      };
    };
  } | null;
};

export const usesTimelineTrackCameraPropertyModel = (
  clip: TimelineTrackPropertyClip | null | undefined,
): boolean => {
  if (!clip?.source) return false;
  return clip.source.type === 'camera';
};

export const shouldHideTimelineTrack3DOnlyProperties = (
  clip: TimelineTrackPropertyClip | null | undefined,
): boolean => {
  return !clip?.is3D && !usesTimelineTrackCameraPropertyModel(clip);
};

export const getTimelineTrackTransformPropertyOrder = (
  clip: TimelineTrackPropertyClip | null | undefined,
): string[] => (
  usesTimelineTrackCameraPropertyModel(clip)
    ? ['camera.fov', 'camera.near', 'camera.far', 'camera.resolutionWidth', 'camera.resolutionHeight', 'camera.exposure', 'camera.fStop', 'camera.focusDistance', 'camera.shutterAngle', 'camera.shakeAmount', 'camera.shakeFrequency', 'camera.shakeSeed', 'opacity', 'position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z']
    : ['opacity', 'position.x', 'position.y', 'position.z', 'scale.all', 'scale.x', 'scale.y', 'scale.z', 'rotation.x', 'rotation.y', 'rotation.z']
);

export const sortTimelineTrackPropertyRows = (
  properties: Iterable<string>,
  selectedClip: TimelineTrackPropertyClip | null | undefined,
): AnimatableProperty[] => (
  Array.from(properties)
    .sort((a, b) => {
      const order = getTimelineTrackTransformPropertyOrder(selectedClip);
      const aIdx = order.indexOf(a);
      const bIdx = order.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      const aLottieState = parseVectorAnimationStateProperty(a);
      const bLottieState = parseVectorAnimationStateProperty(b);
      if (aLottieState && bLottieState) return 0;
      if (aLottieState) return -1;
      if (bLottieState) return 1;
      const aLottieInput = parseVectorAnimationInputProperty(a);
      const bLottieInput = parseVectorAnimationInputProperty(b);
      if (aLottieInput && bLottieInput) return aLottieInput.inputName.localeCompare(bLottieInput.inputName);
      if (aLottieInput) return -1;
      if (bLottieInput) return 1;
      return a.localeCompare(b);
    }) as AnimatableProperty[]
);

export const resolveTimelineTrackPenKeyframeValue = (
  keyframes: Array<{ time: number; value: number }>,
  time: number,
): number => {
  const sorted = keyframes.toSorted((a, b) => a.time - b.time);
  if (sorted.length === 0) return 0;
  if (time <= sorted[0].time) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (time >= last.time) return last.value;

  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index];
    if (time > next.time) continue;
    const previous = sorted[index - 1];
    const span = Math.max(0.0001, next.time - previous.time);
    const progress = Math.max(0, Math.min(1, (time - previous.time) / span));
    return previous.value + (next.value - previous.value) * progress;
  }

  return last.value;
};
