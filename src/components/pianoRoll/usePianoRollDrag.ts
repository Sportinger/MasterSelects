// Document-level drag handling of the piano roll: note create, move, resize, group move, eraser
// swipe and marquee select, for mouse and (phone editor) touch pointers alike. Every store change
// of a drag runs in one history batch, so a drag is one undo step (pianoRollDragHistory.ts).

import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { MidiNote } from '../../types/midiClip';
import { clipLocalToContentTime, contentTimeToClipLocal, isNoteStartInWindow } from '../../services/midi/midiClipTiming';
import { gridStepSeconds, shouldSnap, snapNoteDuration, type PianoRollSnapContext } from './pianoRollSnap';
import { beginPianoRollDragHistory, type PianoRollDragHistory } from './pianoRollDragHistory';
import { clamp, PITCH_MAX, PITCH_MIN, pitchToY, yToPitch } from './pianoRollGeometry';

// A plain click (no drag) makes a SHORT note; drag-and-release sizes longer
// notes by the drag distance (#249). Kept visible/grabbable at default zoom
// (0.1s ≈ 12px at 120 px/s).
export const CLICK_NOTE_DURATION = 0.1; // seconds, note created by a plain click (no drag)
const DRAG_HISTORY_LABEL = 'Edit MIDI notes';

export type PianoRollDragState =
  | { kind: 'create'; noteId: null; pitch: number; startTime: number }
  | { kind: 'move'; noteId: string; grabOffsetTime: number }
  | { kind: 'resize'; noteId: string; startTime: number }
  // Eraser swipe: delete any note the cursor passes over (#249 tool palette).
  | { kind: 'erase' }
  // Marquee select: rubber-band rectangle in grid-content pixels.
  | { kind: 'marquee'; startX: number; startY: number }
  // Group move: drag all selected notes together. `origins` snapshots each
  // selected note's start/pitch at grab time so deltas apply from a fixed base.
  | { kind: 'move-group'; anchorId: string; grabOffsetTime: number; origins: { id: string; start: number; pitch: number }[] };

export interface PendingNote {
  pitch: number;
  start: number;
  duration: number;
}

export interface PianoRollMarquee { x: number; y: number; w: number; h: number }

/** Runs a drag change in the drag's history batch, opening the batch on the drag's first change. */
export function runInDragHistory(historyRef: MutableRefObject<PianoRollDragHistory | null>, action: () => void): void {
  historyRef.current ??= beginPianoRollDragHistory(DRAG_HISTORY_LABEL);
  historyRef.current.run(action);
}

interface UsePianoRollDragOptions {
  clipId: string;
  dragActive: boolean;
  setDragActive: (active: boolean) => void;
  dragRef: MutableRefObject<PianoRollDragState | null>;
  dragHistoryRef: MutableRefObject<PianoRollDragHistory | null>;
  pendingRef: MutableRefObject<PendingNote | null>;
  setPendingNote: (note: PendingNote | null) => void;
  setMarquee: (marquee: PianoRollMarquee | null) => void;
  setSelectedIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  gridRef: RefObject<HTMLDivElement | null>;
  pxPerSecRef: MutableRefObject<number>;
  rowHRef: MutableRefObject<number>;
  snapRef: MutableRefObject<{ enabled: boolean; context: PianoRollSnapContext }>;
  localPoint: (clientX: number, clientY: number) => { x: number; y: number };
  noteAtPx: (x: number, y: number) => MidiNote | null;
  snapTime: (contentTime: number, event: Pick<MouseEvent, 'altKey' | 'shiftKey'>) => number;
}

export function usePianoRollDrag({
  clipId, dragActive, setDragActive, dragRef, dragHistoryRef, pendingRef, setPendingNote, setMarquee,
  setSelectedIds, gridRef, pxPerSecRef, rowHRef, snapRef, localPoint, noteAtPx, snapTime,
}: UsePianoRollDragOptions): void {
  const addMidiNote = useTimelineStore((state) => state.addMidiNote);
  const updateMidiNote = useTimelineStore((state) => state.updateMidiNote);
  const removeMidiNote = useTimelineStore((state) => state.removeMidiNote);

  // A drag cut short by unmounting (editor closed mid-gesture) still ends its undo step,
  // otherwise the open batch would block Undo.
  useEffect(() => () => {
    dragHistoryRef.current?.commit();
    dragHistoryRef.current = null;
  }, [dragHistoryRef]);

  useEffect(() => {
    if (!dragActive) return;

    if (!dragActive) return;

    // Every store change of a drag runs in the drag's history batch, opened on its first change.
    const inDrag = (action: () => void) => runInDragHistory(dragHistoryRef, action);
    const handleMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const { x, y } = localPoint(e.clientX, e.clientY);
      // Map the cursor's screen offset to CONTENT time through the clip window
      // (#232), so note times stay anchored to the content, not the window edge.
      const liveInPoint = useTimelineStore.getState().clips.find((c) => c.id === clipId)?.inPoint ?? 0;
      // Floor at the window's left edge (inPoint), NOT 0: after a left-extend the
      // clip's inPoint is negative (empty space before content origin 0), so that
      // region is valid content time. Clamping to 0 snapped clicks back to the old
      // origin; clamping to inPoint keeps notes inside the visible window (#249).
      const time = Math.max(liveInPoint, clipLocalToContentTime({ inPoint: liveInPoint }, x / pxPerSecRef.current));

      // Snapping quantizes the note EDGE the pointer controls: the start for a
      // move, the end for a create/resize. `snapNoteDuration` floors a snapped
      // length at one grid unit so a 2 px twitch cannot make a sliver note.
      const snapping = shouldSnap(snapRef.current.enabled, e);
      if (drag.kind === 'create') {
        const duration = snapping
          ? snapNoteDuration(snapRef.current.context, drag.startTime, time, 0.02)
          : Math.max(0.02, time - drag.startTime);
        const next = { pitch: drag.pitch, start: drag.startTime, duration };
        pendingRef.current = next;
        setPendingNote(next);
        return;
      }
      if (drag.kind === 'move') {
        const newStart = Math.max(liveInPoint, snapTime(time - drag.grabOffsetTime, e));
        const newPitch = yToPitch(y, rowHRef.current);
        inDrag(() => updateMidiNote(clipId, drag.noteId, { start: newStart, pitch: newPitch }, { captureHistory: false }));
        return;
      }
      if (drag.kind === 'resize') {
        const duration = snapping
          ? snapNoteDuration(snapRef.current.context, drag.startTime, time, 0.02)
          : Math.max(0.02, time - drag.startTime);
        inDrag(() => updateMidiNote(clipId, drag.noteId, { duration }, { captureHistory: false }));
        return;
      }
      if (drag.kind === 'erase') {
        const hit = noteAtPx(x, y);
        if (hit) inDrag(() => removeMidiNote(clipId, hit.id));
        return;
      }
      if (drag.kind === 'move-group') {
        const anchor = drag.origins.find((o) => o.id === drag.anchorId);
        if (!anchor) return;
        // Only the anchor snaps; every other note keeps its offset from it, so a
        // group move quantizes without collapsing the phrase onto the grid.
        const newAnchorStart = Math.max(liveInPoint, snapTime(time - drag.grabOffsetTime, e));
        const deltaTime = newAnchorStart - anchor.start;
        const deltaPitch = yToPitch(y, rowHRef.current) - anchor.pitch;
        inDrag(() => {
          for (const o of drag.origins) {
            updateMidiNote(clipId, o.id, {
              start: Math.max(liveInPoint, o.start + deltaTime),
              pitch: clamp(o.pitch + deltaPitch, PITCH_MIN, PITCH_MAX),
            }, { captureHistory: false });
          }
        });
        return;
      }
      if (drag.kind === 'marquee') {
        const rx = Math.min(drag.startX, x);
        const ry = Math.min(drag.startY, y);
        const rw = Math.abs(x - drag.startX);
        const rh = Math.abs(y - drag.startY);
        setMarquee({ x: rx, y: ry, w: rw, h: rh });
        const liveClip = useTimelineStore.getState().clips.find((c) => c.id === clipId);
        const liveNotes = liveClip?.midiData?.notes ?? [];
        const ppx = pxPerSecRef.current;
        const rowPx = rowHRef.current;
        const next = new Set<string>();
        for (const n of liveNotes) {
          if (!liveClip || !isNoteStartInWindow(liveClip, n)) continue;
          const left = contentTimeToClipLocal(liveClip, n.start) * ppx;
          const width = Math.max(2, n.duration * ppx);
          const top = pitchToY(n.pitch, rowPx);
          // Axis-aligned rectangle overlap.
          if (left <= rx + rw && left + width >= rx && top <= ry + rh && top + rowPx >= ry) next.add(n.id);
        }
        setSelectedIds(next);
      }
    };

    const handleUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragActive(false);
      const history = dragHistoryRef.current;
      dragHistoryRef.current = null;
      try {
        handleDragEnd(drag, history);
      } finally {
        history?.commit();
      }
    };
    const handleDragEnd = (drag: PianoRollDragState | null, history: PianoRollDragHistory | null) => {
      const inHistory = (action: () => void) => (history ? history.run(action) : action());
      if (drag?.kind === 'create') {
        const pending = pendingRef.current ?? { pitch: drag.pitch, start: drag.startTime, duration: CLICK_NOTE_DURATION };
        // A near-zero drag is a plain click → one grid unit when snapping (so a
        // clicked note lands on the grid at both ends), else a short fixed note.
        // An actual drag keeps its dragged length.
        const { enabled, context } = snapRef.current;
        const clickDuration = (enabled ? gridStepSeconds(context, pending.start) : null) ?? CLICK_NOTE_DURATION;
        const duration = pending.duration <= 0.05 ? clickDuration : pending.duration;
        addMidiNote(clipId, { ...pending, duration });
        pendingRef.current = null;
        setPendingNote(null);
      } else if (drag && (drag.kind === 'move' || drag.kind === 'resize')) {
        // Commit a single history snapshot for the whole drag.
        const note = useTimelineStore.getState().clips.find((c) => c.id === clipId)?.midiData?.notes
          .find((n) => n.id === drag.noteId);
        if (note) {
          inHistory(() => updateMidiNote(clipId, drag.noteId, { start: note.start }, { captureHistory: true }));
        }
      } else if (drag?.kind === 'move-group') {
        // One history snapshot for the whole group move (live drag was silent).
        const note = useTimelineStore.getState().clips.find((c) => c.id === clipId)?.midiData?.notes
          .find((n) => n.id === drag.anchorId);
        if (note) {
          inHistory(() => updateMidiNote(clipId, drag.anchorId, { start: note.start }, { captureHistory: true }));
        }
      } else if (drag?.kind === 'marquee') {
        setMarquee(null);
      }
    };

    // CRITICAL: this component runs in the opener's JS realm but is mounted in a
    // popup window, so the global `document` is the MAIN window's document. Mouse
    // events happen in the popup, so listen on the grid's ownerDocument (the
    // popup's document) — otherwise mouseup never fires and notes never commit.
    const doc = gridRef.current?.ownerDocument ?? document;
    // A finger drag (phone editor) arrives as touch pointer events only; mouse and pen keep the
    // mouse events above.
    const handleTouchMove = (e: PointerEvent) => { if (e.pointerType === 'touch') handleMove(e); };
    const handleTouchUp = (e: PointerEvent) => { if (e.pointerType === 'touch') handleUp(); };
    doc.addEventListener('mousemove', handleMove);
    doc.addEventListener('mouseup', handleUp);
    doc.addEventListener('pointermove', handleTouchMove);
    doc.addEventListener('pointerup', handleTouchUp);
    doc.addEventListener('pointercancel', handleTouchUp);
    return () => {
      doc.removeEventListener('mousemove', handleMove);
      doc.removeEventListener('mouseup', handleUp);
      doc.removeEventListener('pointermove', handleTouchMove);
      doc.removeEventListener('pointerup', handleTouchUp);
      doc.removeEventListener('pointercancel', handleTouchUp);
    };
  }, [dragActive, clipId, addMidiNote, updateMidiNote, removeMidiNote, localPoint, noteAtPx, snapTime,
    setDragActive, dragRef, dragHistoryRef, pendingRef, setPendingNote, setMarquee, setSelectedIds,
    gridRef, pxPerSecRef, rowHRef, snapRef]);
}
