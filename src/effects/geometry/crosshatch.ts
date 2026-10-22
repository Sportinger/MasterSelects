// Crosshatch: its own controls and presets. The recipe is the editable graph in
// src/services/operators/geometryFragmentEffectGraphs.ts (crosshatch) and its shader twin crosshatchFragment;
// Line Spacing (scale) counts pixels of a 1080p frame (shorter side).
import type { EffectParam, EffectPreset } from '../types';

/** Crosshatch's own control; index.ts relabels the shared Scale as Line Spacing (px). */
export const CROSSHATCH_PARAMS: Record<string, EffectParam> = {
  // Saved projects from before Line Weight keep their fixed, thin lines (legacyDefault 0).
  weight: {
    type: 'number', label: 'Line Weight', default: 0.6, min: 0, max: 1, step: 0.01, renderMin: 0, renderMax: 1,
    animatable: true, group: 'Pattern', legacyDefault: 0,
  },
};

export const CROSSHATCH_PRESETS: readonly EffectPreset[] = [
  // Black pen on white paper, lines that thicken a little in the dark parts: a quick drawing in a sketchbook.
  { id: 'pen-sketch', name: 'Pen Sketch', params: { scale: 10, weight: 0.5, amount: 1, colorA: '#141414', colorB: '#f7f5ef' } },
  // Fine, heavy lines of brown ink on cream: an old copper-plate etching.
  { id: 'etching', name: 'Etching', params: { scale: 6, weight: 1, amount: 1, colorA: '#2b1b12', colorB: '#efe2c4' } },
  // Blue ballpoint on white, the picture's own colours just showing through.
  { id: 'ballpoint', name: 'Ballpoint', params: { scale: 8, weight: 0.7, amount: 0.9, colorA: '#1d3a8f', colorB: '#f6f6f2' } },
  // Wide, bold strokes in black on off-white that swell in the shadows, readable from the back of a hall.
  { id: 'woodcut', name: 'Woodcut', params: { scale: 22, weight: 0.8, amount: 1, colorA: '#0d0d0d', colorB: '#ece6d8' } },
  // Fine hatching over the picture's own colours: a coloured drawing.
  { id: 'coloured-sketch', name: 'Coloured Sketch', params: { scale: 7, weight: 0.6, amount: 0.5, colorA: '#161616', colorB: '#ffffff' } },
];
