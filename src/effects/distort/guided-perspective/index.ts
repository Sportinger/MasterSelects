import type { EffectDefinition, EffectParam } from '../../types';
import { IDENTITY } from './guideGeometry';
import shader from './shader.wgsl?raw';
// Card order (GuidedPerspectiveControls, one Perspective section): Guides, Framing, Strength, Scale.
const params: Record<string, EffectParam> = {
  guides: { type: 'text', label: 'Guides', default: '[]', hidden: true, group: 'perspective' },
  fillFrame: { type: 'boolean', label: 'Fill Frame', default: false, animatable: false, group: 'perspective' },
  strength: { type: 'number', label: 'Strength', default: 100, min: 0, max: 100, step: 0.1, animatable: true, group: 'perspective' },
  scale: { type: 'number', label: 'Scale', default: 100, min: 50, max: 300, step: 0.1, animatable: true, group: 'perspective' },
};
IDENTITY.forEach((value, i) => { params[`matrix${i}`] = { type: 'number', label: `Matrix ${i}`, default: value, hidden: true, animatable: false }; });

const MATRIX_LIMIT = 10000;
/** Fill Frame enlarges at most this much; a correction that needs more keeps the whole photo and says so. */
export const MAX_FILL_SCALE = 20;
/**
 * Rounding allowance (UV) at the photo edge. Frame corners on the edge are enough: the outermost pixel
 * centres then lie half a pixel inside the photo, where the shader's soft edge is already fully opaque.
 */
const FILL_TOLERANCE = 1e-9;
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

/** Whether every frame corner, pulled towards the middle by 1/scale, lands inside the photo. */
function coversFrame(m: number[], scale: number): boolean {
  return [[0, 0], [1, 0], [0, 1], [1, 1]].every(([x, y]) => {
    const u = (x - 0.5) / scale + 0.5, v = (y - 0.5) / scale + 0.5;
    const w = m[6] * u + m[7] * v + m[8];
    if (!(w > 1e-5)) return false;
    const su = (m[0] * u + m[1] * v + m[2]) / w, sv = (m[3] * u + m[4] * v + m[5]) / w;
    return su >= -FILL_TOLERANCE && su <= 1 + FILL_TOLERANCE && sv >= -FILL_TOLERANCE && sv <= 1 + FILL_TOLERANCE;
  });
}

/**
 * The smallest enlargement (at least 1) at which the corrected photo covers the whole frame, so no
 * transparent border is left; undefined when even MAX_FILL_SCALE leaves a gap. The photo's footprint is
 * convex and contains the middle, so coverage only grows with the enlargement and a bisection finds it.
 */
export function guidedPerspectiveFillScale(values: Values): number | undefined {
  const m = guidedPerspectiveMatrix(values);
  if (coversFrame(m, 1)) return 1;
  if (!coversFrame(m, MAX_FILL_SCALE)) return undefined;
  let low = 1, high = MAX_FILL_SCALE;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (coversFrame(m, mid)) high = mid; else low = mid;
  }
  return high;
}

/** The enlargement the shader applies: Scale, on top of the Fill Frame enlargement when that is on. */
export function guidedPerspectiveScale(values: Values): number {
  const scale = bounded(values, 'scale', 100, 50, 300) / 100;
  return values.fillFrame === true ? (guidedPerspectiveFillScale(values) ?? 1) * scale : scale;
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
  if (values.fillFrame === true && guidedPerspectiveFillScale(values) === undefined) {
    warnings.push(`Fill Frame would have to enlarge the photo more than ${MAX_FILL_SCALE}×; it keeps Whole photo framing. Redraw the guides along longer edges or lower Strength.`);
  }
  return warnings;
}

export const guidedPerspective: EffectDefinition = {
  id: 'guided-perspective', name: 'Guided Perspective', category: 'distort', shader,
  entryPoint: 'guidedPerspectiveFragment', uniformSize: 64, params,
  // Presets keep the drawn guides (hidden parameters a preset does not name stay as they are).
  presets: [
    { id: 'whole-photo', name: 'Whole Photo', params: { fillFrame: false, strength: 100 } },
    { id: 'fill-frame', name: 'Fill Frame', params: { fillFrame: true, strength: 100 } },
    { id: 'natural-lean', name: 'Natural Lean', params: { fillFrame: true, strength: 80 } },
    { id: 'soft-correction', name: 'Soft Correction', params: { fillFrame: true, strength: 50 } },
  ],
  paramWarnings: guidedPerspectiveWarnings,
  packUniforms(values) {
    const m = guidedPerspectiveMatrix(values);
    return new Float32Array([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0,
      guidedPerspectiveScale(values), 0, 0, 0]);
  },
};
