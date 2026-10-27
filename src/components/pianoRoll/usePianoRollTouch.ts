// Touch input for the piano roll (phone editor, M4). Mouse and pen keep their own handlers in
// PianoRoll.tsx unchanged; this hook only reacts to `pointerType === 'touch'`.
//
// One finger edits like the mouse does with the active tool (draw, move, resize from the end of a
// note, erase, marquee). Two fingers navigate: the pair's midpoint pans the view, the change of the
// horizontal finger distance zooms time and the change of the vertical distance zooms pitch, both
// anchored on the content point under the fingers. A second finger arriving mid-edit cancels that
// edit (the caller restores the touched notes), so a pinch never leaves a half-drawn note behind.

import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/** Below this start distance on an axis the fingers count as side by side: that axis does not zoom. */
export const PINCH_AXIS_MIN_PX = 30;
/**
 * Distance changes within this share of the start distance do not zoom: the two fingers' moves
 * arrive one after the other, so a pure two-finger pan wobbles the distance by a few pixels.
 */
export const PINCH_DEADBAND = 0.08;

export interface PianoRollTouchView {
  pxPerSec: number;
  rowH: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface PinchStart {
  /** Midpoint relative to the scroll viewport's top-left corner. */
  midX: number;
  midY: number;
  dx: number;
  dy: number;
  pxPerSec: number;
  rowH: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface PinchLimits {
  minPxPerSec: number;
  maxPxPerSec: number;
  minRowH: number;
  maxRowH: number;
  /** Width of the sticky keyboard column at the start of the scroll content. */
  keyboardWidth: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function axisFactor(startDistance: number, distance: number): number {
  if (startDistance < PINCH_AXIS_MIN_PX) return 1;
  const ratio = Math.max(0.05, distance) / startDistance;
  return Math.abs(ratio - 1) < PINCH_DEADBAND ? 1 : ratio;
}

/**
 * The view for the current finger pair: zoom by the per-axis distance ratio and keep the content
 * point that was under the starting midpoint under the current midpoint (that is the pan).
 * Pure, so the gesture math is unit-tested without a DOM.
 */
export function computePinchView(
  start: PinchStart,
  current: { midX: number; midY: number; dx: number; dy: number },
  limits: PinchLimits,
): PianoRollTouchView {
  const pxPerSec = clamp(start.pxPerSec * axisFactor(start.dx, current.dx), limits.minPxPerSec, limits.maxPxPerSec);
  const rowH = clamp(start.rowH * axisFactor(start.dy, current.dy), limits.minRowH, limits.maxRowH);
  // Seconds (from the grid's left edge) and pitch rows under the starting midpoint.
  const time = (start.midX + start.scrollLeft - limits.keyboardWidth) / start.pxPerSec;
  const rows = (start.midY + start.scrollTop) / start.rowH;
  return {
    pxPerSec,
    rowH,
    scrollLeft: Math.max(0, limits.keyboardWidth + time * pxPerSec - current.midX),
    scrollTop: Math.max(0, rows * rowH - current.midY),
  };
}

interface UsePianoRollTouchOptions {
  scrollRef: RefObject<HTMLDivElement | null>;
  readView: () => { pxPerSec: number; rowH: number };
  limits: () => PinchLimits;
  /** One finger landed: start the active tool's edit exactly like a mouse press would. */
  beginEdit: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** A second finger arrived during an edit: drop it and restore what it changed. */
  cancelEdit: () => void;
  applyView: (view: PianoRollTouchView) => void;
}

export function usePianoRollTouch({ scrollRef, readView, limits, beginEdit, cancelEdit, applyView }: UsePianoRollTouchOptions) {
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<PinchStart | null>(null);
  // After a pinch, the remaining finger does nothing until every finger is up.
  const navigatingRef = useRef(false);

  const pairGeometry = useCallback(() => {
    const el = scrollRef.current;
    const points = [...pointersRef.current.values()];
    if (!el || points.length < 2) return null;
    const rect = el.getBoundingClientRect();
    const [a, b] = points;
    return {
      midX: (a.x + b.x) / 2 - rect.left,
      midY: (a.y + b.y) / 2 - rect.top,
      dx: Math.abs(a.x - b.x),
      dy: Math.abs(a.y - b.y),
    };
  }, [scrollRef]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    // Cancelling the press keeps the browser from also sending compatibility mouse events,
    // which would run the mouse handlers a second time.
    event.preventDefault();
    // The first finger of a new touch is primary. Anything still tracked then is stale (its lift
    // went to an element React re-rendered away), so a new gesture always starts clean.
    if (event.isPrimary) {
      pointersRef.current.clear();
      pinchRef.current = null;
      navigatingRef.current = false;
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const count = pointersRef.current.size;
    if (count === 1 && !navigatingRef.current) {
      beginEdit(event);
      return;
    }
    if (count === 2) {
      cancelEdit();
      navigatingRef.current = true;
      const geometry = pairGeometry();
      const el = scrollRef.current;
      if (!geometry || !el) return;
      const view = readView();
      pinchRef.current = { ...geometry, ...view, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
    }
  }, [beginEdit, cancelEdit, pairGeometry, readView, scrollRef]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || !pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = pinchRef.current;
    if (!start) return;
    const geometry = pairGeometry();
    if (!geometry) return;
    applyView(computePinchView(start, geometry, limits()));
  }, [applyView, limits, pairGeometry]);

  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) navigatingRef.current = false;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd };
}
