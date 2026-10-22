import type { EffectParam } from '../../types';

/** Shared authoring schema; safe to consume without importing a shader. */
export const GAUSSIAN_BLUR_PARAMS = {
  radius: { type: 'number', label: 'Radius', default: 10, min: 0, max: 50, step: 0.1, unit: ' px', animatable: true },
  // The separable kernel picks its own tap count; old projects keep their stored value.
  samples: { type: 'number', label: 'Samples', default: 5, min: 1, max: 64, step: 1, animatable: false, hidden: true,
    deprecated: 'Gaussian Blur now chooses its taps from the radius automatically; samples has no effect.' },
} satisfies Record<string, EffectParam>;
