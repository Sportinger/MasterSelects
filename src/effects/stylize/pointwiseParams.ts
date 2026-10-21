import type { EffectParam } from '../types';

const number = (label: string, defaultValue: number, min: number, max: number, step: number): EffectParam =>
  ({ type: 'number', label, default: defaultValue, min, max, step, animatable: true });
// Softness and Brightness Only are read only by the current graphs (2026-10-21); graphs saved earlier keep their hard steps.
const softness = (max: number): EffectParam => ({ ...number('Softness', 0, 0, max, 0.01), graphOnly: true });

/** Shared by legacy effect controls and canonical pointwise graphs (see pointwiseModel.ts). */
export const THRESHOLD_PARAMS = { level: number('Level', 0.5, 0, 1, 0.01), softness: softness(0.5) } satisfies Record<string, EffectParam>;
export const POSTERIZE_PARAMS = { levels: number('Levels', 6, 2, 32, 1), softness: softness(1),
  // Posterize the brightness and keep hue and saturation (current graphs only).
  brightnessOnly: { type: 'boolean', label: 'Brightness Only', default: false, graphOnly: true } } satisfies Record<string, EffectParam>;
