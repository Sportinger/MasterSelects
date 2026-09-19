import type { Layer } from '../../types/layers';
import type { SurfacePoint, SurfaceQuad } from '../../types/planarTracking';
import type { TrackingSourceTransform } from '../../types/terrainAttachment';
import type { ClipTransform } from '../../types/timelineCore';
import { projectPoint, quadMatrix, validQuad } from './surfaceGeometry';
import { trackingPreviewTransform } from './trackingPreviewTransform';

export const IDENTITY_TRACKING_SOURCE_TRANSFORM: TrackingSourceTransform = [
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
];

function degrees(value: number): number {
  return value * 180 / Math.PI;
}

/**
 * Reproduces the ordinary compositor's source-plane transform. Tracking data
 * is stored in full, presentation-oriented source coordinates, before crop.
 */
export function trackingSourceTransform(
  layer: Layer,
  source: { width: number; height: number },
  composition: { width: number; height: number },
): TrackingSourceTransform | null {
  if (!(source.width > 0 && source.height > 0 && composition.width > 0 && composition.height > 0)) return null;
  // Transition UV effects are intentionally not approximated by one matrix.
  if (layer.transitionRender) return null;
  const rotation = typeof layer.rotation === 'number'
    ? { x: 0, y: 0, z: degrees(layer.rotation) }
    : { x: degrees(layer.rotation.x), y: degrees(layer.rotation.y), z: degrees(layer.rotation.z) };
  const transform: ClipTransform = {
    position: { ...layer.position },
    anchor: layer.anchor ? { ...layer.anchor } : undefined,
    scale: { ...layer.scale },
    rotation,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
  };
  const preview = trackingPreviewTransform(transform, source, composition);
  const rect = layer.sourceRect ?? { x: 0, y: 0, width: 1, height: 1 };
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const toComposition = (point: SurfacePoint) => preview.toComposition({
    x: (point.x - rect.x) / rect.width,
    y: (point.y - rect.y) / rect.height,
  });
  const quad = [
    toComposition({ x: 0, y: 0 }),
    toComposition({ x: 1, y: 0 }),
    toComposition({ x: 1, y: 1 }),
    toComposition({ x: 0, y: 1 }),
  ] as SurfaceQuad;
  if (!validQuad(quad)) return null;
  const matrix = quadMatrix(quad);
  return [
    matrix[0]!, matrix[1]!, matrix[2]!,
    matrix[3]!, matrix[4]!, matrix[5]!,
    matrix[6]!, matrix[7]!, matrix[8]!,
  ];
}

export function transformTrackingPoint(
  transform: TrackingSourceTransform,
  point: SurfacePoint,
): SurfacePoint | null {
  const result = projectPoint([...transform], point);
  return Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
}
