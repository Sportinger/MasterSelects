import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject, SetStateAction } from 'react';
import { clamp, DEFAULT_VIEWPORT, FIT_MARGIN, MAX_ZOOM, MIN_ZOOM } from './canvasGeometry';
import type { NodeBounds, NodeGraphPoint, Viewport } from './canvasGeometry';

const WHEEL_ZOOM_SPEED = 0.0012;
const ZOOM_SMOOTHING_MS = 65;
const ZOOM_SETTLE_EPSILON = 0.0001;

interface ZoomTarget {
  zoom: number;
  pointer: NodeGraphPoint;
  graphPoint: NodeGraphPoint;
}

/** Owns the displayed viewport and the short, cursor-anchored wheel animation. */
export function useNodeGraphViewport(canvasRef: RefObject<HTMLDivElement | null>, onVisualViewport?: (viewport: Viewport) => void) {
  const [viewport, renderViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const currentRef = useRef(viewport);
  const targetRef = useRef<ZoomTarget | null>(null);
  const frameRef = useRef<number | null>(null);
  // Read during render, never rendered: true while a wheel animation owns the view.
  const zoomingRef = useRef(false);

  const cancelZoom = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    targetRef.current = null;
    zoomingRef.current = false;
  }, []);

  const commitViewport = useCallback((next: Viewport) => {
    currentRef.current = next;
    onVisualViewport?.(next);
    renderViewport(next);
  }, [onVisualViewport]);

  // Fit, Reset, graph changes and panning take ownership immediately. A queued
  // wheel frame must never restore the view from before one of these actions.
  const setViewport = useCallback((next: SetStateAction<Viewport>) => {
    cancelZoom();
    commitViewport(typeof next === 'function' ? next(currentRef.current) : next);
  }, [cancelZoom, commitViewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let lastFrameTime = 0;

    const applyZoom = (target: ZoomTarget, zoom: number) => {
      commitViewport({
        zoom,
        panX: target.pointer.x - target.graphPoint.x * zoom,
        panY: target.pointer.y - target.graphPoint.y * zoom,
      });
    };

    const animate = (time: number) => {
      frameRef.current = null;
      const target = targetRef.current;
      if (!target) return;
      const remaining = Math.log(target.zoom / currentRef.current.zoom);
      const elapsed = Math.max(0, time - lastFrameTime);
      lastFrameTime = time;
      const settled = reducedMotion.matches || Math.abs(remaining) < ZOOM_SETTLE_EPSILON;
      // Time-based damping behaves identically on 60 Hz and high-refresh screens.
      const zoom = settled ? target.zoom : currentRef.current.zoom * Math.exp(
        remaining * (1 - Math.exp(-elapsed / ZOOM_SMOOTHING_MS)),
      );
      // Clear before the final commit so that render refreshes hit targets.
      if (settled) { targetRef.current = null; zoomingRef.current = false; }
      applyZoom(target, zoom);
      if (!settled) frameRef.current = requestAnimationFrame(animate);
    };

    const wheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || !Number.isFinite(event.deltaY)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, canvas.clientHeight) : 1;
      const current = currentRef.current;
      // Accumulate input even when several events arrive before the next frame.
      // Clamp the target itself so scrolling back from a limit responds at once.
      const zoom = Math.exp(clamp(
        Math.log(targetRef.current?.zoom ?? current.zoom) - event.deltaY * unit * WHEEL_ZOOM_SPEED,
        Math.log(MIN_ZOOM), Math.log(MAX_ZOOM),
      ));
      const rect = canvas.getBoundingClientRect();
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const target = {
        zoom,
        pointer,
        graphPoint: {
          x: (pointer.x - current.panX) / current.zoom,
          y: (pointer.y - current.panY) / current.zoom,
        },
      };
      if (reducedMotion.matches) {
        cancelZoom();
        applyZoom(target, zoom);
        return;
      }
      targetRef.current = target;
      if (frameRef.current === null) {
        zoomingRef.current = true;
        lastFrameTime = performance.now();
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    // React delegates wheel events passively; a native listener also prevents
    // Ctrl+wheel / trackpad pinch from zooming the browser page underneath us.
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('pointerdown', cancelZoom, true);
    return () => {
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('pointerdown', cancelZoom, true);
      cancelZoom();
    };
  }, [canvasRef, cancelZoom, commitViewport]);

  return { viewport, setViewport, zoomingRef };
}

export function fittedNodeViewport(bounds: NodeBounds, width: number, height: number): Viewport {
  const zoom = clamp(Math.min(Math.max(1, width - 2 * FIT_MARGIN) / Math.max(1, bounds.right - bounds.left),
    Math.max(1, height - 2 * FIT_MARGIN) / Math.max(1, bounds.bottom - bounds.top)), MIN_ZOOM, MAX_ZOOM);
  return { zoom, panX: FIT_MARGIN - bounds.left * zoom, panY: FIT_MARGIN - bounds.top * zoom };
}
