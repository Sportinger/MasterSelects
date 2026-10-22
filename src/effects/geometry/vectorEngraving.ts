// Vector Engraving (registry id vector-tiling): its own control and presets. The recipe is the editable graph in
// src/services/operators/geometryFragmentEffectGraphs.ts (vectorTiling) and its shader twin vectorTilingFragment;
// Line Spacing (scale) counts pixels of a 1080p frame (shorter side).
import type { EffectParam, EffectPreset } from '../types';

/** Vector Engraving's own control; index.ts relabels the shared Scale as Line Spacing (px). Shares Crosshatch's key,
 * so a Style switch between the two carries it. */
export const VECTOR_ENGRAVING_PARAMS: Record<string, EffectParam> = {
  // Saved projects from before Line Weight keep their fixed, thin lines (legacyDefault 0).
  weight: {
    type: 'number', label: 'Line Weight', default: 0.7, min: 0, max: 1, step: 0.01, renderMin: 0, renderMax: 1,
    animatable: true, group: 'Pattern', legacyDefault: 0,
  },
};

export const VECTOR_ENGRAVING_PRESETS: readonly EffectPreset[] = [
  // Fine dark-green lines on pale paper: the portrait on a banknote.
  { id: 'banknote', name: 'Banknote', params: { scale: 6, weight: 0.85, angle: 0, amount: 1, colorA: '#1d3a2c', colorB: '#eef0e1' } },
  // Brown ink on warm cream, lines swelling to solid in the shadows: an old copper-plate print.
  { id: 'copper-plate', name: 'Copper Plate', params: { scale: 9, weight: 1, angle: 0, amount: 1, colorA: '#2e1d12', colorB: '#f0e3c6' } },
  // Wide black waves on white at a slant, readable from the back of a hall: an op-art poster.
  { id: 'op-art', name: 'Op Art', params: { scale: 26, weight: 1, angle: -20, amount: 1, colorA: '#0b0b0b', colorB: '#f5f2ea' } },
  // Prussian-blue lines on white, the shadows deep blue: a cyanotype print.
  { id: 'cyanotype', name: 'Cyanotype', params: { scale: 8, weight: 0.85, angle: 90, amount: 1, colorA: '#1a3d7c', colorB: '#eef3f8' } },
  // Fine engraving over the picture's own colours: the picture stays, the lines lie over it.
  { id: 'engraved-photo', name: 'Engraved Photo', params: { scale: 7, weight: 0.7, angle: 0, amount: 0.55, colorA: '#141414', colorB: '#ffffff' } },
];
