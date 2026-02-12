// Edit mode overlay helpers: bounding box calculation, hit testing, cursor mapping

import { useCallback } from 'react';
import type { Layer } from '../../types';

interface UseEditModeOverlayParams {
  effectiveResolution: { width: number; height: number };
  canvasSize: { width: number; height: number };
  canvasInContainer: { x: number; y: number; width: number; height: number };
  viewZoom: number;
  layers: Layer[];
}

export function useEditModeOverlay({
  effectiveResolution,
  canvasSize,
  canvasInContainer,
  viewZoom,
  layers,
}: UseEditModeOverlayParams) {

  // Calculate layer bounding box in canvas coordinates (matches shader transform)
  const calculateLayerBounds = useCallback((layer: Layer, canvasW: number, canvasH: number, forcePos?: { x: number; y: number }) => {
    let sourceWidth = effectiveResolution.width;
    let sourceHeight = effectiveResolution.height;

    if (layer.source?.videoElement) {
      sourceWidth = layer.source.videoElement.videoWidth || sourceWidth;
      sourceHeight = layer.source.videoElement.videoHeight || sourceHeight;
    } else if (layer.source?.imageElement) {
      sourceWidth = layer.source.imageElement.naturalWidth || sourceWidth;
      sourceHeight = layer.source.imageElement.naturalHeight || sourceHeight;
    }

    const sourceAspect = sourceWidth / sourceHeight;
    const outputAspect = effectiveResolution.width / effectiveResolution.height;
    const aspectRatio = sourceAspect / outputAspect;

    let displayWidth: number;
    let displayHeight: number;

    if (aspectRatio > 1) {
      displayWidth = canvasW;
      displayHeight = canvasH / aspectRatio;
    } else {
      displayWidth = canvasW * aspectRatio;
      displayHeight = canvasH;
    }

    displayWidth *= layer.scale.x;
    displayHeight *= layer.scale.y;

    const centerX = canvasW / 2;
    const centerY = canvasH / 2;
    const layerPos = forcePos || layer.position;
    const posX = centerX + (layerPos.x * canvasW);
    const posY = centerY + (layerPos.y * canvasH);
    const rotationValue = typeof layer.rotation === 'number' ? layer.rotation : layer.rotation.z;

    return {
      x: posX,
      y: posY,
      width: displayWidth,
      height: displayHeight,
      rotation: rotationValue,
    };
  }, [effectiveResolution]);

  // Find layer at mouse position (container coordinates)
  const findLayerAtPosition = useCallback((containerX: number, containerY: number): Layer | null => {
    const visibleLayers = layers.filter(l => l?.visible && l?.source).reverse();

    for (const layer of visibleLayers) {
      if (!layer) continue;

      const bounds = calculateLayerBounds(layer, canvasSize.width, canvasSize.height);
      const layerContainerX = canvasInContainer.x + bounds.x * viewZoom;
      const layerContainerY = canvasInContainer.y + bounds.y * viewZoom;
      const halfW = (bounds.width * viewZoom) / 2;
      const halfH = (bounds.height * viewZoom) / 2;

      if (containerX >= layerContainerX - halfW && containerX <= layerContainerX + halfW &&
          containerY >= layerContainerY - halfH && containerY <= layerContainerY + halfH) {
        return layer;
      }
    }
    return null;
  }, [layers, canvasSize, canvasInContainer, viewZoom, calculateLayerBounds]);

  // Find which handle was clicked on the selected layer
  const findHandleAtPosition = useCallback((containerX: number, containerY: number, layer: Layer): string | null => {
    const bounds = calculateLayerBounds(layer, canvasSize.width, canvasSize.height);

    const cx = canvasInContainer.x + bounds.x * viewZoom;
    const cy = canvasInContainer.y + bounds.y * viewZoom;
    const halfW = (bounds.width * viewZoom) / 2;
    const halfH = (bounds.height * viewZoom) / 2;
    const handleSize = 12;

    const corners = [
      { id: 'tl', x: cx - halfW, y: cy - halfH },
      { id: 'tr', x: cx + halfW, y: cy - halfH },
      { id: 'bl', x: cx - halfW, y: cy + halfH },
      { id: 'br', x: cx + halfW, y: cy + halfH },
    ];

    for (const corner of corners) {
      if (Math.abs(containerX - corner.x) <= handleSize && Math.abs(containerY - corner.y) <= handleSize) {
        return corner.id;
      }
    }

    const edges = [
      { id: 't', x: cx, y: cy - halfH },
      { id: 'b', x: cx, y: cy + halfH },
      { id: 'l', x: cx - halfW, y: cy },
      { id: 'r', x: cx + halfW, y: cy },
    ];

    for (const edge of edges) {
      if (Math.abs(containerX - edge.x) <= handleSize && Math.abs(containerY - edge.y) <= handleSize) {
        return edge.id;
      }
    }

    return null;
  }, [canvasSize, canvasInContainer, viewZoom, calculateLayerBounds]);

  // Get cursor style for handle
  const getCursorForHandle = useCallback((handle: string | null): string => {
    if (!handle) return 'crosshair';
    switch (handle) {
      case 'tl':
      case 'br':
        return 'nwse-resize';
      case 'tr':
      case 'bl':
        return 'nesw-resize';
      case 't':
      case 'b':
        return 'ns-resize';
      case 'l':
      case 'r':
        return 'ew-resize';
      default:
        return 'crosshair';
    }
  }, []);

  return { calculateLayerBounds, findLayerAtPosition, findHandleAtPosition, getCursorForHandle };
}
