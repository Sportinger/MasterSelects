import type { EffectParam } from '../../types';

const number = (label: string, value: number, min: number, max: number, step: number, group: string): EffectParam =>
  ({ type: 'number', label, default: value, min, max, step, group, animatable: true });

export const slitScanParams: Record<string, EffectParam> = {
  temporalInterpolation: { type: 'select', label: 'Temporal sampling', default: 'linear', group: 'Sampling', options: [
    { value: 'linear', label: 'Blend adjacent frames' }, { value: 'nearest', label: 'Nearest frame (no blending)' },
  ] },
  temporalSamples: { ...number('Samples', 32, 2, 64, 1, 'Sampling'), animatable: false },
  temporalResolution: { type: 'select', label: 'Resolution', default: '160', group: 'Sampling', options: [
    { value: 'native', label: 'Full source resolution (streamed)' },
    { value: '160', label: 'Small preview · 160 px' },
  ] },
  protectionMask: { type: 'text', label: 'Protection mask', default: '', group: 'Resources' },
  mapMediaId: { type: 'text', label: 'Time map source', default: '', group: 'Resources' },
  mapAmount: number('Map mix', 0, 0, 1, 0.01, 'Time map'),
  mapStart: number('Map start (timeline s)', 0, -3600, 3600, 0.01, 'Time map'),
  mapChannel: { type: 'select', label: 'Map channel', default: 'luminance', group: 'Time map', options: [
    { value: 'luminance', label: 'Luminance' }, { value: 'alpha', label: 'Alpha' },
  ] },
  mapInvert: { type: 'select', label: 'Invert map', default: 'off', group: 'Time map', options: [
    { value: 'off', label: 'Off' }, { value: 'on', label: 'On' },
  ] },
  preview: { type: 'select', label: 'Preview', default: 'result', group: 'Time', options: [
    { value: 'result', label: 'Result' }, { value: 'time', label: 'Time map' }, { value: 'mask', label: 'Protection mask' },
  ] },
  maskStrength: number('Protection strength', 1, 0, 1, 0.01, 'Subject protection'),
  delay: number('Delay (s)', 1, 0, 4, 0.01, 'Time'),
  profile: { type: 'select', label: 'Profile', default: 'linear', group: 'Time', options: [
    { value: 'linear', label: 'Linear scan' }, { value: 'center', label: 'Out from center' },
    { value: 'wave', label: 'Wave / folds' },
    { value: 'radial', label: 'Radial scan' }, { value: 'rings', label: 'Time rings' },
  ] },
  angle: number('Angle (°)', 0, -180, 180, 1, 'Time'),
  mix: number('Mix', 1, 0, 1, 0.01, 'Time'),
  bands: number('Time bands (0 = off)', 0, 0, 64, 1, 'Time'),
  centerX: number('Center X', 0.5, 0, 1, 0.01, 'Protected center'),
  centerY: number('Center Y', 0.5, 0, 1, 0.01, 'Protected center'),
  protect: number('Radius', 0, 0, 1, 0.01, 'Protected center'),
  feather: number('Feather', 0.15, 0.001, 1, 0.01, 'Protected center'),
  waves: number('Waves', 2, 0.1, 10, 0.1, 'Wave'),
  phase: number('Phase', 0, 0, 1, 0.01, 'Wave'),
  speed: number('Speed (cycles/s)', 0.15, -2, 2, 0.01, 'Wave'),
};

export function slitScanNumber(params: Record<string, unknown>, key: string): number {
  const definition = slitScanParams[key];
  const value = Number(params[key] ?? definition.default);
  return Math.max(definition.min!, Math.min(definition.max!, Number.isFinite(value) ? value : Number(definition.default)));
}
