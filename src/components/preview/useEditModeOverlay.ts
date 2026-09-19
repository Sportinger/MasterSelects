// Edit mode overlay helpers: bounding box calculation, hit testing, cursor mapping

import { useCallback } from 'react';
import type { Layer } from '../../types';
import type { ClipTransform } from '../../types/timelineCore';
import {
  calculateLayerOverlayBounds,
  getLayerOverlayHandles,
  pointInLayerOverlayBounds,
  scaleLayerOverlayBounds,
  type LayerOverlayBounds,
} from './editModeOverlayMath';
import { withClipProjectionTransform } from './maskOverlay/maskOverlayProjectionPlans';

interface UseEditModeOverlayParams {
  effectiveResolution: { width: number; height: number };
  canvasSize: { width: number; height: number };
  canvasInContainer: { x: number; y: number; width: number; height: number };
  viewZoom: number;
  layers: Layer[];
  getLayerProjectionTransform?: (layer: Layer) => ClipTransform | null | undefined;
}

export function useEditModeOverlay({
  effectiveResolution,
  canvasSize,
  canvasInContainer,
  viewZoom,
  layers,
  getLayerProjectionTransform,
}: UseEditModeOverlayParams) {
  const getProjectionLayer = useCallback((layer: Layer) => (
    withClipProjectionTransform(layer, getLayerProjectionTransform?.(layer)) ?? layer
  ), [getLayerProjectionTransform]);

  // Calculate layer bounding box in canvas coordinates (matches shader transform)
  const calculateLayerBounds = useCallback((layer: Layer, canvasW: number, canvasH: number, forcePos?: { x: number; y: number }) => {
    const projectionLayer = getProjectionLayer(layer);
    let sourceWidth = effectiveResolution.width;
    let sourceHeight = effectiveResolution.height;

    if (projectionLayer.source?.videoElement) {
      sourceWidth = projectionLayer.source.videoElement.videoWidth || sourceWidth;
      sourceHeight = projectionLayer.source.videoElement.videoHeight || sourceHeight;
    } else if (projectionLayer.source?.imageElement) {
      sourceWidth = projectionLayer.source.imageElement.naturalWidth || sourceWidth;
      sourceHeight = projectionLayer.source.imageElement.naturalHeight || sourceHeight;
    } else if (projectionLayer.source?.textCanvas) {
      sourceWidth = projectionLayer.source.textCanvas.width || sourceWidth;
      sourceHeight = projectionLayer.source.textCanvas.height || sourceHeight;
    } else if (projectionLayer.source?.nestedComposition) {
      sourceWidth = projectionLayer.source.nestedComposition.width || sourceWidth;
      sourceHeight = projectionLayer.source.nestedComposition.height || sourceHeight;
    } else if (projectionLayer.source?.intrinsicWidth && projectionLayer.source?.intrinsicHeight) {
      sourceWidth = projectionLayer.source.intrinsicWidth;
      sourceHeight = projectionLayer.source.intrinsicHeight;
    }

    const layerPos = forcePos || projectionLayer.position;
    const rotationValue = typeof projectionLayer.rotation === 'number'
      ? projectionLayer.rotation
      : projectionLayer.rotation.z;

    return calculateLayerOverlayBounds({
      sourceWidth,
      sourceHeight,
      outputWidth: effectiveResolution.width,
      outputHeight: effectiveResolution.height,
      canvasWidth: canvasW,
      canvasHeight: canvasH,
      position: layerPos,
      scale: projectionLayer.scale,
      rotation: rotationValue,
    });
  }, [effectiveResolution, getProjectionLayer]);

  const toContainerBounds = useCallback((bounds: LayerOverlayBounds): LayerOverlayBounds => (
    scaleLayerOverlayBounds(bounds, viewZoom, { x: canvasInContainer.x, y: canvasInContainer.y })
  ), [canvasInContainer, viewZoom]);

  // Find layers at the pointer in compositor order (topmost first).
  const findLayersAtPosition = useCallback((containerX: number, containerY: number): Layer[] => {
    // layers[0] is composited on top (see LayerBuilderService), so iterate in
    // array order and return the first hit = the topmost layer under the cursor.
    // (Previously this reversed the list and picked the bottom layer.)
    const visibleLayers = layers.filter(l => l?.visible && l?.source);

    return visibleLayers.filter((layer) => {
      const bounds = calculateLayerBounds(layer, canvasSize.width, canvasSize.height);
      const containerBounds = toContainerBounds(bounds);
      return pointInLayerOverlayBounds({ x: containerX, y: containerY }, containerBounds);
    });
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

  return { calculateLayerBounds, findLayersAtPosition, findHandleAtPosition, getCursorForHandle };
}
