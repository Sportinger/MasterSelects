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

/**
 * Left-mouse drag-to-reorder for a timeline track header. Returns a pointer-down
 * handler to attach to a drag grip. Reordering is constrained to the track's own
 * section (video among video, audio/midi among audio) by the store action.
 */
export function useTrackReorderDrag(track: TimelineTrack) {
  const reorderTrack = useTimelineStore((state) => state.reorderTrack);
  const stateRef = useRef<ReorderDragState | null>(null);

  const onReorderPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || track.locked) return;
    event.stopPropagation();

    const sourceEl = (event.currentTarget.closest('[data-track-reorder-id]') as HTMLElement) ?? null;
    const sourceSection = trackReorderSection(track);
    stateRef.current = {
      startY: event.clientY,
      dragging: false,
      sourceEl,
      targetEl: null,
      targetId: null,
      placeBelow: false,
    };

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
        state.dragging = true;
        state.sourceEl?.classList.add('track-reordering');
        document.body.classList.add('track-reordering-active');
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
      const state = stateRef.current;
      stateRef.current = null;
      if (!state) return;
      state.sourceEl?.classList.remove('track-reordering');
      document.body.classList.remove('track-reordering-active');
      state.targetEl?.classList.remove(...TARGET_CLASSES);
      if (state.dragging && state.targetId) {
        reorderTrack(track.id, state.targetId, state.placeBelow);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [reorderTrack, track]);

  return { onReorderPointerDown };
}
