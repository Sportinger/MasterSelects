import type { EffectParam } from '../../types';
import { MAX_HYBRID_TEMPORAL_SAMPLES } from '../sourceTemporalLimits';

/** Numeric query, age and optional motion fields; band vertices and clock table. */
export function slitScanGeometryBytes(params: Record<string, unknown>, width: number, height: number): number {
  const seamBytes = Number(params.seamSmoothing) > 0 ? width * height * 20 : 0;
  if (!['time-surface', 'motion-band', 'motion-surface'].includes(String(params.geometryMode))) return seamBytes;
  const band = ['motion-band', 'motion-surface'].includes(String(params.geometryMode));
  const fields = 2 + Number(band || Number(params.geometryFlowDepth ?? 0) !== 0);
  const columns = slitScanMeshColumns(params.geometryQuality);
  const rows = Math.max(1, Math.min(Math.max(288, Math.min(512, columns)), Math.round(columns * height / width)));
  let mipBytes = 0;
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    mipBytes += w * h * 4;
    if (w <= 1 && h <= 1) break;
  }
  return seamBytes + width * height * 16 * fields + mipBytes + 8193 * 4 + (MAX_HYBRID_TEMPORAL_SAMPLES + 1) * 16
    + (band ? (columns + 1) * (rows + 1) * 16 + 8192 * 16 : 0);
}

export function slitScanMeshColumns(quality: unknown): number {
  switch (quality) {
    case 'preview': return 128;
    case '512': return 512;
    case '1024': return 1024;
    case '2048': return 2048;
    default: return 256;
  }
}

/** Adaptive source history alone does not reduce trajectory/mesh work. */
export function slitScanGeometryGrid(params: Record<string, unknown>, width: number, height: number,
  interactive: boolean, exporting = false) {
  const requested = slitScanMeshColumns(params.geometryQuality);
  const adaptive = params.temporalPreview === 'adaptive' && interactive && !exporting;
  const columns = adaptive ? Math.min(128, requested) : requested;
  const rows = Math.max(1, Math.min(Math.max(288, Math.min(512, columns)), Math.round(columns * height / Math.max(1, width))));
  return { columns, rows, adaptive };
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
    { value: '512', label: '512 columns' }, { value: '1024', label: '1024 columns' },
    { value: '2048', label: '2048 columns' },
  ] },
  geometryTimeDepth: { type: 'number', label: 'Time depth / sec', default: .25, min: -5, max: 5, step: .01, group: '3D geometry', animatable: true },
  geometryMotionAmount: { type: 'number', label: 'Motion deformation', default: 1, min: 0, max: 2, step: .01, group: '3D geometry', animatable: true },
  geometryMotionGaps: { type: 'select', label: 'Untracked regions', default: 'hold', group: '3D geometry', options: [
    { value: 'hold', label: 'Keep time surface' }, { value: 'cut', label: 'Leave gaps' },
  ] },
  geometryFlowDepth: { type: 'number', label: 'Flow depth', default: 0, min: -2, max: 2, step: .01, group: '3D geometry', animatable: true },
  geometrySmoothing: { type: 'number', label: 'Geometry smoothing', default: 0, min: 0, max: 4, step: 1, group: '3D geometry', animatable: true },
};
