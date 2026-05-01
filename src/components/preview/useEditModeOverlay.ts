// Edit mode overlay helpers: bounding box calculation, hit testing, cursor mapping

import { useCallback } from 'react';
import type { Layer } from '../../types';
import {
  calculateLayerOverlayBounds,
  getLayerOverlayHandles,
  pointInLayerOverlayBounds,
  scaleLayerOverlayBounds,
  type LayerOverlayBounds,
} from './editModeOverlayMath';

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
    } else if (layer.source?.textCanvas) {
      sourceWidth = layer.source.textCanvas.width || sourceWidth;
      sourceHeight = layer.source.textCanvas.height || sourceHeight;
    } else if (layer.source?.nestedComposition) {
      sourceWidth = layer.source.nestedComposition.width || sourceWidth;
      sourceHeight = layer.source.nestedComposition.height || sourceHeight;
    } else if (layer.source?.intrinsicWidth && layer.source?.intrinsicHeight) {
      sourceWidth = layer.source.intrinsicWidth;
      sourceHeight = layer.source.intrinsicHeight;
    }

    const layerPos = forcePos || layer.position;
    const rotationValue = typeof layer.rotation === 'number' ? layer.rotation : layer.rotation.z;

    return calculateLayerOverlayBounds({
      sourceWidth,
      sourceHeight,
      outputWidth: effectiveResolution.width,
      outputHeight: effectiveResolution.height,
      canvasWidth: canvasW,
      canvasHeight: canvasH,
      position: layerPos,
      scale: layer.scale,
      rotation: rotationValue,
    });
  }, [effectiveResolution]);

  const toContainerBounds = useCallback((bounds: LayerOverlayBounds): LayerOverlayBounds => (
    scaleLayerOverlayBounds(bounds, viewZoom, { x: canvasInContainer.x, y: canvasInContainer.y })
  ), [canvasInContainer, viewZoom]);

  // Find layer at mouse position (container coordinates)
  const findLayerAtPosition = useCallback((containerX: number, containerY: number): Layer | null => {
    const visibleLayers = layers.filter(l => l?.visible && l?.source).reverse();

    for (const layer of visibleLayers) {
      if (!layer) continue;

      const bounds = calculateLayerBounds(layer, canvasSize.width, canvasSize.height);
      const containerBounds = toContainerBounds(bounds);

      if (pointInLayerOverlayBounds({ x: containerX, y: containerY }, containerBounds)) {
        return layer;
      }
    }
    return null;
  }, [layers, canvasSize, calculateLayerBounds, toContainerBounds]);

  // Find which handle was clicked on the selected layer
  const findHandleAtPosition = useCallback((containerX: number, containerY: number, layer: Layer): string | null => {
    const bounds = calculateLayerBounds(layer, canvasSize.width, canvasSize.height);
    const containerBounds = toContainerBounds(bounds);
    const handleSize = 12;
    const handles = getLayerOverlayHandles(containerBounds);

    for (const [id, handle] of Object.entries(handles)) {
      if (Math.abs(containerX - handle.x) <= handleSize && Math.abs(containerY - handle.y) <= handleSize) {
        return id;
      }
    }

    return null;
  }, [canvasSize, calculateLayerBounds, toContainerBounds]);

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
