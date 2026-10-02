import type { Layer } from '../../../types';
import { calculateSourcePixelScale } from '../../../utils/sourcePixelScale';

export type CanvasPlacement = [number, number, number, number, number, number];
/** Same inverse 2D transform as composite.wgsl, including native pixel scale and aspect fit. */
export function canvasPlacement(layer: Pick<Layer, 'position' | 'scale' | 'rotation' | 'anchor'>,
  sourceWidth: number, sourceHeight: number, width: number, height: number): CanvasPlacement {
  const rotation = typeof layer.rotation === 'number' ? { x: 0, y: 0, z: layer.rotation } : layer.rotation;
  if (Math.abs(rotation.x) > 1e-6 || Math.abs(rotation.y) > 1e-6 || Math.abs(layer.position.z) > 1e-6) {
    throw new Error('AI canvas fill currently supports 2D placement, not tilted 3D planes.');
  }
  const aspect = width / height, ratio = sourceWidth / sourceHeight / aspect;
  const pixelScale = calculateSourcePixelScale(sourceWidth, sourceHeight, width, height);
  if (Math.abs(layer.scale.x) < 1e-6 || Math.abs(layer.scale.y) < 1e-6) throw new Error('Photo scale must be nonzero.');
  const ax = (ratio < 1 ? 1 / ratio : 1) / (layer.scale.x * pixelScale);
  const by = (ratio > 1 ? ratio : 1) / (layer.scale.y * pixelScale);
  const c = Math.cos(rotation.z), s = Math.sin(rotation.z);
  const a = ax * c, b = -ax * s / aspect, d = by * s * aspect, e = by * c;
  const x = .5 + layer.position.x * .5, y = .5 + layer.position.y * .5;
  return [a, b, .5 + (layer.anchor?.x ?? 0) - a * x - b * y,
    d, e, .5 + (layer.anchor?.y ?? 0) - d * x - e * y];
}

/** Expands only the render description; authored clip placement and bypass behavior remain intact. */
export function prepareCanvasEdgeFill(layer: Layer, effects: Layer['effects'], sourceWidth: number, sourceHeight: number,
  width: number, height: number, skipEffects: boolean) {
  const fill = !skipEffects && layer.source?.type === 'image' && effects.find(effect => effect.enabled
    && effect.type === 'ai-edge-fill' && effect.params.canvasSpace === true && effect.params.artifactId);
  if (!fill) return null;
  let matrix: CanvasPlacement;
  try { matrix = canvasPlacement(layer, sourceWidth, sourceHeight, width, height); } catch { return null; }
  return {
    layer: { ...layer, position: { x: 0, y: 0, z: 0 }, anchor: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 } },
    effects: effects.map(effect => effect === fill ? { ...effect, params: { ...effect.params, canvasWidth: width,
      ...Object.fromEntries(matrix.map((value, i) => [`placement${i}`, value])) } } : effect),
  };
}
