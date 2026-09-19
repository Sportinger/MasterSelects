import type { ClipMask, MaskVertex } from '../../../types/masks';
import { transformMaskPoint, type MaskTransformSize } from '../../../utils/maskTransform';
import type { MaskVertexUpdate } from '../maskPathDragPreview';
import type { MaskOverlayPoint, ProjectMaskPoint } from './maskOverlayTypes';

export type MaskBoundsCorner = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

export interface MaskLocalBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ProjectedMaskBoundsCorner extends MaskOverlayPoint {
  corner: MaskBoundsCorner;
}

export interface ProjectedMaskBounds {
  corners: ProjectedMaskBoundsCorner[];
  path: string;
}

const BOUNDS_EPSILON = 0.000001;

export function getMaskLocalBounds(vertices: readonly MaskVertex[]): MaskLocalBounds | null {
  if (vertices.length === 0) return null;

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

  return { minX, minY, maxX, maxY };
}

function localCorner(bounds: MaskLocalBounds, corner: MaskBoundsCorner): MaskOverlayPoint {
  return {
    x: corner === 'topLeft' || corner === 'bottomLeft' ? bounds.minX : bounds.maxX,
    y: corner === 'topLeft' || corner === 'topRight' ? bounds.minY : bounds.maxY,
  };
}

function oppositeCorner(corner: MaskBoundsCorner): MaskBoundsCorner {
  if (corner === 'topLeft') return 'bottomRight';
  if (corner === 'topRight') return 'bottomLeft';
  if (corner === 'bottomRight') return 'topLeft';
  return 'topRight';
}

export function buildProjectedMaskBounds(
  mask: ClipMask,
  projectPoint: ProjectMaskPoint,
  sourceSize: MaskTransformSize,
): ProjectedMaskBounds | null {
  const bounds = getMaskLocalBounds(mask.vertices);
  if (!bounds) return null;

  const cornerOrder: MaskBoundsCorner[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
  const corners = cornerOrder.map(corner => ({
    corner,
    ...projectPoint(transformMaskPoint(mask, localCorner(bounds, corner), sourceSize)),
  }));
  const [first, ...rest] = corners;
  if (!first) return null;

  return {
    corners,
    path: `M ${first.x} ${first.y} ${rest.map(point => `L ${point.x} ${point.y}`).join(' ')} Z`,
  };
}

export function buildMaskBoundsResizeUpdates(
  mask: ClipMask,
  corner: MaskBoundsCorner,
  target: MaskOverlayPoint,
  preserveAspectRatio: boolean,
): MaskVertexUpdate[] | null {
  const bounds = getMaskLocalBounds(mask.vertices);
  if (!bounds) return null;

  const start = localCorner(bounds, corner);
  const anchor = localCorner(bounds, oppositeCorner(corner));
  const startWidth = start.x - anchor.x;
  const startHeight = start.y - anchor.y;
  if (Math.abs(startWidth) < BOUNDS_EPSILON || Math.abs(startHeight) < BOUNDS_EPSILON) return null;

  let scaleX = (target.x - anchor.x) / startWidth;
  let scaleY = (target.y - anchor.y) / startHeight;
  if (preserveAspectRatio) {
    const uniformScale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    scaleX = uniformScale;
    scaleY = uniformScale;
  }

  return mask.vertices.map(vertex => ({
    id: vertex.id,
    updates: {
      x: anchor.x + (vertex.x - anchor.x) * scaleX,
      y: anchor.y + (vertex.y - anchor.y) * scaleY,
      handleIn: {
        x: vertex.handleIn.x * scaleX,
        y: vertex.handleIn.y * scaleY,
      },
      handleOut: {
        x: vertex.handleOut.x * scaleX,
        y: vertex.handleOut.y * scaleY,
      },
    },
  }));
}
