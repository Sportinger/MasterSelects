import shader from './graphPassThrough.wgsl?raw';
import type { EffectDefinition, EffectParam, EffectPreset } from '../types';
import { clampedValueNotes } from './analogParamWarnings';
import {
  BLOCK_DISSOLVE_DITHER_SIZE_RANGE, BLOCK_DISSOLVE_DOT_COLOR_OPTIONS, BLOCK_DISSOLVE_EDGE_WIDTH_RANGE, BLOCK_DISSOLVE_FILL_OPTIONS, BLOCK_DISSOLVE_PATTERN_OPTIONS, BLOCK_DISSOLVE_PLACEMENT_OPTIONS, BLOCK_DISSOLVE_SLANT_OPTIONS, BLOCK_DISSOLVE_HOLE_SIZE_RANGE, OBJECT_MASK_OPTIONS,
  BLOCK_DISSOLVE_RATE_RANGE, BLOCK_DISSOLVE_SEED_RANGE, BLOCK_DISSOLVE_SIZE_RANGE,
} from './blockDissolveLimits';

/** Runtime-only distances keyframed rates have travelled (EffectParam.integratedAs); never stored. */
const STRUCTURE_TRAVEL = 'structureRateTravel';
const FLICKER_TRAVEL = 'flickerRateTravel';

const params: Record<string, EffectParam> = {
  scale: { type: 'number', label: 'Block Size', default: 24, min: 4, max: 120, step: 1, animatable: true, unit: ' px', group: 'Blocks',
    renderMin: BLOCK_DISSOLVE_SIZE_RANGE[0], renderMax: BLOCK_DISSOLVE_SIZE_RANGE[1] },
  variation: { type: 'number', label: 'Variation', default: 0.6, min: 0, max: 1, step: 0.01, animatable: true, group: 'Blocks' },
  mask: { type: 'select', label: 'Object', default: 'dark', options: OBJECT_MASK_OPTIONS.map(option => ({ ...option })), group: 'Blocks' },
  threshold: { type: 'number', label: 'Threshold', default: 0.75, min: 0, max: 1, step: 0.01, animatable: true, group: 'Blocks' },
  solid: { type: 'number', label: 'Solid', default: 0, min: 0, max: 1, step: 0.01, animatable: true, group: 'Blocks' },
  holes: { type: 'number', label: 'Holes', default: 0.12, min: 0, max: 1, step: 0.01, animatable: true, group: 'Holes' },
  holePlacement: { type: 'select', label: 'Placement', default: 'edges', options: BLOCK_DISSOLVE_PLACEMENT_OPTIONS.map(option => ({ ...option })), group: 'Holes' },
  holeSize: { type: 'number', label: 'Hole Size', default: 3, min: BLOCK_DISSOLVE_HOLE_SIZE_RANGE[0], max: BLOCK_DISSOLVE_HOLE_SIZE_RANGE[1], step: 1, animatable: true, unit: ' blocks', group: 'Holes' },
  edgeAmount: { type: 'number', label: 'Edge Amount', default: 0.35, min: 0, max: 1, step: 0.01, animatable: true, group: 'Dither' },
  edgeDither: { type: 'number', label: 'Edge Dither', default: 0.7, min: 0, max: 1, step: 0.01, animatable: true, group: 'Dither' },
  dither: { type: 'number', label: 'Dither', default: 0, min: 0, max: 1, step: 0.01, animatable: true, group: 'Dither' },
  slant: { type: 'number', label: 'Slant', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true, group: 'Dither' },
  slantDirection: { type: 'select', label: 'Slant Direction', default: 'falling', options: BLOCK_DISSOLVE_SLANT_OPTIONS.map(option => ({ ...option })), group: 'Dither' },
  edgeWidth: { type: 'number', label: 'Edge Width', default: 10, min: BLOCK_DISSOLVE_EDGE_WIDTH_RANGE[0], max: BLOCK_DISSOLVE_EDGE_WIDTH_RANGE[1], step: 1, animatable: true, unit: ' px', group: 'Dither' },
  ditherSize: { type: 'number', label: 'Dot Size', default: 3, min: BLOCK_DISSOLVE_DITHER_SIZE_RANGE[0], max: BLOCK_DISSOLVE_DITHER_SIZE_RANGE[1], step: 1, animatable: true, unit: ' px', group: 'Dither' },
  displace: { type: 'number', label: 'Displace', default: 0.06, min: 0, max: 1, step: 0.01, animatable: true, group: 'Dither' },
  pattern: { type: 'select', label: 'Pattern', default: 'checker', options: BLOCK_DISSOLVE_PATTERN_OPTIONS.map(option => ({ ...option })), group: 'Dither' },
  dotColor: { type: 'select', label: 'Dot Colour', default: 'original', options: BLOCK_DISSOLVE_DOT_COLOR_OPTIONS.map(option => ({ ...option })), group: 'Dither' },
  colorA: { type: 'color', label: 'Ink', default: '#000000', group: 'Color' },
  colorB: { type: 'color', label: 'Paper', default: '#ffffff', group: 'Color' },
  fill: { type: 'select', label: 'Removed', default: 'paper', options: BLOCK_DISSOLVE_FILL_OPTIONS.map(option => ({ ...option })), group: 'Color' },
  structureRate: { type: 'number', label: 'Structure Rate', default: 1, min: BLOCK_DISSOLVE_RATE_RANGE[0], max: BLOCK_DISSOLVE_RATE_RANGE[1], step: 0.1, animatable: true,
    unit: ' /s', group: 'Motion', integratedAs: STRUCTURE_TRAVEL },
  flickerRate: { type: 'number', label: 'Flicker Rate', default: 3, min: BLOCK_DISSOLVE_RATE_RANGE[0], max: BLOCK_DISSOLVE_RATE_RANGE[1], step: 0.1, animatable: true,
    unit: ' /s', group: 'Motion', integratedAs: FLICKER_TRAVEL },
  seed: { type: 'number', label: 'Seed', default: 0, min: BLOCK_DISSOLVE_SEED_RANGE[0], max: BLOCK_DISSOLVE_SEED_RANGE[1], step: 1, animatable: false, group: 'Motion' },
  amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Mix' },
};

const ranges = {
  variation: [0, 1], solid: [0, 1], threshold: [0, 1], holes: [0, 1], holeSize: BLOCK_DISSOLVE_HOLE_SIZE_RANGE,
  edgeAmount: [0, 1], edgeDither: [0, 1], dither: [0, 1], slant: [0, 1], edgeWidth: BLOCK_DISSOLVE_EDGE_WIDTH_RANGE, ditherSize: BLOCK_DISSOLVE_DITHER_SIZE_RANGE, displace: [0, 1], amount: [0, 1], seed: BLOCK_DISSOLVE_SEED_RANGE,
} as const;

/** Presets: only values that differ from the defaults (EffectPreset). */
const presets: readonly EffectPreset[] = [
  { id: 'data-dissolve', name: 'Data Dissolve', params: {} },
  // Nissan 350Z reel (frames 1-16): even blocks, the object itself revealed (no fill), one large hole, dithered edges.
  { id: '350z-burst', name: '350Z Burst', params: { scale: 39, variation: 0.1, holes: 0.2, holeSize: 2, edgeDither: 0.9, ditherSize: 5, pattern: 'diagonal', slant: 0.7, displace: 0.06, structureRate: 0.7, flickerRate: 2 } },
  { id: 'crumble', name: 'Crumble', params: { holes: 0.35, holeSize: 4, edgeDither: 0.9, dither: 0.15, displace: 0.12, flickerRate: 6 } },
  { id: 'dither-veil', name: 'Dither Veil', params: { holes: 0.03, dither: 0.5, edgeDither: 1, pattern: 'bayer', displace: 0, structureRate: 0.5, flickerRate: 1.5 } },
  { id: 'big-blocks', name: 'Big Blocks', params: { scale: 60, variation: 0.8, holeSize: 2, holes: 0.2, ditherSize: 4, displace: 0.15 } },
];

export const blockDissolve: EffectDefinition = {
  id: 'block-dissolve', name: 'Block Dissolve', category: 'analog',
  shader, entryPoint: 'blockDissolveFragment', uniformSize: 0,
  params,
  presets,
  // Blocks, holes and flicker follow the playhead and hold while paused.
  requiresContinuousRender: false,
  timelineAnimated: true,
  paramWarnings: values => {
    const notes = clampedValueNotes(params, values, ranges);
    for (const key of ['structureRate', 'flickerRate'] as const) {
      const value = values[key];
      if (typeof value === 'number' && value < 0) notes.push(`${params[key].label} ${value} is below 0; the blocks hold still as at 0.`);
    }
    return notes;
  },
  packUniforms: () => null,
};
