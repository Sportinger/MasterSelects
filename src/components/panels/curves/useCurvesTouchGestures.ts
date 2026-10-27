// Touch input for the Curves dock panel (phone landscape editor, tablets). Mouse and pen keep the
// desktop path untouched: only pointerType 'touch' is handled here.
//
// - One finger on (or within a finger's width of) a keyframe or Bezier handle drives the graph's
//   own mouse-drag code: the same select, transaction, preview and single undo step as a mouse.
// - One finger on empty graph pans the time axis.
// - Two fingers pinch: side by side they zoom time around their midpoint, stacked they scale the
//   curve height (the desktop's Shift+wheel notches), and moving them pans.

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { Logger } from '../../../services/logger';
import {
  measureCurvePinch,
  pickCurveTouchTarget,
  verticalZoomNotches,
  type CurveTouchCandidate,
  type CurveTouchPoint,
} from './curvesTouchGesture';

const log = Logger.create('CurvesTouch');

const PANE_SELECTOR = '.timeline-global-curve-editor-pane';
const TARGET_SELECTOR = 'circle[data-keyframe-id]';
const SIDEBAR_SELECTOR = '.timeline-global-curve-sidebar';
const MOVE_TOLERANCE_PX = 4;

export interface CurvesTouchView {
  /** Graph-local pan: content moves by `panX` pixels; `factor` zooms around `anchorX`. */
  scaleTimeAt: (start: { scrollX: number; zoom: number }, factor: number, anchorX: number, panX: number) => void;
  getTimeView: () => { scrollX: number; zoom: number };
}

type Gesture =
  | { kind: 'edit'; pointerId: number; target: Element; offsetX: number; offsetY: number; moved: boolean; startX: number; startY: number }
  | { kind: 'pan'; pointerId: number; startX: number; startView: { scrollX: number; zoom: number } }
  | {
      kind: 'pinch';
      ids: [number, number];
      start: [CurveTouchPoint, CurveTouchPoint];
      startView: { scrollX: number; zoom: number };
      notches: number;
    }
  | { kind: 'ended' };

function dispatchMouse(type: 'mousedown' | 'mousemove' | 'mouseup', target: Element, x: number, y: number): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    clientX: x,
    clientY: y,
  });
  (target.isConnected ? target : document).dispatchEvent(event);
}

function collectCandidates(pane: Element): CurveTouchCandidate<Element>[] {
  return Array.from(pane.querySelectorAll(TARGET_SELECTOR)).map((element) => {
    const box = element.getBoundingClientRect();
    return {
      item: element,
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      isHandle: element.hasAttribute('data-handle'),
    };
  });
}

export function useCurvesTouchGestures(view: CurvesTouchView) {
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointersRef = useRef(new Map<number, CurveTouchPoint>());
  const gestureRef = useRef<Gesture | null>(null);

  const sendVerticalNotches = useCallback((host: Element, count: number) => {
    const sidebar = host.querySelector(SIDEBAR_SELECTOR);
    if (!sidebar) {
      log.warn('Curve height pinch ignored: the graph parameter list is not rendered');
      return;
    }
    for (let index = 0; index < Math.abs(count); index++) {
      sidebar.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, shiftKey: true, deltaY: count > 0 ? -100 : 100,
      }));
    }
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch' || !(event.target instanceof Element)) return;
    const pane = event.target.closest(PANE_SELECTOR);
    if (!pane || !event.currentTarget.contains(pane)) return;
    const pointers = pointersRef.current;
    const point = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, point);
    const gesture = gestureRef.current;
    event.preventDefault();
    event.stopPropagation();
    // No explicit pointer capture: touch pointers are implicitly captured by the touched element.

    if (!gesture || gesture.kind === 'ended') {
      if (pointers.size > 1) return;
      const direct = event.target.closest(TARGET_SELECTOR);
      const picked = direct
        ? { item: direct, ...(() => { const box = direct.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })() }
        : pickCurveTouchTarget(collectCandidates(pane), point);
      if (picked) {
        gestureRef.current = {
          kind: 'edit', pointerId: event.pointerId, target: picked.item,
          offsetX: picked.x - point.x, offsetY: picked.y - point.y, moved: false, startX: point.x, startY: point.y,
        };
        dispatchMouse('mousedown', picked.item, picked.x, picked.y);
        return;
      }
      gestureRef.current = { kind: 'pan', pointerId: event.pointerId, startX: point.x, startView: viewRef.current.getTimeView() };
      return;
    }
    if (gesture.kind === 'pan' && pointers.size === 2) {
      const ids = Array.from(pointers.keys()) as [number, number];
      gestureRef.current = {
        kind: 'pinch', ids,
        start: [pointers.get(ids[0])!, pointers.get(ids[1])!],
        startView: viewRef.current.getTimeView(),
        notches: 0,
      };
    }
    // A second finger during a keyframe drag is ignored: the drag keeps its one finger.
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') return;
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, point);
    const gesture = gestureRef.current;
    if (!gesture) return;
    event.preventDefault();
    if (gesture.kind === 'edit' && gesture.pointerId === event.pointerId) {
      gesture.moved = gesture.moved || Math.hypot(point.x - gesture.startX, point.y - gesture.startY) > MOVE_TOLERANCE_PX;
      dispatchMouse('mousemove', gesture.target, point.x + gesture.offsetX, point.y + gesture.offsetY);
      return;
    }
    if (gesture.kind === 'pan' && gesture.pointerId === event.pointerId) {
      viewRef.current.scaleTimeAt(gesture.startView, 1, 0, point.x - gesture.startX);
      return;
    }
    if (gesture.kind === 'pinch') {
      const a = pointers.get(gesture.ids[0]);
      const b = pointers.get(gesture.ids[1]);
      if (!a || !b) return;
      const frame = measureCurvePinch(gesture.start, [a, b]);
      const pane = event.currentTarget.querySelector(PANE_SELECTOR);
      const paneLeft = pane?.getBoundingClientRect().left ?? 0;
      viewRef.current.scaleTimeAt(gesture.startView, frame.factorX, frame.mid.x - paneLeft, frame.panX);
      const notches = verticalZoomNotches(frame.factorY);
      if (notches !== gesture.notches) {
        sendVerticalNotches(event.currentTarget, notches - gesture.notches);
        gesture.notches = notches;
      }
    }
  }, [sendVerticalNotches]);

  const finish = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') return;
    const pointers = pointersRef.current;
    if (!pointers.delete(event.pointerId)) return;
    const gesture = gestureRef.current;
    if (gesture?.kind === 'edit' && gesture.pointerId === event.pointerId) {
      dispatchMouse('mouseup', gesture.target, event.clientX + gesture.offsetX, event.clientY + gesture.offsetY);
      gestureRef.current = pointers.size > 0 ? { kind: 'ended' } : null;
      return;
    }
    if (pointers.size === 0) {
      gestureRef.current = null;
      return;
    }
    // One finger of a pinch lifted: the rest of the gesture does nothing until every finger is up.
    if (gesture && gesture.kind !== 'edit') gestureRef.current = { kind: 'ended' };
  }, []);

  return {
    onPointerDownCapture: onPointerDown,
    onPointerMoveCapture: onPointerMove,
    onPointerUpCapture: finish,
    onPointerCancelCapture: finish,
  };
}
