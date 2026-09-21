import type { EffectParam } from '../../types';

/** Shared authoring schema; safe to consume without importing a shader. */
export const GAUSSIAN_BLUR_PARAMS = {
  radius: { type: 'number', label: 'Radius', default: 10, min: 0, max: 50, step: 1, animatable: true },
  samples: { type: 'number', label: 'Samples', default: 5, min: 1, max: 64, step: 1, animatable: false, quality: true },
} satisfies Record<string, EffectParam>;
