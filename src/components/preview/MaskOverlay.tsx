// MaskOverlay - SVG overlay for mask drawing and editing on preview canvas

import './MaskOverlay.css';
import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { getShortcutRegistry } from '../../services/shortcutRegistry';
import { startBatch, endBatch } from '../../stores/historyStore';
import { projectLayerUvToCanvas, unprojectCanvasToLayerUv, type LayerUvProjectionParams } from './editModeOverlayMath';
import {
  getNextMaskVertexHandleMode,
  inferMaskVertexHandleMode,
} from '../../utils/maskVertexHandles';
import { createMaskPathProperty, type ClipMask, type Layer, type MaskPathKeyframeValue, type MaskVertex, type MaskVertexHandleMode } from '../../types';
import { useMaskVertexDrag } from './useMaskVertexDrag';
import { useMaskDrag } from './useMaskDrag';
import { useMaskEdgeDrag } from './useMaskEdgeDrag';
import { useMaskShapeDraw } from './useMaskShapeDraw';

const DEFAULT_MASK_OUTLINE_COLOR = '#2997E5';

interface MaskOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
  displayWidth: number;
  displayHeight: number;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function constrainHandleDelta(dx: number, dy: number, shiftKey: boolean): { x: number; y: number } {
  if (!shiftKey) return { x: dx, y: dy };

  const length = Math.hypot(dx, dy);
  if (length < 0.000001) return { x: 0, y: 0 };

  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: Math.cos(snappedAngle) * length,
    y: Math.sin(snappedAngle) * length,
  };
}

function lerpPoint(a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function isZeroHandle(handle: { x: number; y: number }): boolean {
  return Math.hypot(handle.x, handle.y) < 0.000001;
}

function getDisplayHandleEndpoint(
  vertex: { x: number; y: number; handleIn: { x: number; y: number }; handleOut: { x: number; y: number } },
  handleType: 'handleIn' | 'handleOut',
  previousVertex: { x: number; y: number } | undefined,
  nextVertex: { x: number; y: number } | undefined,
): { x: number; y: number } {
  const handle = handleType === 'handleIn' ? vertex.handleIn : vertex.handleOut;
  const handleLength = Math.hypot(handle.x, handle.y);
  const minHandleLength = 24;

  if (handleLength >= minHandleLength) {
    return {
      x: vertex.x + handle.x,
      y: vertex.y + handle.y,
    };
  }

  const neighbor = handleType === 'handleIn' ? previousVertex : nextVertex;
  const fallbackDirection = handleType === 'handleIn' ? { x: -1, y: 0 } : { x: 1, y: 0 };
  const rawDirection = handleLength > 0.001
    ? { x: handle.x, y: handle.y }
    : neighbor
      ? { x: neighbor.x - vertex.x, y: neighbor.y - vertex.y }
      : fallbackDirection;
  const directionLength = Math.hypot(rawDirection.x, rawDirection.y);
  const direction = directionLength > 0.001
    ? { x: rawDirection.x / directionLength, y: rawDirection.y / directionLength }
    : fallbackDirection;

  return {
    x: vertex.x + direction.x * minHandleLength,
    y: vertex.y + direction.y * minHandleLength,
  };
}

function cubicPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const a = lerpPoint(p0, p1, t);
  const b = lerpPoint(p1, p2, t);
  const c = lerpPoint(p2, p3, t);
  const d = lerpPoint(a, b, t);
  const e = lerpPoint(b, c, t);
  return lerpPoint(d, e, t);
}

interface PenEdgeInsertPreview {
  insertIndex: number;
  prevVertexId: string;
  nextVertexId: string;
  t: number;
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
}

interface SplitSegmentResult {
  vertex: Omit<MaskVertex, 'id'>;
  prevHandleOut: { x: number; y: number };
  nextHandleIn: { x: number; y: number };
}

function splitMaskSegment(mask: ClipMask, preview: PenEdgeInsertPreview): SplitSegmentResult | null {
  const prev = mask.vertices.find(vertex => vertex.id === preview.prevVertexId);
  const next = mask.vertices.find(vertex => vertex.id === preview.nextVertexId);
  if (!prev || !next) return null;

  const p0 = { x: prev.x, y: prev.y };
  const p1 = { x: prev.x + prev.handleOut.x, y: prev.y + prev.handleOut.y };
  const p2 = { x: next.x + next.handleIn.x, y: next.y + next.handleIn.y };
  const p3 = { x: next.x, y: next.y };
  const t = preview.t;

  if (isZeroHandle(prev.handleOut) && isZeroHandle(next.handleIn)) {
    return {
      vertex: {
        x: preview.x,
        y: preview.y,
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
        handleMode: 'none',
      },
      prevHandleOut: { x: 0, y: 0 },
      nextHandleIn: { x: 0, y: 0 },
    };
  }

  const p01 = lerpPoint(p0, p1, t);
  const p12 = lerpPoint(p1, p2, t);
  const p23 = lerpPoint(p2, p3, t);
  const p012 = lerpPoint(p01, p12, t);
  const p123 = lerpPoint(p12, p23, t);
  const p = lerpPoint(p012, p123, t);
  const insertedVertex: Omit<MaskVertex, 'id'> = {
    x: p.x,
    y: p.y,
    handleIn: { x: p012.x - p.x, y: p012.y - p.y },
    handleOut: { x: p123.x - p.x, y: p123.y - p.y },
  };

  return {
    vertex: {
      ...insertedVertex,
      handleMode: inferMaskVertexHandleMode({ id: 'preview', ...insertedVertex }),
    },
    prevHandleOut: { x: p01.x - p0.x, y: p01.y - p0.y },
    nextHandleIn: { x: p23.x - p3.x, y: p23.y - p3.y },
  };
}

function buildMaskPathValueWithVertexUpdates(
  mask: ClipMask,
  vertexUpdates: Array<{ id: string; updates: Partial<MaskVertex> }>,
): MaskPathKeyframeValue {
  const updatesById = new Map(vertexUpdates.map(({ id, updates }) => [id, updates]));
  return {
    closed: mask.closed,
    vertices: mask.vertices.map(vertex => {
      const updates = updatesById.get(vertex.id);
      const nextVertex = updates ? { ...vertex, ...updates } : vertex;
      return {
        ...nextVertex,
        handleIn: updates?.handleIn ? { ...updates.handleIn } : { ...vertex.handleIn },
        handleOut: updates?.handleOut ? { ...updates.handleOut } : { ...vertex.handleOut },
      };
    }),
  };
}

function getNearestMaskEdgeInsert(
  mask: ClipMask,
  point: { x: number; y: number },
  canvasWidth: number,
  canvasHeight: number,
  maxDistancePx: number,
  projectPoint?: (point: { x: number; y: number }) => { x: number; y: number },
  pointerCanvas?: { x: number; y: number },
): PenEdgeInsertPreview | null {
  if (mask.vertices.length < 2) return null;

  const posX = mask.position?.x || 0;
  const posY = mask.position?.y || 0;
  const pointerX = pointerCanvas?.x ?? point.x * canvasWidth;
  const pointerY = pointerCanvas?.y ?? point.y * canvasHeight;
  const segmentCount = mask.closed ? mask.vertices.length : mask.vertices.length - 1;
  let closest: PenEdgeInsertPreview | null = null;
  let closestDistance = maxDistancePx;

  for (let index = 0; index < segmentCount; index += 1) {
    const prev = mask.vertices[index];
    const next = mask.vertices[(index + 1) % mask.vertices.length];
    if (!prev || !next) continue;

    const p0 = { x: prev.x, y: prev.y };
    const p1 = { x: prev.x + prev.handleOut.x, y: prev.y + prev.handleOut.y };
    const p2 = { x: next.x + next.handleIn.x, y: next.y + next.handleIn.y };
    const p3 = { x: next.x, y: next.y };

    for (let step = 1; step < 40; step += 1) {
      const t = step / 40;
      const sample = cubicPoint(p0, p1, p2, p3, t);
      const projected = projectPoint
        ? projectPoint({ x: sample.x + posX, y: sample.y + posY })
        : { x: (sample.x + posX) * canvasWidth, y: (sample.y + posY) * canvasHeight };
      const canvasX = projected.x;
      const canvasY = projected.y;
      const sampleDistance = Math.hypot(canvasX - pointerX, canvasY - pointerY);

      if (sampleDistance < closestDistance) {
        closestDistance = sampleDistance;
        closest = {
          insertIndex: index + 1,
          prevVertexId: prev.id,
          nextVertexId: next.id,
          t,
          x: sample.x,
          y: sample.y,
          canvasX,
          canvasY,
        };
      }
    }
  }

  return closest;
}

function getLayerSourceSize(layer: Layer | undefined, fallback: { width: number; height: number }): { width: number; height: number } {
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

function getProjectionParams(
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
  };
}

function buildProjectedMaskPath(
  mask: ClipMask,
  projectPoint: (point: { x: number; y: number }) => { x: number; y: number },
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

export function MaskOverlay({ canvasWidth, canvasHeight, displayWidth, displayHeight }: MaskOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const suppressNextSvgClickRef = useRef(false);
  const [hoveredVertexId, setHoveredVertexId] = useState<string | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [penInsertPreview, setPenInsertPreview] = useState<PenEdgeInsertPreview | null>(null);

  const {
    clips,
    layers,
    selectedClipIds,
    playheadPosition,
    maskEditMode,
    activeMaskId,
    selectedVertexIds,
    setMaskEditMode,
    deselectAllVertices,
    selectVertex,
    selectVertices,
    addVertex,
    closeMask,
    addMask,
    updateMask,
    updateVertex,
    updateVertices,
    setVertexHandleMode,
    setActiveMask,
    getInterpolatedMasks,
  } = useTimelineStore();

  // Get first selected clip for mask editing
  const selectedClipId = selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;
  const selectedClip = clips.find(c => c.id === selectedClipId);
  const selectedClipMasks = selectedClip
    ? getInterpolatedMasks(selectedClip.id, playheadPosition - selectedClip.startTime) ?? selectedClip.masks
    : undefined;
  const activeMask = selectedClipMasks?.find(m => m.id === activeMaskId) ?? selectedClipMasks?.[0];
  const activeLayer = useMemo(() => {
    if (!selectedClip) return undefined;
    return layers.find(layer => layer?.sourceClipId === selectedClip.id)
      || layers.find(layer => layer?.name === selectedClip.name);
  }, [layers, selectedClip]);
  const projectionParams = useMemo(
    () => getProjectionParams(activeLayer, canvasWidth, canvasHeight),
    [activeLayer, canvasHeight, canvasWidth],
  );
  const projectMaskPoint = useCallback((point: { x: number; y: number }) => {
    if (!projectionParams) {
      return { x: point.x * canvasWidth, y: point.y * canvasHeight };
    }
    return projectLayerUvToCanvas(point, projectionParams);
  }, [canvasHeight, canvasWidth, projectionParams]);

  const getCanvasPoint = useCallback((e: MouseEvent | React.MouseEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;

    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    return {
      x: (e.clientX - rect.left) * (canvasWidth / rect.width),
      y: (e.clientY - rect.top) * (canvasHeight / rect.height),
    };
  }, [canvasHeight, canvasWidth]);

  const getNormalizedPoint = useCallback((e: MouseEvent | React.MouseEvent): { x: number; y: number } | null => {
    const canvasPoint = getCanvasPoint(e);
    if (!canvasPoint) return null;
    const point = projectionParams
      ? unprojectCanvasToLayerUv(canvasPoint, projectionParams)
      : { x: canvasPoint.x / canvasWidth, y: canvasPoint.y / canvasHeight };

    return {
      x: clamp01(point.x),
      y: clamp01(point.y),
    };
  }, [canvasHeight, canvasWidth, getCanvasPoint, projectionParams]);

  const clientToLocalPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const syntheticPoint = {
      clientX,
      clientY,
    } as MouseEvent;
    return getNormalizedPoint(syntheticPoint);
  }, [getNormalizedPoint]);

  // Extracted hooks
  const suppressNextSvgClick = useCallback((didDrag: boolean) => {
    if (!didDrag) return;
    suppressNextSvgClickRef.current = true;
    window.setTimeout(() => {
      suppressNextSvgClickRef.current = false;
    }, 0);
  }, []);

  const { handleVertexMouseDown } = useMaskVertexDrag(
    svgRef,
    canvasWidth,
    canvasHeight,
    selectedClip,
    activeMask,
    clientToLocalPoint,
    suppressNextSvgClick,
  );
  const { handleMaskDragStart } = useMaskDrag(svgRef, canvasWidth, canvasHeight, selectedClip, activeMask, clientToLocalPoint);
  const { handleEdgeMouseDown } = useMaskEdgeDrag(svgRef, canvasWidth, canvasHeight, selectedClip, activeMask, clientToLocalPoint);
  const { shapeDrawState, justFinishedDrawing: justFinishedDrawingRef, handleShapeMouseDown, handleShapeMouseMove, handleShapeMouseUp } =
    useMaskShapeDraw(svgRef, selectedClip, maskEditMode, clientToLocalPoint);

  const handlePenMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>): boolean => {
    if (!selectedClip || maskEditMode !== 'drawingPen') return false;
    if (e.button !== 0 || e.target !== svgRef.current) return false;

    const startPoint = getNormalizedPoint(e);
    const startCanvasPoint = getCanvasPoint(e);
    if (!startPoint) return false;

    e.preventDefault();
    e.stopPropagation();
    startBatch('Add mask vertex');

    const insertPreview = activeMask
      ? getNearestMaskEdgeInsert(
          activeMask,
          startPoint,
          canvasWidth,
          canvasHeight,
          12,
          projectMaskPoint,
          startCanvasPoint ?? undefined,
        )
      : null;

    if (activeMask && insertPreview) {
      const split = splitMaskSegment(activeMask, insertPreview);
      if (split) {
        const prevVertex = activeMask.vertices.find(vertex => vertex.id === insertPreview.prevVertexId);
        const nextVertex = activeMask.vertices.find(vertex => vertex.id === insertPreview.nextVertexId);
        updateVertex(selectedClip.id, activeMask.id, insertPreview.prevVertexId, {
          handleOut: split.prevHandleOut,
          ...(prevVertex
            ? { handleMode: inferMaskVertexHandleMode({ ...prevVertex, handleOut: split.prevHandleOut }) }
            : {}),
        }, true);
        updateVertex(selectedClip.id, activeMask.id, insertPreview.nextVertexId, {
          handleIn: split.nextHandleIn,
          ...(nextVertex
            ? { handleMode: inferMaskVertexHandleMode({ ...nextVertex, handleIn: split.nextHandleIn }) }
            : {}),
        }, true);
        const insertedVertexId = addVertex(selectedClip.id, activeMask.id, split.vertex, insertPreview.insertIndex);
        selectVertex(insertedVertexId, false);
        setMaskEditMode('drawingPen');
        setPenInsertPreview(null);
        endBatch();
        return true;
      }
    }

    const maskId = activeMask && !activeMask.closed
      ? activeMask.id
      : addMask(selectedClip.id, { name: 'Pen Mask' });

    if (!activeMask || activeMask.closed) {
      setActiveMask(selectedClip.id, maskId);
    }

    const vertexId = addVertex(selectedClip.id, maskId, {
      x: startPoint.x,
      y: startPoint.y,
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
    });
    selectVertex(vertexId, false);
    setMaskEditMode('drawingPen');

    let didDrag = false;
    let latestHandle = { x: 0, y: 0 };
    let latestBroken = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentPoint = getNormalizedPoint(moveEvent);
      if (!currentPoint) return;

      const rawDx = currentPoint.x - startPoint.x;
      const rawDy = currentPoint.y - startPoint.y;
      const distancePx = Math.hypot(rawDx * canvasWidth, rawDy * canvasHeight);
      if (distancePx < 3 && !didDrag) return;

      didDrag = true;
      latestHandle = constrainHandleDelta(rawDx, rawDy, moveEvent.shiftKey);
      latestBroken = moveEvent.altKey;

      updateVertex(selectedClip.id, maskId, vertexId, {
        handleIn: latestBroken ? { x: 0, y: 0 } : { x: -latestHandle.x, y: -latestHandle.y },
        handleOut: latestHandle,
        handleMode: latestBroken ? 'split' : 'mirrored',
      }, true);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (didDrag) {
        updateVertex(selectedClip.id, maskId, vertexId, {
          handleIn: latestBroken ? { x: 0, y: 0 } : { x: -latestHandle.x, y: -latestHandle.y },
          handleOut: latestHandle,
          handleMode: latestBroken ? 'split' : 'mirrored',
        });
      }
      endBatch();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return true;
  }, [
    activeMask,
    addMask,
    addVertex,
    canvasHeight,
    canvasWidth,
    getCanvasPoint,
    getNormalizedPoint,
    maskEditMode,
    projectMaskPoint,
    selectedClip,
    selectVertex,
    setActiveMask,
    setMaskEditMode,
    setPenInsertPreview,
    updateVertex,
  ]);

  // Convert mask vertices to canvas coordinates for rendering
  const canvasVertices = useMemo(() => {
    if (!activeMask) return [];
    const posX = activeMask.position?.x || 0;
    const posY = activeMask.position?.y || 0;

    return activeMask.vertices.map((v) => {
      const point = projectMaskPoint({ x: v.x + posX, y: v.y + posY });
      const handleInPoint = projectMaskPoint({ x: v.x + posX + v.handleIn.x, y: v.y + posY + v.handleIn.y });
      const handleOutPoint = projectMaskPoint({ x: v.x + posX + v.handleOut.x, y: v.y + posY + v.handleOut.y });

      return {
        ...v,
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
  }, [activeMask, projectMaskPoint]);

  // Generate path data for the active mask
  const pathData = useMemo(() => {
    if (!activeMask) return '';
    return buildProjectedMaskPath(activeMask, projectMaskPoint);
  }, [activeMask, projectMaskPoint]);
  const visibleMaskPaths = useMemo(
    () => (selectedClipMasks || [])
      .filter(mask => mask.visible && mask.vertices.length >= 2)
      .map(mask => ({
        id: mask.id,
        d: buildProjectedMaskPath(mask, projectMaskPoint),
        closed: mask.closed,
        color: getMaskOutlineColor(mask),
      }))
      .filter(path => path.d.length > 0),
    [projectMaskPoint, selectedClipMasks],
  );

  // Generate individual edge path segments for hit testing
  const edgeSegments = useMemo(() => {
    if (!activeMask || !activeMask.visible || activeMask.vertices.length < 2) return [];
    const verts = activeMask.vertices;
    const posX = activeMask.position?.x || 0;
    const posY = activeMask.position?.y || 0;
    const segments: Array<{ d: string; idA: string; idB: string }> = [];
    const pointFor = (point: { x: number; y: number }) => projectMaskPoint({ x: point.x + posX, y: point.y + posY });

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
      });
    }

    if (activeMask.closed && verts.length > 2) {
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
      });
    }

    return segments;
  }, [activeMask, projectMaskPoint]);

  const updatePenInsertPreview = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (maskEditMode !== 'drawingPen' || !activeMask || !activeMask.visible) {
      setPenInsertPreview(null);
      return;
    }

    const point = getNormalizedPoint(e);
    const canvasPoint = getCanvasPoint(e);
    if (!point) {
      setPenInsertPreview(null);
      return;
    }

    setPenInsertPreview(getNearestMaskEdgeInsert(
      activeMask,
      point,
      canvasWidth,
      canvasHeight,
      12,
      projectMaskPoint,
      canvasPoint ?? undefined,
    ));
  }, [activeMask, canvasHeight, canvasWidth, getCanvasPoint, getNormalizedPoint, maskEditMode, projectMaskPoint]);

  const setSelectedVertexHandleMode = useCallback((mode: MaskVertexHandleMode) => {
    if (!selectedClip || !activeMask || selectedVertexIds.size === 0) return;

    const vertexIds = Array.from(selectedVertexIds).filter(vertexId =>
      activeMask.vertices.some(vertex => vertex.id === vertexId)
    );
    if (vertexIds.length === 0) return;

    startBatch('Change mask vertex handles');
    setVertexHandleMode(selectedClip.id, activeMask.id, vertexIds, mode);
    endBatch();
  }, [activeMask, selectedClip, selectedVertexIds, setVertexHandleMode]);

  const cycleSelectedVertexHandleMode = useCallback(() => {
    if (!activeMask || selectedVertexIds.size === 0) return;

    const selectedModes = activeMask.vertices
      .filter(vertex => selectedVertexIds.has(vertex.id))
      .map(vertex => inferMaskVertexHandleMode(vertex));
    if (selectedModes.length === 0) return;

    const firstMode = selectedModes[0] ?? 'none';
    const nextMode = selectedModes.every(mode => mode === firstMode)
      ? getNextMaskVertexHandleMode(firstMode)
      : 'mirrored';
    setSelectedVertexHandleMode(nextMode);
  }, [activeMask, selectedVertexIds, setSelectedVertexHandleMode]);

  const handleVertexDoubleClick = useCallback((e: React.MouseEvent, vertexId: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!selectedClip || !activeMask) return;

    const vertex = activeMask.vertices.find(v => v.id === vertexId);
    if (!vertex) return;

    const nextMode = getNextMaskVertexHandleMode(inferMaskVertexHandleMode(vertex));
    selectVertex(vertexId, false);
    startBatch('Change mask vertex handles');
    setVertexHandleMode(selectedClip.id, activeMask.id, [vertexId], nextMode);
    endBatch();
  }, [activeMask, selectedClip, selectVertex, setVertexHandleMode]);

  const nudgeSelectedVertices = useCallback((dxPixels: number, dyPixels: number) => {
    if (!selectedClip || !activeMask || selectedVertexIds.size === 0) return;

    const selectedVertices = activeMask.vertices.filter(vertex => selectedVertexIds.has(vertex.id));
    if (selectedVertices.length === 0) return;

    const posX = activeMask.position?.x || 0;
    const posY = activeMask.position?.y || 0;
    const center = selectedVertices.reduce(
      (sum, vertex) => ({
        x: sum.x + vertex.x + posX,
        y: sum.y + vertex.y + posY,
      }),
      { x: 0, y: 0 },
    );
    center.x /= selectedVertices.length;
    center.y /= selectedVertices.length;

    const centerCanvas = projectMaskPoint(center);
    const targetCanvas = {
      x: centerCanvas.x + dxPixels,
      y: centerCanvas.y + dyPixels,
    };
    const target = projectionParams
      ? unprojectCanvasToLayerUv(targetCanvas, projectionParams)
      : { x: targetCanvas.x / canvasWidth, y: targetCanvas.y / canvasHeight };
    const dx = target.x - center.x;
    const dy = target.y - center.y;

    const vertexUpdates = selectedVertices
      .map(vertex => ({
        id: vertex.id,
        updates: {
          x: clamp01(vertex.x + dx),
          y: clamp01(vertex.y + dy),
        },
      }));

    if (vertexUpdates.length === 0) return;

    startBatch('Nudge mask vertices');
    updateVertices(selectedClip.id, activeMask.id, vertexUpdates, true);
    const store = useTimelineStore.getState();
    const pathProperty = createMaskPathProperty(activeMask.id);
    if (store.isRecording(selectedClip.id, pathProperty) || store.hasKeyframes(selectedClip.id, pathProperty)) {
      store.addMaskPathKeyframe(
        selectedClip.id,
        activeMask.id,
        buildMaskPathValueWithVertexUpdates(activeMask, vertexUpdates),
      );
    } else {
      store.invalidateCache();
    }
    endBatch();
  }, [activeMask, canvasHeight, canvasWidth, projectMaskPoint, projectionParams, selectedClip, selectedVertexIds, updateVertices]);

  // Handle clicking on SVG background
  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!selectedClip) return;
    if (e.target !== svgRef.current) return;
    if (suppressNextSvgClickRef.current) {
      suppressNextSvgClickRef.current = false;
      return;
    }

    if (justFinishedDrawingRef.current) {
      justFinishedDrawingRef.current = false;
      return;
    }

    if (maskEditMode === 'drawingPen') return;

    const point = getNormalizedPoint(e);
    if (!point) return;

    if (maskEditMode === 'drawing' && activeMask) {
      addVertex(selectedClip.id, activeMask.id, {
        x: point.x,
        y: point.y,
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
      });
    } else if (maskEditMode === 'editing' && activeMask) {
      deselectAllVertices();
    }
  }, [selectedClip, activeMask, maskEditMode, addVertex, deselectAllVertices, getNormalizedPoint, justFinishedDrawingRef]);

  // Handle clicking on first vertex to close path
  const handleFirstVertexClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!selectedClip || !activeMask) return;

    if ((maskEditMode === 'drawing' || maskEditMode === 'drawingPen') && activeMask.vertices.length >= 3) {
      closeMask(selectedClip.id, activeMask.id);
      setMaskEditMode('editing');
    }
  }, [selectedClip, activeMask, maskEditMode, closeMask, setMaskEditMode]);

  // Handle escape key to exit drawing mode + delete selected vertices
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const registry = getShortcutRegistry();

      if (selectedClip && registry.matches('mask.pen', e)) {
        e.preventDefault();
        setMaskEditMode('drawingPen');
        return;
      }
      if (selectedClip && registry.matches('mask.rectangle', e)) {
        e.preventDefault();
        setMaskEditMode('drawingRect');
        return;
      }
      if (selectedClip && registry.matches('mask.ellipse', e)) {
        e.preventDefault();
        setMaskEditMode('drawingEllipse');
        return;
      }
      if (activeMask && registry.matches('mask.edit', e)) {
        e.preventDefault();
        setMaskEditMode('editing');
        return;
      }
      if (activeMask && registry.matches('mask.closePath', e)) {
        e.preventDefault();
        if (!activeMask.closed && activeMask.vertices.length >= 3 && selectedClip) {
          closeMask(selectedClip.id, activeMask.id);
          setMaskEditMode('editing');
        }
        return;
      }
      if (activeMask && selectedClip && registry.matches('mask.invert', e)) {
        e.preventDefault();
        updateMask(selectedClip.id, activeMask.id, { inverted: !activeMask.inverted });
        return;
      }
      if (activeMask && selectedClip && registry.matches('mask.toggleOutline', e)) {
        e.preventDefault();
        updateMask(selectedClip.id, activeMask.id, { visible: !activeMask.visible });
        return;
      }
      if (activeMask && registry.matches('mask.selectAllVertices', e)) {
        e.preventDefault();
        selectVertices(activeMask.vertices.map(v => v.id));
        return;
      }
      if (activeMask && selectedClip && selectedVertexIds.size > 0 && registry.matches('mask.toggleVertexHandles', e)) {
        e.preventDefault();
        cycleSelectedVertexHandleMode();
        return;
      }

      if (activeMask && selectedClip && selectedVertexIds.size > 0 && e.key.startsWith('Arrow')) {
        const amount = e.shiftKey ? 10 : e.altKey ? 0.2 : 1;
        const dx = e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0;
        const dy = e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0;
        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          e.stopPropagation();
          nudgeSelectedVertices(dx, dy);
          return;
        }
      }

      if (e.key === 'Escape') {
        if (shapeDrawState.isDrawing) {
          handleShapeMouseUp();
        } else if (maskEditMode === 'drawing' || maskEditMode === 'drawingRect' ||
                   maskEditMode === 'drawingEllipse' || maskEditMode === 'drawingPen') {
          setMaskEditMode('none');
        } else if (maskEditMode === 'editing') {
          setMaskEditMode('none');
        }
      }
      if (registry.matches('edit.delete', e) && maskEditMode === 'editing') {
        if (selectedVertexIds.size > 0 && selectedClip && activeMask) {
          e.preventDefault();
          const { removeVertex } = useTimelineStore.getState();
          Array.from(selectedVertexIds).forEach(vertexId => {
            removeVertex(selectedClip.id, activeMask.id, vertexId);
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeMask,
    closeMask,
    cycleSelectedVertexHandleMode,
    handleShapeMouseUp,
    maskEditMode,
    nudgeSelectedVertices,
    selectedClip,
    selectedVertexIds,
    selectVertices,
    setMaskEditMode,
    shapeDrawState.isDrawing,
    updateMask,
  ]);

  // Don't render if not in mask editing mode
  const isShapeDrawingMode = maskEditMode === 'drawingRect' || maskEditMode === 'drawingEllipse' || maskEditMode === 'drawingPen';
  if (maskEditMode === 'none' || !selectedClip) {
    return null;
  }
  if (!isShapeDrawingMode && !activeMask) {
    return null;
  }

  const vertexSize = 8;
  const handleSize = 6;

  const getCursor = () => {
    if (maskEditMode === 'drawingRect' || maskEditMode === 'drawingEllipse' || maskEditMode === 'drawingPen') {
      return 'crosshair';
    }
    if (maskEditMode === 'drawing') return 'crosshair';
    return 'default';
  };

  const shapePreviewPath = (() => {
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
    }, projectMaskPoint);
  })();

  return (
    <svg
      ref={svgRef}
      className="mask-overlay-svg"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="xMidYMid meet"
      onClick={handleSvgClick}
      onMouseDown={(e) => {
        if (handlePenMouseDown(e)) return;
        handleShapeMouseDown(e);
      }}
      onMouseMove={(e) => {
        updatePenInsertPreview(e);
        handleShapeMouseMove(e);
      }}
      onMouseUp={handleShapeMouseUp}
      onMouseLeave={() => {
        setPenInsertPreview(null);
        handleShapeMouseUp();
      }}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: displayWidth,
        height: displayHeight,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'auto',
        cursor: getCursor(),
      }}
    >
      {/* Shape preview while drawing */}
      {shapePreviewPath && (
        <path
          d={shapePreviewPath}
          fill="rgba(45, 140, 235, 0.15)"
          stroke="#2997E5"
          strokeWidth="2"
          strokeDasharray="5,5"
          pointerEvents="none"
        />
      )}

      {/* Mask path fill - clickable for dragging when visible */}
      {activeMask?.closed && activeMask.visible && pathData && (
        <path
          d={pathData}
          fill={activeMask.inverted ? 'rgba(45, 140, 235, 0.1)' : 'rgba(45, 140, 235, 0.15)'}
          stroke="none"
          pointerEvents={maskEditMode === 'editing' ? 'all' : 'none'}
          cursor="move"
          onMouseDown={handleMaskDragStart}
        />
      )}

      {/* Mask path strokes - show every visible mask outline */}
      {visibleMaskPaths.map(maskPath => (
        <path
          key={`mask-outline-${maskPath.id}`}
          d={maskPath.d}
          fill="none"
          stroke={maskPath.color}
          strokeWidth="2"
          strokeDasharray={maskPath.closed ? 'none' : '5,5'}
          pointerEvents="none"
        />
      ))}

      {maskEditMode === 'drawingPen' && penInsertPreview && (
        <g className="mask-edge-insert-preview" pointerEvents="none">
          <circle
            cx={penInsertPreview.canvasX}
            cy={penInsertPreview.canvasY}
            r="7"
            fill="rgba(255, 153, 0, 0.18)"
            stroke="#ff9900"
            strokeWidth="2"
          />
          <path
            d={`M ${penInsertPreview.canvasX - 4} ${penInsertPreview.canvasY} L ${penInsertPreview.canvasX + 4} ${penInsertPreview.canvasY} M ${penInsertPreview.canvasX} ${penInsertPreview.canvasY - 4} L ${penInsertPreview.canvasX} ${penInsertPreview.canvasY + 4}`}
            fill="none"
            stroke="#ff9900"
            strokeWidth="1.5"
          />
        </g>
      )}

      {/* Edge hit areas */}
      {maskEditMode === 'editing' && edgeSegments.map((seg) => {
        const edgeKey = `${seg.idA}-${seg.idB}`;
        return (
          <g key={`edge-${edgeKey}`}>
            {hoveredEdgeKey === edgeKey && (
              <path
                d={seg.d}
                fill="none"
                stroke="rgba(255, 153, 0, 0.85)"
                strokeWidth="4"
                pointerEvents="none"
                className="mask-edge-highlight"
              />
            )}
            <path
              d={seg.d}
              fill="none"
              stroke="transparent"
              strokeWidth="12"
              cursor="move"
              pointerEvents="stroke"
              onMouseEnter={() => setHoveredEdgeKey(edgeKey)}
              onMouseLeave={() => setHoveredEdgeKey(null)}
              onMouseDown={(e) => handleEdgeMouseDown(e, seg.idA, seg.idB)}
            />
          </g>
        );
      })}

      {/* Bezier control handles */}
      {activeMask && canvasVertices.map((vertex, index) => {
        const isSelected = selectedVertexIds.has(vertex.id);
        const handleMode = inferMaskVertexHandleMode(vertex);
        if (!isSelected || handleMode === 'none') return null;

        const previousVertex = canvasVertices[index - 1] ?? (activeMask.closed ? canvasVertices[canvasVertices.length - 1] : undefined);
        const nextVertex = canvasVertices[index + 1] ?? (activeMask.closed ? canvasVertices[0] : undefined);
        const handleInEndpoint = getDisplayHandleEndpoint(vertex, 'handleIn', previousVertex, nextVertex);
        const handleOutEndpoint = getDisplayHandleEndpoint(vertex, 'handleOut', previousVertex, nextVertex);

        return (
          <g key={`handles-${vertex.id}`} className={`mask-handle-group ${handleMode}`}>
            <line
              x1={vertex.x}
              y1={vertex.y}
              x2={handleInEndpoint.x}
              y2={handleInEndpoint.y}
              stroke="#ff9900"
              strokeWidth="1"
              pointerEvents="none"
            />
            <circle
              cx={handleInEndpoint.x}
              cy={handleInEndpoint.y}
              r={handleSize / 2 + 1}
              fill="#ff9900"
              stroke="#fff"
              strokeWidth="1"
              cursor="move"
              className="mask-handle-point"
              onMouseDown={(e) => handleVertexMouseDown(e, vertex.id, 'handleIn')}
            />

            <line
              x1={vertex.x}
              y1={vertex.y}
              x2={handleOutEndpoint.x}
              y2={handleOutEndpoint.y}
              stroke="#ff9900"
              strokeWidth="1"
              pointerEvents="none"
            />
            <circle
              cx={handleOutEndpoint.x}
              cy={handleOutEndpoint.y}
              r={handleSize / 2 + 1}
              fill="#ff9900"
              stroke="#fff"
              strokeWidth="1"
              cursor="move"
              className="mask-handle-point"
              onMouseDown={(e) => handleVertexMouseDown(e, vertex.id, 'handleOut')}
            />
          </g>
        );
      })}

      {/* Vertex points */}
      {activeMask && canvasVertices.map((vertex, index) => {
        const isSelected = selectedVertexIds.has(vertex.id);
        const isHovered = hoveredVertexId === vertex.id;
        const handleMode = inferMaskVertexHandleMode(vertex);
        if (!activeMask.visible && !isSelected) return null;

        const isFirst = index === 0;
        const isClosableFirst = isFirst &&
          (maskEditMode === 'drawing' || maskEditMode === 'drawingPen') &&
          activeMask.vertices.length >= 3;

        return (
          <g key={vertex.id} className={`mask-vertex-group ${isSelected ? 'selected' : ''} ${isHovered ? 'hovered' : ''} ${handleMode}`}>
            {(isSelected || isHovered || isClosableFirst) && (
              <circle
                cx={vertex.x}
                cy={vertex.y}
                r={isClosableFirst ? vertexSize * 1.15 : vertexSize}
                fill="none"
                stroke={isClosableFirst ? '#ff4d4d' : '#ff9900'}
                strokeWidth="1.5"
                className={isSelected ? 'mask-active-vertex-ring' : 'mask-hover-vertex-ring'}
                pointerEvents="none"
              />
            )}
            <rect
              x={vertex.x - vertexSize / 2}
              y={vertex.y - vertexSize / 2}
              width={vertexSize}
              height={vertexSize}
              fill={isSelected ? '#2997E5' : '#fff'}
              stroke={isClosableFirst ? '#ff4d4d' : '#2997E5'}
              strokeWidth={isClosableFirst ? '2' : '1'}
              cursor={isClosableFirst ? 'crosshair' : 'move'}
              className={`mask-vertex-point ${isSelected ? 'selected' : ''}`}
              onMouseEnter={() => setHoveredVertexId(vertex.id)}
              onMouseLeave={() => setHoveredVertexId(null)}
              onMouseDown={isClosableFirst
                ? handleFirstVertexClose
                : (e) => handleVertexMouseDown(e, vertex.id, 'vertex')}
              onDoubleClick={(e) => {
                if (!isClosableFirst) {
                  handleVertexDoubleClick(e, vertex.id);
                }
              }}
            />
          </g>
        );
      })}
    </svg>
  );
}
