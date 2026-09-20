import type { EffectParam } from '../types';

const number = (label: string, defaultValue: number, min: number, max: number, step: number): EffectParam =>
  ({ type: 'number', label, default: defaultValue, min, max, step, animatable: true });

/** Shared by legacy effect controls and canonical pointwise graphs. */
export const THRESHOLD_PARAMS = { level: number('Level', 0.5, 0, 1, 0.01) } satisfies Record<string, EffectParam>;
export const POSTERIZE_PARAMS = { levels: number('Levels', 6, 2, 32, 1) } satisfies Record<string, EffectParam>;
