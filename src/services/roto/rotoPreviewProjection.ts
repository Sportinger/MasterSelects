import type { ClipTransform } from '../../types/timelineCore';
import type { LayerSourceRect } from '../../types/layers';
import type { SurfacePoint, SurfaceQuad } from '../../types/planarTracking';
import { trackingPreviewTransform } from '../planarTracking/trackingPreviewTransform';
import { quadMatrix } from '../planarTracking/surfaceGeometry';
import type { RotoMask } from './rotoTypes';

export function sampleRotoMask(masks: Iterable<RotoMask>, time: number) {
  for (const mask of masks) if (time >= mask.time - .6e-6 && time < mask.time + mask.duration - .6e-6) return mask;
  return undefined;
}

export function rotoPreviewProjection(transform: ClipTransform, source: { width: number; height: number },
  output: { width: number; height: number }, display: { width: number; height: number },
  crop: LayerSourceRect = { x: 0, y: 0, width: 1, height: 1 }) {
  const mapping = trackingPreviewTransform(transform, source, output);
  const toDisplay = (uv: SurfacePoint) => {
    const p = mapping.toComposition({ x: (uv.x - crop.x) / crop.width, y: (uv.y - crop.y) / crop.height });
    return { x: p.x * display.width, y: p.y * display.height };
  };
  const toSource = (point: SurfacePoint) => {
    const p = mapping.toSource({ x: point.x / display.width, y: point.y / display.height });
    if (!Number.isFinite(p.x + p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
    return { x: crop.x + p.x * crop.width, y: crop.y + p.y * crop.height };
  };
  const quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map(p => {
    const v = mapping.toComposition(p); return { x: v.x * display.width, y: v.y * display.height };
  }) as SurfaceQuad;
  const h = quadMatrix(quad);
  // CSS uses column-major entries; the bitmap's CSS unit square maps to the visible source quad.
  const cssMatrix = [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]];
  return { toDisplay, toSource, cssMatrix, crop };
}
