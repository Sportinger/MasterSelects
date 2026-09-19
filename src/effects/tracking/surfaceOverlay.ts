import type { EffectDefinition } from '../types';
import type { SurfaceQuad } from '../../types/planarTracking';
import { inverseMatrix, quadMatrix } from '../../services/planarTracking/surfaceGeometry';
import shader from './surfaceOverlay.wgsl?raw';

/** Internal render primitive. User-facing authoring lives in the Tracking tab. */
export const surfaceOverlay: EffectDefinition = {
  internal: true,
  id: 'surface-overlay', name: 'Surface Overlay', category: 'tracking', shader,
  entryPoint: 'surfaceOverlayFragment', uniformSize: 128, params: {},
  packUniforms(params, width, height) {
    const quad = Array.from({ length: 4 }, (_, i) => ({ x: Number(params[`x${i}`]), y: Number(params[`y${i}`]) })) as SurfaceQuad;
    const m = inverseMatrix(quadMatrix(quad));
    if (!m || m.some(v => !Number.isFinite(v))) return null;
    const hex = /^#[0-9a-f]{6}$/i.test(String(params.color)) ? String(params.color) : '#ff3535';
    const color = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255);
    return new Float32Array([
      ...m.slice(0,3), 0, ...m.slice(3,6), 0, ...m.slice(6,9), 0,
      ...color, Number(params.opacity ?? 1),
      width, height, Number(params.lineWidth ?? 3), Number(params.fill ?? 0.12),
      Number(params.inset ?? 0), params.shape === 'ellipse' ? 1 : params.shape === 'cross' ? 2 : 0, params.occluded ? 1 : 0, 0,
      ...Array.from({length:4},(_,i)=>[Number(params[`ox${i}`] ?? 0),Number(params[`oy${i}`] ?? 0)]).flat(),
    ]);
  },
};
