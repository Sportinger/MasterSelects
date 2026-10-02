import type { Layer } from '../types';
import { calculateSourcePixelScale } from './sourcePixelScale';

export type CanvasPlacement = [number, number, number, number, number, number];
/** Composition UV to photo UV, matching composite.wgsl's native pixel scale and aspect fit. */
export function canvasPlacement(layer: Pick<Layer, 'position' | 'scale' | 'rotation' | 'anchor'>,
  sourceWidth: number, sourceHeight: number, width: number, height: number): CanvasPlacement {
  const rotation = typeof layer.rotation === 'number' ? { x: 0, y: 0, z: layer.rotation } : layer.rotation;
  if (Math.abs(rotation.x) > 1e-6 || Math.abs(rotation.y) > 1e-6 || Math.abs(layer.position.z) > 1e-6) {
    throw new Error('Photo editing currently supports 2D placement, not tilted 3D planes.');
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
