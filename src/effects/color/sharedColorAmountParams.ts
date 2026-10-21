import type { EffectParam } from '../types';

const amount = (defaultValue: number, min: number, max: number, renderMin: number, renderMax: number): EffectParam => ({
  type: 'number', label: 'Amount', default: defaultValue, min, max, step: 0.01, animatable: true, renderMin, renderMax,
});

/** One parameter contract shared by legacy controls and editable image graphs. */
// Brightness ±1 is the slider; up to ±4 still renders a meaningful (extreme) curve.
export const BRIGHTNESS_AMOUNT_PARAM = amount(0, -1, 1, -4, 4);
// Negative contrast or saturation has no tonal meaning (Invert is its own effect): clamped to 0.
export const CONTRAST_AMOUNT_PARAM = amount(1, 0, 3, 0, 10);
export const SATURATION_AMOUNT_PARAM = amount(1, 0, 3, 0, 10);
