// MaskOverlay - SVG overlay for mask drawing and editing on preview canvas

import './MaskOverlay.css';
import { memo, useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { getShortcutRegistry } from '../../services/shortcutRegistry';
import { startBatch, endBatch } from '../../stores/historyStore';
import { projectLayerUvToCanvas, unprojectCanvasToLayerUv } from './editModeOverlayMath';
import {
  getNextMaskVertexHandleMode,
  inferMaskVertexHandleMode,
} from '../../utils/maskVertexHandles';
import { createMaskPathProperty } from '../../types/animationProperties';
import type { MaskVertexHandleMode } from '../../types/masks';
import { MaskOverlayChrome } from './maskOverlay/MaskOverlayChrome';
import {
  buildMaskPathValueWithVertexUpdates,
  getNearestMaskEdgeInsert,
} from './maskOverlay/maskOverlayGeometry';
import {
  buildCanvasMaskVertices,
  buildMaskEdgeSegments,
  buildProjectedMaskPath,
  buildShapePreviewPath,
  buildVisibleMaskPaths,
  getProjectionParams,
  withClipProjectionTransform,
} from './maskOverlay/maskOverlayProjectionPlans';
import type { PenEdgeInsertPreview } from './maskOverlay/maskOverlayTypes';
import { usePenMaskDraw } from './maskOverlay/usePenMaskDraw';
import { useMaskVertexDrag } from './useMaskVertexDrag';
import { useMaskDrag } from './useMaskDrag';
import { useMaskEdgeDrag } from './useMaskEdgeDrag';
import { useMaskShapeDraw } from './useMaskShapeDraw';

interface MaskOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
  displayWidth: number;
  displayHeight: number;
  viewZoom: number;
}

type FeatherPreviewOverlay = {
  maskId: string;
  edgeId: string | null;
  changedAt: number;
  phase: 'in' | 'out';
};

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function MaskOverlayComponent({ canvasWidth, canvasHeight, displayWidth, displayHeight, viewZoom }: MaskOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const suppressNextSvgClickRef = useRef(false);
  const [hoveredVertexId, setHoveredVertexId] = useState<string | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [penInsertPreview, setPenInsertPreview] = useState<PenEdgeInsertPreview | null>(null);
  const [featherPreviewOverlay, setFeatherPreviewOverlay] = useState<FeatherPreviewOverlay | null>(null);

  const {
    clips,
    layers,
    selectedClipIds,
    playheadPosition,
    maskEditMode,
    activeMaskId,
    selectedVertexIds,
    selectedMaskEdgeId,
    maskFeatherPreview,
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
    getInterpolatedTransform,
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
  const selectedClipLocalTime = selectedClip
    ? playheadPosition - selectedClip.startTime
    : 0;
  const projectionLayer = useMemo(() => {
    if (!selectedClip) return activeLayer;
    return withClipProjectionTransform(
      activeLayer,
      getInterpolatedTransform(selectedClip.id, selectedClipLocalTime),
    );
  }, [activeLayer, getInterpolatedTransform, selectedClip, selectedClipLocalTime]);
  const projectionParams = useMemo(
    () => getProjectionParams(projectionLayer, canvasWidth, canvasHeight),
    [canvasHeight, canvasWidth, projectionLayer],
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
    const viewBox = svg.viewBox.baseVal;
    const viewBoxWidth = viewBox.width || canvasWidth;
    const viewBoxHeight = viewBox.height || canvasHeight;

    return {
      x: viewBox.x + ((e.clientX - rect.left) / rect.width) * viewBoxWidth,
      y: viewBox.y + ((e.clientY - rect.top) / rect.height) * viewBoxHeight,
    };
  }, [canvasHeight, canvasWidth]);

  const getNormalizedPoint = useCallback((e: MouseEvent | React.MouseEvent): { x: number; y: number } | null => {
    const canvasPoint = getCanvasPoint(e);
    if (!canvasPoint) return null;
    const point = projectionParams
      ? unprojectCanvasToLayerUv(canvasPoint, projectionParams)
      : { x: canvasPoint.x / canvasWidth, y: canvasPoint.y / canvasHeight };

    return point;
  }, [canvasHeight, canvasWidth, getCanvasPoint, projectionParams]);

  const clientToLocalPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const syntheticPoint = {
      clientX,
      clientY,
    } as MouseEvent;
    return getNormalizedPoint(syntheticPoint);
  }, [getNormalizedPoint]);

  useEffect(() => {
    if (!maskFeatherPreview) {
      setFeatherPreviewOverlay(current => current ? { ...current, phase: 'out' } : current);
      const clearTimer = window.setTimeout(() => {
        setFeatherPreviewOverlay(null);
      }, 500);
      return () => {
        window.clearTimeout(clearTimer);
      };
    }
    const overlay: FeatherPreviewOverlay = {
      maskId: maskFeatherPreview.maskId,
      edgeId: maskFeatherPreview.edgeId,
      changedAt: maskFeatherPreview.changedAt,
      phase: 'in' as const,
    };
    setFeatherPreviewOverlay(current => ({
      ...overlay,
      phase: current?.maskId === overlay.maskId && current.edgeId === overlay.edgeId && current.phase === 'in'
        ? current.phase
        : 'in',
    }));

    const fadeOutTimer = window.setTimeout(() => {
      setFeatherPreviewOverlay(current =>
        current?.maskId === overlay.maskId && current.edgeId === overlay.edgeId
          && current.changedAt === overlay.changedAt
          ? { ...current, phase: 'out' }
          : current
      );
    }, 500);
    const clearTimer = window.setTimeout(() => {
      setFeatherPreviewOverlay(current =>
        current?.maskId === overlay.maskId && current.edgeId === overlay.edgeId && current.changedAt === overlay.changedAt ? null : current
      );
    }, 1000);

    return () => {
      window.clearTimeout(fadeOutTimer);
      window.clearTimeout(clearTimer);
    };
  }, [maskFeatherPreview]);

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

  const { handlePenMouseDown } = usePenMaskDraw({
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
    svgRef,
    updateVertex,
  });

  const canvasVertices = useMemo(
    () => buildCanvasMaskVertices(activeMask, projectMaskPoint),
    [activeMask, projectMaskPoint],
  );
  const pathData = useMemo(() => {
    if (!activeMask) return '';
    return buildProjectedMaskPath(activeMask, projectMaskPoint);
  }, [activeMask, projectMaskPoint]);
  const visibleMaskPaths = useMemo(
    () => buildVisibleMaskPaths(selectedClipMasks, projectMaskPoint),
    [projectMaskPoint, selectedClipMasks],
  );
  const edgeSegments = useMemo(
    () => buildMaskEdgeSegments(activeMask, projectMaskPoint),
    [activeMask, projectMaskPoint],
  );

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
          x: vertex.x + dx,
          y: vertex.y + dy,
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
    if (e.button !== 0) return;

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

  const shapePreviewPath = useMemo(
    () => buildShapePreviewPath(shapeDrawState, maskEditMode, projectMaskPoint),
    [maskEditMode, projectMaskPoint, shapeDrawState],
  );

  // Don't render if not in mask editing mode
  const isShapeDrawingMode = maskEditMode === 'drawingRect' || maskEditMode === 'drawingEllipse' || maskEditMode === 'drawingPen';
  if (maskEditMode === 'none' || !selectedClip) {
    return null;
  }
  if (!isShapeDrawingMode && !activeMask) {
    return null;
  }

  return (
    <MaskOverlayChrome
      svgRef={svgRef}
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
      displayWidth={displayWidth}
      displayHeight={displayHeight}
      viewZoom={viewZoom}
      maskEditMode={maskEditMode}
      activeMask={activeMask}
      selectedVertexIds={selectedVertexIds}
      selectedMaskEdgeId={selectedMaskEdgeId}
      featherPreview={featherPreviewOverlay?.maskId === activeMask?.id ? featherPreviewOverlay : null}
      hoveredVertexId={hoveredVertexId}
      hoveredEdgeKey={hoveredEdgeKey}
      penInsertPreview={penInsertPreview}
      shapePreviewPath={shapePreviewPath}
      pathData={pathData}
      visibleMaskPaths={visibleMaskPaths}
      edgeSegments={edgeSegments}
      canvasVertices={canvasVertices}
      onSvgClick={handleSvgClick}
      onPenMouseDown={handlePenMouseDown}
      onShapeMouseDown={handleShapeMouseDown}
      onShapeMouseMove={(event) => {
        updatePenInsertPreview(event);
        handleShapeMouseMove(event);
      }}
      onShapeMouseUp={handleShapeMouseUp}
      onClearPenInsertPreview={() => setPenInsertPreview(null)}
      onMaskDragStart={handleMaskDragStart}
      onEdgeMouseDown={handleEdgeMouseDown}
      onVertexMouseDown={handleVertexMouseDown}
      onVertexDoubleClick={handleVertexDoubleClick}
      onFirstVertexClose={handleFirstVertexClose}
      onHoveredEdgeChange={setHoveredEdgeKey}
      onHoveredVertexChange={setHoveredVertexId}
    />
  );
}

export const MaskOverlay = memo(MaskOverlayComponent);
