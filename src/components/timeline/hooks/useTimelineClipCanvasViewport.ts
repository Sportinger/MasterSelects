import { useLayoutEffect, useState, type RefObject } from 'react';

// Sliding-window sizing for the timeline clip canvas. The canvas paints a window
// that follows the scroll position, so its backing store only ever needs to span
// the visible viewport plus overscan. Browsers (notably Chrome on Linux/Mesa)
// silently render a canvas blank once its backing store exceeds the GPU's max
// compositable size, so the backing width is capped well below the typical 16384
// hardware limit. Sizing the canvas to the full timeline content width instead
// blanks the whole lane at high zoom; this keeps it bounded at every zoom level.
// See docs/Features/Linux-Mesa-GPU.md (rules 1-2) and issue #259.
const SAFE_MAX_CANVAS_BACKING_PX = 8192;
// Used before the live viewport width has been measured, to avoid a one-frame
// oversized backing store on first paint.
const SAFE_VIEWPORT_FALLBACK_PX = 4096;

interface TimelineClipCanvasViewportInput {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  scrollX: number;
  // The clip row width, which equals the full timeline content width on
  // wide/zoomed timelines — only used as an upper bound on the measured viewport.
  viewportWidth: number;
  overscanPx: number;
  maxCanvasWidthPx: number;
}

interface TimelineClipCanvasViewport {
  cssWidth: number;
  canvasOffsetX: number;
  scrollBucket: number;
  visibleViewportWidth: number;
}

export function useTimelineClipCanvasViewport({
  canvasRef,
  scrollX,
  viewportWidth,
  overscanPx,
  maxCanvasWidthPx,
}: TimelineClipCanvasViewportInput): TimelineClipCanvasViewport {
  const [measuredViewportWidth, setMeasuredViewportWidth] = useState(0);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const viewport = (
      canvas?.closest('.timeline-section-tracks') ??
      canvas?.closest('.timeline-section-viewport')
    );
    if (!viewport) return;
    const update = () => {
      setMeasuredViewportWidth((previous) => (
        previous === viewport.clientWidth ? previous : viewport.clientWidth
      ));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [canvasRef]);

  const scrollBucket = Math.round(scrollX / 200);
  const canvasOffsetX = Math.max(0, scrollBucket * 200 - overscanPx);
  const devicePixelRatio = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const windowViewportWidth = Math.min(
    viewportWidth,
    measuredViewportWidth > 0 ? measuredViewportWidth : SAFE_VIEWPORT_FALLBACK_PX,
  );
  const cssWidth = Math.max(
    1,
    Math.min(
      maxCanvasWidthPx,
      Math.floor(SAFE_MAX_CANVAS_BACKING_PX / devicePixelRatio),
      Math.ceil(windowViewportWidth + overscanPx * 2),
    ),
  );
  return { cssWidth, canvasOffsetX, scrollBucket, visibleViewportWidth: windowViewportWidth };
}
