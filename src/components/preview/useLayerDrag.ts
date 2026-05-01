// Layer drag logic: move/scale layers in edit mode with document-level listeners + overlay drawing

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Layer, TimelineClip } from '../../types';
import {
  getLayerOverlayHandles,
  resolvePositionDeltaForCanvasDelta,
  scaleLayerOverlayBounds,
  type LayerOverlayBounds,
  type OverlayPoint,
} from './editModeOverlayMath';

interface UseLayerDragParams {
  editMode: boolean;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  canvasSize: { width: number; height: number };
  canvasInContainer: { x: number; y: number; width: number; height: number };
  viewZoom: number;
  layers: Layer[];
  clips: TimelineClip[];
  selectedLayerId: string | null;
  selectedClipId: string | null;
  selectClip: (id: string | null) => void;
  selectLayer: (id: string | null) => void;
  updateClipTransform: (clipId: string, transform: Partial<{ position: { x: number; y: number; z: number }; scale: { x: number; y: number } }>) => void;
  updateLayer: (layerId: string, updates: Partial<Layer>) => void;
  calculateLayerBounds: (layer: Layer, canvasW: number, canvasH: number, forcePos?: { x: number; y: number }) => LayerOverlayBounds;
  findLayerAtPosition: (containerX: number, containerY: number) => Layer | null;
  findHandleAtPosition: (containerX: number, containerY: number, layer: Layer) => string | null;
}

function drawOverlayPath(ctx: CanvasRenderingContext2D, corners: LayerOverlayBounds['corners']): void {
  ctx.beginPath();
  ctx.moveTo(corners.tl.x, corners.tl.y);
  ctx.lineTo(corners.tr.x, corners.tr.y);
  ctx.lineTo(corners.br.x, corners.br.y);
  ctx.lineTo(corners.bl.x, corners.bl.y);
  ctx.closePath();
  ctx.stroke();
}

function drawHandle(ctx: CanvasRenderingContext2D, point: OverlayPoint, size: number): void {
  ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
}

function findClipForLayer(clips: TimelineClip[], layer: Layer): TimelineClip | undefined {
  return layer.sourceClipId
    ? clips.find((clip) => clip.id === layer.sourceClipId)
    : clips.find((clip) => clip.name === layer.name);
}

interface MovePositionBasis {
  baseBounds: LayerOverlayBounds;
  xPlusBounds: LayerOverlayBounds;
  yPlusBounds: LayerOverlayBounds;
}

type PendingDragUpdate =
  | {
      mode: 'move';
      layerId: string;
      clipId?: string;
      position: { x: number; y: number; z: number };
    }
  | {
      mode: 'scale';
      layerId: string;
      clipId?: string;
      scale: { x: number; y: number };
    };

export function useLayerDrag({
  editMode,
  overlayRef,
  canvasSize,
  canvasInContainer,
  viewZoom,
  layers,
  clips,
  selectedLayerId,
  selectedClipId,
  selectClip,
  selectLayer,
  updateClipTransform,
  updateLayer,
  calculateLayerBounds,
  findLayerAtPosition,
  findHandleAtPosition,
}: UseLayerDragParams) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<'move' | 'scale'>('move');
  const [dragHandle, setDragHandle] = useState<string | null>(null);
  const [hoverHandle, setHoverHandle] = useState<string | null>(null);
  const dragStart = useRef({ x: 0, y: 0, layerPosX: 0, layerPosY: 0, layerScaleX: 1, layerScaleY: 1 });
  const currentDragPos = useRef({ x: 0, y: 0 });
  const layersRef = useRef(layers);
  const clipsRef = useRef(clips);
  const movePositionBasis = useRef<MovePositionBasis | null>(null);
  const pendingDragUpdate = useRef<PendingDragUpdate | null>(null);
  const dragUpdateFrame = useRef<number | null>(null);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  const flushPendingDragUpdate = useCallback(() => {
    dragUpdateFrame.current = null;
    const pending = pendingDragUpdate.current;
    pendingDragUpdate.current = null;

    if (!pending) return;

    if (pending.mode === 'move') {
      updateLayer(pending.layerId, { position: pending.position });
      if (pending.clipId) {
        updateClipTransform(pending.clipId, { position: pending.position });
      }
      return;
    }

    updateLayer(pending.layerId, { scale: pending.scale });
    if (pending.clipId) {
      updateClipTransform(pending.clipId, { scale: pending.scale });
    }
  }, [updateClipTransform, updateLayer]);

  const scheduleDragUpdate = useCallback((update: PendingDragUpdate) => {
    pendingDragUpdate.current = update;

    if (dragUpdateFrame.current === null) {
      dragUpdateFrame.current = requestAnimationFrame(flushPendingDragUpdate);
    }
  }, [flushPendingDragUpdate]);

  const flushPendingDragUpdateNow = useCallback(() => {
    if (dragUpdateFrame.current !== null) {
      cancelAnimationFrame(dragUpdateFrame.current);
      dragUpdateFrame.current = null;
    }

    flushPendingDragUpdate();
  }, [flushPendingDragUpdate]);

  useEffect(() => () => {
    if (dragUpdateFrame.current !== null) {
      cancelAnimationFrame(dragUpdateFrame.current);
    }
  }, []);

  // Draw overlay with bounding boxes (full-container overlay)
  useEffect(() => {
    if (!editMode || !overlayRef.current) return;

    const ctx = overlayRef.current.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const overlayWidth = overlayRef.current!.width;
      const overlayHeight = overlayRef.current!.height;
      ctx.clearRect(0, 0, overlayWidth, overlayHeight);

      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(0, 0, overlayWidth, overlayHeight);

      ctx.clearRect(
        canvasInContainer.x,
        canvasInContainer.y,
        canvasInContainer.width,
        canvasInContainer.height
      );

      const visibleLayers = layers.filter(l => l?.visible && l?.source);

      visibleLayers.forEach((layer) => {
        if (!layer) return;

        const isSelected = layer.id === selectedLayerId ||
          clips.find(c => c.id === selectedClipId)?.name === layer.name;

        const forcePos = (isDragging && dragMode === 'move' && layer.id === dragLayerId)
          ? currentDragPos.current
          : undefined;
        const bounds = calculateLayerBounds(layer, canvasSize.width, canvasSize.height, forcePos);
        const containerBounds = scaleLayerOverlayBounds(bounds, viewZoom, {
          x: canvasInContainer.x,
          y: canvasInContainer.y,
        });

        ctx.save();
        ctx.strokeStyle = isSelected ? '#2997E5' : 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.setLineDash(isSelected ? [] : [5, 5]);
        drawOverlayPath(ctx, containerBounds.corners);

        if (isSelected) {
          const handleSize = 8;
          ctx.fillStyle = '#2997E5';
          const handles = getLayerOverlayHandles(containerBounds);

          Object.values(handles).forEach((handle) => drawHandle(ctx, handle, handleSize));

          ctx.strokeStyle = '#2997E5';
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(containerBounds.x - 10, containerBounds.y);
          ctx.lineTo(containerBounds.x + 10, containerBounds.y);
          ctx.moveTo(containerBounds.x, containerBounds.y - 10);
          ctx.lineTo(containerBounds.x, containerBounds.y + 10);
          ctx.stroke();
        }

        ctx.fillStyle = isSelected ? '#2997E5' : 'rgba(255, 255, 255, 0.7)';
        ctx.font = '11px sans-serif';
        ctx.fillText(layer.name, containerBounds.corners.tl.x + 4, containerBounds.corners.tl.y - 6);

        ctx.restore();
      });
    };

    draw();
  }, [editMode, layers, selectedLayerId, selectedClipId, clips, canvasSize, canvasInContainer, viewZoom, calculateLayerBounds, isDragging, dragMode, dragLayerId, overlayRef]);

  // Handle mouse down on overlay
  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    if (!editMode || !overlayRef.current || e.altKey) return;
    if (e.button !== 0) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const selectedLayer = selectedLayerId ? layers.find(l => l?.id === selectedLayerId) : null;
    if (selectedLayer) {
      const handle = findHandleAtPosition(x, y, selectedLayer);
      if (handle) {
        movePositionBasis.current = null;
        currentDragPos.current = { x: selectedLayer.position.x, y: selectedLayer.position.y };
        setIsDragging(true);
        setDragLayerId(selectedLayer.id);
        setDragMode('scale');
        setDragHandle(handle);
        dragStart.current = {
          x: e.clientX,
          y: e.clientY,
          layerPosX: selectedLayer.position.x,
          layerPosY: selectedLayer.position.y,
          layerScaleX: selectedLayer.scale.x,
          layerScaleY: selectedLayer.scale.y,
        };
        return;
      }
    }

    const layer = findLayerAtPosition(x, y);

    if (layer) {
      const clip = findClipForLayer(clips, layer);
      if (clip) {
        selectClip(clip.id);
      }
      selectLayer(layer.id);
      currentDragPos.current = { x: layer.position.x, y: layer.position.y };

      movePositionBasis.current = {
        baseBounds: calculateLayerBounds(layer, canvasSize.width, canvasSize.height, layer.position),
        xPlusBounds: calculateLayerBounds(layer, canvasSize.width, canvasSize.height, {
          x: layer.position.x + 1,
          y: layer.position.y,
        }),
        yPlusBounds: calculateLayerBounds(layer, canvasSize.width, canvasSize.height, {
          x: layer.position.x,
          y: layer.position.y + 1,
        }),
      };

      setIsDragging(true);
      setDragLayerId(layer.id);
      setDragMode('move');
      setDragHandle(null);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        layerPosX: layer.position.x,
        layerPosY: layer.position.y,
        layerScaleX: layer.scale.x,
        layerScaleY: layer.scale.y,
      };
    } else {
      selectClip(null);
      selectLayer(null);
      movePositionBasis.current = null;
    }
  }, [editMode, findLayerAtPosition, findHandleAtPosition, clips, layers, selectedLayerId, selectClip, selectLayer, calculateLayerBounds, canvasSize, overlayRef]);

  // Handle mouse move on overlay — detect handle hover
  const handleOverlayMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging || !overlayRef.current) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const selectedLayer = selectedLayerId ? layers.find(l => l?.id === selectedLayerId) : null;
    if (selectedLayer) {
      const handle = findHandleAtPosition(x, y, selectedLayer);
      setHoverHandle(handle);
    } else {
      setHoverHandle(null);
    }
  }, [isDragging, selectedLayerId, layers, findHandleAtPosition, overlayRef]);

  // Handle mouse up
  const handleOverlayMouseUp = useCallback(() => {
    flushPendingDragUpdateNow();
    setIsDragging(false);
    setDragLayerId(null);
    movePositionBasis.current = null;
    currentDragPos.current = { x: 0, y: 0 };
  }, [flushPendingDragUpdateNow]);

  // Document-level listeners during drag
  useEffect(() => {
    if (!isDragging) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!dragLayerId) return;

      const layer = layersRef.current.find(l => l?.id === dragLayerId);
      if (!layer) return;
      const clip = findClipForLayer(clipsRef.current, layer);

      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;

      if (dragMode === 'scale' && dragHandle) {
        const originalScaleX = dragStart.current.layerScaleX;
        const originalScaleY = dragStart.current.layerScaleY;
        const scaleSensitivity = 0.005 / viewZoom;

        let newScaleX = originalScaleX;
        let newScaleY = originalScaleY;

        switch (dragHandle) {
          case 'tl':
            newScaleX = originalScaleX - dx * scaleSensitivity;
            newScaleY = originalScaleY - dy * scaleSensitivity;
            break;
          case 'tr':
            newScaleX = originalScaleX + dx * scaleSensitivity;
            newScaleY = originalScaleY - dy * scaleSensitivity;
            break;
          case 'bl':
            newScaleX = originalScaleX - dx * scaleSensitivity;
            newScaleY = originalScaleY + dy * scaleSensitivity;
            break;
          case 'br':
            newScaleX = originalScaleX + dx * scaleSensitivity;
            newScaleY = originalScaleY + dy * scaleSensitivity;
            break;
          case 't':
            newScaleY = originalScaleY - dy * scaleSensitivity;
            break;
          case 'b':
            newScaleY = originalScaleY + dy * scaleSensitivity;
            break;
          case 'l':
            newScaleX = originalScaleX - dx * scaleSensitivity;
            break;
          case 'r':
            newScaleX = originalScaleX + dx * scaleSensitivity;
            break;
        }

        if (e.shiftKey && (dragHandle === 'tl' || dragHandle === 'tr' || dragHandle === 'bl' || dragHandle === 'br')) {
          const avgScale = (newScaleX / originalScaleX + newScaleY / originalScaleY) / 2;
          newScaleX = originalScaleX * avgScale;
          newScaleY = originalScaleY * avgScale;
        }

        newScaleX = Math.max(0.01, Math.min(10, newScaleX));
        newScaleY = Math.max(0.01, Math.min(10, newScaleY));

        scheduleDragUpdate({
          mode: 'scale',
          layerId: dragLayerId,
          clipId: clip?.id,
          scale: { x: newScaleX, y: newScaleY },
        });
      } else {
        const basis = movePositionBasis.current ?? {
          baseBounds: calculateLayerBounds(layer, canvasSize.width, canvasSize.height, {
            x: dragStart.current.layerPosX,
            y: dragStart.current.layerPosY,
          }),
          xPlusBounds: calculateLayerBounds(layer, canvasSize.width, canvasSize.height, {
            x: dragStart.current.layerPosX + 1,
            y: dragStart.current.layerPosY,
          }),
          yPlusBounds: calculateLayerBounds(layer, canvasSize.width, canvasSize.height, {
            x: dragStart.current.layerPosX,
            y: dragStart.current.layerPosY + 1,
          }),
        };
        movePositionBasis.current = basis;
        const positionDelta = resolvePositionDeltaForCanvasDelta(
          basis.baseBounds,
          basis.xPlusBounds,
          basis.yPlusBounds,
          { x: dx / viewZoom, y: dy / viewZoom },
        );

        const newPosX = dragStart.current.layerPosX + positionDelta.x;
        const newPosY = dragStart.current.layerPosY + positionDelta.y;

        currentDragPos.current = { x: newPosX, y: newPosY };

        scheduleDragUpdate({
          mode: 'move',
          layerId: dragLayerId,
          clipId: clip?.id,
          position: { x: newPosX, y: newPosY, z: layer.position.z },
        });
      }
    };

    const handleDocumentMouseUp = () => {
      flushPendingDragUpdateNow();
      setIsDragging(false);
      setDragLayerId(null);
      setDragMode('move');
      setDragHandle(null);
      movePositionBasis.current = null;
      currentDragPos.current = { x: 0, y: 0 };
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    isDragging,
    dragLayerId,
    dragMode,
    dragHandle,
    viewZoom,
    canvasSize,
    calculateLayerBounds,
    flushPendingDragUpdateNow,
    scheduleDragUpdate,
  ]);

  return {
    isDragging,
    dragMode,
    dragHandle,
    hoverHandle,
    handleOverlayMouseDown,
    handleOverlayMouseMove,
    handleOverlayMouseUp,
  };
}
