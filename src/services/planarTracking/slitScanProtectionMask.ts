import type { ClipMask } from '../../types/masks';
import type { SurfaceQuad } from '../../types/planarTracking';
import { transformMaskPoint } from '../../utils/maskTransform';
import { validQuad } from './surfaceGeometry';

/** Use a straight quadrilateral as-is; other shapes use their source-space bounds. */
export function slitScanTrackingQuad(mask: ClipMask, width: number, height: number): SurfaceQuad {
  if (!mask.closed || mask.vertices.length < 3 || mask.inverted || mask.purpose === 'crop') {
    throw new Error('Select a closed, non-inverted object mask first.');
  }
  const points = mask.vertices.map(vertex => transformMaskPoint(mask, vertex, { width, height }));
  const straight = mask.vertices.every(v => !v.handleIn.x && !v.handleIn.y && !v.handleOut.x && !v.handleOut.y);
  if (points.length === 4 && straight && validQuad(points as SurfaceQuad)) return points as SurfaceQuad;
  const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
  const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
  const quad: SurfaceQuad = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  if (!validQuad(quad)) throw new Error('The tracking area is too small.');
  return quad;
}

/** Editable reference-space mask: no keyframes, runtime objects, or alpha crop. */
export function slitScanProtectionMask(quad: SurfaceQuad, feather: number): Partial<ClipMask> {
  if (!validQuad(quad) || !Number.isFinite(feather) || feather < 0) throw new Error('Invalid protection mask geometry or feather.');
  return { name: 'Slit Scan protection', enabled: true, compositeEnabled: false, closed: true,
    feather, featherQuality: 50, inverted: false, mode: 'add', position: { x: 0, y: 0 }, rotation: 0,
    vertices: quad.map(point => ({ ...point, id: crypto.randomUUID(), handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' })) };
}
