import type { SlitScanGeometrySettings } from './geometryContract';

export function readSlitScanReference(value: unknown): SlitScanGeometrySettings['reference'] | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  if (!value || typeof value !== 'object') return undefined;
  const reference = value as SlitScanGeometrySettings['reference'];
  if (!['perspective', 'orthographic'].includes(reference.projection)) return undefined;
  if (![reference.viewProjection, reference.inverseViewProjection].every(matrix => Array.isArray(matrix)
    && matrix.length === 16 && matrix.every(Number.isFinite))) return undefined;
  if (!(reference.near > 0 && reference.far > reference.near && Number.isFinite(reference.far))) return undefined;
  return reference;
}

/** Image-local reference: z=0 spans [-.5,.5] in both axes. */
export function createSlitScanReference(projection: 'perspective' | 'orthographic',
  distance = 1 / Math.tan(25 * Math.PI / 180), near = .1, far = 1000): SlitScanGeometrySettings['reference'] {
  if (!(distance > near && far > distance && near > 0) || !Number.isFinite(far)) {
    throw new Error('Slit Scan reference must place the image between finite clipping planes.');
  }
  const perspective = projection === 'perspective';
  const scale = perspective ? 2 * distance : 2;
  const a = perspective ? far / (near - far) : 1 / (near - far);
  const b = near * a;
  const c = b - a * distance;
  const w = perspective ? distance : 1;
  const zW = perspective ? -1 : 0;
  const determinant = a * w - c * zW;
  return { projection, near, far,
    viewProjection: [scale,0,0,0, 0,scale,0,0, 0,0,a,zW, 0,0,c,w],
    inverseViewProjection: [1/scale,0,0,0, 0,1/scale,0,0,
      0,0,w/determinant,-zW/determinant, 0,0,-c/determinant,a/determinant],
  };
}
