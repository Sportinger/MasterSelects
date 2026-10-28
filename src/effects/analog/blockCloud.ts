import shader from './graphPassThrough.wgsl?raw';
import type { EffectDefinition, EffectParam, EffectPreset } from '../types';
import { clampedValueNotes } from './analogParamWarnings';
import {
  BLOCK_CLOUD_CELL_RANGE, BLOCK_CLOUD_CLEAR_OPTIONS, BLOCK_CLOUD_CLIP_OPTIONS, BLOCK_CLOUD_CLOUD_SIZE_RANGE, BLOCK_CLOUD_COLOR_SLOTS, BLOCK_CLOUD_COVERAGE_RANGE,
  BLOCK_CLOUD_OFFSET_RANGE, BLOCK_CLOUD_RATE_RANGE, BLOCK_CLOUD_SEED_RANGE,
} from './blockCloudLimits';

/** Runtime-only distances keyframed rates have travelled (EffectParam.integratedAs); never stored. */
const DRIFT_TRAVEL = 'driftTravel';
const FLICKER_TRAVEL = 'flickerRateTravel';
const PULSE_TRAVEL = 'pulseRateTravel';
/** Default palette: the three accent colours of the brand, then white, dark grey and blush. */
const PALETTE = ['#ef489d', '#80e9eb', '#a8e783', '#ffffff', '#313131', '#ffcdcd'] as const;

const params: Record<string, EffectParam> = {
  progress: { type: 'number', label: 'Progress', default: 0.7, min: 0, max: 1, step: 0.01, animatable: true, presetKeeps: true, group: 'Clouds' },
  coverage: { type: 'number', label: 'Coverage', default: 1, min: 0, max: 2, step: 0.01, animatable: true, group: 'Clouds',
    renderMin: BLOCK_CLOUD_COVERAGE_RANGE[0], renderMax: BLOCK_CLOUD_COVERAGE_RANGE[1] },
  hold: { type: 'number', label: 'Hold', default: 0, min: 0, max: 0.9, step: 0.01, animatable: true, group: 'Clouds' },
  clearBy: { type: 'select', label: 'Clear By', default: 'thin', options: BLOCK_CLOUD_CLEAR_OPTIONS.map(option => ({ ...option })), group: 'Clouds' },
  frontAngle: { type: 'number', label: 'Front Angle', default: -35, min: -180, max: 180, step: 1, animatable: true, unit: '°', group: 'Clouds' },
  frontRoughness: { type: 'number', label: 'Front Roughness', default: 0.18, min: 0, max: 1, step: 0.01, animatable: true, group: 'Clouds' },
  cloudSize: { type: 'number', label: 'Cloud Size', default: 30, min: 1, max: 120, step: 0.5, animatable: true, unit: ' cells', group: 'Clouds',
    renderMin: BLOCK_CLOUD_CLOUD_SIZE_RANGE[0], renderMax: BLOCK_CLOUD_CLOUD_SIZE_RANGE[1] },
  cellSize: { type: 'number', label: 'Cell Size', default: 18, min: 4, max: 120, step: 0.5, animatable: true, unit: ' px', group: 'Grid',
    renderMin: BLOCK_CLOUD_CELL_RANGE[0], renderMax: BLOCK_CLOUD_CELL_RANGE[1] },
  offsetX: { type: 'number', label: 'Offset X', default: 0, min: -60, max: 60, step: 0.5, animatable: true, unit: ' px', group: 'Grid',
    renderMin: BLOCK_CLOUD_OFFSET_RANGE[0], renderMax: BLOCK_CLOUD_OFFSET_RANGE[1] },
  offsetY: { type: 'number', label: 'Offset Y', default: 0, min: -60, max: 60, step: 0.5, animatable: true, unit: ' px', group: 'Grid',
    renderMin: BLOCK_CLOUD_OFFSET_RANGE[0], renderMax: BLOCK_CLOUD_OFFSET_RANGE[1] },
  drift: { type: 'number', label: 'Drift', default: 1, min: 0, max: 5, step: 0.05, animatable: true, unit: ' /s', group: 'Motion',
    renderMin: BLOCK_CLOUD_RATE_RANGE[0], renderMax: BLOCK_CLOUD_RATE_RANGE[1], integratedAs: DRIFT_TRAVEL },
  jitter: { type: 'number', label: 'Jitter', default: 0.35, min: 0, max: 1, step: 0.01, animatable: true, group: 'Motion' },
  flicker: { type: 'number', label: 'Flicker', default: 0.06, min: 0, max: 0.5, step: 0.005, animatable: true, group: 'Motion' },
  flickerRate: { type: 'number', label: 'Flicker Rate', default: 1.3, min: 0, max: 10, step: 0.05, animatable: true, unit: ' /s', group: 'Motion',
    renderMin: BLOCK_CLOUD_RATE_RANGE[0], renderMax: BLOCK_CLOUD_RATE_RANGE[1], integratedAs: FLICKER_TRAVEL },
  recolor: { type: 'number', label: 'Recolour', default: 0.04, min: 0, max: 0.5, step: 0.005, animatable: true, group: 'Motion' },
  pulse: { type: 'number', label: 'Pulse', default: 0, min: 0, max: 1, step: 0.01, animatable: true, group: 'Motion' },
  pulseRate: { type: 'number', label: 'Pulse Rate', default: 0.7, min: 0, max: 5, step: 0.05, animatable: true, unit: ' /s', group: 'Motion',
    renderMin: BLOCK_CLOUD_RATE_RANGE[0], renderMax: BLOCK_CLOUD_RATE_RANGE[1], integratedAs: PULSE_TRAVEL },
  colorScatter: { type: 'number', label: 'Colour Scatter', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true, group: 'Colour' },
  colorCount: { type: 'number', label: 'Colour Count', default: 3, min: 1, max: BLOCK_CLOUD_COLOR_SLOTS, step: 1, animatable: false, group: 'Colour' },
  ...Object.fromEntries(PALETTE.map((color, index) => [`color${index + 1}`, { type: 'color', label: `Colour ${index + 1}`, default: color, group: 'Colour' } satisfies EffectParam])),
  clipTo: { type: 'select', label: 'Clip To', default: 'layer', options: BLOCK_CLOUD_CLIP_OPTIONS.map(option => ({ ...option })), group: 'Mix' },
  seed: { type: 'number', label: 'Seed', default: 0, min: BLOCK_CLOUD_SEED_RANGE[0], max: BLOCK_CLOUD_SEED_RANGE[1], step: 1, animatable: false, group: 'Mix' },
  amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Mix' },
};

const ranges = {
  progress: [0, 1], hold: [0, 0.95], coverage: BLOCK_CLOUD_COVERAGE_RANGE, frontRoughness: [0, 1], cloudSize: BLOCK_CLOUD_CLOUD_SIZE_RANGE, cellSize: BLOCK_CLOUD_CELL_RANGE,
  offsetX: BLOCK_CLOUD_OFFSET_RANGE, offsetY: BLOCK_CLOUD_OFFSET_RANGE, jitter: [0, 2], flicker: [0, 2], recolor: [0, 1], pulse: [0, 1], colorScatter: [0, 1],
  colorCount: [1, BLOCK_CLOUD_COLOR_SLOTS], seed: BLOCK_CLOUD_SEED_RANGE, amount: [0, 1],
} as const;

/**
 * Presets: the motion characters of overlay_pixel.py, each with the full brand palette (only values that differ
 * from the defaults).
 */
const presets: readonly EffectPreset[] = [
  // "basis": calm clouds that wander and flicker a little at their edges, in all six brand colours.
  { id: 'brand-base', name: 'Brand Base', params: { colorCount: 6 } },
  // "nervoes": fast, twitchy edges and blocks that keep changing colour.
  { id: 'nervous', name: 'Nervous', params: { colorCount: 6, drift: 2.4, flicker: 0.16, flickerRate: 3.5, recolor: 0.12, colorScatter: 0.9, coverage: 0.85 } },
  // "atmend": slow clouds whose coverage breathes in and out.
  { id: 'breathing', name: 'Breathing', params: { colorCount: 6, drift: 0.45, flicker: 0.025, flickerRate: 0.4, recolor: 0.02, pulse: 0.56, pulseRate: 0.7, coverage: 0.8 } },
  // "zoegernd": dense clouds that hold, then clear quickly.
  { id: 'hesitant', name: 'Hesitant', params: { colorCount: 6, hold: 0.4, coverage: 1.6, drift: 0.9, flicker: 0.08, flickerRate: 2, recolor: 0.05 } },
  // "klar": only the three accent colours, quieter clouds without scattered single blocks.
  { id: 'clear', name: 'Clear', params: { colorCount: 3, jitter: 0.12, colorScatter: 0.1, flicker: 0.03, recolor: 0 } },
  // "welle": the clouds stay dense and a ragged front sweeps them away along the diagonal.
  { id: 'wave', name: 'Wave', params: { colorCount: 6, clearBy: 'wave', drift: 0.8, flicker: 0.08, flickerRate: 1.7, recolor: 0.06 } },
];

export const blockCloud: EffectDefinition = {
  id: 'block-cloud', name: 'Block Cloud', category: 'analog',
  shader, entryPoint: 'blockCloudFragment', uniformSize: 0,
  params,
  presets,
  // Clouds drift with the playhead and hold while paused.
  requiresContinuousRender: false,
  timelineAnimated: true,
  // Progress 0 or Amount 0 is the input unchanged: the renderer skips the graph.
  mixParam: ['amount', 'progress'],
  paramWarnings: values => {
    const notes = clampedValueNotes(params, values, ranges);
    for (const key of ['drift', 'flickerRate', 'pulseRate'] as const) {
      const value = values[key];
      if (typeof value === 'number' && value < 0) notes.push(`${params[key].label} ${value} is below 0; it holds still as at 0.`);
    }
    const count = values.colorCount;
    if (typeof count === 'number' && Number.isFinite(count) && !Number.isInteger(count)) notes.push(`Colour Count ${count} renders as ${Math.round(count)} colours.`);
    return notes;
  },
  packUniforms: () => null,
};
