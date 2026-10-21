import type { EffectDefinition, EffectParam } from '../../types';
import { IDENTITY } from './guideGeometry';
import shader from './shader.wgsl?raw';
const params: Record<string, EffectParam> = {
  guides: { type: 'text', label: 'Guides', default: '[]', hidden: true },
  scale: { type: 'number', label: 'Scale', default: 100, min: 50, max: 300, step: 0.1, animatable: true },
  strength: { type: 'number', label: 'Strength', default: 100, min: 0, max: 100, step: 0.1, animatable: true },
};
IDENTITY.forEach((value, i) => { params[`matrix${i}`] = { type: 'number', label: `Matrix ${i}`, default: value, hidden: true, animatable: false }; });

const MATRIX_LIMIT = 10000;
type Values = Record<string, number | boolean | string>;
const bounded = (values: Values, key: string, fallback: number, min: number, max: number) => typeof values[key] === 'number'
  && Number.isFinite(values[key]) ? Math.max(min, Math.min(max, values[key] as number)) : fallback;

/**
 * Output-to-source homography at the chosen Strength. Strength blends the matrix (normalized
 * to a bottom-right entry of 1) toward identity, so partial corrections stay projective and
 * straight lines stay straight.
 */
export function guidedPerspectiveMatrix(values: Values): number[] {
  const m = IDENTITY.map((fallback, i) => bounded(values, `matrix${i}`, fallback, -MATRIX_LIMIT, MATRIX_LIMIT));
  const strength = bounded(values, 'strength', 100, 0, 100) / 100;
  const norm = Math.abs(m[8]) > 1e-6 ? m[8] : 1;
  return m.map((value, i) => IDENTITY[i] + (value / norm - IDENTITY[i]) * strength);
}

export function guidedPerspectiveWarnings(values: Values): string[] {
  const warnings: string[] = [];
  for (const [key, min, max] of [['scale', 50, 300], ['strength', 0, 100]] as const) {
    const value = values[key];
    if (typeof value === 'number' && (!Number.isFinite(value) || value < min || value > max)) {
      warnings.push(`${key}: ${value} is outside ${min}..${max}; using ${bounded(values, key, 100, min, max)}.`);
    }
  }
  if (IDENTITY.some((_, i) => typeof values[`matrix${i}`] === 'number' && Math.abs(values[`matrix${i}`] as number) > MATRIX_LIMIT)) {
    warnings.push(`A perspective matrix entry exceeds ${MATRIX_LIMIT} and is clamped; redraw the guides.`);
  }
  return warnings;
}

export const guidedPerspective: EffectDefinition = {
  id: 'guided-perspective', name: 'Guided Perspective', category: 'distort', shader,
  entryPoint: 'guidedPerspectiveFragment', uniformSize: 64, params,
  paramWarnings: guidedPerspectiveWarnings,
  packUniforms(values) {
    const m = guidedPerspectiveMatrix(values);
    return new Float32Array([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0,
      bounded(values, 'scale', 100, 50, 300) / 100, 0, 0, 0]);
  },
};
