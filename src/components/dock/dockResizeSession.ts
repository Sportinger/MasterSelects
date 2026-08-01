import { endBatch, startBatch } from '../../stores/historyStore';

export type DockResizeAxis = 'x' | 'y';

export interface DockResizePointer {
  clientX: number;
  clientY: number;
}

interface DockResizeHandleRegistration {
  id: string;
  axis: DockResizeAxis;
  element: HTMLElement;
  onStart: (pointer: DockResizePointer) => void;
  onMove: (pointer: DockResizePointer) => void;
  onEnd: (pointer: DockResizePointer) => void;
}

interface ActiveDockResizeSession {
  pointerId: number;
  handles: DockResizeHandleRegistration[];
  lastPointer: DockResizePointer;
  openedHistoryBatch: boolean;
  previousResizeAxis: string | null;
  previousBodyUserSelect: string;
}

const FINE_HIT_AREA_MARGIN = 12;
const COARSE_HIT_AREA_MARGIN = 20;
const RESIZE_AXIS_ATTRIBUTE = 'data-dock-resize-axis';
const RESIZE_HOVER_AXIS_ATTRIBUTE = 'data-dock-resize-hover-axis';
const RESIZE_HANDLE_HOVER_ATTRIBUTE = 'data-dock-resize-hovered';

const registeredHandles = new Map<string, DockResizeHandleRegistration>();
let hoveredHandles = new Set<DockResizeHandleRegistration>();
let activeSession: ActiveDockResizeSession | null = null;

function pointerFromEvent(event: PointerEvent): DockResizePointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
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
  handle: DockResizeHandleRegistration,
  margin: number,
): boolean {
  const rect = handle.element.getBoundingClientRect();
  return pointer.clientX >= rect.left - margin
    && pointer.clientX <= rect.right + margin
    && pointer.clientY >= rect.top - margin
    && pointer.clientY <= rect.bottom + margin;
}

function findEventSourceHandle(target: EventTarget | null): DockResizeHandleRegistration | null {
  if (!(target instanceof Node)) return null;

  for (const handle of registeredHandles.values()) {
    if (handle.element === target || handle.element.contains(target)) return handle;
  }
  return null;
}

function getSessionAxis(handles: DockResizeHandleRegistration[]): 'x' | 'y' | 'xy' {
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

function setResizeHoverState(handles: DockResizeHandleRegistration[]): void {
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

function updateHoverListeners(): void {
  window.removeEventListener('pointermove', handleHoverPointerMove, true);
  window.removeEventListener('pointerout', handleHoverPointerOut, true);
  window.removeEventListener('blur', clearResizeHoverState);

  if (registeredHandles.size > 0) {
    window.addEventListener('pointermove', handleHoverPointerMove, true);
    window.addEventListener('pointerout', handleHoverPointerOut, true);
    window.addEventListener('blur', clearResizeHoverState);
  } else {
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
}

function finishSession(event: PointerEvent, useLastPointer = false): void {
  const session = activeSession;
  if (!session || event.pointerId !== session.pointerId) return;

  const finalPointer = useLastPointer ? session.lastPointer : pointerFromEvent(event);
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

function handleWindowPointerMove(event: PointerEvent): void {
  const session = activeSession;
  if (!session || event.pointerId !== session.pointerId) return;

  if (event.pointerType === 'mouse' && event.buttons === 0) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    finishSession(event);
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const pointer = pointerFromEvent(event);
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
  event.stopImmediatePropagation();
  finishSession(event);
}

function handleWindowPointerCancel(event: PointerEvent): void {
  const session = activeSession;
  if (!session || event.pointerId !== session.pointerId) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  finishSession(event, true);
}

function addWindowListeners(): void {
  window.addEventListener('pointermove', handleWindowPointerMove, true);
  window.addEventListener('pointerup', handleWindowPointerUp, true);
  window.addEventListener('pointercancel', handleWindowPointerCancel, true);
}

export function registerDockResizeHandle(
  registration: DockResizeHandleRegistration,
): () => void {
  registeredHandles.set(registration.id, registration);
  updateHoverListeners();

  return () => {
    if (registeredHandles.get(registration.id) !== registration) return;
    registeredHandles.delete(registration.id);
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

export function startDockResize(event: PointerEvent, sourceHandleId: string): boolean {
  if (activeSession || !event.isPrimary) return false;

  const sourceHandle = registeredHandles.get(sourceHandleId);
  if (!sourceHandle) return false;

  const pointer = pointerFromEvent(event);
  const margin = getHitAreaMargin(event);
  const intersectingHandles = Array.from(registeredHandles.values()).filter((handle) => (
    handle === sourceHandle || pointerIntersectsHandle(pointer, handle, margin)
  ));
  clearResizeHoverState();
  const historyBatch = startBatch('Resize dock split');
  const session: ActiveDockResizeSession = {
    pointerId: event.pointerId,
    handles: intersectingHandles,
    lastPointer: pointer,
    openedHistoryBatch: historyBatch.opened,
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
