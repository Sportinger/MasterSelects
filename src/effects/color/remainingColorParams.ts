import type { EffectParam } from '../types';

const number = (label: string, defaultValue: number, min: number, max: number, step = 0.01): EffectParam =>
  ({ type: 'number', label, default: defaultValue, min, max, step, animatable: true });

/** Parameter schemas shared by legacy controls and canonical image graphs. */
export const EXPOSURE_PARAMS = {
  exposure: number('Exposure (EV)', 0, -3, 3, 0.1), offset: number('Offset', 0, -0.5, 0.5), gamma: number('Gamma', 1, 0.2, 3),
} satisfies Record<string, EffectParam>;
export const LEVELS_PARAMS = {
  inputBlack: number('Input Black', 0, 0, 1), inputWhite: number('Input White', 1, 0, 1), gamma: number('Gamma', 1, 0.1, 3),
  outputBlack: number('Output Black', 0, 0, 1), outputWhite: number('Output White', 1, 0, 1),
} satisfies Record<string, EffectParam>;
export const HUE_SHIFT_PARAMS = { shift: number('Shift', 0, 0, 1) } satisfies Record<string, EffectParam>;
export const TEMPERATURE_PARAMS = {
  temperature: number('Temperature', 0, -1, 1), tint: number('Tint', 0, -1, 1),
} satisfies Record<string, EffectParam>;
export const VIBRANCE_PARAMS = { amount: number('Amount', 0, -1, 1) } satisfies Record<string, EffectParam>;
