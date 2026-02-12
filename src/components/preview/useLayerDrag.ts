// Layer drag logic: move/scale layers in edit mode with document-level listeners + overlay drawing

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Layer, TimelineClip } from '../../types';

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
  calculateLayerBounds: (layer: Layer, canvasW: number, canvasH: number, forcePos?: { x: number; y: number }) => { x: number; y: number; width: number; height: number; rotation: number };
  findLayerAtPosition: (containerX: number, containerY: number) => Layer | null;
  findHandleAtPosition: (containerX: number, containerY: number, layer: Layer) => string | null;
}

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

        const forcePos = (isDragging && layer.id === dragLayerId) ? currentDragPos.current : undefined;
        const bounds = calculateLayerBounds(layer, canvasSize.width, canvasSize.height, forcePos);

        const containerX = canvasInContainer.x + bounds.x * viewZoom;
        const containerY = canvasInContainer.y + bounds.y * viewZoom;
        const containerWidth = bounds.width * viewZoom;
        const containerHeight = bounds.height * viewZoom;

        ctx.save();
        ctx.translate(containerX, containerY);
        ctx.rotate(bounds.rotation);

        const halfW = containerWidth / 2;
        const halfH = containerHeight / 2;

        ctx.strokeStyle = isSelected ? '#2997E5' : 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.setLineDash(isSelected ? [] : [5, 5]);
        ctx.strokeRect(-halfW, -halfH, containerWidth, containerHeight);

        if (isSelected) {
          const handleSize = 8;
          ctx.fillStyle = '#2997E5';

          ctx.fillRect(-halfW - handleSize/2, -halfH - handleSize/2, handleSize, handleSize);
          ctx.fillRect(halfW - handleSize/2, -halfH - handleSize/2, handleSize, handleSize);
          ctx.fillRect(-halfW - handleSize/2, halfH - handleSize/2, handleSize, handleSize);
          ctx.fillRect(halfW - handleSize/2, halfH - handleSize/2, handleSize, handleSize);

          ctx.fillRect(-handleSize/2, -halfH - handleSize/2, handleSize, handleSize);
          ctx.fillRect(-handleSize/2, halfH - handleSize/2, handleSize, handleSize);
          ctx.fillRect(-halfW - handleSize/2, -handleSize/2, handleSize, handleSize);
          ctx.fillRect(halfW - handleSize/2, -handleSize/2, handleSize, handleSize);

          ctx.strokeStyle = '#2997E5';
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(-10, 0);
          ctx.lineTo(10, 0);
          ctx.moveTo(0, -10);
          ctx.lineTo(0, 10);
          ctx.stroke();
        }

        ctx.fillStyle = isSelected ? '#2997E5' : 'rgba(255, 255, 255, 0.7)';
        ctx.font = '11px sans-serif';
        ctx.fillText(layer.name, -halfW + 4, -halfH - 6);

        ctx.restore();
      });
    };

    draw();

    let animId: number | null = null;
    if (isDragging) {
      const loop = () => {
        draw();
        animId = requestAnimationFrame(loop);
      };
      animId = requestAnimationFrame(loop);
    }

    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [editMode, layers, selectedLayerId, selectedClipId, clips, canvasSize, canvasInContainer, viewZoom, calculateLayerBounds, isDragging, dragLayerId]);

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
      const clip = clips.find(c => c.name === layer.name);
      if (clip) {
        selectClip(clip.id);
      }
      selectLayer(layer.id);

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
    }
  }, [editMode, findLayerAtPosition, findHandleAtPosition, clips, layers, selectedLayerId, selectClip, selectLayer]);

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
  }, [isDragging, selectedLayerId, layers, findHandleAtPosition]);

  // Handle mouse up
  const handleOverlayMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragLayerId(null);
    currentDragPos.current = { x: 0, y: 0 };
  }, []);

  // Document-level listeners during drag
  useEffect(() => {
    if (!isDragging) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!dragLayerId) return;

      const layer = layers.find(l => l?.id === dragLayerId);
      if (!layer) return;

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

        updateLayer(dragLayerId, {
          scale: { x: newScaleX, y: newScaleY },
        });

        const clip = clips.find(c => c.name === layer.name);
        if (clip) {
          updateClipTransform(clip.id, {
            scale: { x: newScaleX, y: newScaleY },
          });
        }
      } else {
        const normalizedDx = (dx / viewZoom) / canvasSize.width;
        const normalizedDy = (dy / viewZoom) / canvasSize.height;

        const newPosX = dragStart.current.layerPosX + normalizedDx;
        const newPosY = dragStart.current.layerPosY + normalizedDy;

        currentDragPos.current = { x: newPosX, y: newPosY };

        updateLayer(dragLayerId, {
          position: { x: newPosX, y: newPosY, z: layer.position.z },
        });

        const clip = clips.find(c => c.name === layer.name);
        if (clip) {
          updateClipTransform(clip.id, {
            position: { x: newPosX, y: newPosY, z: 0 },
          });
        }
      }
    };

    const handleDocumentMouseUp = () => {
      setIsDragging(false);
      setDragLayerId(null);
      setDragMode('move');
      setDragHandle(null);
      currentDragPos.current = { x: 0, y: 0 };
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [isDragging, dragLayerId, dragMode, dragHandle, viewZoom, canvasSize, layers, clips, updateClipTransform, updateLayer]);

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
