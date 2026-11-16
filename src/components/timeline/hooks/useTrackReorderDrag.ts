import { useCallback, useRef } from 'react';
import type React from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineTrack } from '../../../types';

const REORDER_THRESHOLD_PX = 5;

export function trackReorderSection(track: TimelineTrack): 'video' | 'audio' {
  return track.type === 'video' ? 'video' : 'audio';
}

interface ReorderDragState {
  startY: number;
  dragging: boolean;
  sourceEl: HTMLElement | null;
  targetEl: HTMLElement | null;
  targetId: string | null;
  placeBelow: boolean;
}

const TARGET_CLASSES = ['track-reorder-target-before', 'track-reorder-target-after'];

/** Holding the pointer this long on a track header picks the track up, clips included. */
export const TRACK_HOLD_TO_REORDER_MS = 350;
/** Controls inside the header keep their own pointer behavior; holding them never starts a reorder. */
const HOLD_EXCLUDED = 'button, input, select, textarea, a, [role="button"], [role="slider"], .track-expand-arrow, .track-reorder-handle';

/**
 * Drag-to-reorder for a timeline track header, moving the track with all its clips.
 * `onReorderPointerDown` belongs on the grip and starts after a few pixels of movement;
 * `onHoldPointerDown` belongs on the whole header and starts after holding still for
 * TRACK_HOLD_TO_REORDER_MS (clicks and quick drags keep their normal meaning).
 * Reordering is constrained to the track's own section (video among video, audio/midi
 * among audio) by the store action.
 */
export function useTrackReorderDrag(track: TimelineTrack) {
  const reorderTrack = useTimelineStore((state) => state.reorderTrack);
  const stateRef = useRef<ReorderDragState | null>(null);

  const beginReorder = useCallback((startY: number, sourceEl: HTMLElement | null, pickedUp: boolean) => {
    const sourceSection = trackReorderSection(track);
    stateRef.current = { startY, dragging: false, sourceEl, targetEl: null, targetId: null, placeBelow: false };

    const startDragging = (state: ReorderDragState) => {
      state.dragging = true;
      state.sourceEl?.classList.add('track-reordering');
      document.body.classList.add('track-reordering-active');
    };
    if (pickedUp) startDragging(stateRef.current);

    const clearTarget = () => {
      stateRef.current?.targetEl?.classList.remove(...TARGET_CLASSES);
      if (stateRef.current) {
        stateRef.current.targetEl = null;
        stateRef.current.targetId = null;
      }
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const state = stateRef.current;
      if (!state) return;

      if (!state.dragging) {
        if (Math.abs(moveEvent.clientY - state.startY) < REORDER_THRESHOLD_PX) return;
        startDragging(state);
      }

      const overEl = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
      const headerEl = (overEl?.closest('[data-track-reorder-id]') as HTMLElement) ?? null;
      clearTarget();
      if (!headerEl) return;

      const id = headerEl.getAttribute('data-track-reorder-id');
      const section = headerEl.getAttribute('data-track-reorder-section');
      if (!id || id === track.id || section !== sourceSection) return;

      const rect = headerEl.getBoundingClientRect();
      const placeBelow = moveEvent.clientY > rect.top + rect.height / 2;
      headerEl.classList.add(placeBelow ? 'track-reorder-target-after' : 'track-reorder-target-before');
      state.targetEl = headerEl;
      state.targetId = id;
      state.placeBelow = placeBelow;
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      const state = stateRef.current;
      stateRef.current = null;
      if (!state) return;
      state.sourceEl?.classList.remove('track-reordering');
      document.body.classList.remove('track-reordering-active');
      state.targetEl?.classList.remove(...TARGET_CLASSES);
      if (state.dragging && state.targetId) {
        reorderTrack(track.id, state.targetId, state.placeBelow);
      }
      if (pickedUp) {
        // The release after a hold must not also count as a click on the header (selection, expand).
        const swallow = (clickEvent: MouseEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }, [reorderTrack, track]);

  const onReorderPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || track.locked) return;
    event.stopPropagation();
    beginReorder(event.clientY, (event.currentTarget.closest('[data-track-reorder-id]') as HTMLElement) ?? null, false);
  }, [beginReorder, track.locked]);

  const onHoldPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || track.locked || stateRef.current) return;
    if ((event.target as HTMLElement | null)?.closest(HOLD_EXCLUDED)) return;
    const sourceEl = (event.currentTarget.closest('[data-track-reorder-id]') as HTMLElement) ?? null;
    const startX = event.clientX, startY = event.clientY;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointercancel', cancel);
    };
    // Moving before the hold completes is an ordinary gesture (e.g. a scroll), not a pick-up.
    const onMove = (moveEvent: PointerEvent) => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) >= REORDER_THRESHOLD_PX) cancel();
    };
    timer = setTimeout(() => { cancel(); beginReorder(startY, sourceEl, true); }, TRACK_HOLD_TO_REORDER_MS);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cancel);
    window.addEventListener('pointercancel', cancel);
  }, [beginReorder, track.locked]);

  return { onReorderPointerDown, onHoldPointerDown };
}
