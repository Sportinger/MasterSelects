import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject, SetStateAction } from 'react';
import { FIT_MARGIN } from './canvasGeometry';
import type { NodeBounds, Viewport } from './canvasGeometry';
import { fittedNodeViewport } from './useNodeGraphViewport';

/**
 * Fit for a phone screen: the whole graph, centred in the axis it does not fill. Every node must stay
 * on screen: cards outside the view are not mounted, so a partial view would hide the program output.
 */
export function phoneFittedNodeViewport(bounds: NodeBounds, width: number, height: number): Viewport {
  const fit = fittedNodeViewport(bounds, width, height);
  const graphWidth = (bounds.right - bounds.left) * fit.zoom;
  const graphHeight = (bounds.bottom - bounds.top) * fit.zoom;
  return {
    zoom: fit.zoom,
    panX: Math.max(FIT_MARGIN, (width - graphWidth) / 2) - bounds.left * fit.zoom,
    panY: Math.max(FIT_MARGIN, (height - graphHeight) / 2) - bounds.top * fit.zoom,
  };
}

function sameViewport(a: Viewport, b: Viewport): boolean {
  return Math.abs(a.zoom - b.zoom) < 1e-6 && Math.abs(a.panX - b.panX) < 0.5 && Math.abs(a.panY - b.panY) < 0.5;
}

/**
 * Phone only: zoom the graph to fit when it opens and again whenever the canvas changes size
 * (rotation, a side panel opening or closing), as long as the person has not moved the view since
 * the last automatic fit. A pan, pinch, Fit or a lane opening hands the camera to the person.
 */
export function useNodePhoneAutoFit({ enabled, canvasRef, graphId, bounds, viewport, setViewport, skipInitial }: {
  enabled: boolean;
  canvasRef: RefObject<HTMLDivElement | null>;
  graphId: string;
  bounds: NodeBounds;
  viewport: Viewport;
  setViewport: (next: SetStateAction<Viewport>) => void;
  /** The canvas opened on a requested group: keep that framing instead of the overview. */
  skipInitial?: boolean;
}): void {
  const boundsRef = useRef(bounds);
  const viewportRef = useRef(viewport);
  const setViewportRef = useRef(setViewport);
  const lastAutoRef = useRef<Viewport | null>(null);
  useLayoutEffect(() => {
    boundsRef.current = bounds;
    viewportRef.current = viewport;
    setViewportRef.current = setViewport;
  });

  const fitNow = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.clientWidth < 1 || canvas.clientHeight < 1) return;
    const next = phoneFittedNodeViewport(boundsRef.current, canvas.clientWidth, canvas.clientHeight);
    lastAutoRef.current = next;
    setViewportRef.current(next);
  }, [canvasRef]);

  useEffect(() => {
    lastAutoRef.current = null;
    if (!enabled || skipInitial) return;
    // Runs after the canvas' own initial fit (declared earlier) and replaces it with the phone fit.
    fitNow();
  }, [enabled, graphId, skipInitial, fitNow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas || typeof ResizeObserver === 'undefined') return undefined;
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    const observer = new ResizeObserver(() => {
      const nextWidth = canvas.clientWidth, nextHeight = canvas.clientHeight;
      if (nextWidth === width && nextHeight === height) return;
      const wasEmpty = width < 1 || height < 1;
      width = nextWidth; height = nextHeight;
      const last = lastAutoRef.current;
      const untouched = wasEmpty || (last !== null && sameViewport(last, viewportRef.current));
      if (untouched) fitNow();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [enabled, canvasRef, fitNow]);
}

/** True when the canvas sits inside the phone skin (/m). The desktop layout never sees the phone paths. */
export function useNodeCanvasInPhoneSkin(canvasRef: RefObject<HTMLDivElement | null>): boolean {
  const [inside, setInside] = useState(false);
  useLayoutEffect(() => { setInside(Boolean(canvasRef.current?.closest('.mobile-skin'))); }, [canvasRef]);
  return inside;
}
