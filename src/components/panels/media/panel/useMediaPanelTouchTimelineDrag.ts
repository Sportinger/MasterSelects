import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { mediaNeedsRelink } from '../../../../services/project/relinkMedia';
import { useDockStore } from '../../../../stores/dockStore';
import { useMediaStore, type ProjectItem } from '../../../../stores/mediaStore';
import {
  clearExternalDragPayload,
  createExternalDragPayloadForProjectItem,
  dispatchExternalDragBridgeEvent,
  getExternalDragPayload,
  setExternalDragPayload,
  type ExternalDragPayload,
} from '../../../timeline/utils/externalDragSession';
import { isImportedMediaFileItem } from '../itemTypeGuards';

// Give a fast scroll flick only a couple of frames to declare itself. A
// controlled move then feels immediate instead of requiring a long press.
const TOUCH_DRAG_INTENT_WINDOW_MS = 40;
const TOUCH_DRAG_START_DISTANCE_PX = 6;
const TOUCH_SCROLL_DISTANCE_PX = 10;
const TOUCH_DRAG_GHOST_WIDTH_PX = 190;
const TOUCH_DRAG_GHOST_OFFSET_X_PX = 14;
const TOUCH_DRAG_GHOST_OFFSET_Y_PX = 62;
const TOUCH_DOUBLE_TAP_INTERVAL_MS = 320;
const TOUCH_DOUBLE_TAP_DISTANCE_PX = 36;
const TOUCH_TAP_MAX_DURATION_MS = 240;
const TOUCH_TAP_MOVE_TOLERANCE_PX = 12;

interface CompletedMediaTouchTap {
  completedAt: number;
  itemId: string;
  x: number;
  y: number;
}

function getTouchDragGhostAbbreviation(payload: ExternalDragPayload): string {
  if (payload.isAudio) return 'AUD';
  if (payload.mediaType === 'image') return 'IMG';
  if (payload.kind === 'composition') return 'COMP';
  if (payload.mediaType === 'video' || payload.kind === 'media-file') return 'VID';
  return payload.mediaType?.slice(0, 4).toUpperCase() || 'ITEM';
}

function createTouchDragGhost(payload: ExternalDragPayload): HTMLDivElement {
  document.querySelectorAll('.media-touch-drag-ghost').forEach((element) => element.remove());

  const ghost = document.createElement('div');
  ghost.className = `media-touch-drag-ghost${payload.isAudio ? ' is-audio' : ''}`;
  ghost.setAttribute('aria-hidden', 'true');

  const visual = document.createElement('div');
  visual.className = 'media-touch-drag-ghost-visual';
  if (payload.thumbnailUrl) {
    const image = document.createElement('img');
    image.src = payload.thumbnailUrl;
    image.alt = '';
    image.draggable = false;
    visual.appendChild(image);
  } else {
    visual.textContent = getTouchDragGhostAbbreviation(payload);
  }

  const copy = document.createElement('span');
  copy.className = 'media-touch-drag-ghost-copy';

  const label = document.createElement('strong');
  label.textContent = payload.label || 'Media';
  copy.appendChild(label);

  const mediaType = document.createElement('span');
  mediaType.textContent = payload.mediaType || payload.kind;
  copy.appendChild(mediaType);

  ghost.append(visual, copy);
  document.body.appendChild(ghost);
  return ghost;
}

function positionTouchDragGhost(ghost: HTMLElement, clientX: number, clientY: number): void {
  const margin = 10;
  const x = Math.max(
    margin,
    Math.min(window.innerWidth - TOUCH_DRAG_GHOST_WIDTH_PX - margin, clientX + TOUCH_DRAG_GHOST_OFFSET_X_PX),
  );
  const y = Math.max(margin, clientY - TOUCH_DRAG_GHOST_OFFSET_Y_PX);
  ghost.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;

  const target = typeof document.elementFromPoint === 'function'
    ? document.elementFromPoint(clientX, clientY)
    : null;
  ghost.classList.toggle('is-over-timeline', target instanceof Element && target.closest('.timeline-container') !== null);
}

interface UseMediaPanelTouchTimelineDragInput {
  activeCompositionId: string | null;
  renameTimerRef: { current: number | null };
  setInternalDragId: (itemId: string | null) => void;
  getSlotGridProgress: () => number;
}

function suppressNextClick(): void {
  const suppress = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener('click', suppress, { capture: true, once: true });
  window.setTimeout(() => document.removeEventListener('click', suppress, true), 400);
}

function suppressTouchDoubleTapCompatibilityEvents(): void {
  const suppress = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const remove = () => {
    document.removeEventListener('click', suppress, true);
    document.removeEventListener('dblclick', suppress, true);
  };
  document.addEventListener('click', suppress, true);
  document.addEventListener('dblclick', suppress, true);
  window.setTimeout(remove, 400);
}

export function useMediaPanelTouchTimelineDrag({
  activeCompositionId,
  renameTimerRef,
  setInternalDragId,
  getSlotGridProgress,
}: UseMediaPanelTouchTimelineDragInput) {
  const cancelActiveGestureRef = useRef<(() => void) | null>(null);
  const previousTapRef = useRef<CompletedMediaTouchTap | null>(null);

  useEffect(() => () => cancelActiveGestureRef.current?.(), []);

  return useCallback((event: ReactPointerEvent<HTMLDivElement>, item: ProjectItem) => {
    if (event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0) return;
    if ('isExpanded' in item) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, input, select, textarea, [contenteditable="true"]')) return;
    if (isImportedMediaFileItem(item) && (item.isImporting || mediaNeedsRelink(item))) return;

    const payload = createExternalDragPayloadForProjectItem(item, {
      activeCompositionId,
      slotGridProgress: getSlotGridProgress(),
    });
    if (!payload) return;
    const activePayload: ExternalDragPayload = payload;

    cancelActiveGestureRef.current?.();
    if (renameTimerRef.current !== null) {
      window.clearTimeout(renameTimerRef.current);
      renameTimerRef.current = null;
    }

    const pointerId = event.pointerId;
    const sourceElement = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const startedAt = Date.now();
    const previousTap = previousTapRef.current;
    const isCompositionDoubleTapCandidate = item.type === 'composition'
      && previousTap !== null
      && previousTap.itemId === item.id
      && startedAt - previousTap.completedAt <= TOUCH_DOUBLE_TAP_INTERVAL_MS
      && Math.hypot(startX - previousTap.x, startY - previousTap.y) <= TOUCH_DOUBLE_TAP_DISTANCE_PX;
    let armed = false;
    let dragging = false;
    let finished = false;
    let latestX = startX;
    let latestY = startY;
    let dragGhost: HTMLDivElement | null = null;

    const armTimer = window.setTimeout(() => {
      armed = true;
      if (Math.hypot(latestX - startX, latestY - startY) >= TOUCH_DRAG_START_DISTANCE_PX) {
        beginDrag();
        updateDragPosition();
      }
    }, TOUCH_DRAG_INTENT_WINDOW_MS);

    const clearPayloadIfCurrent = () => {
      if (getExternalDragPayload() === activePayload) clearExternalDragPayload();
    };

    const removeListeners = () => {
      window.clearTimeout(armTimer);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      window.removeEventListener('pointerdown', handleAdditionalPointerDown, true);
      window.removeEventListener('touchmove', handleTouchMove, true);
      try {
        if (sourceElement.hasPointerCapture(pointerId)) sourceElement.releasePointerCapture(pointerId);
      } catch {
        // The element may have been replaced by a panel re-render.
      }
    };

    const finish = (phase: 'drop' | 'cancel') => {
      if (finished) return;
      finished = true;
      removeListeners();
      cancelActiveGestureRef.current = null;
      sourceElement.classList.remove('touch-dragging');
      setInternalDragId(null);

      if (dragGhost) {
        const settledGhost = dragGhost;
        dragGhost = null;
        settledGhost.classList.add(phase === 'drop' ? 'is-dropping' : 'is-cancelling');
        window.setTimeout(() => settledGhost.remove(), phase === 'drop' ? 150 : 90);
      }

      if (!dragging) return;
      dispatchExternalDragBridgeEvent({ phase, clientX: latestX, clientY: latestY });
      if (phase === 'drop') {
        suppressNextClick();
        window.setTimeout(clearPayloadIfCurrent, 0);
      } else {
        clearPayloadIfCurrent();
      }
    };

    function handleTouchMove(touchEvent: TouchEvent) {
      if (armed) touchEvent.preventDefault();
    }

    function handleAdditionalPointerDown(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerType !== 'mouse' && pointerEvent.pointerId !== pointerId) finish('cancel');
    }

    function beginDrag() {
      if (dragging || finished) return;
      dragging = true;
      clearExternalDragPayload();
      setExternalDragPayload(activePayload);
      setInternalDragId(item.id);
      sourceElement.classList.add('touch-dragging');
      dragGhost = createTouchDragGhost(activePayload);
    }

    function updateDragPosition() {
      if (!dragging) return;
      if (dragGhost) positionTouchDragGhost(dragGhost, latestX, latestY);
      dispatchExternalDragBridgeEvent({ phase: 'move', clientX: latestX, clientY: latestY });
    }

    function handlePointerMove(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      latestX = pointerEvent.clientX;
      latestY = pointerEvent.clientY;
      const distance = Math.hypot(latestX - startX, latestY - startY);

      if (!armed) {
        if (distance >= TOUCH_SCROLL_DISTANCE_PX) finish('cancel');
        return;
      }

      if (!dragging && distance >= TOUCH_DRAG_START_DISTANCE_PX) {
        beginDrag();
      }
      if (!dragging) return;

      pointerEvent.preventDefault();
      updateDragPosition();
    }

    function handlePointerUp(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      latestX = pointerEvent.clientX;
      latestY = pointerEvent.clientY;
      if (dragging) pointerEvent.preventDefault();
      const completedAt = Date.now();
      const isTap = !dragging
        && completedAt - startedAt <= TOUCH_TAP_MAX_DURATION_MS
        && Math.hypot(latestX - startX, latestY - startY) <= TOUCH_TAP_MOVE_TOLERANCE_PX;

      if (isCompositionDoubleTapCandidate && isTap) {
        previousTapRef.current = null;
        pointerEvent.preventDefault();
        pointerEvent.stopPropagation();
        finish('cancel');
        suppressTouchDoubleTapCompatibilityEvents();
        useDockStore.getState().activatePanelType('timeline');
        void useMediaStore.getState().openCompositionTab(item.id, { skipAnimation: true });
        return;
      }

      previousTapRef.current = isTap
        ? { completedAt, itemId: item.id, x: latestX, y: latestY }
        : null;
      finish('drop');
    }

    function handlePointerCancel(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      previousTapRef.current = null;
      finish('cancel');
    }

    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handlePointerUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', handlePointerCancel, true);
    window.addEventListener('pointerdown', handleAdditionalPointerDown, true);
    window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    cancelActiveGestureRef.current = () => finish('cancel');

    try {
      sourceElement.setPointerCapture(pointerId);
    } catch {
      // Window listeners still keep the gesture alive where capture is unavailable.
    }
  }, [activeCompositionId, getSlotGridProgress, renameTimerRef, setInternalDragId]);
}
