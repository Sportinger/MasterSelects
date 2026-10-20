import { useCallback, type Dispatch, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction } from 'react';
import { placeTextLayerAt } from '../../services/canvasTools';
import { useCanvasToolStore } from '../../stores/canvasToolStore';
import { MAX_VIEW_ZOOM, MIN_VIEW_ZOOM, PREVIEW_ZOOM_STEP } from './usePreviewCanvasZoom';

interface PreviewPoint {
  x: number;
  y: number;
}

interface UsePreviewCanvasToolPointerOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  containerSize: { width: number; height: number };
  canvasInContainer: { x: number; y: number; width: number; height: number };
  compositionSize: { width: number; height: number };
  viewZoom: number;
  viewPan: PreviewPoint;
  setViewZoom: Dispatch<SetStateAction<number>>;
  setViewPan: Dispatch<SetStateAction<PreviewPoint>>;
}

/** Zoom keeping `point` (container pixels) fixed on screen. */
export function zoomViewAroundPoint(
  point: PreviewPoint,
  containerSize: { width: number; height: number },
  viewZoom: number,
  viewPan: PreviewPoint,
  nextZoom: number,
): { zoom: number; pan: PreviewPoint } {
  const zoom = Math.max(MIN_VIEW_ZOOM, Math.min(MAX_VIEW_ZOOM, nextZoom));
  const centerX = containerSize.width / 2;
  const centerY = containerSize.height / 2;
  const worldX = (point.x - centerX - viewPan.x) / viewZoom;
  const worldY = (point.y - centerY - viewPan.y) / viewZoom;
  return { zoom, pan: { x: point.x - worldX * zoom - centerX, y: point.y - worldY * zoom - centerY } };
}

/**
 * Left-click actions of the canvas tools that are not drags: the Zoom tool
 * zooms in (Alt zooms out) around the click, the Text tool places a text
 * layer. `handleCanvasToolClick` returns true when it consumed the click.
 */
export function usePreviewCanvasToolPointer({
  containerRef,
  containerSize,
  canvasInContainer,
  compositionSize,
  viewZoom,
  viewPan,
  setViewZoom,
  setViewPan,
}: UsePreviewCanvasToolPointerOptions) {
  const activeCanvasTool = useCanvasToolStore((state) => state.activeCanvasTool);
  const handleCanvasToolClick = useCallback((event: ReactMouseEvent): boolean => {
    const tool = activeCanvasTool;
    if (event.button !== 0 || (tool !== 'zoom' && tool !== 'text')) return false;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (tool === 'zoom') {
      const factor = event.altKey ? 1 / PREVIEW_ZOOM_STEP : PREVIEW_ZOOM_STEP;
      const next = zoomViewAroundPoint(point, containerSize, viewZoom, viewPan, viewZoom * factor);
      setViewZoom(next.zoom);
      setViewPan(next.pan);
      return true;
    }
    if (!(canvasInContainer.width > 0 && canvasInContainer.height > 0)) return false;
    void placeTextLayerAt({
      x: ((point.x - canvasInContainer.x) / canvasInContainer.width) * compositionSize.width,
      y: ((point.y - canvasInContainer.y) / canvasInContainer.height) * compositionSize.height,
    }, compositionSize);
    return true;
  }, [activeCanvasTool, canvasInContainer, compositionSize, containerRef, containerSize, setViewPan, setViewZoom, viewPan, viewZoom]);
  return { activeCanvasTool, handleCanvasToolClick };
}
