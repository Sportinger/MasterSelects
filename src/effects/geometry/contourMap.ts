// Contour Map (registry id contour-map): its own controls and presets. The recipe is the editable graph in
// src/services/operators/geometryFragmentEffectGraphs.ts (contourMap) and its shader twin contourMapFragment;
// Band Density (scale) sets the number of bands (scale x 0.35), Line Width and Smoothing count pixels of a 1080p frame.
import type { EffectParam, EffectPreset } from '../types';

/** Contour Map's own controls; index.ts keeps the shared Scale as Band Density. */
export const CONTOUR_MAP_PARAMS: Record<string, EffectParam> = {
  lineWidth: {
    type: 'number', label: 'Line Width', default: 1.8, min: 0, max: 6, step: 0.1, unit: ' px', renderMin: 0,
    animatable: true, group: 'Pattern',
  },
  // Saved projects from before Smoothing read the picture itself (legacyDefault 0).
  smoothing: {
    type: 'number', label: 'Smoothing', default: 6, min: 0, max: 32, step: 1, unit: ' px', renderMin: 0, renderMax: 32,
    animatable: true, group: 'Pattern', legacyDefault: 0,
  },
  // Saved projects from before Fill keep their full ink-to-paper bands (legacyDefault 1).
  fill: {
    type: 'number', label: 'Fill', default: 0.7, min: 0, max: 1, step: 0.01, renderMin: 0, renderMax: 1,
    animatable: true, group: 'Pattern', legacyDefault: 1,
  },
};

export const CONTOUR_MAP_PRESETS: readonly EffectPreset[] = [
  // Brown contour lines over pale tinted bands on cream: a hiking map.
  { id: 'hiking-map', name: 'Hiking Map', params: { scale: 22, lineWidth: 1.3, smoothing: 8, fill: 0.45, amount: 1, colorA: '#4a2f1b', colorB: '#f4ecd6' } },
  // Only the lines, black on white: a survey drawing of the picture.
  { id: 'survey-lines', name: 'Survey Lines', params: { scale: 30, lineWidth: 1.2, smoothing: 6, fill: 0, amount: 1, colorA: '#141414', colorB: '#f6f3ec' } },
  // Glowing green lines on black: a sonar or radar screen.
  { id: 'sonar', name: 'Sonar', params: { scale: 26, lineWidth: 1.6, smoothing: 8, fill: 0, amount: 1, colorA: '#5dffb0', colorB: '#03130c' } },
  // Flat bands from deep blue to warm sand, no lines: a screen-printed poster.
  { id: 'poster-bands', name: 'Poster Bands', params: { scale: 16, lineWidth: 0, smoothing: 10, fill: 1, amount: 1, colorA: '#1d2547', colorB: '#f6d6a6' } },
  // Pale lines on deep blue: a blueprint of the picture.
  { id: 'blueprint', name: 'Blueprint', params: { scale: 24, lineWidth: 1.2, smoothing: 6, fill: 0, amount: 1, colorA: '#e6efff', colorB: '#1b4a85' } },
];
