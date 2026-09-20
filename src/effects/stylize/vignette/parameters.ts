import type { EffectParam } from '../../types';

const number = (label: string, defaultValue: number, min: number, max: number): EffectParam => ({
  type: 'number', label, default: defaultValue, min, max, step: 0.01, animatable: true,
});

/** Shared by the fullscreen effect definition and its canonical contextual graph. */
export const VIGNETTE_PARAMS = {
  amount: number('Amount', 0.5, 0, 1),
  size: number('Size', 0.5, 0, 1.5),
  softness: number('Softness', 0.5, 0, 1),
  roundness: number('Roundness', 1, 0.5, 2),
} satisfies Record<string, EffectParam>;
