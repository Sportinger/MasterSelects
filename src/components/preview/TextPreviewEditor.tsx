import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  createTextBoundsNumericProperty,
  type Layer,
  type MaskVertex,
  type TextBoundsPath,
  type TextClipProperties,
  type TimelineClip,
} from '../../types';
import {
  createTextBoundsFromRect,
  cloneTextBoundsPath,
  measureTextWithLetterSpacing,
  resolveTextBoundsPath,
  resolveTextBoxRect,
  wrapTextToShapeLines,
  wrapTextToLines,
} from '../../services/textLayout';
import {
  projectLayerUvToCanvas,
  unprojectCanvasToLayerUv,
  type OverlayPoint,
} from './editModeOverlayMath';

interface TextPreviewEditorProps {
  clip: TimelineClip;
  layer: Layer;
  effectiveResolution: { width: number; height: number };
  canvasSize: { width: number; height: number };
  canvasInContainer: { x: number; y: number; width: number; height: number };
  viewZoom: number;
  enabled: boolean;
  activeTextBounds?: TextBoundsPath;
  updateTextProperties: (clipId: string, props: Partial<TextClipProperties>) => void;
  updateTextBoundsVertex: (clipId: string, vertexId: string, updates: Partial<MaskVertex>, recordKeyframe?: boolean) => void;
  updateTextBoundsVertices: (clipId: string, vertexUpdates: Array<{ vertexId: string; updates: Partial<MaskVertex> }>, recordKeyframe?: boolean) => void;
  setPropertyValue: (clipId: string, property: ReturnType<typeof createTextBoundsNumericProperty>, value: number) => void;
}

type DragKind = 'create' | 'move' | 'vertex' | 'edge';

interface DragState {
  kind: DragKind;
  pointerId: number;
  start: OverlayPoint;
  current: OverlayPoint;
  startBounds: TextBoundsPath;
  startSourcePoint?: OverlayPoint;
  vertexId?: string;
  edgeVertexIds?: [string, string];
}

interface ProjectedVertex {
  vertex: MaskVertex;
  point: OverlayPoint;
}

interface ProjectedEdge {
  id: string;
  fromVertexId: string;
  toVertexId: string;
  pathD: string;
  midpoint: OverlayPoint;
}

interface EditorGeometry {
  sourceWidth: number;
  sourceHeight: number;
  bounds: TextBoundsPath;
  box: ReturnType<typeof resolveTextBoxRect>;
  vertices: ProjectedVertex[];
  edges: ProjectedEdge[];
  pathD: string;
  corners: {
    tl: OverlayPoint;
    tr: OverlayPoint;
    bl: OverlayPoint;
  };
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  projectSourcePoint: (sourceX: number, sourceY: number) => OverlayPoint;
}

interface SelectionPolygon {
  id: string;
  points: string;
}

function distance(a: OverlayPoint, b: OverlayPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function atLeast(value: number, minimum: number): number {
  return value < minimum ? minimum : value;
}

function roundNormalizedToPixel(value: number, dimension: number): number {
  return Math.round(value * Math.max(1, dimension)) / Math.max(1, dimension);
}

function getFontCss(props: TextClipProperties): string {
  const fontStyle = props.fontStyle === 'italic' ? 'italic' : 'normal';
  return `${fontStyle} ${props.fontWeight} ${props.fontSize}px "${props.fontFamily}"`;
}

function getSourceDimensions(
  clip: TimelineClip,
  layer: Layer,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const sourceCanvas = clip.source?.textCanvas ?? layer.source?.textCanvas;
  return {
    width: sourceCanvas?.width || fallback.width,
    height: sourceCanvas?.height || fallback.height,
  };
}

function selectionRect(start: OverlayPoint, end: OverlayPoint): CSSProperties {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    left,
    top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function hasVisibleSelectionRect(start: OverlayPoint, end: OverlayPoint): boolean {
  return Math.abs(end.x - start.x) >= 6 && Math.abs(end.y - start.y) >= 6;
}

function shouldMoveWholeText(event: Pick<ReactPointerEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return event.ctrlKey || event.metaKey;
}

function selectionLineLeft(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  lineText: string,
  lineLeft: number,
  lineRight: number,
  lineWidth: number,
  props: TextClipProperties,
): number {
  const textWidth = measureTextWithLetterSpacing(ctx, lineText, props.letterSpacing);
  if (props.textAlign === 'center') {
    return lineLeft + lineWidth / 2 - textWidth / 2;
  }
  if (props.textAlign === 'right') {
    return lineRight - textWidth;
  }
  return lineLeft;
}

function pointString(points: OverlayPoint[]): string {
  return points.map(point => `${point.x},${point.y}`).join(' ');
}

function buildSvgPath(
  bounds: TextBoundsPath,
  sourceWidth: number,
  sourceHeight: number,
  projectSourcePoint: (sourceX: number, sourceY: number) => OverlayPoint,
): string {
  const vertices = bounds.vertices;
  if (vertices.length === 0) return '';

  const projectVertex = (vertex: MaskVertex, handle?: 'in' | 'out') => {
    const handleOffset = handle === 'in'
      ? vertex.handleIn
      : handle === 'out'
        ? vertex.handleOut
        : { x: 0, y: 0 };
    return projectSourcePoint(
      (vertex.x + bounds.position.x + handleOffset.x) * sourceWidth,
      (vertex.y + bounds.position.y + handleOffset.y) * sourceHeight,
    );
  };

  const first = projectVertex(vertices[0]);
  const commands = [`M ${first.x} ${first.y}`];
  for (let index = 1; index < vertices.length; index += 1) {
    const previous = vertices[index - 1];
    const current = vertices[index];
    const end = projectVertex(current);
    if (
      previous.handleOut.x === 0 &&
      previous.handleOut.y === 0 &&
      current.handleIn.x === 0 &&
      current.handleIn.y === 0
    ) {
      commands.push(`L ${end.x} ${end.y}`);
    } else {
      const cp1 = projectVertex(previous, 'out');
      const cp2 = projectVertex(current, 'in');
      commands.push(`C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${end.x} ${end.y}`);
    }
  }

  if (bounds.closed && vertices.length > 1) {
    const previous = vertices[vertices.length - 1];
    const current = vertices[0];
    if (
      previous.handleOut.x !== 0 ||
      previous.handleOut.y !== 0 ||
      current.handleIn.x !== 0 ||
      current.handleIn.y !== 0
    ) {
      const cp1 = projectVertex(previous, 'out');
      const cp2 = projectVertex(current, 'in');
      commands.push(`C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${first.x} ${first.y}`);
    }
    commands.push('Z');
  }

  return commands.join(' ');
}

export function TextPreviewEditor({
  clip,
  layer,
  effectiveResolution,
  canvasSize,
  canvasInContainer,
  viewZoom,
  enabled,
  activeTextBounds,
  updateTextProperties,
  updateTextBoundsVertex,
  updateTextBoundsVertices,
  setPropertyValue,
}: TextPreviewEditorProps) {
  const textProperties = clip.textProperties;
  const layerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const selectAllOnFocusRef = useRef(false);
  const [draftText, setDraftText] = useState(textProperties?.text ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const [dragSelection, setDragSelection] = useState<{ start: OverlayPoint; current: OverlayPoint } | null>(null);
  const [textSelection, setTextSelection] = useState({ start: 0, end: 0 });

  useEffect(() => {
    if (!isEditing) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          setDraftText(textProperties?.text ?? '');
        }
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [clip.id, isEditing, textProperties?.text]);

  useEffect(() => {
    dragStateRef.current = null;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setDragSelection(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clip.id, enabled]);

  const geometry = useMemo<EditorGeometry | null>(() => {
    if (!textProperties) return null;
    const { width: sourceWidth, height: sourceHeight } = getSourceDimensions(clip, layer, effectiveResolution);
    const bounds = activeTextBounds
      ? cloneTextBoundsPath(activeTextBounds)
      : resolveTextBoundsPath(textProperties, sourceWidth, sourceHeight);
    const box = resolveTextBoxRect({ ...textProperties, textBounds: bounds }, sourceWidth, sourceHeight);
    const params = {
      sourceWidth,
      sourceHeight,
      outputWidth: effectiveResolution.width,
      outputHeight: effectiveResolution.height,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      position: layer.position,
      scale: layer.scale,
      rotation: layer.rotation,
    };
    const toContainer = (point: OverlayPoint): OverlayPoint => ({
      x: canvasInContainer.x + point.x * viewZoom,
      y: canvasInContainer.y + point.y * viewZoom,
    });
    const projectSourcePoint = (sourceX: number, sourceY: number): OverlayPoint => toContainer(projectLayerUvToCanvas({
      x: sourceX / sourceWidth,
      y: sourceY / sourceHeight,
    }, params));

    const tl = projectSourcePoint(box.x, box.y);
    const tr = projectSourcePoint(box.x + box.width, box.y);
    const bl = projectSourcePoint(box.x, box.y + box.height);
    const width = atLeast(distance(tl, tr), 1);
    const height = atLeast(distance(tl, bl), 1);
    const vertices = bounds.vertices.map(vertex => ({
      vertex,
      point: projectSourcePoint(
        (vertex.x + bounds.position.x) * sourceWidth,
        (vertex.y + bounds.position.y) * sourceHeight,
      ),
    }));
    const edges = vertices.map((current, index) => {
      const next = vertices[(index + 1) % vertices.length];
      return {
        id: `${current.vertex.id}-${next.vertex.id}`,
        fromVertexId: current.vertex.id,
        toVertexId: next.vertex.id,
        pathD: `M ${current.point.x} ${current.point.y} L ${next.point.x} ${next.point.y}`,
        midpoint: {
          x: (current.point.x + next.point.x) / 2,
          y: (current.point.y + next.point.y) / 2,
        },
      };
    });

    return {
      sourceWidth,
      sourceHeight,
      bounds,
      box,
      vertices,
      edges,
      pathD: buildSvgPath(bounds, sourceWidth, sourceHeight, projectSourcePoint),
      corners: { tl, tr, bl },
      width,
      height,
      rotation: Math.atan2(tr.y - tl.y, tr.x - tl.x),
      scaleX: width / Math.max(1, box.width),
      scaleY: height / Math.max(1, box.height),
      projectSourcePoint,
    };
  }, [
    canvasInContainer.x,
    canvasInContainer.y,
    canvasSize.height,
    canvasSize.width,
    clip,
    effectiveResolution,
    layer,
    textProperties,
    activeTextBounds,
    viewZoom,
  ]);

  const syncTextSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
    const end = Math.max(textarea.selectionStart, textarea.selectionEnd);
    setTextSelection(previous => (
      previous.start === start && previous.end === end
        ? previous
        : { start, end }
    ));
  }, []);

  const focusEditor = useCallback((selectAll = false) => {
    selectAllOnFocusRef.current = selectAll;
    setIsEditing(true);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      if (selectAllOnFocusRef.current) {
        textarea.select();
        selectAllOnFocusRef.current = false;
      }
      syncTextSelection();
    });
  }, [syncTextSelection]);

  const sourcePointFromContainer = useCallback((point: OverlayPoint): OverlayPoint | null => {
    if (!geometry) return null;
    const canvasPoint = {
      x: (point.x - canvasInContainer.x) / Math.max(0.0001, viewZoom),
      y: (point.y - canvasInContainer.y) / Math.max(0.0001, viewZoom),
    };
    const uv = unprojectCanvasToLayerUv(canvasPoint, {
      sourceWidth: geometry.sourceWidth,
      sourceHeight: geometry.sourceHeight,
      outputWidth: effectiveResolution.width,
      outputHeight: effectiveResolution.height,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      position: layer.position,
      scale: layer.scale,
      rotation: layer.rotation,
      uvClampMin: -1000,
      uvClampMax: 1001,
    });

    return {
      x: uv.x * geometry.sourceWidth,
      y: uv.y * geometry.sourceHeight,
    };
  }, [
    canvasInContainer.x,
    canvasInContainer.y,
    canvasSize.height,
    canvasSize.width,
    effectiveResolution.height,
    effectiveResolution.width,
    geometry,
    layer.position,
    layer.rotation,
    layer.scale,
    viewZoom,
  ]);

  const applyMoveDrag = useCallback((drag: DragState, point: OverlayPoint) => {
    if (!geometry) return;
    const start = sourcePointFromContainer(drag.start);
    const current = sourcePointFromContainer(point);
    if (!start || !current) return;
    const nextX = drag.startBounds.position.x + (current.x - start.x) / geometry.sourceWidth;
    const nextY = drag.startBounds.position.y + (current.y - start.y) / geometry.sourceHeight;
    setPropertyValue(clip.id, createTextBoundsNumericProperty('position.x'), nextX);
    setPropertyValue(clip.id, createTextBoundsNumericProperty('position.y'), nextY);
  }, [clip.id, geometry, setPropertyValue, sourcePointFromContainer]);

  const applyVertexDrag = useCallback((drag: DragState, point: OverlayPoint, recordKeyframe: boolean) => {
    if (!geometry || !drag.vertexId) return;
    const startVertex = drag.startBounds.vertices.find(vertex => vertex.id === drag.vertexId);
    if (!startVertex) return;
    const startPoint = drag.startSourcePoint ?? sourcePointFromContainer(drag.start);
    const sourcePoint = sourcePointFromContainer(point);
    if (!startPoint || !sourcePoint) return;
    const dx = (sourcePoint.x - startPoint.x) / geometry.sourceWidth;
    const dy = (sourcePoint.y - startPoint.y) / geometry.sourceHeight;
    updateTextBoundsVertex(clip.id, drag.vertexId, {
      x: startVertex.x + dx,
      y: startVertex.y + dy,
    }, recordKeyframe);
  }, [clip.id, geometry, sourcePointFromContainer, updateTextBoundsVertex]);

  const applyEdgeDrag = useCallback((
    drag: DragState,
    point: OverlayPoint,
    recordKeyframe: boolean,
    snapStraight: boolean,
  ) => {
    if (!geometry || !drag.edgeVertexIds) return;
    const startPoint = drag.startSourcePoint ?? sourcePointFromContainer(drag.start);
    const sourcePoint = sourcePointFromContainer(point);
    if (!startPoint || !sourcePoint) return;
    const dx = (sourcePoint.x - startPoint.x) / geometry.sourceWidth;
    const dy = (sourcePoint.y - startPoint.y) / geometry.sourceHeight;
    const movedVertices: Array<{ vertexId: string; startVertex: MaskVertex; x: number; y: number }> = [];
    for (const vertexId of drag.edgeVertexIds) {
      const startVertex = drag.startBounds.vertices.find(vertex => vertex.id === vertexId);
      if (!startVertex) continue;
      movedVertices.push({
        vertexId,
        startVertex,
        x: startVertex.x + dx,
        y: startVertex.y + dy,
      });
    }
    if (movedVertices.length === 0) return;

    const resetHandles = {
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
      handleMode: 'none' as const,
    };
    const vertexUpdates: Array<{ vertexId: string; updates: Partial<MaskVertex> }> = movedVertices.map((entry) => ({
      vertexId: entry.vertexId,
      updates: { x: entry.x, y: entry.y },
    }));

    if (snapStraight && movedVertices.length === 2) {
      const [from, to] = movedVertices;
      const edgeWidth = Math.abs((to.startVertex.x - from.startVertex.x) * geometry.sourceWidth);
      const edgeHeight = Math.abs((to.startVertex.y - from.startVertex.y) * geometry.sourceHeight);
      const startVertices = drag.startBounds.vertices;

      if (startVertices.length === 4) {
        const draggedVertexIds = new Set(drag.edgeVertexIds);
        const minX = Math.min(...startVertices.map(vertex => vertex.x));
        const maxX = Math.max(...startVertices.map(vertex => vertex.x));
        const minY = Math.min(...startVertices.map(vertex => vertex.y));
        const maxY = Math.max(...startVertices.map(vertex => vertex.y));
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const edgeCenterX = (from.startVertex.x + to.startVertex.x) / 2;
        const edgeCenterY = (from.startVertex.y + to.startVertex.y) / 2;

        vertexUpdates.length = 0;
        if (edgeWidth >= edgeHeight) {
          const draggedY = roundNormalizedToPixel((from.y + to.y) / 2, geometry.sourceHeight);
          const oppositeY = edgeCenterY <= centerY ? maxY : minY;
          for (const vertex of startVertices) {
            vertexUpdates.push({
              vertexId: vertex.id,
              updates: {
                ...resetHandles,
                x: vertex.x <= centerX ? minX : maxX,
                y: draggedVertexIds.has(vertex.id) ? draggedY : oppositeY,
              },
            });
          }
        } else {
          const draggedX = roundNormalizedToPixel((from.x + to.x) / 2, geometry.sourceWidth);
          const oppositeX = edgeCenterX <= centerX ? maxX : minX;
          for (const vertex of startVertices) {
            vertexUpdates.push({
              vertexId: vertex.id,
              updates: {
                ...resetHandles,
                x: draggedVertexIds.has(vertex.id) ? draggedX : oppositeX,
                y: vertex.y <= centerY ? minY : maxY,
              },
            });
          }
        }
      } else if (edgeWidth >= edgeHeight) {
        const y = roundNormalizedToPixel((from.y + to.y) / 2, geometry.sourceHeight);
        vertexUpdates[0] = { vertexId: from.vertexId, updates: { ...resetHandles, x: from.x, y } };
        vertexUpdates[1] = { vertexId: to.vertexId, updates: { ...resetHandles, x: to.x, y } };
      } else {
        const x = roundNormalizedToPixel((from.x + to.x) / 2, geometry.sourceWidth);
        vertexUpdates[0] = { vertexId: from.vertexId, updates: { ...resetHandles, x, y: from.y } };
        vertexUpdates[1] = { vertexId: to.vertexId, updates: { ...resetHandles, x, y: to.y } };
      }
    }

    if (vertexUpdates.length === 0) return;
    updateTextBoundsVertices(clip.id, vertexUpdates, recordKeyframe);
  }, [clip.id, geometry, sourcePointFromContainer, updateTextBoundsVertices]);

  const straightenEdge = useCallback((fromVertexId: string, toVertexId: string) => {
    if (!geometry) return;
    const from = geometry.bounds.vertices.find(vertex => vertex.id === fromVertexId);
    const to = geometry.bounds.vertices.find(vertex => vertex.id === toVertexId);
    if (!from || !to) return;

    const dx = Math.abs((to.x - from.x) * geometry.sourceWidth);
    const dy = Math.abs((to.y - from.y) * geometry.sourceHeight);
    const resetHandles = {
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
      handleMode: 'none' as const,
    };

    if (dx >= dy) {
      const y = roundNormalizedToPixel((from.y + to.y) / 2, geometry.sourceHeight);
      updateTextBoundsVertices(clip.id, [
        { vertexId: fromVertexId, updates: { ...resetHandles, y } },
        { vertexId: toVertexId, updates: { ...resetHandles, y } },
      ], true);
      return;
    }

    const x = roundNormalizedToPixel((from.x + to.x) / 2, geometry.sourceWidth);
    updateTextBoundsVertices(clip.id, [
      { vertexId: fromVertexId, updates: { ...resetHandles, x } },
      { vertexId: toVertexId, updates: { ...resetHandles, x } },
    ], true);
  }, [clip.id, geometry, updateTextBoundsVertices]);

  const finishDrag = useCallback((target: HTMLElement, pointerId: number, finalPoint?: OverlayPoint, snapEdge = false) => {
    const drag = dragStateRef.current;
    dragStateRef.current = null;
    setDragSelection(null);

    try {
      target.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    if (!drag || !geometry || !textProperties) return;
    const current = finalPoint ?? drag.current;

    if (drag.kind === 'move') {
      applyMoveDrag(drag, current);
      return;
    }

    if (drag.kind === 'vertex') {
      applyVertexDrag(drag, current, true);
      return;
    }

    if (drag.kind === 'edge') {
      applyEdgeDrag(drag, current, true, snapEdge);
      return;
    }

    const dragDistance = Math.hypot(current.x - drag.start.x, current.y - drag.start.y);
    if (dragDistance < 6) {
      focusEditor();
      return;
    }

    const start = sourcePointFromContainer(drag.start);
    const end = sourcePointFromContainer(current);
    if (!start || !end) return;

    const x = Math.round(Math.min(start.x, end.x));
    const y = Math.round(Math.min(start.y, end.y));
    const width = Math.round(Math.abs(end.x - start.x));
    const height = Math.round(Math.abs(end.y - start.y));

    if (width < 24 || height < 24) {
      focusEditor();
      return;
    }

    const box = {
      x,
      y,
      width: Math.max(24, width),
      height: Math.max(24, height),
    };
    updateTextProperties(clip.id, {
      boxEnabled: true,
      boxX: box.x,
      boxY: box.y,
      boxWidth: box.width,
      boxHeight: box.height,
      textBounds: createTextBoundsFromRect(box, geometry.sourceWidth, geometry.sourceHeight, undefined, { clampToCanvas: false }),
    });
    focusEditor(true);
  }, [
    applyMoveDrag,
    applyEdgeDrag,
    applyVertexDrag,
    clip.id,
    focusEditor,
    geometry,
    sourcePointFromContainer,
    textProperties,
    updateTextProperties,
  ]);

  const beginDrag = useCallback((
    event: ReactPointerEvent<Element>,
    kind: DragKind,
    vertexId?: string,
    edgeVertexIds?: [string, string],
  ) => {
    if (!enabled || event.button !== 0 || event.altKey || !geometry) return;
    const captureElement = layerRef.current;
    if (!captureElement) return;
    const rect = captureElement.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    dragStateRef.current = {
      kind,
      pointerId: event.pointerId,
      start: point,
      current: point,
      startBounds: geometry.bounds,
      startSourcePoint: kind === 'vertex' || kind === 'edge' ? sourcePointFromContainer(point) ?? undefined : undefined,
      vertexId,
      edgeVertexIds,
    };
    setDragSelection(kind === 'create' ? { start: point, current: point } : null);
    captureElement.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, [enabled, geometry, sourcePointFromContainer]);

  const handleCapturePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (shouldMoveWholeText(event)) {
      beginDrag(event, 'move');
      return;
    }
    beginDrag(event, 'create');
  }, [beginDrag]);

  const handleInputPointerDown = useCallback((event: ReactPointerEvent<HTMLTextAreaElement>) => {
    if (shouldMoveWholeText(event)) {
      beginDrag(event, 'move');
      return;
    }
    event.stopPropagation();
    focusEditor();
  }, [beginDrag, focusEditor]);

  const handleVertexPointerDown = useCallback((event: ReactPointerEvent<SVGRectElement>, vertexId: string) => {
    if (shouldMoveWholeText(event)) {
      beginDrag(event, 'move');
      return;
    }
    beginDrag(event, 'vertex', vertexId);
  }, [beginDrag]);

  const handleEdgePointerDown = useCallback((
    event: ReactPointerEvent<SVGElement>,
    fromVertexId: string,
    toVertexId: string,
  ) => {
    if (shouldMoveWholeText(event)) {
      beginDrag(event, 'move');
      return;
    }
    beginDrag(event, 'edge', undefined, [fromVertexId, toVertexId]);
  }, [beginDrag]);

  const handleEdgeDoubleClick = useCallback((
    event: ReactMouseEvent<SVGElement>,
    fromVertexId: string,
    toVertexId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    straightenEdge(fromVertexId, toVertexId);
  }, [straightenEdge]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    drag.current = point;
    if (drag.kind === 'create') {
      setDragSelection({ start: drag.start, current: point });
    } else if (drag.kind === 'move') {
      applyMoveDrag(drag, point);
    } else if (drag.kind === 'vertex') {
      applyVertexDrag(drag, point, true);
    } else if (drag.kind === 'edge') {
      applyEdgeDrag(drag, point, true, event.shiftKey);
    }
    event.preventDefault();
    event.stopPropagation();
  }, [applyEdgeDrag, applyMoveDrag, applyVertexDrag]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    finishDrag(event.currentTarget, event.pointerId, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }, event.shiftKey);
    event.preventDefault();
    event.stopPropagation();
  }, [finishDrag]);

  const handleTextChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextText = event.target.value;
    setDraftText(nextText);
    setTextSelection({
      start: Math.min(event.target.selectionStart, event.target.selectionEnd),
      end: Math.max(event.target.selectionStart, event.target.selectionEnd),
    });
    updateTextProperties(clip.id, { text: nextText });
  }, [clip.id, updateTextProperties]);

  const handleTextKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      textareaRef.current?.blur();
    }
  }, []);

  const editorStyle = useMemo<CSSProperties | null>(() => {
    if (!geometry || !textProperties) return null;
    const fontSize = Math.max(1, textProperties.fontSize * geometry.scaleY);
    const wrapWidth = Math.max(1, geometry.box.width);
    const lineCount = (() => {
      if (typeof document === 'undefined') {
        return Math.max(1, textProperties.text.split('\n').length);
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return Math.max(1, textProperties.text.split('\n').length);
      }
      ctx.font = getFontCss(textProperties);
      return wrapTextToLines(ctx, draftText, wrapWidth, textProperties.letterSpacing).length;
    })();
    const contentHeight = lineCount * textProperties.fontSize * textProperties.lineHeight;
    const verticalInsetSource = textProperties.verticalAlign === 'bottom'
      ? Math.max(0, geometry.box.height - contentHeight)
      : textProperties.verticalAlign === 'middle'
        ? Math.max(0, (geometry.box.height - contentHeight) / 2)
        : 0;

    return {
      left: geometry.corners.tl.x,
      top: geometry.corners.tl.y,
      width: geometry.width,
      height: geometry.height,
      transform: `rotate(${geometry.rotation}rad)`,
      fontFamily: textProperties.fontFamily,
      fontSize,
      fontStyle: textProperties.fontStyle,
      fontWeight: textProperties.fontWeight,
      lineHeight: textProperties.lineHeight,
      letterSpacing: textProperties.letterSpacing * geometry.scaleX,
      textAlign: textProperties.textAlign,
      color: 'transparent',
      caretColor: isEditing ? textProperties.color : 'transparent',
      paddingTop: verticalInsetSource * geometry.scaleY,
    } as CSSProperties;
  }, [draftText, geometry, isEditing, textProperties]);

  const selectionPolygons = useMemo<SelectionPolygon[]>(() => {
    if (!isEditing || !geometry || !textProperties || textSelection.start === textSelection.end) {
      return [];
    }
    if (typeof document === 'undefined') return [];

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    ctx.font = getFontCss(textProperties);
    const lineHeightPx = textProperties.fontSize * textProperties.lineHeight;
    const topBaseline = geometry.box.y + textProperties.fontSize;
    const firstPassLines = wrapTextToShapeLines(
      ctx,
      draftText,
      geometry.bounds,
      geometry.box,
      geometry.sourceWidth,
      geometry.sourceHeight,
      textProperties.fontSize,
      textProperties.lineHeight,
      textProperties.letterSpacing,
      topBaseline,
    );
    const totalHeight = firstPassLines.length * lineHeightPx;
    const startY = textProperties.verticalAlign === 'bottom'
      ? geometry.box.y + Math.max(0, geometry.box.height - totalHeight) + textProperties.fontSize
      : textProperties.verticalAlign === 'middle'
        ? geometry.box.y + Math.max(0, (geometry.box.height - totalHeight) / 2) + textProperties.fontSize
        : topBaseline;
    const lines = wrapTextToShapeLines(
      ctx,
      draftText,
      geometry.bounds,
      geometry.box,
      geometry.sourceWidth,
      geometry.sourceHeight,
      textProperties.fontSize,
      textProperties.lineHeight,
      textProperties.letterSpacing,
      startY,
    );

    const selectionStart = Math.min(textSelection.start, textSelection.end);
    const selectionEnd = Math.max(textSelection.start, textSelection.end);
    const polygons: SelectionPolygon[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const start = Math.max(selectionStart, line.start);
      const end = Math.min(selectionEnd, line.end);
      if (end <= start || line.text.length === 0) continue;

      const visualStart = Math.max(0, Math.min(line.text.length, start - line.start));
      const visualEnd = Math.max(visualStart, Math.min(line.text.length, end - line.start));
      if (visualEnd <= visualStart) continue;

      const leftEdge = selectionLineLeft(ctx, line.text, line.left, line.right, line.width, textProperties);
      const selectedLeft = leftEdge + measureTextWithLetterSpacing(
        ctx,
        line.text.slice(0, visualStart),
        textProperties.letterSpacing,
      );
      const selectedRight = leftEdge + measureTextWithLetterSpacing(
        ctx,
        line.text.slice(0, visualEnd),
        textProperties.letterSpacing,
      );
      if (selectedRight <= selectedLeft) continue;

      const yTop = line.y - textProperties.fontSize;
      const yBottom = yTop + lineHeightPx;
      polygons.push({
        id: `selection-${index}-${start}-${end}`,
        points: pointString([
          geometry.projectSourcePoint(selectedLeft, yTop),
          geometry.projectSourcePoint(selectedRight, yTop),
          geometry.projectSourcePoint(selectedRight, yBottom),
          geometry.projectSourcePoint(selectedLeft, yBottom),
        ]),
      });
    }

    return polygons;
  }, [draftText, geometry, isEditing, textProperties, textSelection.end, textSelection.start]);

  const selectionClipPathId = `preview-text-selection-clip-${clip.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  if (!enabled || !textProperties || !geometry || !editorStyle) {
    return null;
  }

  return (
    <div
      ref={layerRef}
      className="preview-text-editor-layer"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={(event) => finishDrag(event.currentTarget, event.pointerId)}
    >
      <div
        className="preview-text-area-capture"
        onPointerDown={handleCapturePointerDown}
      />
      {dragSelection && hasVisibleSelectionRect(dragSelection.start, dragSelection.current) && (
        <div
          className="preview-text-draft-box"
          style={selectionRect(dragSelection.start, dragSelection.current)}
        />
      )}
      <textarea
        ref={textareaRef}
        className={`preview-text-editor-input ${isEditing ? 'editing' : ''}`}
        value={draftText}
        onChange={handleTextChange}
        onFocus={() => {
          setIsEditing(true);
          syncTextSelection();
        }}
        onBlur={() => {
          setIsEditing(false);
          setTextSelection({ start: 0, end: 0 });
        }}
        onKeyDown={handleTextKeyDown}
        onKeyUp={syncTextSelection}
        onMouseDown={(event) => event.stopPropagation()}
        onMouseUp={syncTextSelection}
        onPointerDown={handleInputPointerDown}
        onSelect={syncTextSelection}
        spellCheck={false}
        style={editorStyle}
      />
      <svg className="preview-text-bounds-svg" width="100%" height="100%">
        {geometry.pathD && (
          <defs>
            <clipPath id={selectionClipPathId}>
              <path d={geometry.pathD} />
            </clipPath>
          </defs>
        )}
        {selectionPolygons.map(polygon => (
          <polygon
            key={polygon.id}
            className="preview-text-selection-highlight"
            points={polygon.points}
            clipPath={geometry.pathD ? `url(#${selectionClipPathId})` : undefined}
          />
        ))}
        {geometry.pathD && (
          <path className="preview-text-bounds-outline" d={geometry.pathD} />
        )}
        {geometry.edges.map(edge => (
          <path
            key={edge.id}
            className="preview-text-bounds-edge-hit"
            d={edge.pathD}
            onPointerDown={(event) => handleEdgePointerDown(event, edge.fromVertexId, edge.toVertexId)}
            onDoubleClick={(event) => handleEdgeDoubleClick(event, edge.fromVertexId, edge.toVertexId)}
          >
            <title>Drag edge. Shift-drag to snap straight. Double-click to straighten.</title>
          </path>
        ))}
        {geometry.edges.map(edge => (
          <rect
            key={`${edge.id}-handle`}
            className="preview-text-bounds-edge-handle"
            x={edge.midpoint.x - 3}
            y={edge.midpoint.y - 3}
            width={6}
            height={6}
            onPointerDown={(event) => handleEdgePointerDown(event, edge.fromVertexId, edge.toVertexId)}
            onDoubleClick={(event) => handleEdgeDoubleClick(event, edge.fromVertexId, edge.toVertexId)}
          >
            <title>Drag edge. Shift-drag to snap straight. Double-click to straighten.</title>
          </rect>
        ))}
        {geometry.vertices.map(({ vertex, point }) => (
          <rect
            key={vertex.id}
            className="preview-text-bounds-vertex"
            x={point.x - 4}
            y={point.y - 4}
            width={8}
            height={8}
            onPointerDown={(event) => handleVertexPointerDown(event, vertex.id)}
          />
        ))}
      </svg>
    </div>
  );
}
