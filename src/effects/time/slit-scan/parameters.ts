import type { EffectParam } from '../../types';
import { finiteEffectNumber } from '../../_shared/effectNumberParam';
import { slitScanGeometryParams } from './geometryParameters';
import { spaceTimeParams } from './spaceTimeParameters';
import { MAX_HYBRID_TEMPORAL_SAMPLES } from '../sourceTemporalLimits';
import { slitScanTimeFieldParams, timeFieldChannelOptions } from './timeFieldParameters';

const number = (label: string, value: number, min: number, max: number, step: number, group: string): EffectParam =>
  ({ type: 'number', label, default: value, min, max, step, group, animatable: true });

// Radial scan and Time rings measure the distance from Center X/Y, so the scan Angle does nothing there; the
// Wave section shapes only the two wave profiles. The card dims these rows with the note (SlitScanControls).
const SCAN_AXIS_PROFILES = { param: 'profile', values: ['linear', 'center', 'wave'], note: 'Radial scan and Time rings spread from the centre: Angle does nothing there.' };
const WAVE_PROFILES = { param: 'profile', values: ['wave', 'rings'], note: 'Acts in the Wave / folds and Time rings profiles.' };

export const slitScanParams: Record<string, EffectParam> = {
  ...slitScanGeometryParams,
  ...spaceTimeParams,
  ...slitScanTimeFieldParams,
  temporalStorage: { type: 'select', label: 'Frame storage', default: 'resident', group: 'Sampling', options: [
    { value: 'cache', label: 'GPU cache' }, { value: 'hybrid', label: 'Hybrid · bounded GPU memory' },
    { value: 'resident', label: 'GPU history · resident video volume' },
  ] },
  temporalMemory: { type: 'select', label: 'History memory', default: '4096', group: 'Sampling', options: [
    { value: '640', label: '640 MiB' }, { value: '1024', label: '1 GiB' },
    { value: '2048', label: '2 GiB' }, { value: '4096', label: '4 GiB' },
  ] },
  temporalPreview: { type: 'select', label: 'Preview quality', default: 'adaptive', group: 'Preview quality', options: [
    { value: 'full', label: 'Full resolution' },
    { value: 'adaptive', label: 'Adaptive · playback / scrub / edits' },
  ] },
  // Blend is the default (and the runtime fallback for older saved effects): Nearest leaves hard stair steps.
  temporalInterpolation: { type: 'select', label: 'Temporal sampling', default: 'linear', group: 'Sampling', options: [
    { value: 'linear', label: 'Blend adjacent frames' }, { value: 'nearest', label: 'Nearest frame (no blending)' },
  ] },
  // Section switch in the inspector; the select value keeps room for other motion sources.
  temporalMotion: { type: 'select', label: 'Motion compensation', default: 'off', group: 'Resources', options: [
    { value: 'off', label: 'Off' }, { value: 'motion', label: 'DIS optical flow' },
  ] },
  temporalMotionStrength: number('Flow strength', 1, 0, 2, .01, 'Motion compensation'),
  temporalBatch: { type: 'select', label: 'Export processing', default: 'block', group: 'Sampling', options: [
    { value: 'single', label: 'Individual frames' }, { value: 'block', label: 'Shared source frames (Hybrid)' },
  ] },
  temporalSamples: { ...number('Samples', 1920, 2, MAX_HYBRID_TEMPORAL_SAMPLES, 1, 'Sampling'), animatable: false },
  scanSmoothing: number('Scan smoothing (px)', 0, 0, 4, 0.1, 'Sampling'),
  seamSmoothing: number('Seam smoothing (px)', 0, 0, 8, .1, 'Sampling'),
  seamEdgeProtection: number('Seam edge protection', .65, 0, 1, .01, 'Sampling'),
  scanStretchThreshold: number('Stretch threshold (×)', 2, 1.01, 16, .05, 'Sampling'),
  // Retain the old binding for user-authored consumers of the time-gradient node.
  scanTimeThreshold: number('Time change (ms / 1%)', 100, 0, 2000, 1, 'Resources'),
  scanSmoothingPreview: { type: 'boolean', label: 'Show smoothing areas', default: false, group: 'Resources' },
  temporalResolution: { type: 'select', label: 'Resolution', default: 'native', group: 'Sampling', options: [
    { value: 'native', label: 'Full size (follows preview Proxy mode)' },
    { value: '160', label: 'Small preview · 160 px' },
  ] },
  protectionMask: { type: 'text', label: 'Protection mask', default: '', group: 'Resources' },
  stabilizationAssetId: { type: 'text', label: 'Stabilization tracking', default: '', group: 'Resources' },
  stabilizationEnabled: { type: 'boolean', label: 'Enable stabilization', default: true, group: 'Resources' },
  stabilizationReference: { ...number('Reference (source s)', 0, 0, 86400, 0.001, 'Stabilization'), animatable: false },
  stabilizationStrength: { ...number('Strength', 1, 0, 1, 0.01, 'Stabilization'), animatable: false },
  stabilizationRotation: { type: 'select', label: 'Rotation', default: 'on', group: 'Stabilization', options: [
    { value: 'on', label: 'Lock rotation' }, { value: 'off', label: 'Keep rotation' },
  ] },
  stabilizationScale: { type: 'select', label: 'Scale', default: 'on', group: 'Stabilization', options: [
    { value: 'on', label: 'Lock size' }, { value: 'off', label: 'Keep size changes' },
  ] },
  mapMediaId: { type: 'text', label: 'Time map source', default: '', group: 'Resources' },
  mapAmount: number('Map mix', 0, 0, 1, 0.01, 'Time map'),
  mapStart: number('Map start (timeline s)', 0, -3600, 3600, 0.01, 'Time map'),
  mapChannel: { type: 'select', label: 'Map channel', default: 'luminance', group: 'Time map', options: [
    { value: 'luminance', label: 'Luminance' }, { value: 'alpha', label: 'Alpha' },
    ...timeFieldChannelOptions,
  ] },
  mapInvert: { type: 'select', label: 'Invert map', default: 'off', group: 'Time map', options: [
    { value: 'off', label: 'Off' }, { value: 'on', label: 'On' },
  ] },
  preview: { type: 'select', label: 'Preview', default: 'result', group: 'Time', options: [
    { value: 'result', label: 'Result' }, { value: 'time', label: 'Time map' }, { value: 'mask', label: 'Protection mask' },
  ] },
  maskStrength: number('Protection strength', 1, 0, 1, 0.01, 'Subject protection'),
  // 3 s (until 3.2.7: 1 s, where a figure in the middle of the frame barely changes). Every instance stores its
  // Delay, so saved projects keep theirs.
  delay: number('Delay (s)', 3, 0, 60, 0.01, 'Time'),
  timeFactor: number('Time factor (×)', 1, 1, 100, 0.1, 'Time'),
  bypassSlowdown: { type: 'boolean', label: 'Bypass slowdown', default: false, group: 'Resources' },
  profile: { type: 'select', label: 'Profile', default: 'linear', group: 'Time', options: [
    { value: 'linear', label: 'Linear scan' }, { value: 'center', label: 'Out from center' },
    { value: 'wave', label: 'Wave / folds' },
    { value: 'radial', label: 'Radial scan' }, { value: 'rings', label: 'Time rings' },
  ] },
  angle: { ...number('Angle (°)', 0, -180, 180, 1, 'Time'), activeWhen: SCAN_AXIS_PROFILES },
  mix: number('Mix', 1, 0, 1, 0.01, 'Time'),
  bands: number('Time bands', 0, 0, 64, 1, 'Time'),
  centerX: number('Center X', 0.5, 0, 1, 0.01, 'Protected center'),
  centerY: number('Center Y', 0.5, 0, 1, 0.01, 'Protected center'),
  protect: number('Radius', 0, 0, 1, 0.01, 'Protected center'),
  feather: number('Feather', 0.15, 0.001, 1, 0.01, 'Protected center'),
  waves: { ...number('Waves', 2, 0.1, 10, 0.1, 'Wave'), activeWhen: WAVE_PROFILES },
  phase: { ...number('Phase', 0, 0, 1, 0.01, 'Wave'), activeWhen: WAVE_PROFILES },
  speed: { ...number('Speed (cycles/s)', 0.15, -2, 2, 0.01, 'Wave'), activeWhen: WAVE_PROFILES },
};

/** A number param clamped to its range; null, NaN or text read as the default, like the graph (effectNumberParam.ts). */
export function slitScanNumber(params: Record<string, unknown>, key: string): number {
  const definition = slitScanParams[key];
  const value = finiteEffectNumber(params[key], Number(definition.default));
  return Math.max(definition.min!, Math.min(definition.max!, value));
}

/**
 * Notes on values the graph ignores (shown in the card and tool results): Time bands use-bands is
 * `bands > 1`, so a value above 0 up to 1 renders as off.
 */
export function slitScanParamWarnings(params: Record<string, unknown>): string[] {
  const bands = finiteEffectNumber(params.bands, 0);
  return bands > 0 && bands <= 1 ? [`Time bands ${bands} acts as off (0): set 2 or more to cut the picture into bands.`] : [];
}
