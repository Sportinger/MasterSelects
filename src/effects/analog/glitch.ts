import shader from './shader.wgsl?raw';
import { createCatalogEffect } from '../_shared/catalogEffect';
import type { EffectParam } from '../types';
import { clampedValueNotes } from './analogParamWarnings';
import { GLITCH_BAND_RANGE, GLITCH_SEED_RANGE } from './glitchLimits';

const params: Record<string, EffectParam> = {
  // Original Glitch (saved before the 2026-10 rebuild) only: number of torn bands.
  scale: { type: 'number', label: 'Scale', default: 14, min: 2, max: 80, step: 1, animatable: true, group: 'Pattern' },
  amount: { type: 'number', label: 'Intensity', default: 0.6, min: 0, max: 1, step: 0.01, animatable: true },
  density: { type: 'number', label: 'Density', default: 0.35, min: 0, max: 1, step: 0.01, animatable: true, graphOnly: true },
  bands: { type: 'number', label: 'Bands', default: 16, min: 2, max: 80, step: 1, animatable: true, group: 'Pattern', graphOnly: true },
  split: { type: 'number', label: 'RGB Split', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true, group: 'Pattern', graphOnly: true },
  speed: { type: 'number', label: 'Speed', default: 1, min: 0, max: 5, step: 0.05, animatable: true, group: 'Motion' },
  seed: { type: 'number', label: 'Seed', default: 0, min: 0, max: 999, step: 1, animatable: false, group: 'Motion', graphOnly: true },
};
const ranges = { amount: [0, 1], density: [0, 1], bands: GLITCH_BAND_RANGE, split: [0, 2], seed: GLITCH_SEED_RANGE } as const;

export const glitch = createCatalogEffect({
  id: 'glitch', name: 'Glitch', category: 'analog', shader, entryPoint: 'glitchFragment', animated: true,
  params,
  retired: {
    scale: 'Glitch sets its rows with Bands; Scale only acts on Glitch effects saved before the 2026-10 rebuild.',
    angle: 'Glitch has no angle; the value is ignored.',
    colorA: 'Glitch has no ink color; the value is ignored.',
    colorB: 'Glitch has no paper color; the value is ignored.',
  },
  // Effects without Density run the original Glitch graph (saved before the 2026-10 rebuild).
  paramWarnings: values => values.density === undefined ? [] : clampedValueNotes(params, values, ranges),
});
