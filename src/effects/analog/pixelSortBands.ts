import shader from './graphPassThrough.wgsl?raw';
import type { EffectDefinition, EffectParam, EffectPreset } from '../types';
import { clampedValueNotes } from './analogParamWarnings';
import {
  PIXEL_SORT_BANDS_DIRECTION_OPTIONS, PIXEL_SORT_BANDS_DRIFT_RANGE, PIXEL_SORT_BANDS_KEY_OPTIONS, PIXEL_SORT_BANDS_LENGTH_RANGE, PIXEL_SORT_BANDS_OFFSET_RANGE,
  PIXEL_SORT_BANDS_ORDER_OPTIONS, PIXEL_SORT_BANDS_LAYER2_OPTIONS, PIXEL_SORT_BANDS_SEED_RANGE, PIXEL_SORT_BANDS_TILT_RANGE, PIXEL_SORT_BANDS_WIDTH_RANGE,
} from './pixelSortBandsLimits';
import { BAND_TAPS_MAX } from '../../services/operators/axisBandNodes';

const params: Record<string, EffectParam> = {
  progress: { type: 'number', label: 'Progress', default: 0.6, min: 0, max: 1, step: 0.01, animatable: true, presetKeeps: true, group: 'Sort' },
  direction: { type: 'select', label: 'Direction', default: 'columns', options: PIXEL_SORT_BANDS_DIRECTION_OPTIONS.map(option => ({ ...option })), group: 'Sort' },
  tilt: { type: 'number', label: 'Tilt', default: 0, min: PIXEL_SORT_BANDS_TILT_RANGE[0], max: PIXEL_SORT_BANDS_TILT_RANGE[1], step: 1, animatable: true, unit: '°', group: 'Sort' },
  sortBy: { type: 'select', label: 'Sort By', default: 'luminance', options: PIXEL_SORT_BANDS_KEY_OPTIONS.map(option => ({ ...option })), group: 'Sort' },
  order: { type: 'select', label: 'Order', default: 'ascending', options: PIXEL_SORT_BANDS_ORDER_OPTIONS.map(option => ({ ...option })), group: 'Sort' },
  centre: { type: 'number', label: 'Centre', default: 0.78, min: 0, max: 1, step: 0.01, animatable: true, group: 'Range' },
  range: { type: 'number', label: 'Range', default: 0.62, min: 0, max: 1, step: 0.01, animatable: true, group: 'Range' },
  variation: { type: 'number', label: 'Band Variation', default: 0.4, min: 0, max: 1, step: 0.01, animatable: true, group: 'Range' },
  bandWidth: { type: 'number', label: 'Band Width', default: 1, min: 1, max: 120, step: 0.5, animatable: true, unit: ' px', group: 'Bands',
    renderMin: PIXEL_SORT_BANDS_WIDTH_RANGE[0], renderMax: PIXEL_SORT_BANDS_WIDTH_RANGE[1] },
  bandOffset: { type: 'number', label: 'Band Offset', default: 0, min: 0, max: 120, step: 0.5, animatable: true, unit: ' px', group: 'Bands',
    renderMin: PIXEL_SORT_BANDS_OFFSET_RANGE[0], renderMax: PIXEL_SORT_BANDS_OFFSET_RANGE[1] },
  maxLength: { type: 'number', label: 'Max Length', default: 330, min: 8, max: 2000, step: 1, animatable: true, unit: ' px', group: 'Streaks',
    renderMin: PIXEL_SORT_BANDS_LENGTH_RANGE[0], renderMax: PIXEL_SORT_BANDS_LENGTH_RANGE[1] },
  drift: { type: 'number', label: 'Drift', default: 0, min: -1000, max: 1000, step: 1, animatable: true, unit: ' px', group: 'Streaks',
    renderMin: PIXEL_SORT_BANDS_DRIFT_RANGE[0], renderMax: PIXEL_SORT_BANDS_DRIFT_RANGE[1] },
  layer2: { type: 'select', label: 'Layer 2', default: 'off', options: PIXEL_SORT_BANDS_LAYER2_OPTIONS.map(option => ({ ...option })), group: 'Layer 2' },
  layer2Width: { type: 'number', label: 'Layer 2 Width', default: 36, min: 1, max: 120, step: 0.5, animatable: true, unit: ' px', group: 'Layer 2',
    renderMin: PIXEL_SORT_BANDS_WIDTH_RANGE[0], renderMax: PIXEL_SORT_BANDS_WIDTH_RANGE[1] },
  layer2Offset: { type: 'number', label: 'Layer 2 Offset', default: 0, min: 0, max: 120, step: 0.5, animatable: true, unit: ' px', group: 'Layer 2',
    renderMin: PIXEL_SORT_BANDS_OFFSET_RANGE[0], renderMax: PIXEL_SORT_BANDS_OFFSET_RANGE[1] },
  layer2Centre: { type: 'number', label: 'Layer 2 Centre', default: 0.66, min: 0, max: 1, step: 0.01, animatable: true, group: 'Layer 2' },
  layer2Range: { type: 'number', label: 'Layer 2 Range', default: 0.38, min: 0, max: 1, step: 0.01, animatable: true, group: 'Layer 2' },
  layer2Strength: { type: 'number', label: 'Layer 2 Strength', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true, group: 'Layer 2' },
  layer2Delay: { type: 'number', label: 'Layer 2 Delay', default: 0.15, min: 0, max: 0.95, step: 0.01, animatable: true, group: 'Layer 2' },
  seed: { type: 'number', label: 'Seed', default: 0, min: PIXEL_SORT_BANDS_SEED_RANGE[0], max: PIXEL_SORT_BANDS_SEED_RANGE[1], step: 1, animatable: false, group: 'Mix' },
  amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Mix' },
};

const ranges = {
  progress: [0, 1], tilt: PIXEL_SORT_BANDS_TILT_RANGE, centre: [0, 1], range: [0, 1], variation: [0, 1], bandWidth: PIXEL_SORT_BANDS_WIDTH_RANGE,
  bandOffset: PIXEL_SORT_BANDS_OFFSET_RANGE, layer2Width: PIXEL_SORT_BANDS_WIDTH_RANGE, layer2Offset: PIXEL_SORT_BANDS_OFFSET_RANGE,
  layer2Centre: [0, 1], layer2Range: [0, 1], layer2Strength: [0, 1], layer2Delay: [0, 0.95], maxLength: PIXEL_SORT_BANDS_LENGTH_RANGE, drift: PIXEL_SORT_BANDS_DRIFT_RANGE, seed: PIXEL_SORT_BANDS_SEED_RANGE, amount: [0, 1],
} as const;

/**
 * Presets named after the prototype looks (only values that differ from the defaults). Progress belongs to the
 * shot (it is keyed). Sizes are the texture's grid in 1080p pixels: a design cell is 17.8 px (offset 0.6 px).
 */
const presets: readonly EffectPreset[] = [
  // pixelsort.py "vertikal": single-pixel lines, the light pastel tones sort into long drips.
  { id: 'fine-vertical', name: 'Fine Vertical', params: {} },
  // pixelsort_dick.py "halb": bands half a design cell wide, aligned to its grid.
  { id: 'cell-bands', name: 'Cell Bands', params: { bandWidth: 8.9, bandOffset: 0.6 } },
  // pixelsort_dick.py "ganz": whole-cell bands, chunky columns.
  { id: 'wide-bands', name: 'Wide Bands', params: { bandWidth: 17.8, bandOffset: 0.6 } },
  // pixelsort_kreuz.py "halb": light tones sorted down, mid tones sorted across on top.
  { id: 'woven', name: 'Woven', params: { bandWidth: 8.9, bandOffset: 0.6, centre: 0.8, range: 0.55,
    layer2: 'rows', layer2Width: 9.1, layer2Offset: 13.4, layer2Centre: 0.66, layer2Range: 0.45, layer2Strength: 1, layer2Delay: 0 } },
  // sort_kombi5.py: fine quarter-cell streaks plus 2-cell bars that join a little later and less strongly.
  { id: 'fine-wide', name: 'Fine + Wide', params: { bandWidth: 4.45, bandOffset: 0.6, centre: 0.8, range: 0.6,
    layer2: 'columns', layer2Width: 35.6, layer2Offset: 0.6, layer2Centre: 0.66, layer2Range: 0.28, layer2Strength: 0.35, layer2Delay: 0.15 } },
  // pixelsort.py "diagonal": streaks along a rising diagonal.
  { id: 'diagonal', name: 'Diagonal', params: { direction: 'rows', tilt: -35, maxLength: 300 } },
];

export const pixelSortBands: EffectDefinition = {
  id: 'pixel-sort-bands', name: 'Pixel Sort Bands', category: 'analog',
  shader, entryPoint: 'pixelSortBandsFragment', uniformSize: 0,
  params,
  presets,
  // Progress 0 or Amount 0 is the input unchanged: the renderer skips the graph.
  mixParam: ['amount', 'progress'],
  paramWarnings: values => {
    const notes = clampedValueNotes(params, values, ranges);
    const width = values.bandWidth;
    if (typeof width === 'number' && width > BAND_TAPS_MAX) notes.push(`Band Width ${width} is averaged from ${BAND_TAPS_MAX} evenly spaced pixels per row (at 1080p), not from every pixel.`);
    return notes;
  },
  packUniforms: () => null,
};
