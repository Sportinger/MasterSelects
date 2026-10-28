import shader from './graphPassThrough.wgsl?raw';
import type { EffectDefinition, EffectParam, EffectPreset } from '../types';
import { clampedValueNotes } from './analogParamWarnings';
import { OBJECT_MASK_OPTIONS } from './blockDissolveLimits';
import { DATA_HUD_BOX_RANGE, DATA_HUD_LINE_RANGE, DATA_HUD_MARK_RANGE, DATA_HUD_RATE_RANGE, DATA_HUD_SEED_RANGE, DATA_HUD_SIZE_RANGE, DATA_HUD_TEXT_RANGE } from './dataHudLimits';

const params: Record<string, EffectParam> = {
  scale: { type: 'number', label: 'Box Size', default: 240, min: 40, max: 400, step: 1, animatable: true, unit: ' px', group: 'Boxes',
    renderMin: DATA_HUD_SIZE_RANGE[0], renderMax: DATA_HUD_SIZE_RANGE[1] },
  boxes: { type: 'number', label: 'Boxes', default: 3, min: DATA_HUD_BOX_RANGE[0], max: DATA_HUD_BOX_RANGE[1], step: 1, animatable: true, group: 'Boxes' },
  variation: { type: 'number', label: 'Size Variation', default: 0.6, min: 0, max: 1, step: 0.01, animatable: true, group: 'Boxes' },
  gap: { type: 'number', label: 'Gap', default: 0.35, min: 0, max: 0.9, step: 0.01, animatable: true, group: 'Boxes' },
  lineWidth: { type: 'number', label: 'Line Width', default: 3, min: DATA_HUD_LINE_RANGE[0], max: DATA_HUD_LINE_RANGE[1], step: 1, animatable: true, unit: ' px', group: 'Boxes' },
  labels: { type: 'number', label: 'Labels', default: 0.7, min: 0, max: 1, step: 0.01, animatable: true, group: 'Marks' },
  textSize: { type: 'number', label: 'Text Size', default: 15, min: DATA_HUD_TEXT_RANGE[0], max: DATA_HUD_TEXT_RANGE[1], step: 1, animatable: true, unit: ' px', group: 'Marks' },
  dots: { type: 'number', label: 'Dots', default: 0.9, min: 0, max: 1, step: 0.01, animatable: true, group: 'Marks' },
  marks: { type: 'number', label: 'Small Marks', default: 3, min: DATA_HUD_MARK_RANGE[0], max: DATA_HUD_MARK_RANGE[1], step: 1, animatable: true, group: 'Marks' },
  textBlocks: { type: 'number', label: 'Text Blocks', default: 2, min: DATA_HUD_BOX_RANGE[0], max: DATA_HUD_BOX_RANGE[1], step: 1, animatable: true, group: 'Marks' },
  mask: { type: 'select', label: 'Object', default: 'dark', options: OBJECT_MASK_OPTIONS.map(option => ({ ...option })), group: 'Object' },
  threshold: { type: 'number', label: 'Threshold', default: 0.75, min: 0, max: 1, step: 0.01, animatable: true, group: 'Object' },
  colorA: { type: 'color', label: 'Lines', default: '#c8e04c', group: 'Color' },
  colorB: { type: 'color', label: 'Labels', default: '#e4e6e0', group: 'Color' },
  dotColor: { type: 'color', label: 'Dots', default: '#3cc8b4', group: 'Color' },
  markColor: { type: 'color', label: 'Marks', default: '#c8e04c', group: 'Color' },
  rate: { type: 'number', label: 'Rate', default: 1.5, min: DATA_HUD_RATE_RANGE[0], max: DATA_HUD_RATE_RANGE[1], step: 0.1, animatable: true, unit: ' /s',
    group: 'Motion', integratedAs: 'rateTravel' },
  drift: { type: 'number', label: 'Glide', default: 0.3, min: 0, max: 1, step: 0.01, animatable: true, group: 'Motion' },
  seed: { type: 'number', label: 'Seed', default: 0, min: DATA_HUD_SEED_RANGE[0], max: DATA_HUD_SEED_RANGE[1], step: 1, animatable: false, group: 'Motion' },
  amount: { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Mix' },
};

const ranges = {
  boxes: DATA_HUD_BOX_RANGE, variation: [0, 1], gap: [0, 0.9], lineWidth: DATA_HUD_LINE_RANGE, labels: [0, 1], textSize: DATA_HUD_TEXT_RANGE,
  dots: [0, 1], marks: DATA_HUD_MARK_RANGE, textBlocks: DATA_HUD_BOX_RANGE, drift: [0, 1], threshold: [0, 1], amount: [0, 1], seed: DATA_HUD_SEED_RANGE,
} as const;

/** Presets: only values that differ from the defaults (EffectPreset). */
const presets: readonly EffectPreset[] = [
  { id: 'tracking-data', name: 'Tracking Data', params: {} },
  // Nissan 350Z reel: lime boxes with open sides, teal centre dots and coordinate labels, jumping at the glitch rate.
  { id: '350z-overlay', name: '350Z Overlay', params: { scale: 300, gap: 0.4, lineWidth: 2, labels: 0.8 } },
  { id: 'quiet-scan', name: 'Quiet Scan', params: { boxes: 1, textBlocks: 1, labels: 0.4, rate: 0.7, gap: 0.2, drift: 0.6 } },
  { id: 'dense-readout', name: 'Dense Readout', params: { scale: 200, textBlocks: 3, labels: 1, textSize: 12, rate: 3 } },
];

export const dataHud: EffectDefinition = {
  id: 'data-hud', name: 'Data HUD', category: 'analog',
  shader, entryPoint: 'dataHudFragment', uniformSize: 0,
  params,
  presets,
  // The marks follow the playhead and hold while paused.
  requiresContinuousRender: false,
  timelineAnimated: true,
  paramWarnings: values => {
    const notes = clampedValueNotes(params, values, ranges);
    if (typeof values.rate === 'number' && values.rate < 0) notes.push(`Rate ${values.rate} is below 0; the marks hold still as at 0.`);
    return notes;
  },
  packUniforms: () => null,
};
