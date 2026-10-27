// Finger editing of the piano roll (phone editor, M4): one finger edits with the active tool through
// the same press dispatch as the mouse, two fingers pinch-zoom and pan (usePianoRollTouch). A pinch
// that interrupts a finger edit cancels it: the notes go back and the edit's history batch is dropped.

import { useCallback, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { MidiNote } from '../../types/midiClip';
import type { PianoRollDragHistory } from './pianoRollDragHistory';
import { usePianoRollTouch, type PianoRollTouchView, type PinchLimits } from './usePianoRollTouch';
import type { PendingNote, PianoRollDragState, PianoRollMarquee } from './usePianoRollDrag';

interface UsePianoRollTouchEditingOptions {
  clipId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  dragRef: MutableRefObject<PianoRollDragState | null>;
  dragHistoryRef: MutableRefObject<PianoRollDragHistory | null>;
  pendingRef: MutableRefObject<PendingNote | null>;
  pxPerSecRef: MutableRefObject<number>;
  rowHRef: MutableRefObject<number>;
  pendingScrollRef: MutableRefObject<{ left: number | null; top: number | null }>;
  setDragActive: (active: boolean) => void;
  setPendingNote: (note: PendingNote | null) => void;
  setMarquee: (marquee: PianoRollMarquee | null) => void;
  setPxPerSec: (pxPerSec: number) => void;
  setRowH: (rowH: number) => void;
  limits: () => PinchLimits;
}

export function usePianoRollTouchEditing({
  clipId, scrollRef, dragRef, dragHistoryRef, pendingRef, pxPerSecRef, rowHRef, pendingScrollRef,
  setDragActive, setPendingNote, setMarquee, setPxPerSec, setRowH, limits,
}: UsePianoRollTouchEditingOptions) {
  const updateMidiNote = useTimelineStore((state) => state.updateMidiNote);
  // Notes as they were when a finger edit began, so a pinch that interrupts it can put them back.
  const touchSnapshotRef = useRef<readonly MidiNote[]>([]);
  const touchBeginRef = useRef<(e: ReactPointerEvent<HTMLDivElement>) => void>(() => {});
  const cancelTouchEdit = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragActive(false);
    pendingRef.current = null;
    setPendingNote(null);
    setMarquee(null);
    const history = dragHistoryRef.current;
    dragHistoryRef.current = null;
    // Moved notes are put back explicitly; deleted ones (an eraser swipe, including the note under
    // the press) come back when the swipe's history batch is cancelled.
    const touched = drag.kind === 'move' || drag.kind === 'resize' ? [drag.noteId]
      : drag.kind === 'move-group' ? drag.origins.map((origin) => origin.id) : [];
    const restore = () => {
      for (const id of touched) {
        const original = touchSnapshotRef.current.find((note) => note.id === id);
        if (original) {
          updateMidiNote(clipId, id, { start: original.start, pitch: original.pitch, duration: original.duration }, { captureHistory: false });
        }
      }
    };
    if (history) { history.run(restore); history.cancel(); } else restore();
  }, [clipId, updateMidiNote, dragRef, dragHistoryRef, pendingRef, setDragActive, setPendingNote, setMarquee]);
  const applyTouchView = useCallback((view: PianoRollTouchView) => {
    const el = scrollRef.current;
    if (!el) return;
    if (view.pxPerSec === pxPerSecRef.current && view.rowH === rowHRef.current) {
      el.scrollLeft = view.scrollLeft;
      el.scrollTop = view.scrollTop;
      return;
    }
    pxPerSecRef.current = view.pxPerSec;
    rowHRef.current = view.rowH;
    const pending = { left: view.scrollLeft, top: view.scrollTop };
    pendingScrollRef.current = pending;
    setPxPerSec(view.pxPerSec);
    setRowH(view.rowH);
    // Two zoom changes inside one frame can cancel out (React then skips the render and the
    // layout effect that applies the scroll); apply it directly if it is still pending then.
    requestAnimationFrame(() => {
      if (pendingScrollRef.current !== pending) return;
      pendingScrollRef.current = { left: null, top: null };
      el.scrollLeft = pending.left;
      el.scrollTop = pending.top;
    });
  }, [scrollRef, pxPerSecRef, rowHRef, pendingScrollRef, setPxPerSec, setRowH]);
  const touchHandlers = usePianoRollTouch({
    scrollRef,
    readView: useCallback(() => ({ pxPerSec: pxPerSecRef.current, rowH: rowHRef.current }), [pxPerSecRef, rowHRef]),
    limits,
    beginEdit: useCallback((e: ReactPointerEvent<HTMLDivElement>) => touchBeginRef.current(e), []),
    cancelEdit: cancelTouchEdit,
    applyView: applyTouchView,
  });
  return { touchHandlers, touchSnapshotRef, touchBeginRef };
}
