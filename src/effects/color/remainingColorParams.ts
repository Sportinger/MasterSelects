import type { EffectParam } from '../types';

const number = (label: string, defaultValue: number, min: number, max: number, step = 0.01, render?: [number, number]): EffectParam =>
  ({ type: 'number', label, default: defaultValue, min, max, step, animatable: true,
    ...(render ? { renderMin: render[0], renderMax: render[1] } : {}) });

/** Parameter schemas shared by legacy controls and canonical image graphs. */
export const EXPOSURE_PARAMS = {
  exposure: { ...number('Exposure', 0, -3, 3, 0.1, [-20, 20]), unit: ' EV' }, offset: number('Offset', 0, -0.5, 0.5),
  // The floor matches the slider: gamma 0.2 is x^5, already very dark.
  gamma: { ...number('Gamma', 1, 0.2, 3, 0.01, [0.2, 10]), renderMinLook: 'very dark' },
} satisfies Record<string, EffectParam>;
export const LEVELS_PARAMS = {
  inputBlack: number('Input Black', 0, 0, 1), inputWhite: number('Input White', 1, 0, 1),
  gamma: { ...number('Gamma', 1, 0.1, 3, 0.01, [0.1, 10]), renderMinLook: 'almost black' },
  outputBlack: number('Output Black', 0, 0, 1), outputWhite: number('Output White', 1, 0, 1),
} satisfies Record<string, EffectParam>;
// Stored in turns (0.5 = 180°) since the first release; inspectors show degrees.
export const HUE_SHIFT_PARAMS = { shift: { ...number('Shift', 0, 0, 1, 1 / 360), displayScale: 360, unit: '°' } } satisfies Record<string, EffectParam>;
export const TEMPERATURE_PARAMS = {
  temperature: number('Temperature', 0, -1, 1, 0.01, [-4, 4]), tint: number('Tint', 0, -1, 1, 0.01, [-4, 4]),
} satisfies Record<string, EffectParam>;
export const VIBRANCE_PARAMS = { amount: number('Amount', 0, -1, 1, 0.01, [-1, 4]) } satisfies Record<string, EffectParam>;
