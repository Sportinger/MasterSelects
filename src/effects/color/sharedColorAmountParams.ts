import type { EffectParam } from '../types';

const amount = (defaultValue: number, min: number, max: number): EffectParam => ({
  type: 'number', label: 'Amount', default: defaultValue, min, max, step: 0.01, animatable: true,
});

/** One parameter contract shared by legacy controls and editable image graphs. */
export const BRIGHTNESS_AMOUNT_PARAM = amount(0, -1, 1);
export const CONTRAST_AMOUNT_PARAM = amount(1, 0, 3);
export const SATURATION_AMOUNT_PARAM = amount(1, 0, 3);
