import type { EffectParam } from '../../types';

const number = (label: string, value: number, min: number, max: number, step: number, group: string): EffectParam =>
  ({ type: 'number', label, default: value, min, max, step, group, animatable: true });

export const slitScanParams: Record<string, EffectParam> = {
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
