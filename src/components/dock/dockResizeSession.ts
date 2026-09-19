import { endBatch, startBatch } from '../../stores/historyStore';
import { DOCK_RESIZE_AXIS_ATTRIBUTE as RESIZE_AXIS_ATTRIBUTE } from './dockResizeDomState';

export type DockResizeAxis = 'x' | 'y';

export interface DockResizePointer {
  clientX: number;
  clientY: number;
}

interface DockResizeRegistrationBase {
  id: string;
  axis: DockResizeAxis;
  element: HTMLElement;
}

interface DockResizeHandleRegistration extends DockResizeRegistrationBase {
  proxyTargetId?: never;
  onStart: (pointer: DockResizePointer) => void;
  onMove: (pointer: DockResizePointer) => void;
  onEnd: (pointer: DockResizePointer) => void;
}

interface DockResizeProxyRegistration extends DockResizeRegistrationBase {
  proxyTargetId: string;
}

type DockResizeRegistration = DockResizeHandleRegistration | DockResizeProxyRegistration;

interface ActiveDockResizeSession {
  pointerId: number;
  handles: DockResizeHandleRegistration[];
  lastPointer: DockResizePointer;
  openedHistoryBatch: boolean;
  pointerOffset: DockResizePointer;
  previousResizeAxis: string | null;
  previousBodyUserSelect: string;
}

interface PendingCoarseDockResize {
  pointerId: number;
  sourceHandleId: string;
  sourceAxis: DockResizeAxis;
  pointerDownEvent: PointerEvent;
  startPointer: DockResizePointer;
}

const FINE_HIT_AREA_MARGIN = 12;
const COARSE_HIT_AREA_MARGIN = 23;
const COARSE_DRAG_INTENT_PX = 6;
const COARSE_CROSS_AXIS_CANCEL_PX = 12;
const RESIZE_HOVER_AXIS_ATTRIBUTE = 'data-dock-resize-hover-axis';
const RESIZE_HANDLE_HOVER_ATTRIBUTE = 'data-dock-resize-hovered';
const CONTROL_PRIORITY_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="tab"]',
  '.dock-tab',
  '.dock-tab-handle',
  '[data-dock-resize-touch-priority]',
].join(', ');
const HARD_TOUCH_PRIORITY_SELECTOR = '[data-dock-resize-touch-priority="true"]';

const registeredHandles = new Map<string, DockResizeRegistration>();
let hoveredHandles = new Set<DockResizeRegistration>();
let activeSession: ActiveDockResizeSession | null = null;
let pendingCoarseResize: PendingCoarseDockResize | null = null;

function pointerFromEvent(event: PointerEvent): DockResizePointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
  };
}

function isDirectResizeHandle(
  registration: DockResizeRegistration,
): registration is DockResizeHandleRegistration {
  return registration.proxyTargetId === undefined;
}

function offsetPointer(pointer: DockResizePointer, offset: DockResizePointer): DockResizePointer {
  return {
    clientX: pointer.clientX + offset.clientX,
    clientY: pointer.clientY + offset.clientY,
  };
}

function getHitAreaMargin(event: PointerEvent): number {
  if (event.pointerType === 'touch') return COARSE_HIT_AREA_MARGIN;

  const coarsePointer = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  return coarsePointer ? COARSE_HIT_AREA_MARGIN : FINE_HIT_AREA_MARGIN;
}

function pointerIntersectsHandle(
  pointer: DockResizePointer,
  handle: DockResizeRegistration,
  margin: number,
): boolean {
  const rect = handle.element.getBoundingClientRect();
  return pointer.clientX >= rect.left - margin
    && pointer.clientX <= rect.right + margin
    && pointer.clientY >= rect.top - margin
    && pointer.clientY <= rect.bottom + margin;
}

function findEventSourceHandle(target: EventTarget | null): DockResizeRegistration | null {
  if (!(target instanceof Node)) return null;

  for (const handle of registeredHandles.values()) {
    if (handle.element === target || handle.element.contains(target)) return handle;
  }
  return null;
}

function isControlPriorityTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(CONTROL_PRIORITY_SELECTOR) !== null;
}

function isControlPriorityAtTouchPoint(
  event: PointerEvent,
  resizeHandle?: HTMLElement,
): boolean {
  if (isControlPriorityTarget(event.target)) return true;
  if (event.pointerType !== 'touch' || typeof document.elementsFromPoint !== 'function') {
    return false;
  }

  return document.elementsFromPoint(event.clientX, event.clientY).some((element) => {
    if (resizeHandle && (element === resizeHandle || resizeHandle.contains(element))) {
      return false;
    }
    return isControlPriorityTarget(element);
  });
}

function isHardTouchPriorityAtTouchPoint(
  event: PointerEvent,
  resizeHandle?: HTMLElement,
): boolean {
  if (!(event.target instanceof Element)) return false;
  if (event.target.closest(HARD_TOUCH_PRIORITY_SELECTOR)) return true;
  if (event.pointerType !== 'touch' || typeof document.elementsFromPoint !== 'function') {
    return false;
  }

  return document.elementsFromPoint(event.clientX, event.clientY).some((element) => {
    if (resizeHandle && (element === resizeHandle || resizeHandle.contains(element))) {
      return false;
    }
    return element.closest(HARD_TOUCH_PRIORITY_SELECTOR) !== null;
  });
}

function clearPendingCoarseResize(pointerId?: number): void {
  if (pointerId !== undefined && pendingCoarseResize?.pointerId !== pointerId) return;
  pendingCoarseResize = null;
}

function getSessionAxis(handles: DockResizeRegistration[]): 'x' | 'y' | 'xy' {
  let hasX = false;
  let hasY = false;

  for (const handle of handles) {
    if (handle.axis === 'x') hasX = true;
    else hasY = true;
  }

  return hasX && hasY ? 'xy' : hasX ? 'x' : 'y';
}

function clearResizeHoverState(): void {
  for (const handle of hoveredHandles) {
    handle.element.removeAttribute(RESIZE_HANDLE_HOVER_ATTRIBUTE);
  }
  hoveredHandles = new Set();
  document.documentElement.removeAttribute(RESIZE_HOVER_AXIS_ATTRIBUTE);
}

function setResizeHoverState(handles: DockResizeRegistration[]): void {
  const nextHandles = new Set(handles);
  const unchanged = nextHandles.size === hoveredHandles.size
    && Array.from(nextHandles).every((handle) => hoveredHandles.has(handle));
  if (unchanged) return;

  for (const handle of hoveredHandles) {
    if (!nextHandles.has(handle)) {
      handle.element.removeAttribute(RESIZE_HANDLE_HOVER_ATTRIBUTE);
    }
  }
  for (const handle of nextHandles) {
    handle.element.setAttribute(RESIZE_HANDLE_HOVER_ATTRIBUTE, 'true');
  }

  hoveredHandles = nextHandles;
  const axis = getSessionAxis(handles);
  if (axis === 'xy') {
    document.documentElement.setAttribute(RESIZE_HOVER_AXIS_ATTRIBUTE, axis);
  } else {
    document.documentElement.removeAttribute(RESIZE_HOVER_AXIS_ATTRIBUTE);
  }
}

function updateResizeHoverState(event: PointerEvent): void {
  if (activeSession) return;

  const sourceHandle = findEventSourceHandle(event.target);
  if (!sourceHandle) {
    clearResizeHoverState();
    return;
  }

  const pointer = pointerFromEvent(event);
  const margin = getHitAreaMargin(event);
  const intersectingHandles = Array.from(registeredHandles.values()).filter((handle) => (
    handle === sourceHandle || pointerIntersectsHandle(pointer, handle, margin)
  ));
  setResizeHoverState(intersectingHandles);
}

function handleHoverPointerMove(event: PointerEvent): void {
  updateResizeHoverState(event);
}

function handleHoverPointerOut(event: PointerEvent): void {
  if (event.relatedTarget === null) clearResizeHoverState();
}

function handleWindowBlur(): void {
  clearPendingCoarseResize();
  clearResizeHoverState();
  finishActiveSessionAtLastPointer();
}

function handleCoarsePointerDown(event: PointerEvent): void {
  if (
    event.pointerType !== 'touch'
    || event.button !== 0
    || !event.isPrimary
    || activeSession
  ) return;

  const pointer = pointerFromEvent(event);
  const eventSourceHandle = findEventSourceHandle(event.target);
  const nearestHandle = eventSourceHandle ?? Array.from(registeredHandles.values()).find((handle) => (
    pointerIntersectsHandle(pointer, handle, COARSE_HIT_AREA_MARGIN)
  ));
  if (!nearestHandle) return;
  if (
    !eventSourceHandle
    && isHardTouchPriorityAtTouchPoint(event, nearestHandle.element)
  ) return;

  // The expanded coarse-pointer area is intent-based: an ordinary tap is left
  // untouched, while a directed drag promotes this pending gesture to resize.
  pendingCoarseResize = {
    pointerId: event.pointerId,
    sourceHandleId: nearestHandle.id,
    sourceAxis: nearestHandle.axis,
    pointerDownEvent: event,
    startPointer: pointer,
  };
}

function handleCoarsePointerMove(event: PointerEvent): void {
  const pending = pendingCoarseResize;
  if (!pending || event.pointerId !== pending.pointerId || activeSession) return;

  const dx = event.clientX - pending.startPointer.clientX;
  const dy = event.clientY - pending.startPointer.clientY;
  const primaryDistance = pending.sourceAxis === 'x' ? Math.abs(dx) : Math.abs(dy);
  const crossDistance = pending.sourceAxis === 'x' ? Math.abs(dy) : Math.abs(dx);

  if (
    crossDistance >= COARSE_CROSS_AXIS_CANCEL_PX
    && crossDistance > primaryDistance
  ) {
    clearPendingCoarseResize(event.pointerId);
    return;
  }

  if (
    primaryDistance < COARSE_DRAG_INTENT_PX
    || primaryDistance < crossDistance * 0.75
  ) return;

  clearPendingCoarseResize(event.pointerId);
  if (!startDockResizeFromIntent(pending.pointerDownEvent, pending.sourceHandleId)) return;
  handleWindowPointerMove(event);
}

function handleCoarsePointerEnd(event: PointerEvent): void {
  clearPendingCoarseResize(event.pointerId);
}

function updateHoverListeners(): void {
  window.removeEventListener('pointermove', handleHoverPointerMove, true);
  window.removeEventListener('pointerout', handleHoverPointerOut, true);
  window.removeEventListener('pointerdown', handleCoarsePointerDown, true);
  window.removeEventListener('pointermove', handleCoarsePointerMove, true);
  window.removeEventListener('pointerup', handleCoarsePointerEnd, true);
  window.removeEventListener('pointercancel', handleCoarsePointerEnd, true);
  window.removeEventListener('blur', handleWindowBlur);

  if (registeredHandles.size > 0) {
    window.addEventListener('pointermove', handleHoverPointerMove, true);
    window.addEventListener('pointerout', handleHoverPointerOut, true);
    window.addEventListener('pointerdown', handleCoarsePointerDown, true);
    window.addEventListener('pointermove', handleCoarsePointerMove, true);
    window.addEventListener('pointerup', handleCoarsePointerEnd, true);
    window.addEventListener('pointercancel', handleCoarsePointerEnd, true);
    window.addEventListener('blur', handleWindowBlur);
  } else {
    clearPendingCoarseResize();
    clearResizeHoverState();
  }
}

function setGlobalResizeState(session: ActiveDockResizeSession): void {
  const root = document.documentElement;
  session.previousResizeAxis = root.getAttribute(RESIZE_AXIS_ATTRIBUTE);
  session.previousBodyUserSelect = document.body.style.userSelect;
  root.setAttribute(RESIZE_AXIS_ATTRIBUTE, getSessionAxis(session.handles));
  document.body.style.userSelect = 'none';
}

function restoreGlobalResizeState(session: ActiveDockResizeSession): void {
  const root = document.documentElement;
  if (session.previousResizeAxis === null) {
    root.removeAttribute(RESIZE_AXIS_ATTRIBUTE);
  } else {
    root.setAttribute(RESIZE_AXIS_ATTRIBUTE, session.previousResizeAxis);
  }
  document.body.style.userSelect = session.previousBodyUserSelect;
}

function removeWindowListeners(): void {
  window.removeEventListener('pointermove', handleWindowPointerMove, true);
  window.removeEventListener('pointerup', handleWindowPointerUp, true);
  window.removeEventListener('pointercancel', handleWindowPointerCancel, true);
  window.removeEventListener('lostpointercapture', handleWindowLostPointerCapture, true);
  window.removeEventListener('pagehide', handleWindowPageHide, true);
  document.removeEventListener('visibilitychange', handleDocumentVisibilityChange, true);
}

function completeSession(
  session: ActiveDockResizeSession,
  finalPointer: DockResizePointer,
): void {
  activeSession = null;
  removeWindowListeners();
  restoreGlobalResizeState(session);

  try {
    for (const handle of session.handles) {
      if (registeredHandles.get(handle.id) === handle) {
        handle.onEnd(finalPointer);
      }
    }
  } finally {
    if (session.openedHistoryBatch) endBatch();
  }
}

function finishActiveSessionAtLastPointer(): void {
  const session = activeSession;
  if (!session) return;
  completeSession(session, session.lastPointer);
}

function finishSession(event: PointerEvent, useLastPointer = false): void {
  const session = activeSession;
  if (!session || event.pointerId !== session.pointerId) return;

  const finalPointer = useLastPointer
    ? session.lastPointer
    : offsetPointer(pointerFromEvent(event), session.pointerOffset);
  completeSession(session, finalPointer);
}

function handleWindowPointerMove(event: PointerEvent): void {
  const session = activeSession;
  if (!session || event.pointerId !== session.pointerId) return;

  if (event.pointerType === 'mouse' && event.buttons === 0) {
    event.preventDefault();
    event.stopPropagation();
    finishSession(event);
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const pointer = offsetPointer(pointerFromEvent(event), session.pointerOffset);
  session.lastPointer = pointer;
  for (const handle of session.handles) {
    if (registeredHandles.get(handle.id) === handle) {
      handle.onMove(pointer);
    }
  }
}

function handleWindowPointerUp(event: PointerEvent): void {
  const session = activeSession;
  if (!session || event.pointerId !== session.pointerId) return;

  event.preventDefault();
  event.stopPropagation();
  finishSession(event);
}

function handleWindowPointerCancel(event: PointerEvent): void {
  const session = activeSession;
  if (!session || event.pointerId !== session.pointerId) return;

  event.preventDefault();
  event.stopPropagation();
  finishSession(event, true);
}

function handleWindowLostPointerCapture(event: PointerEvent): void {
  const session = activeSession;
  if (!session || event.pointerId !== session.pointerId) return;
  finishActiveSessionAtLastPointer();
}

function handleWindowPageHide(): void {
  finishActiveSessionAtLastPointer();
}

function handleDocumentVisibilityChange(): void {
  if (document.visibilityState !== 'visible') finishActiveSessionAtLastPointer();
}

function addWindowListeners(): void {
  window.addEventListener('pointermove', handleWindowPointerMove, true);
  window.addEventListener('pointerup', handleWindowPointerUp, true);
  window.addEventListener('pointercancel', handleWindowPointerCancel, true);
  window.addEventListener('lostpointercapture', handleWindowLostPointerCapture, true);
  window.addEventListener('pagehide', handleWindowPageHide, true);
  document.addEventListener('visibilitychange', handleDocumentVisibilityChange, true);
}

export function registerDockResizeHandle(
  registration: DockResizeHandleRegistration,
): () => void {
  registeredHandles.set(registration.id, registration);
  updateHoverListeners();

  return () => {
    if (registeredHandles.get(registration.id) !== registration) return;
    registeredHandles.delete(registration.id);
    if (pendingCoarseResize?.sourceHandleId === registration.id) {
      clearPendingCoarseResize();
    }
    const removedHoveredHandle = hoveredHandles.delete(registration);
    registration.element.removeAttribute(RESIZE_HANDLE_HOVER_ATTRIBUTE);
    if (removedHoveredHandle) {
      const remainingHoveredHandles = Array.from(hoveredHandles);
      if (
        remainingHoveredHandles.length > 0
        && getSessionAxis(remainingHoveredHandles) === 'xy'
      ) {
        document.documentElement.setAttribute(RESIZE_HOVER_AXIS_ATTRIBUTE, 'xy');
      } else {
        document.documentElement.removeAttribute(RESIZE_HOVER_AXIS_ATTRIBUTE);
      }
    }
    updateHoverListeners();

    const session = activeSession;
    if (!session) return;

    session.handles = session.handles.filter((handle) => handle !== registration);
    if (session.handles.length === 0) {
      activeSession = null;
      removeWindowListeners();
      restoreGlobalResizeState(session);
      if (session.openedHistoryBatch) endBatch();
      return;
    }

    document.documentElement.setAttribute(
      RESIZE_AXIS_ATTRIBUTE,
      getSessionAxis(session.handles),
    );
  };
}

export function registerDockResizeProxyHandle(
  registration: DockResizeProxyRegistration,
): () => void {
  registeredHandles.set(registration.id, registration);
  updateHoverListeners();

  return () => {
    if (registeredHandles.get(registration.id) !== registration) return;
    registeredHandles.delete(registration.id);
    if (pendingCoarseResize?.sourceHandleId === registration.id) {
      clearPendingCoarseResize();
    }
    const removedHoveredHandle = hoveredHandles.delete(registration);
    registration.element.removeAttribute(RESIZE_HANDLE_HOVER_ATTRIBUTE);
    if (removedHoveredHandle) {
      const remainingHoveredHandles = Array.from(hoveredHandles);
      if (
        remainingHoveredHandles.length > 0
        && getSessionAxis(remainingHoveredHandles) === 'xy'
      ) {
        document.documentElement.setAttribute(RESIZE_HOVER_AXIS_ATTRIBUTE, 'xy');
      } else {
        document.documentElement.removeAttribute(RESIZE_HOVER_AXIS_ATTRIBUTE);
      }
    }
    updateHoverListeners();
  };
}

function startDockResizeSession(
  event: PointerEvent,
  sourceHandleId: string,
  controlPrioritySatisfied: boolean,
): boolean {
  if (activeSession || !event.isPrimary) return false;

  const sourceRegistration = registeredHandles.get(sourceHandleId);
  if (!sourceRegistration) return false;
  const sourceHandle = isDirectResizeHandle(sourceRegistration)
    ? sourceRegistration
    : registeredHandles.get(sourceRegistration.proxyTargetId);
  if (!sourceHandle || !isDirectResizeHandle(sourceHandle)) return false;
  const eventSourceHandle = findEventSourceHandle(event.target);
  if (
    !controlPrioritySatisfied
    && eventSourceHandle !== sourceRegistration
    && isControlPriorityAtTouchPoint(event, sourceRegistration.element)
  ) return false;

  clearPendingCoarseResize(event.pointerId);

  const rawPointer = pointerFromEvent(event);
  const pointerOffset = isDirectResizeHandle(sourceRegistration)
    ? { clientX: 0, clientY: 0 }
    : (() => {
        const sourceRect = sourceRegistration.element.getBoundingClientRect();
        const targetRect = sourceHandle.element.getBoundingClientRect();
        return sourceRegistration.axis === 'x'
          ? {
              clientX: targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2),
              clientY: 0,
            }
          : {
              clientX: 0,
              clientY: targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2),
            };
      })();
  const pointer = offsetPointer(rawPointer, pointerOffset);
  const margin = getHitAreaMargin(event);
  const intersectingHandles = isDirectResizeHandle(sourceRegistration)
    ? Array.from(registeredHandles.values()).filter((handle): handle is DockResizeHandleRegistration => (
        isDirectResizeHandle(handle)
        && (handle === sourceHandle || pointerIntersectsHandle(pointer, handle, margin))
      ))
    : [sourceHandle];
  clearResizeHoverState();
  const historyBatch = startBatch('Resize dock split');
  const session: ActiveDockResizeSession = {
    pointerId: event.pointerId,
    handles: intersectingHandles,
    lastPointer: pointer,
    openedHistoryBatch: historyBatch.opened,
    pointerOffset,
    previousResizeAxis: null,
    previousBodyUserSelect: '',
  };

  activeSession = session;
  setGlobalResizeState(session);
  addWindowListeners();

  for (const handle of session.handles) {
    handle.onStart(pointer);
  }

  event.preventDefault();
  return true;
}

function startDockResizeFromIntent(event: PointerEvent, sourceHandleId: string): boolean {
  return startDockResizeSession(event, sourceHandleId, true);
}

export function startDockResize(event: PointerEvent, sourceHandleId: string): boolean {
  return startDockResizeSession(event, sourceHandleId, false);
}
