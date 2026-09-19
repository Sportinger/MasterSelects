import type { SurfacePoint, SurfaceQuad } from '../../types/planarTracking';
import type {
  PlanarTrackingProjectionDescriptor,
  TrackingScreenAnchorDescriptor,
  TrackingSourceTransform,
} from '../../types/terrainAttachment';
import { projectPoint, quadMatrix, sampleSurface, validQuad } from './surfaceGeometry';
import { IDENTITY_TRACKING_SOURCE_TRANSFORM, transformTrackingPoint } from './trackingSourceTransform';

export interface ResolvedTrackingScreenAnchor {
  contact: SurfacePoint;
  content: SurfacePoint;
}

function resolveTime(
  targetVideoClipId: string | undefined,
  sourcePresentedTime: number | undefined,
  displayedMediaTimes: ReadonlyMap<string, number>,
): number | null {
  const time = targetVideoClipId
    ? displayedMediaTimes.get(targetVideoClipId)
    : sourcePresentedTime;
  return typeof time === 'number' && Number.isFinite(time) ? time : null;
}

function resolveTransform(
  targetVideoClipId: string | undefined,
  transforms: ReadonlyMap<string, TrackingSourceTransform>,
): TrackingSourceTransform | null {
  return targetVideoClipId
    ? transforms.get(targetVideoClipId) ?? null
    : IDENTITY_TRACKING_SOURCE_TRANSFORM;
}

function placementQuad(descriptor: PlanarTrackingProjectionDescriptor): SurfaceQuad {
  const { binding } = descriptor;
  const placement = binding.placement ?? {
    x: binding.point.x,
    y: binding.point.y,
    width: 1,
    height: 1,
    rotation: 0,
  };
  const angle = placement.rotation * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return ([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const).map(([x, y]) => ({
    x: placement.x + cosine * x * placement.width - sine * y * placement.height,
    y: placement.y + sine * x * placement.width + cosine * y * placement.height,
  })) as SurfaceQuad;
}

export function resolvePlanarTrackingProjection(
  descriptor: PlanarTrackingProjectionDescriptor | undefined,
  displayedMediaTimes: ReadonlyMap<string, number>,
  transforms: ReadonlyMap<string, TrackingSourceTransform>,
): PlanarTrackingProjectionDescriptor | null {
  if (!descriptor) return null;
  const time = resolveTime(descriptor.binding.targetVideoClipId, descriptor.sourcePresentedTime, displayedMediaTimes);
  const transform = resolveTransform(descriptor.binding.targetVideoClipId, transforms);
  if (time === null || !transform) return null;
  const sample = sampleSurface(descriptor.track, time);
  if (!sample) return null;
  const surfaceToSource = quadMatrix(sample.quad);
  const quad = placementQuad(descriptor).map((point) => (
    transformTrackingPoint(transform, projectPoint(surfaceToSource, point))
  )) as Array<SurfacePoint | null>;
  if (quad.some((point) => !point)) return null;
  const projected = quad as SurfaceQuad;
  return validQuad(projected) ? { ...descriptor, quad: projected } : null;
}

export function resolvePlanarTrackingScreenAnchor(
  descriptor: TrackingScreenAnchorDescriptor | undefined,
  displayedMediaTimes: ReadonlyMap<string, number>,
  transforms: ReadonlyMap<string, TrackingSourceTransform>,
): ResolvedTrackingScreenAnchor | null {
  if (!descriptor) return null;
  const time = resolveTime(descriptor.binding.targetVideoClipId, descriptor.sourcePresentedTime, displayedMediaTimes);
  const transform = resolveTransform(descriptor.binding.targetVideoClipId, transforms);
  if (time === null || !transform) return null;
  const sample = sampleSurface(descriptor.track, time);
  if (!sample) return null;
  const sourcePoint = projectPoint(quadMatrix(sample.quad), descriptor.binding.point);
  const contact = transformTrackingPoint(transform, sourcePoint);
  if (!contact || contact.x < 0 || contact.x > 1 || contact.y < 0 || contact.y > 1) return null;
  const content = {
    x: contact.x + descriptor.binding.offset.x,
    y: contact.y + descriptor.binding.offset.y,
  };
  return Number.isFinite(content.x) && Number.isFinite(content.y) ? { contact, content } : null;
}
