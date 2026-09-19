import type { ClipMask, MaskVertex } from '../types/masks';

export interface MaskTransformPoint {
  x: number;
  y: number;
}

export interface MaskTransformSize {
  width: number;
  height: number;
}

export function getMaskGeometryCenter(vertices: readonly MaskVertex[]): MaskTransformPoint {
  if (vertices.length === 0) return { x: 0.5, y: 0.5 };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }

  return { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 };
}

function safeSize(size: MaskTransformSize): MaskTransformSize {
  return {
    width: Math.max(0.0001, Math.abs(size.width)),
    height: Math.max(0.0001, Math.abs(size.height)),
  };
}

export function transformMaskPoint(
  mask: Pick<ClipMask, 'vertices' | 'position' | 'rotation'>,
  point: MaskTransformPoint,
  size: MaskTransformSize,
): MaskTransformPoint {
  const center = getMaskGeometryCenter(mask.vertices);
  const dimensions = safeSize(size);
  const radians = ((mask.rotation ?? 0) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localX = (point.x - center.x) * dimensions.width;
  const localY = (point.y - center.y) * dimensions.height;

  return {
    x: center.x + (localX * cosine - localY * sine) / dimensions.width + (mask.position?.x ?? 0),
    y: center.y + (localX * sine + localY * cosine) / dimensions.height + (mask.position?.y ?? 0),
  };
}

export function inverseTransformMaskPoint(
  mask: Pick<ClipMask, 'vertices' | 'position' | 'rotation'>,
  point: MaskTransformPoint,
  size: MaskTransformSize,
): MaskTransformPoint {
  const center = getMaskGeometryCenter(mask.vertices);
  const dimensions = safeSize(size);
  const radians = -((mask.rotation ?? 0) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const translatedX = point.x - (mask.position?.x ?? 0);
  const translatedY = point.y - (mask.position?.y ?? 0);
  const localX = (translatedX - center.x) * dimensions.width;
  const localY = (translatedY - center.y) * dimensions.height;

  return {
    x: center.x + (localX * cosine - localY * sine) / dimensions.width,
    y: center.y + (localX * sine + localY * cosine) / dimensions.height,
  };
}

export function getMaskRotationCenter(
  mask: Pick<ClipMask, 'vertices' | 'position'>,
): MaskTransformPoint {
  const center = getMaskGeometryCenter(mask.vertices);
  return {
    x: center.x + (mask.position?.x ?? 0),
    y: center.y + (mask.position?.y ?? 0),
  };
}
