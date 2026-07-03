import type { Layer } from "../../../types/layers";
import type { ClipTransform } from "../../../types/timelineCore";
import type { ClipMask, MaskVertex } from "../../../types/masks";
import { getEffectiveScale } from "../../../utils/transformScale";
import { type LayerUvProjectionParams } from '../editModeOverlayMath';
import type {
  CanvasMaskVertex,
  MaskEdgeSegment,
  ProjectMaskPoint,
  VisibleMaskPath,
} from './maskOverlayTypes';

const DEFAULT_MASK_OUTLINE_COLOR = '#2997E5';

export function withClipProjectionTransform(
  layer: Layer | undefined,
  transform: ClipTransform | null | undefined,
): Layer | undefined {
  if (!layer || !transform) return layer;

  return {
    ...layer,
    position: { ...transform.position },
    scale: getEffectiveScale(transform.scale),
    rotation: {
      x: (transform.rotation.x * Math.PI) / 180,
      y: (transform.rotation.y * Math.PI) / 180,
      z: (transform.rotation.z * Math.PI) / 180,
    },
  };
}

export function getLayerSourceSize(
  layer: Layer | undefined,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  if (!layer?.source) return fallback;

  if (layer.source.videoElement) {
    return {
      width: layer.source.videoElement.videoWidth || fallback.width,
      height: layer.source.videoElement.videoHeight || fallback.height,
    };
  }
  if (layer.source.imageElement) {
    return {
      width: layer.source.imageElement.naturalWidth || fallback.width,
      height: layer.source.imageElement.naturalHeight || fallback.height,
    };
  }
  if (layer.source.textCanvas) {
    return {
      width: layer.source.textCanvas.width || fallback.width,
      height: layer.source.textCanvas.height || fallback.height,
    };
  }
  if (layer.source.nestedComposition) {
    return {
      width: layer.source.nestedComposition.width || fallback.width,
      height: layer.source.nestedComposition.height || fallback.height,
    };
  }
  if (layer.source.intrinsicWidth && layer.source.intrinsicHeight) {
    return {
      width: layer.source.intrinsicWidth,
      height: layer.source.intrinsicHeight,
    };
  }

  return fallback;
}

export function getProjectionParams(
  layer: Layer | undefined,
  canvasWidth: number,
  canvasHeight: number,
): LayerUvProjectionParams | null {
  if (!layer) return null;

  const sourceSize = getLayerSourceSize(layer, { width: canvasWidth, height: canvasHeight });
  return {
    sourceWidth: sourceSize.width,
    sourceHeight: sourceSize.height,
    outputWidth: canvasWidth,
    outputHeight: canvasHeight,
    canvasWidth,
    canvasHeight,
    position: layer.position,
    scale: layer.scale,
    rotation: layer.rotation,
    perspective: 2,
    uvClampMin: -1000,
    uvClampMax: 1001,
  };
}

export function buildProjectedMaskPath(
  mask: ClipMask,
  projectPoint: ProjectMaskPoint,
): string {
  if (mask.vertices.length < 2) return '';

  const posX = mask.position?.x || 0;
  const posY = mask.position?.y || 0;
  const pointFor = (point: { x: number; y: number }) => projectPoint({ x: point.x + posX, y: point.y + posY });
  let d = '';

  for (let i = 0; i < mask.vertices.length; i += 1) {
    const vertex = mask.vertices[i]!;
    const projectedVertex = pointFor(vertex);
    if (i === 0) {
      d += `M ${projectedVertex.x} ${projectedVertex.y}`;
      continue;
    }

    const prev = mask.vertices[i - 1]!;
    const cp1 = pointFor({ x: prev.x + prev.handleOut.x, y: prev.y + prev.handleOut.y });
    const cp2 = pointFor({ x: vertex.x + vertex.handleIn.x, y: vertex.y + vertex.handleIn.y });
    d += ` C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${projectedVertex.x},${projectedVertex.y}`;
  }

  if (mask.closed && mask.vertices.length > 2) {
    const last = mask.vertices[mask.vertices.length - 1]!;
    const first = mask.vertices[0]!;
    const cp1 = pointFor({ x: last.x + last.handleOut.x, y: last.y + last.handleOut.y });
    const cp2 = pointFor({ x: first.x + first.handleIn.x, y: first.y + first.handleIn.y });
    const projectedFirst = pointFor(first);
    d += ` C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${projectedFirst.x},${projectedFirst.y} Z`;
  }

  return d;
}

function getMaskOutlineColor(mask: ClipMask): string {
  return mask.outlineColor || DEFAULT_MASK_OUTLINE_COLOR;
}

export function buildCanvasMaskVertices(mask: ClipMask | undefined, projectPoint: ProjectMaskPoint): CanvasMaskVertex[] {
  if (!mask) return [];
  const posX = mask.position?.x || 0;
  const posY = mask.position?.y || 0;

  return mask.vertices.map((vertex) => {
    const point = projectPoint({ x: vertex.x + posX, y: vertex.y + posY });
    const handleInPoint = projectPoint({ x: vertex.x + posX + vertex.handleIn.x, y: vertex.y + posY + vertex.handleIn.y });
    const handleOutPoint = projectPoint({ x: vertex.x + posX + vertex.handleOut.x, y: vertex.y + posY + vertex.handleOut.y });

    return {
      ...vertex,
      ...point,
      handleIn: {
        x: handleInPoint.x - point.x,
        y: handleInPoint.y - point.y,
      },
      handleOut: {
        x: handleOutPoint.x - point.x,
        y: handleOutPoint.y - point.y,
      },
    };
  });
}

export function buildVisibleMaskPaths(
  masks: ClipMask[] | undefined,
  projectPoint: ProjectMaskPoint,
): VisibleMaskPath[] {
  return (masks || [])
    .filter(mask => mask.visible && mask.vertices.length >= 2)
    .map(mask => ({
      id: mask.id,
      d: buildProjectedMaskPath(mask, projectPoint),
      closed: mask.closed,
      color: getMaskOutlineColor(mask),
    }))
    .filter(path => path.d.length > 0);
}

export function buildMaskEdgeSegments(mask: ClipMask | undefined, projectPoint: ProjectMaskPoint): MaskEdgeSegment[] {
  if (!mask || !mask.visible || mask.vertices.length < 2) return [];
  const verts = mask.vertices;
  const posX = mask.position?.x || 0;
  const posY = mask.position?.y || 0;
  const segments: MaskEdgeSegment[] = [];
  const pointFor = (point: { x: number; y: number }) => projectPoint({ x: point.x + posX, y: point.y + posY });

  for (let i = 1; i < verts.length; i++) {
    const prev = verts[i - 1];
    const curr = verts[i];
    const prevPoint = pointFor(prev);
    const currPoint = pointFor(curr);
    const cp1 = pointFor({ x: prev.x + prev.handleOut.x, y: prev.y + prev.handleOut.y });
    const cp2 = pointFor({ x: curr.x + curr.handleIn.x, y: curr.y + curr.handleIn.y });
    segments.push({
      d: `M ${prevPoint.x} ${prevPoint.y} C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${currPoint.x},${currPoint.y}`,
      idA: prev.id,
      idB: curr.id,
      fromIndex: i - 1,
      toIndex: i,
    });
  }

  if (mask.closed && verts.length > 2) {
    const last = verts[verts.length - 1];
    const first = verts[0];
    const lastPoint = pointFor(last);
    const firstPoint = pointFor(first);
    const cp1 = pointFor({ x: last.x + last.handleOut.x, y: last.y + last.handleOut.y });
    const cp2 = pointFor({ x: first.x + first.handleIn.x, y: first.y + first.handleIn.y });
    segments.push({
      d: `M ${lastPoint.x} ${lastPoint.y} C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${firstPoint.x},${firstPoint.y}`,
      idA: last.id,
      idB: first.id,
      fromIndex: verts.length - 1,
      toIndex: 0,
    });
  }

  return segments;
}

export function buildShapePreviewPath(
  shapeDrawState: { isDrawing: boolean; startX: number; startY: number; currentX: number; currentY: number },
  maskEditMode: string,
  projectPoint: ProjectMaskPoint,
): string {
  if (!shapeDrawState.isDrawing || (maskEditMode !== 'drawingRect' && maskEditMode !== 'drawingEllipse')) return '';

  const minX = Math.min(shapeDrawState.startX, shapeDrawState.currentX);
  const maxX = Math.max(shapeDrawState.startX, shapeDrawState.currentX);
  const minY = Math.min(shapeDrawState.startY, shapeDrawState.currentY);
  const maxY = Math.max(shapeDrawState.startY, shapeDrawState.currentY);
  let vertices: MaskVertex[];

  if (maskEditMode === 'drawingRect') {
    vertices = [
      { id: 'preview-1', x: minX, y: minY, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'preview-2', x: maxX, y: minY, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'preview-3', x: maxX, y: maxY, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'preview-4', x: minX, y: maxY, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
    ];
  } else {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = (maxX - minX) / 2;
    const ry = (maxY - minY) / 2;
    const k = 0.5523;
    vertices = [
      { id: 'preview-1', x: cx, y: minY, handleIn: { x: -rx * k, y: 0 }, handleOut: { x: rx * k, y: 0 }, handleMode: 'mirrored' },
      { id: 'preview-2', x: maxX, y: cy, handleIn: { x: 0, y: -ry * k }, handleOut: { x: 0, y: ry * k }, handleMode: 'mirrored' },
      { id: 'preview-3', x: cx, y: maxY, handleIn: { x: rx * k, y: 0 }, handleOut: { x: -rx * k, y: 0 }, handleMode: 'mirrored' },
      { id: 'preview-4', x: minX, y: cy, handleIn: { x: 0, y: ry * k }, handleOut: { x: 0, y: -ry * k }, handleMode: 'mirrored' },
    ];
  }

  return buildProjectedMaskPath({
    id: 'shape-preview',
    name: 'Shape Preview',
    vertices,
    closed: true,
    opacity: 1,
    feather: 0,
    featherQuality: 50,
    inverted: false,
    mode: 'add',
    expanded: false,
    position: { x: 0, y: 0 },
    enabled: true,
    visible: true,
  }, projectPoint);
}
