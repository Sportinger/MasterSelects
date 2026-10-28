import shader from './graphPassThrough.wgsl?raw';
import type { EffectDefinition, EffectParam, EffectPreset } from '../types';
import { clampedValueNotes } from './analogParamWarnings';
import {
  FLOW_MOSH_CELL_RANGE, FLOW_MOSH_DISTANCE_RANGE, FLOW_MOSH_OFFSET_RANGE, FLOW_MOSH_SEED_RANGE, FLOW_MOSH_SHAPE_OPTIONS, FLOW_MOSH_SMOOTHNESS_RANGE,
  FLOW_MOSH_SNAP_OPTIONS, FLOW_MOSH_SOURCE_OPTIONS, FLOW_MOSH_SPEED_RANGE, FLOW_MOSH_SWIRL_RANGE,
} from './flowMoshLimits';

const params: Record<string, EffectParam> = {
  progress: { type: 'number', label: 'Progress', default: 0.6, min: 0, max: 1, step: 0.01, animatable: true, presetKeeps: true, group: 'Flow' },
  distance: { type: 'number', label: 'Distance', default: 300, min: 0, max: 1500, step: 1, animatable: true, unit: ' px', group: 'Flow',
    renderMin: FLOW_MOSH_DISTANCE_RANGE[0], renderMax: FLOW_MOSH_DISTANCE_RANGE[1] },
  flowFrom: { type: 'select', label: 'Flow From', default: 'brightness', options: FLOW_MOSH_SOURCE_OPTIONS.map(option => ({ ...option })), group: 'Flow' },
  smoothness: { type: 'number', label: 'Smoothness', default: 30, min: 2, max: 200, step: 1, animatable: true, unit: ' px', group: 'Flow',
    renderMin: FLOW_MOSH_SMOOTHNESS_RANGE[0], renderMax: FLOW_MOSH_SMOOTHNESS_RANGE[1] },
  along: { type: 'number', label: 'Along Contours', default: 1, min: 0, max: 2, step: 0.01, animatable: true, group: 'Flow' },
  edgePull: { type: 'number', label: 'Edge Pull', default: 1, min: 0, max: 5, step: 0.01, animatable: true, group: 'Flow' },
  drift: { type: 'number', label: 'Drift', default: 1, min: 0, max: 2, step: 0.01, animatable: true, group: 'Flow' },
  driftAngle: { type: 'number', label: 'Drift Direction', default: -35, min: -180, max: 180, step: 1, animatable: true, unit: '°', group: 'Flow' },
  vortices: { type: 'number', label: 'Vortices', default: 0, min: 0, max: 2, step: 0.01, animatable: true, group: 'Flow' },
  turbulence: { type: 'number', label: 'Turbulence', default: 0.6, min: 0, max: 3, step: 0.01, animatable: true, group: 'Flow' },
  swirlSize: { type: 'number', label: 'Swirl Size', default: 60, min: 4, max: 600, step: 1, animatable: true, unit: ' px', group: 'Flow',
    renderMin: FLOW_MOSH_SWIRL_RANGE[0], renderMax: FLOW_MOSH_SWIRL_RANGE[1] },
  cellSize: { type: 'number', label: 'Cell Size', default: 9, min: 1, max: 120, step: 0.5, animatable: true, unit: ' px', group: 'Cells',
    renderMin: FLOW_MOSH_CELL_RANGE[0], renderMax: FLOW_MOSH_CELL_RANGE[1] },
  offsetX: { type: 'number', label: 'Offset X', default: 0, min: -60, max: 60, step: 0.5, animatable: true, unit: ' px', group: 'Cells',
    renderMin: FLOW_MOSH_OFFSET_RANGE[0], renderMax: FLOW_MOSH_OFFSET_RANGE[1] },
  offsetY: { type: 'number', label: 'Offset Y', default: 0, min: -60, max: 60, step: 0.5, animatable: true, unit: ' px', group: 'Cells',
    renderMin: FLOW_MOSH_OFFSET_RANGE[0], renderMax: FLOW_MOSH_OFFSET_RANGE[1] },
  snap: { type: 'select', label: 'Snap', default: 'cells', options: FLOW_MOSH_SNAP_OPTIONS.map(option => ({ ...option })), group: 'Cells' },
  particles: { type: 'number', label: 'Particles', default: 0.15, min: 0, max: 1, step: 0.01, animatable: true, group: 'Glitch' },
  particleSpeed: { type: 'number', label: 'Particle Speed', default: 2.5, min: 1, max: 6, step: 0.05, animatable: true, unit: '×', group: 'Glitch',
    renderMin: FLOW_MOSH_SPEED_RANGE[0], renderMax: FLOW_MOSH_SPEED_RANGE[1] },
  trails: { type: 'number', label: 'Trails', default: 0.2, min: 0, max: 1, step: 0.01, animatable: true, group: 'Glitch' },
  jumps: { type: 'number', label: 'Jumps', default: 0.08, min: 0, max: 1, step: 0.01, animatable: true, group: 'Glitch' },
  slices: { type: 'number', label: 'Slices', default: 0.06, min: 0, max: 1, step: 0.01, animatable: true, group: 'Glitch' },
  sortRows: { type: 'number', label: 'Sort Rows', default: 0, min: 0, max: 1, step: 0.01, animatable: true, group: 'Glitch' },
  shape: { type: 'select', label: 'Shape', default: 'keep', options: FLOW_MOSH_SHAPE_OPTIONS.map(option => ({ ...option })), group: 'Mix' },
  seed: { type: 'number', label: 'Seed', default: 0, min: FLOW_MOSH_SEED_RANGE[0], max: FLOW_MOSH_SEED_RANGE[1], step: 1, animatable: false, group: 'Mix' },
  amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Mix' },
};

const ranges = {
  progress: [0, 1], distance: FLOW_MOSH_DISTANCE_RANGE, smoothness: FLOW_MOSH_SMOOTHNESS_RANGE, along: [0, 4], edgePull: [0, 10], drift: [0, 4], vortices: [0, 4], sortRows: [0, 1], turbulence: [0, 4],
  swirlSize: FLOW_MOSH_SWIRL_RANGE, cellSize: FLOW_MOSH_CELL_RANGE, offsetX: FLOW_MOSH_OFFSET_RANGE, offsetY: FLOW_MOSH_OFFSET_RANGE, particles: [0, 1],
  particleSpeed: FLOW_MOSH_SPEED_RANGE, trails: [0, 1], jumps: [0, 1], slices: [0, 1], seed: FLOW_MOSH_SEED_RANGE, amount: [0, 1],
} as const;

/**
 * Presets named after the prototype looks (only values that differ from the defaults; Progress belongs to the
 * shot). Distances are the prototypes' speeds in 1080p pixels of the texture (a design cell is 17.8 px).
 */
const presets: readonly EffectPreset[] = [
  // glitch_v4.py "zelle": everything in half-cell steps, nothing finer than the design grid.
  { id: 'grid-cells', name: 'Grid Cells', params: { cellSize: 8.9, offsetX: 0.6, offsetY: 13.4 } },
  // glitch_v4.py "gross": whole design cells.
  { id: 'big-grid', name: 'Big Grid', params: { cellSize: 17.8, offsetX: 0.6, offsetY: 13.4, distance: 330, turbulence: 0.5, particleSpeed: 2.4, jumps: 0.07, slices: 0.05 } },
  // fluss_v2.py "strom": a smooth stream along the contours, no grid.
  { id: 'stream', name: 'Stream', params: { snap: 'pixels', distance: 190, smoothness: 20, turbulence: 1, swirlSize: 45, particles: 0.25, particleSpeed: 2.2, trails: 0, jumps: 0, slices: 0 } },
  // fluss_v2.py "wirbel": two counter-rotating vortices pull the picture round.
  { id: 'swirl', name: 'Swirl', params: { snap: 'pixels', distance: 230, drift: 0.35, along: 0.4, vortices: 0.6, turbulence: 0.3, particles: 0.25, particleSpeed: 2.6, trails: 0, jumps: 0, slices: 0 } },
  // fluss_v2.py "faeden": strong flow along the contours that pulls outlines into threads.
  { id: 'threads', name: 'Threads', params: { snap: 'pixels', distance: 420, along: 2, edgePull: 2, turbulence: 0.1, particles: 0.6, particleSpeed: 2.8, trails: 0.9, jumps: 0, slices: 0 } },
  // fluss_v1.py: the colour shapes stream along the pink and green borders, with soft swirls.
  { id: 'flow', name: 'Flow', params: { snap: 'pixels', flowFrom: 'red-green', distance: 220, smoothness: 60, turbulence: 0.25, swirlSize: 160, particles: 0.2, particleSpeed: 2.2, trails: 0, jumps: 0, slices: 0 } },
  // glitch_v3.py "mosh": fine blocks off the grid, fast cells, jumps and slipped rows.
  { id: 'mosh', name: 'Mosh', params: { cellSize: 5.8, distance: 327, turbulence: 1, particleSpeed: 3, jumps: 0.1, slices: 0.08 } },
  // glitch_v3.py "sort": the mosh with pixel rows sorted by brightness.
  { id: 'sorted-mosh', name: 'Sorted Mosh', params: { cellSize: 4.4, distance: 276, turbulence: 0.8, particleSpeed: 3.4, jumps: 0.04, slices: 0.04, sortRows: 0.55 } },
  // glitch_v3.py "sturm": wild turbulence, many jumps and slices.
  { id: 'storm', name: 'Storm', params: { cellSize: 24, distance: 400, turbulence: 1.6, particleSpeed: 4, jumps: 0.16, slices: 0.12, trails: 0.3 } },
];

export const flowMosh: EffectDefinition = {
  id: 'flow-mosh', name: 'Flow Mosh', category: 'analog',
  shader, entryPoint: 'flowMoshFragment', uniformSize: 0,
  params,
  presets,
  // Progress 0 or Amount 0 is the input unchanged: the renderer skips the graph.
  mixParam: ['amount', 'progress'],
  paramWarnings: values => clampedValueNotes(params, values, ranges),
  packUniforms: () => null,
};
