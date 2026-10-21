import shader from './shader.wgsl?raw';
import { createCatalogEffect } from '../_shared/catalogEffect';
import type { EffectParam } from '../types';
import { clampedValueNotes } from './analogParamWarnings';
import { FILM_PRISM_GRAIN_SIZE_RANGE, FILM_PRISM_MODE_OPTIONS } from './filmPrismLimits';

const params: Record<string, EffectParam> = {
  amount: { type: 'number', label: 'Fringe', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true },
  mode: { type: 'select', label: 'Shape', default: 'lens', options: FILM_PRISM_MODE_OPTIONS, group: 'Fringe', graphOnly: true },
  angle: { type: 'number', label: 'Prism Angle', default: 0, min: -180, max: 180, step: 1, animatable: true, group: 'Fringe', graphOnly: true },
  grain: { type: 'number', label: 'Grain', default: 0.3, min: 0, max: 1, step: 0.01, animatable: true, group: 'Grain', graphOnly: true },
  grainSize: { type: 'number', label: 'Grain Size', default: 1.2, min: 0.5, max: 4, step: 0.1, animatable: true, group: 'Grain', graphOnly: true },
  speed: { type: 'number', label: 'Grain Speed', default: 1, min: 0, max: 5, step: 0.05, animatable: true, group: 'Grain' },
};
const ranges = { amount: [0, 1], grain: [0, 1], grainSize: FILM_PRISM_GRAIN_SIZE_RANGE } as const;

export const filmPrism = createCatalogEffect({
  id: 'film-prism', name: 'Film Prism', category: 'analog', shader, entryPoint: 'filmPrismFragment', animated: true,
  params,
  retired: {
    scale: 'Film Prism has no scale; the value is ignored.',
    colorA: 'Film Prism has no ink color; the value is ignored.',
    colorB: 'Film Prism has no paper color; the value is ignored.',
  },
  // Effects without Grain run the original Film Prism graph (saved before the 2026-10 rebuild).
  paramWarnings: values => {
    if (values.grain === undefined) return [];
    const notes = clampedValueNotes(params, values, ranges);
    if (values.mode === 'lens' && typeof values.angle === 'number' && values.angle !== 0) notes.push('Prism Angle only acts in the Prism shape; Lens fringes spread out from the centre.');
    return notes;
  },
});
