import shader from './shader.wgsl?raw';
import { createCatalogEffect } from '../_shared/catalogEffect';
import type { EffectParam } from '../types';
import { clampedValueNotes } from './analogParamWarnings';
import { CRT_LINE_COUNT_RANGE, CRT_MASK_OPTIONS, CRT_MASK_SIZE_RANGE, CRT_MIN_LINE_PX, CRT_MIN_STRIPE_PX } from './crtScreenLimits';

const unit = [0, 1] as const;
const params: Record<string, EffectParam> = {
  // Original CRT (saved before the 2026-10 rebuild) only: stripe width in output pixels.
  scale: { type: 'number', label: 'Mask Density', default: 3, min: 1, max: 12, step: 1, animatable: true, group: 'Phosphor Mask' },
  amount: { type: 'number', label: 'Mix', default: 1, min: 0, max: 1, step: 0.01, animatable: true },
  curvature: { type: 'number', label: 'Curvature', default: 0.35, min: 0, max: 1, step: 0.01, animatable: true, group: 'Screen', graphOnly: true },
  lineCount: { type: 'number', label: 'Line Count', default: 240, min: CRT_LINE_COUNT_RANGE[0], max: CRT_LINE_COUNT_RANGE[1], step: 1, animatable: true, group: 'Scanlines', graphOnly: true },
  scanlines: { type: 'number', label: 'Line Depth', default: 0.75, min: 0, max: 1, step: 0.01, animatable: true, group: 'Scanlines', graphOnly: true },
  maskType: { type: 'select', label: 'Mask', default: 'aperture', options: CRT_MASK_OPTIONS, group: 'Phosphor Mask', graphOnly: true },
  maskStrength: { type: 'number', label: 'Mask Strength', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true, group: 'Phosphor Mask', graphOnly: true },
  maskSize: { type: 'number', label: 'Mask Size', default: 2, min: CRT_MASK_SIZE_RANGE[0], max: CRT_MASK_SIZE_RANGE[1], step: 0.1, animatable: true, group: 'Phosphor Mask', graphOnly: true },
  flicker: { type: 'number', label: 'Flicker', default: 0.2, min: 0, max: 1, step: 0.01, animatable: true, group: 'Motion', graphOnly: true },
  speed: { type: 'number', label: 'Speed', default: 1, min: 0, max: 5, step: 0.05, animatable: true, group: 'Motion' },
};

const ranges = { amount: unit, curvature: unit, lineCount: CRT_LINE_COUNT_RANGE, scanlines: unit, maskStrength: unit,
  maskSize: CRT_MASK_SIZE_RANGE, flicker: unit };

/** Clamped values, and lines or mask stripes too fine to draw at the composition size (they fade out). */
function crtParamWarnings(values: Record<string, number | boolean | string>, _width?: number, height = 1080): string[] {
  // Effects without Line Count run the original CRT graph (saved before the 2026-10 rebuild).
  if (values.lineCount === undefined) return [];
  const notes = clampedValueNotes(params, values, ranges);
  const lines = typeof values.lineCount === 'number' ? Math.min(CRT_LINE_COUNT_RANGE[1], Math.max(CRT_LINE_COUNT_RANGE[0], values.lineCount)) : NaN;
  const linePx = height / lines;
  if (Number.isFinite(linePx) && linePx < CRT_MIN_LINE_PX) {
    notes.push(`At ${height} px frame height, ${format(lines)} lines are ${format(linePx)} px apart; lines closer than ${CRT_MIN_LINE_PX} px fade out (at most ${Math.floor(height / CRT_MIN_LINE_PX)} lines show fully).`);
  }
  const size = typeof values.maskSize === 'number' ? Math.min(CRT_MASK_SIZE_RANGE[1], Math.max(CRT_MASK_SIZE_RANGE[0], values.maskSize)) : NaN;
  const stripePx = size * height / 1080;
  if (Number.isFinite(stripePx) && stripePx < CRT_MIN_STRIPE_PX) {
    notes.push(`At ${height} px frame height, Mask Size ${format(size)} gives ${format(stripePx)} px stripes; the mask fades out below ${CRT_MIN_STRIPE_PX} px.`);
  }
  return notes;
}
const format = (value: number) => Number(value.toPrecision(3)).toString();

export const crtScreen = createCatalogEffect({
  id: 'crt-screen', name: 'CRT Screen', category: 'analog', shader, entryPoint: 'crtScreenFragment', animated: true,
  params,
  retired: {
    scale: 'CRT Screen sizes its mask with Mask Size; Mask Density only acts on CRT Screen effects saved before the 2026-10 rebuild.',
    angle: 'CRT Screen has no angle; the value is ignored.',
    colorA: 'CRT Screen has no ink color; the value is ignored.',
    colorB: 'CRT Screen has no paper color; the value is ignored.',
  },
  paramWarnings: crtParamWarnings,
});
