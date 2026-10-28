import shader from './graphPassThrough.wgsl?raw';
import type { EffectDefinition, EffectParam, EffectPreset } from '../types';
import { clampedValueNotes } from './analogParamWarnings';
import { BLOCK_SILHOUETTE_AREA_OPTIONS, BLOCK_SILHOUETTE_GRID_RANGE, BLOCK_SILHOUETTE_MARK_OPTIONS, BLOCK_SILHOUETTE_MARK_RANGE, BLOCK_SILHOUETTE_SIZE_RANGE } from './blockSilhouetteLimits';

const params: Record<string, EffectParam> = {
  scale: { type: 'number', label: 'Block Size', default: 26, min: 4, max: 120, step: 1, animatable: true, unit: ' px', group: 'Silhouette',
    renderMin: BLOCK_SILHOUETTE_SIZE_RANGE[0], renderMax: BLOCK_SILHOUETTE_SIZE_RANGE[1] },
  threshold: { type: 'number', label: 'Threshold', default: 0.2, min: 0, max: 1, step: 0.01, animatable: true, group: 'Silhouette' },
  invert: { type: 'number', label: 'Invert', default: 0, min: 0, max: 1, step: 1, animatable: true, group: 'Silhouette' },
  marks: { type: 'select', label: 'Marks', default: 'dots', options: BLOCK_SILHOUETTE_MARK_OPTIONS.map(option => ({ ...option })), group: 'Marks' },
  gridSize: { type: 'number', label: 'Grid Size', default: 36, min: BLOCK_SILHOUETTE_GRID_RANGE[0], max: 200, step: 1, animatable: true, unit: ' px', group: 'Marks' },
  markSize: { type: 'number', label: 'Mark Size', default: 4, min: BLOCK_SILHOUETTE_MARK_RANGE[0], max: BLOCK_SILHOUETTE_MARK_RANGE[1], step: 1, animatable: true, unit: ' px', group: 'Marks' },
  markArea: { type: 'select', label: 'Mark Area', default: 'edges', options: BLOCK_SILHOUETTE_AREA_OPTIONS.map(option => ({ ...option })), group: 'Marks' },
  markAmount: { type: 'number', label: 'Mark Amount', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true, group: 'Marks' },
  markOpacity: { type: 'number', label: 'Mark Opacity', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Marks' },
  colorA: { type: 'color', label: 'Ink', default: '#000000', group: 'Color' },
  colorB: { type: 'color', label: 'Paper', default: '#eeff0d', group: 'Color' },
  seed: { type: 'number', label: 'Seed', default: 0, min: 0, max: 9999, step: 1, animatable: false, group: 'Mix' },
  amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Mix' },
};

const ranges = {
  threshold: [0, 1], invert: [0, 1], gridSize: BLOCK_SILHOUETTE_GRID_RANGE, markSize: BLOCK_SILHOUETTE_MARK_RANGE, markAmount: [0, 1], markOpacity: [0, 1], amount: [0, 1], seed: [0, 9999],
} as const;

/** Presets: only values that differ from the defaults (EffectPreset). */
const presets: readonly EffectPreset[] = [
  // Nissan 350Z reel, frames 79-83: black car on neon yellow, sparse dots.
  { id: 'neon-yellow', name: 'Neon Yellow', params: {} },
  // Frames 84-91: the same silhouette white on black, with a faint cross grid.
  { id: 'white-on-black', name: 'White on Black', params: { colorA: '#f4f4f6', colorB: '#000000', marks: 'crosses', markArea: 'ink', markSize: 3, markAmount: 0.9, markOpacity: 0.15 } },
  { id: 'big-pixels', name: 'Big Pixels', params: { scale: 60, marks: 'none' } },
  { id: 'blueprint', name: 'Blueprint', params: { colorA: '#ffffff', colorB: '#1d3fbf', invert: 1, marks: 'crosses', markArea: 'everywhere', gridSize: 48, markAmount: 1, markOpacity: 0.6 } },
];

export const blockSilhouette: EffectDefinition = {
  id: 'block-silhouette', name: 'Block Silhouette', category: 'analog',
  shader, entryPoint: 'blockSilhouetteFragment', uniformSize: 0,
  params,
  presets,
  paramWarnings: values => clampedValueNotes(params, values, ranges),
  packUniforms: () => null,
};
