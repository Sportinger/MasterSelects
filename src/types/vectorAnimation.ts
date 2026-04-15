export type VectorAnimationProvider = 'lottie' | 'rive';

export interface VectorAnimationMetadata {
  provider: VectorAnimationProvider;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  totalFrames?: number;
  animationNames?: string[];
  defaultAnimationName?: string;
  artboardNames?: string[];
  stateMachineNames?: string[];
}

export interface VectorAnimationClipSettings {
  loop: boolean;
  endBehavior: 'hold' | 'clear' | 'loop';
  fit: 'contain' | 'cover' | 'fill';
  backgroundColor?: string;
  animationName?: string;
  artboard?: string;
  stateMachineName?: string;
}

export const DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS: VectorAnimationClipSettings = {
  loop: false,
  endBehavior: 'hold',
  fit: 'contain',
};

export function mergeVectorAnimationSettings(
  sourceSettings?: VectorAnimationClipSettings,
): VectorAnimationClipSettings {
  return {
    ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
    ...sourceSettings,
  };
}

export function shouldLoopVectorAnimation(
  sourceSettings?: VectorAnimationClipSettings,
): boolean {
  const settings = mergeVectorAnimationSettings(sourceSettings);
  return settings.loop || settings.endBehavior === 'loop';
}
