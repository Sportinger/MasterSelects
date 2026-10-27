import { useEffect, useRef, type RefObject } from 'react';
import { clamp, MAX_ZOOM, MIN_ZOOM, type NodeGraphPoint, type Viewport } from './canvasGeometry';

/**
 * Two-finger pinch zoom (and two-finger pan) on the node canvas for touch input, the counterpart of the
 * mouse wheel. Only `pointerType === 'touch'` pointers take part: mouse and pen keep every existing path.
 *
 * Native capture listeners on the canvas run before React's delegated bubble handlers, so while two
 * fingers pinch, their pointer events never reach the canvas' pan/edge/connection handlers. A finger that
 * took part in a pinch stays swallowed until it lifts, so lifting one finger never turns into a pan jump
 * or a cable click. A second finger that lands while a node drag or cable drag runs is ignored entirely.
 */
export interface NodeTouchPinchOptions {
  canvasRef: RefObject<HTMLDivElement | null>;
  /** The viewport currently on screen (may run ahead of React state during a gesture). */
  getViewport: () => Viewport;
  /** Shows a viewport immediately (no React render). */
  showViewport: (viewport: Viewport) => void;
  /** Commits a viewport to React state. */
  setViewport: (viewport: Viewport) => void;
  /** False while another gesture (node drag, cable drag) owns the first finger. */
  canStart: () => boolean;
  /** A pinch begins: the one-finger pan of the first finger must end without moving the view. */
  onStart: () => void;
}

interface Pinch {
  ids: [number, number];
  startDistance: number;
  startZoom: number;
  /** Graph point under the fingers' midpoint when the pinch began. */
  anchor: NodeGraphPoint;
}

/** Pure pinch math, exported for unit tests: zoom by the finger-distance ratio, keep `anchor` under the midpoint. */
export function pinchViewport(anchor: NodeGraphPoint, startZoom: number, startDistance: number, distance: number, midpoint: NodeGraphPoint): Viewport {
  const zoom = clamp(startZoom * (distance / Math.max(1, startDistance)), MIN_ZOOM, MAX_ZOOM);
  return { zoom, panX: midpoint.x - anchor.x * zoom, panY: midpoint.y - anchor.y * zoom };
}

export function useNodeTouchPinch(options: NodeTouchPinchOptions) {
  const latest = useRef(options);
  latest.current = options;
  const pinchingRef = useRef(false);

  useEffect(() => {
    const canvas = options.canvasRef.current;
    if (!canvas) return undefined;
    const touches = new Map<number, NodeGraphPoint>();
    const swallowed = new Set<number>();
    let pinch: Pinch | null = null;
    let frame: number | null = null;
    let pending: Viewport | null = null;

    const local = (point: NodeGraphPoint) => {
      const rect = canvas.getBoundingClientRect();
      return { x: point.x - rect.left, y: point.y - rect.top };
    };
    const geometry = (ids: [number, number]) => {
      const a = touches.get(ids[0])!, b = touches.get(ids[1])!;
      return { distance: Math.hypot(a.x - b.x, a.y - b.y), midpoint: local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) };
    };
    const flush = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (pending) latest.current.setViewport(pending);
      pending = null;
    };

    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch) { swallowed.add(event.pointerId); event.stopPropagation(); return; }
      if (touches.size !== 2) return;
      const ids = [...touches.keys()] as [number, number];
      // Both fingers are swallowed from here on, whether they pinch or the second one is ignored.
      swallowed.add(event.pointerId);
      event.stopPropagation();
      if (!latest.current.canStart()) return;
      for (const id of ids) swallowed.add(id);
      latest.current.onStart();
      const { distance, midpoint } = geometry(ids);
      const view = latest.current.getViewport();
      pinch = {
        ids, startDistance: distance, startZoom: view.zoom,
        anchor: { x: (midpoint.x - view.panX) / view.zoom, y: (midpoint.y - view.panY) / view.zoom },
      };
      pinchingRef.current = true;
      try { canvas.setPointerCapture(event.pointerId); } catch { /* the pointer may already be gone */ }
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !touches.has(event.pointerId)) return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!swallowed.has(event.pointerId)) return;
      event.stopPropagation();
      if (!pinch || !pinch.ids.includes(event.pointerId)) return;
      const { distance, midpoint } = geometry(pinch.ids);
      const next = pinchViewport(pinch.anchor, pinch.startZoom, pinch.startDistance, distance, midpoint);
      latest.current.showViewport(next);
      pending = next;
      if (frame === null) frame = requestAnimationFrame(() => {
        frame = null;
        if (pending) latest.current.setViewport(pending);
        pending = null;
      });
    };

    const up = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      touches.delete(event.pointerId);
      if (pinch?.ids.includes(event.pointerId)) {
        flush();
        pinch = null;
        pinchingRef.current = false;
      }
      if (swallowed.delete(event.pointerId)) event.stopPropagation();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };

    canvas.addEventListener('pointerdown', down, true);
    canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerup', up, true);
    canvas.addEventListener('pointercancel', up, true);
    return () => {
      canvas.removeEventListener('pointerdown', down, true);
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerup', up, true);
      canvas.removeEventListener('pointercancel', up, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [options.canvasRef]);

  return pinchingRef;
}
