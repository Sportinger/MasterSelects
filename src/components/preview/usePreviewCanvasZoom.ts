import { useMemo, type Dispatch, type SetStateAction } from 'react';

const ZOOM_STEP = 1.25;
const MAX_VIEW_ZOOM = 150;
const MIN_VIEW_ZOOM = 0.1;

export interface PreviewCanvasZoom {
  /** Displayed size relative to the composition's pixels, in percent. */
  percent: number;
  fit: () => void;
  actualPixels: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface UsePreviewCanvasZoomOptions {
  enabled: boolean;
  /** Fitted (zoom 1) canvas width in CSS pixels. */
  fittedWidth: number;
  compositionWidth: number;
  viewZoom: number;
  setViewZoom: Dispatch<SetStateAction<number>>;
  setViewPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
}

/** Image-style zoom commands for the preview canvas; zooms around the view center. */
export function usePreviewCanvasZoom({
  enabled,
  fittedWidth,
  compositionWidth,
  viewZoom,
  setViewZoom,
  setViewPan,
}: UsePreviewCanvasZoomOptions): PreviewCanvasZoom | null {
  return useMemo(() => {
    if (!enabled || !(fittedWidth > 0) || !(compositionWidth > 0)) return null;
    const zoomTo = (nextZoom: number) => {
      const clamped = Math.max(MIN_VIEW_ZOOM, Math.min(MAX_VIEW_ZOOM, nextZoom));
      const ratio = clamped / viewZoom;
      setViewZoom(clamped);
      setViewPan((pan) => ({ x: pan.x * ratio, y: pan.y * ratio }));
    };
    return {
      percent: Math.round((fittedWidth * viewZoom / compositionWidth) * 100),
      fit: () => {
        setViewZoom(1);
        setViewPan({ x: 0, y: 0 });
      },
      actualPixels: () => zoomTo(compositionWidth / fittedWidth),
      zoomIn: () => zoomTo(viewZoom * ZOOM_STEP),
      zoomOut: () => zoomTo(viewZoom / ZOOM_STEP),
    };
  }, [compositionWidth, enabled, fittedWidth, setViewPan, setViewZoom, viewZoom]);
}
