// Pick Whip Drag Hook - handles clip and track parenting via drag

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type { PickWhipDragState } from '../types';
import { evaluateMotionParentDrop } from '../utils/motionParentingUi';

interface UsePickWhipDragProps {
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  setClipParent: (clipId: string, parentClipId: string | null) => void;
  setTrackParent: (trackId: string, parentTrackId: string | null) => void;
}

function getClipIdAtPoint(x: number, y: number): string | null {
  const target = document.elementFromPoint?.(x, y);
  return target?.closest<HTMLElement>('[data-clip-id]')?.dataset.clipId ?? null;
}

export function usePickWhipDrag({ clips, tracks, setClipParent, setTrackParent }: UsePickWhipDragProps) {
  const [pickWhipDrag, setPickWhipDrag] = useState<PickWhipDragState | null>(null);
  const dragRef = useRef<PickWhipDragState | null>(null);
  const clipsRef = useRef(clips);
  const tracksRef = useRef(tracks);
  const setClipParentRef = useRef(setClipParent);

  useEffect(() => {
    clipsRef.current = clips;
    tracksRef.current = tracks;
    setClipParentRef.current = setClipParent;
  }, [clips, setClipParent, tracks]);

  const updateDrag = useCallback((next: PickWhipDragState | null) => {
    dragRef.current = next;
    setPickWhipDrag(next);
  }, []);

  const handlePickWhipDragStart = useCallback((sourceClipId: string, startX: number, startY: number) => {
    const source = clipsRef.current.find((clip) => clip.id === sourceClipId);
    const sourceTrack = source
      ? tracksRef.current.find((track) => track.id === source.trackId)
      : undefined;
    if (!source || sourceTrack?.type !== 'video' || sourceTrack.locked === true) return;

    updateDrag({
      sourceClipId,
      startX,
      startY,
      currentX: startX,
      currentY: startY,
      targetClipId: null,
      status: 'idle',
      diagnostic: 'Drop onto an unlocked 2D video clip.',
    });
  }, [updateDrag]);

  const handlePickWhipDragEnd = useCallback(() => {
    updateDrag(null);
  }, [updateDrag]);

  const pickWhipActive = pickWhipDrag !== null;
  useEffect(() => {
    if (!pickWhipActive) return;

    const handlePointerMove = (event: PointerEvent) => {
      const active = dragRef.current;
      if (!active) return;
      const targetClipId = getClipIdAtPoint(event.clientX, event.clientY);
      const evaluation = evaluateMotionParentDrop({
        sourceClipId: active.sourceClipId,
        targetClipId,
        clips: clipsRef.current,
        tracks: tracksRef.current,
      });
      updateDrag({
        ...active,
        currentX: event.clientX,
        currentY: event.clientY,
        targetClipId,
        ...evaluation,
      });
    };

    const finishPointerDrag = (event: PointerEvent) => {
      const active = dragRef.current;
      if (!active) return;
      const targetClipId = getClipIdAtPoint(event.clientX, event.clientY);
      const evaluation = evaluateMotionParentDrop({
        sourceClipId: active.sourceClipId,
        targetClipId,
        clips: clipsRef.current,
        tracks: tracksRef.current,
      });
      if (evaluation.status === 'valid' && targetClipId) {
        setClipParentRef.current(active.sourceClipId, targetClipId);
      }
      updateDrag(null);
    };

    const cancelPointerDrag = () => updateDrag(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelPointerDrag();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishPointerDrag);
    window.addEventListener('pointercancel', cancelPointerDrag);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointerDrag);
      window.removeEventListener('pointercancel', cancelPointerDrag);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [pickWhipActive, updateDrag]);

  const noop = useCallback(() => {}, []);
  const noopDragStart = useCallback((_id: string, _startX: number, _startY: number) => {}, []);
  void setTrackParent;

  return {
    pickWhipDrag,
    handlePickWhipDragStart,
    handlePickWhipDragEnd,
    trackPickWhipDrag: null,
    handleTrackPickWhipDragStart: noopDragStart,
    handleTrackPickWhipDragEnd: noop,
  };
}
