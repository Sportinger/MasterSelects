import type { EffectParam } from '../../types';
import { MAX_HYBRID_TEMPORAL_SAMPLES } from '../sourceTemporalLimits';

/** Numeric query, age and optional motion fields; band vertices and clock table. */
export function slitScanGeometryBytes(params: Record<string, unknown>, width: number, height: number): number {
  if (!['time-surface', 'motion-band', 'motion-surface'].includes(String(params.geometryMode))) return 0;
  const band = ['motion-band', 'motion-surface'].includes(String(params.geometryMode));
  const fields = 2 + Number(band || Number(params.geometryFlowDepth ?? 0) !== 0);
  return width * height * (16 * fields + 4) + 8193 * 4 + (MAX_HYBRID_TEMPORAL_SAMPLES + 1) * 16
    + (band ? 257 * 289 * 16 + 8192 * 16 : 0);
}

export const slitScanGeometryParams: Record<string, EffectParam> = {
  geometryMode: { type: 'select', label: 'Representation', default: '2d', group: '3D geometry', options: [
    { value: '2d', label: '2D image' }, { value: 'time-surface', label: 'Reference time surface' },
    { value: 'motion-band', label: 'Free motion band' },
    { value: 'motion-surface', label: 'Motion-deformed surface' },
  ] },
  geometryProjection: { type: 'select', label: 'Reference projection', default: 'perspective', group: '3D geometry', options: [
    { value: 'perspective', label: 'Perspective' }, { value: 'orthographic', label: 'Orthographic' },
  ] },
  geometryTimeBasis: { type: 'select', label: 'Depth time source', default: 'query', group: '3D geometry', options: [
    { value: 'query', label: 'Continuous requested time' },
    { value: 'samples', label: 'Sampled source frames' },
  ] },
  geometryQuality: { type: 'select', label: 'Mesh quality', default: 'high', group: '3D geometry', options: [
    { value: 'preview', label: '128 columns' }, { value: 'high', label: '256 columns' },
  ] },
  geometryTimeDepth: { type: 'number', label: 'Time depth / sec', default: .25, min: -5, max: 5, step: .01, group: '3D geometry', animatable: true },
  geometryMotionAmount: { type: 'number', label: 'Motion deformation', default: 1, min: 0, max: 2, step: .01, group: '3D geometry', animatable: true },
  geometryMotionGaps: { type: 'select', label: 'Untracked regions', default: 'hold', group: '3D geometry', options: [
    { value: 'hold', label: 'Keep time surface' }, { value: 'cut', label: 'Leave gaps' },
  ] },
  geometryFlowDepth: { type: 'number', label: 'Flow depth', default: 0, min: -2, max: 2, step: .01, group: '3D geometry', animatable: true },
  geometrySmoothing: { type: 'number', label: 'Geometry smoothing', default: 0, min: 0, max: 4, step: 1, group: '3D geometry', animatable: true },
};
