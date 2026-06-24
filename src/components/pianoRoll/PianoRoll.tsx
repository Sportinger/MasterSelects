// Piano-roll editor for a single MIDI clip (issue #182).
//
// Runs inside a detached same-origin popup (see PianoRollBoot) but is a normal
// React component reading the shared Zustand timeline store. Vertical axis is
// pitch (keyboard on the left), horizontal axis is time in seconds across the
// clip. Notes are drawn/moved/resized with free placement (no grid snapping)
// and deleted via right-click. A live cursor mirrors the timeline playhead.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { previewMidiNote } from '../../services/audio/midiPlaybackScheduler';
import type { MidiNote } from '../../types/midiClip';
import { computeGhostNotes } from './ghostNotes';
import { PianoRollScrollbars, PIANO_ROLL_SCROLLBAR } from './PianoRollScrollbars';
import { clipLocalToContentTime, contentTimeToClipLocal, isNoteStartInWindow } from '../../services/midi/midiClipTiming';

// Two independent zoom axes, like Cubase (#249): horizontal = time scale
// (px per second), vertical = note-row height (px per pitch). Both live in
// component state so Ctrl / Ctrl+Shift wheel zoom (and, later, the on-screen
// zoom buttons) can drive them. The DEFAULT_* values are the historical fixed
// scale; MIN/MAX keep the grid usable at the extremes.
const DEFAULT_ROW_H = 16;          // px per pitch row
const MIN_ROW_H = 5;
const MAX_ROW_H = 48;
const DEFAULT_PX_PER_SEC = 120;    // px per second (time scale)
const MIN_PX_PER_SEC = 12;
const MAX_PX_PER_SEC = 1200;
const ZOOM_WHEEL_STEP = 1.15;      // multiplier per wheel notch
const ZOOM_BUTTON_STEP = 1.4;      // multiplier per +/- button click

const KEYBOARD_W = 48;     // px, left keyboard column
const DEFAULT_CLICK_DURATION = 0.5; // seconds, note created by a plain click (no drag)
const PITCH_MIN = 21;      // A0
const PITCH_MAX = 108;     // C8
const PITCH_COUNT = PITCH_MAX - PITCH_MIN + 1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

function isBlackKey(pitch: number): boolean {
  return BLACK_KEYS.has(((pitch % 12) + 12) % 12);
}

function pitchLabel(pitch: number): string {
  const name = NOTE_NAMES[((pitch % 12) + 12) % 12];
  const octave = Math.floor(pitch / 12) - 1;
  return `${name}${octave}`;
}

function pitchToY(pitch: number, rowH: number): number {
  return (PITCH_MAX - pitch) * rowH;
}

function yToPitch(y: number, rowH: number): number {
  return PITCH_MAX - Math.floor(y / rowH);
}

type DragState =
  | { kind: 'create'; noteId: null; pitch: number; startTime: number }
  | { kind: 'move'; noteId: string; grabOffsetTime: number }
  | { kind: 'resize'; noteId: string; startTime: number };

interface PendingNote {
  pitch: number;
  start: number;
  duration: number;
}

interface PianoRollProps {
  clipId: string;
  onRequestClose?: () => void;
}

export function PianoRoll({ clipId, onRequestClose }: PianoRollProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingRef = useRef<PendingNote | null>(null);
  const [pendingNote, setPendingNote] = useState<PendingNote | null>(null);
  // Flipped true whenever a drag (create/move/resize) starts, so the document
  // listener effect re-runs to attach handlers regardless of which drag kind.
  const [dragActive, setDragActive] = useState(false);

  // Two independent zoom axes (#249). Refs mirror the state so the native wheel
  // handler reads fresh values without re-attaching the listener on every zoom.
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  const [rowH, setRowH] = useState(DEFAULT_ROW_H);
  const pxPerSecRef = useRef(pxPerSec);
  const rowHRef = useRef(rowH);
  useEffect(() => { pxPerSecRef.current = pxPerSec; }, [pxPerSec]);
  useEffect(() => { rowHRef.current = rowH; }, [rowH]);
  // After a zoom changes the content size, restore the scroll offset that keeps
  // the point under the cursor stationary. Applied in a layout effect because the
  // grid's new width/height only exist once React has re-rendered.
  const pendingScrollRef = useRef<{ left: number | null; top: number | null }>({ left: null, top: null });

  // Plain selectors (no useShallow): the clip object identity changes whenever
  // its notes change, so this re-renders on every edit; actions are stable refs.
  const clip = useTimelineStore((state) => state.clips.find((c) => c.id === clipId));
  // All clips, so ghost notes from other overlapping MIDI clips can be shown
  // read-only in this clip's editor (#232). Re-renders on any clip edit, which
  // is what we want — ghosts must track the other clips' notes live.
  const allClips = useTimelineStore((state) => state.clips);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const addMidiNote = useTimelineStore((state) => state.addMidiNote);
  const updateMidiNote = useTimelineStore((state) => state.updateMidiNote);
  const removeMidiNote = useTimelineStore((state) => state.removeMidiNote);

  const clipDuration = clip?.duration ?? 0;
  // The piano roll is exactly the clip's real time span — no padding. Clip length
  // rules the editor length (#232); resize the clip on the timeline for more room.
  const contentWidth = clipDuration * pxPerSec;
  const gridH = PITCH_COUNT * rowH;
  const notes = clip?.midiData?.notes ?? [];

  // Read-only ghosts: notes from other MIDI clips that overlap this clip's
  // window, in this clip's local time space (#232). Editing stays in each
  // note's own clip; ghosts are display only.
  const ghostNotes = useMemo(
    () => (clip ? computeGhostNotes(clip, allClips) : []),
    [clip, allClips],
  );

  // Center the view near middle C on first mount so notes land in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, pitchToY(72, rowHRef.current) - el.clientHeight / 2 + rowHRef.current);
  }, []);

  // Restore cursor-anchored scroll after a zoom resizes the grid content.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const pending = pendingScrollRef.current;
    if (!el || (pending.left === null && pending.top === null)) return;
    if (pending.left !== null) el.scrollLeft = Math.max(0, pending.left);
    if (pending.top !== null) el.scrollTop = Math.max(0, pending.top);
    pendingScrollRef.current = { left: null, top: null };
  }, [pxPerSec, rowH]);

  // --- two-axis zoom (#249) ---------------------------------------------------
  // Shared by the Ctrl/Ctrl+Shift wheel gesture and the on-screen +/- buttons.
  // Each keeps the point under its anchor (cursor for wheel, viewport center for
  // buttons) stationary by stashing the corrected scroll offset for the layout
  // effect above to apply once the grid has resized.

  // Time (horizontal) zoom to newPx, anchored on the second under anchorClientX.
  // The first KEYBOARD_W px of the scroll content is the sticky keyboard column.
  const zoomTimeTo = useCallback((newPx: number, anchorClientX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = clamp(newPx, MIN_PX_PER_SEC, MAX_PX_PER_SEC);
    const oldPx = pxPerSecRef.current;
    if (clamped === oldPx) return;
    const rect = el.getBoundingClientRect();
    const cursorX = anchorClientX - rect.left;
    const time = Math.max(0, (cursorX + el.scrollLeft - KEYBOARD_W) / oldPx);
    pendingScrollRef.current = { left: KEYBOARD_W + time * clamped - cursorX, top: null };
    setPxPerSec(clamped);
  }, []);

  // Note-height (vertical) zoom to newRowH, anchored on the pitch under anchorClientY.
  const zoomNotesTo = useCallback((newRowH: number, anchorClientY: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = clamp(newRowH, MIN_ROW_H, MAX_ROW_H);
    const oldRowH = rowHRef.current;
    if (clamped === oldRowH) return;
    const rect = el.getBoundingClientRect();
    const cursorY = anchorClientY - rect.top;
    const frac = (cursorY + el.scrollTop) / oldRowH;
    pendingScrollRef.current = { left: null, top: frac * clamped - cursorY };
    setRowH(clamped);
  }, []);

  // Center-anchored zoom steps for the +/- buttons (dir: +1 in, -1 out).
  const zoomTimeStep = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const factor = dir > 0 ? ZOOM_BUTTON_STEP : 1 / ZOOM_BUTTON_STEP;
    zoomTimeTo(pxPerSecRef.current * factor, el.getBoundingClientRect().left + el.clientWidth / 2);
  }, [zoomTimeTo]);

  const zoomNotesStep = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const factor = dir > 0 ? ZOOM_BUTTON_STEP : 1 / ZOOM_BUTTON_STEP;
    zoomNotesTo(rowHRef.current * factor, el.getBoundingClientRect().top + el.clientHeight / 2);
  }, [zoomNotesTo]);

  // Ctrl+wheel = time zoom; Ctrl+Shift+wheel = note-height zoom, both pointer-
  // anchored. The native, non-passive listener is mandatory: it preventDefaults
  // the gesture so the browser never page-zooms the popup (the app's usePageZoom
  // guard lives in the main window and never runs in this detached document).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const doc = el.ownerDocument;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP;
      if (e.shiftKey) {
        zoomNotesTo(rowHRef.current * factor, e.clientY);
      } else {
        zoomTimeTo(pxPerSecRef.current * factor, e.clientX);
      }
    };

    // Block the browser's Ctrl+wheel zoom over the popup chrome outside the
    // scroll area too (e.g. the header), mirroring usePageZoom's intent.
    const handleDocWheel = (e: WheelEvent) => {
      if ((e.ctrlKey || e.metaKey) && !el.contains(e.target as Node)) e.preventDefault();
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    doc.addEventListener('wheel', handleDocWheel, { passive: false, capture: true });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      doc.removeEventListener('wheel', handleDocWheel, { capture: true } as EventListenerOptions);
    };
  }, [zoomTimeTo, zoomNotesTo]);

  // --- coordinate helpers (relative to the scrollable grid content) ----------
  const localPoint = useCallback((clientX: number, clientY: number) => {
    const el = gridRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  // --- global drag handling ---------------------------------------------------
  useEffect(() => {
    if (!dragActive) return;

    const handleMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const { x, y } = localPoint(e.clientX, e.clientY);
      // Map the cursor's screen offset to CONTENT time through the clip window
      // (#232), so note times stay anchored to the content, not the window edge.
      const liveInPoint = useTimelineStore.getState().clips.find((c) => c.id === clipId)?.inPoint ?? 0;
      const time = Math.max(0, clipLocalToContentTime({ inPoint: liveInPoint }, x / pxPerSecRef.current));

      if (drag.kind === 'create') {
        const next = { pitch: drag.pitch, start: drag.startTime, duration: Math.max(0.02, time - drag.startTime) };
        pendingRef.current = next;
        setPendingNote(next);
        return;
      }
      if (drag.kind === 'move') {
        const newStart = Math.max(0, time - drag.grabOffsetTime);
        const newPitch = yToPitch(y, rowHRef.current);
        updateMidiNote(clipId, drag.noteId, { start: newStart, pitch: newPitch }, { captureHistory: false });
        return;
      }
      if (drag.kind === 'resize') {
        const duration = Math.max(0.02, time - drag.startTime);
        updateMidiNote(clipId, drag.noteId, { duration }, { captureHistory: false });
      }
    };

    const handleUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragActive(false);
      if (drag?.kind === 'create') {
        const pending = pendingRef.current ?? { pitch: drag.pitch, start: drag.startTime, duration: DEFAULT_CLICK_DURATION };
        // A near-zero drag is a plain click → give it a usable default length.
        const duration = pending.duration <= 0.05 ? DEFAULT_CLICK_DURATION : pending.duration;
        addMidiNote(clipId, { ...pending, duration });
        pendingRef.current = null;
        setPendingNote(null);
      } else if (drag && (drag.kind === 'move' || drag.kind === 'resize')) {
        // Commit a single history snapshot for the whole drag.
        const note = useTimelineStore.getState().clips.find((c) => c.id === clipId)?.midiData?.notes
          .find((n) => n.id === drag.noteId);
        if (note) {
          updateMidiNote(clipId, drag.noteId, { start: note.start }, { captureHistory: true });
        }
      }
    };

    // CRITICAL: this component runs in the opener's JS realm but is mounted in a
    // popup window, so the global `document` is the MAIN window's document. Mouse
    // events happen in the popup, so listen on the grid's ownerDocument (the
    // popup's document) — otherwise mouseup never fires and notes never commit.
    const doc = gridRef.current?.ownerDocument ?? document;
    doc.addEventListener('mousemove', handleMove);
    doc.addEventListener('mouseup', handleUp);
    return () => {
      doc.removeEventListener('mousemove', handleMove);
      doc.removeEventListener('mouseup', handleUp);
    };
  }, [dragActive, clipId, addMidiNote, updateMidiNote, localPoint]);

  if (!clip || clip.source?.type !== 'midi') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#888' }}>
        This MIDI clip is no longer available.
      </div>
    );
  }

  const startCreate = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const { x, y } = localPoint(e.clientX, e.clientY);
    const pitch = yToPitch(y, rowH);
    const startTime = Math.max(0, clipLocalToContentTime(clip, x / pxPerSec));
    // Audible feedback for the note being drawn (issue #182, Phase 4) — routed
    // through the track's synth bus so preview respects its volume/pan.
    const track = useTimelineStore.getState().tracks.find((t) => t.id === clip?.trackId);
    previewMidiNote(track?.midiInstrument, pitch, 0.85, clip?.trackId);
    dragRef.current = { kind: 'create', noteId: null, pitch, startTime };
    pendingRef.current = { pitch, start: startTime, duration: 0.02 };
    setPendingNote(pendingRef.current);
    setDragActive(true);
    e.preventDefault();
  };

  const startMove = (e: React.MouseEvent, note: MidiNote) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Audible feedback for the clicked note (issue #182, Phase 4) — routed
    // through the track's synth bus so preview respects its volume/pan.
    const track = useTimelineStore.getState().tracks.find((t) => t.id === clip?.trackId);
    previewMidiNote(track?.midiInstrument, note.pitch, note.velocity, clip?.trackId);
    const { x } = localPoint(e.clientX, e.clientY);
    const grabTime = clipLocalToContentTime(clip, x / pxPerSec);
    dragRef.current = { kind: 'move', noteId: note.id, grabOffsetTime: grabTime - note.start };
    setDragActive(true);
    e.preventDefault();
  };

  const startResize = (e: React.MouseEvent, note: MidiNote) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = { kind: 'resize', noteId: note.id, startTime: note.start };
    setDragActive(true);
    e.preventDefault();
  };

  const deleteNote = (e: React.MouseEvent, note: MidiNote) => {
    e.preventDefault();
    e.stopPropagation();
    removeMidiNote(clipId, note.id);
  };

  const clipLocalPlayhead = playheadPosition - clip.startTime;
  const showPlayhead = clipLocalPlayhead >= 0 && clipLocalPlayhead <= clipDuration;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f0f0f' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px',
        background: '#161616', borderBottom: '1px solid #2a2a2a', flexShrink: 0,
      }}>
        <strong style={{ fontSize: 13, color: '#e0e0e0' }}>{clip.name || 'MIDI Clip'}</strong>
        <span style={{ fontSize: 11, color: '#777' }}>{notes.length} notes · {clipDuration.toFixed(2)}s</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#666' }}>Drag to draw · drag note to move · right edge to resize · right-click to delete</span>
        {onRequestClose && (
          <button
            onClick={onRequestClose}
            style={{ background: '#333', color: '#ccc', border: '1px solid #444', borderRadius: 3, padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}
          >
            Close
          </button>
        )}
      </div>

      {/* Body: relative container holding the scroll viewport + our own bars
          (#249). The viewport keeps the native scroll engine (overflow:auto) but
          its native bars are hidden — see the <style> below and scrollbarWidth —
          and is inset to leave room for the custom bars along the bottom/right. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <style>{'.pr-grid-scroll::-webkit-scrollbar{display:none}'}</style>
        <div
          ref={scrollRef}
          className="pr-grid-scroll"
          style={{
            position: 'absolute', top: 0, left: 0,
            right: PIANO_ROLL_SCROLLBAR, bottom: PIANO_ROLL_SCROLLBAR,
            display: 'flex', overflow: 'auto', scrollbarWidth: 'none',
          }}
        >
        {/* Keyboard column (sticky left) */}
        <div style={{ width: KEYBOARD_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: '#0a0a0a' }}>
          {Array.from({ length: PITCH_COUNT }, (_, i) => {
            const pitch = PITCH_MAX - i;
            const black = isBlackKey(pitch);
            return (
              <div
                key={pitch}
                style={{
                  height: rowH,
                  boxSizing: 'border-box',
                  borderBottom: '1px solid #1c1c1c',
                  background: black ? '#1a1a1a' : '#2b2b2b',
                  color: black ? '#777' : '#bbb',
                  fontSize: 8,
                  lineHeight: `${rowH}px`,
                  textAlign: 'right',
                  paddingRight: 4,
                  userSelect: 'none',
                }}
              >
                {pitch % 12 === 0 ? pitchLabel(pitch) : ''}
              </div>
            );
          })}
        </div>

        {/* Grid */}
        <div
          ref={gridRef}
          onMouseDown={startCreate}
          style={{ position: 'relative', width: contentWidth, height: gridH, flexShrink: 0, cursor: 'crosshair' }}
        >
          {/* Row backgrounds */}
          {Array.from({ length: PITCH_COUNT }, (_, i) => {
            const pitch = PITCH_MAX - i;
            return (
              <div
                key={pitch}
                style={{
                  position: 'absolute', top: i * rowH, left: 0, width: '100%', height: rowH,
                  background: isBlackKey(pitch) ? '#141414' : '#181818',
                  borderBottom: '1px solid #1d1d1d',
                  boxSizing: 'border-box',
                }}
              />
            );
          })}

          {/* Second grid lines */}
          {Array.from({ length: Math.ceil(contentWidth / pxPerSec) + 1 }, (_, s) => (
            <div
              key={`s${s}`}
              style={{ position: 'absolute', top: 0, left: s * pxPerSec, width: 1, height: gridH, background: 'rgba(255,255,255,0.07)' }}
            />
          ))}

          {/* Ghost notes from other overlapping MIDI clips — read-only (#232).
              Drawn before the real notes so editable notes always sit on top. */}
          {ghostNotes.map((ghost) => (
            <div
              key={`ghost-${ghost.key}`}
              title={`${pitchLabel(ghost.pitch)} · (other clip)`}
              style={{
                position: 'absolute',
                left: ghost.start * pxPerSec,
                top: pitchToY(ghost.pitch, rowH),
                width: Math.max(2, ghost.duration * pxPerSec),
                height: rowH - 1,
                background: 'rgba(150,150,150,0.18)',
                border: '1px solid rgba(170,170,170,0.35)',
                borderRadius: 2,
                boxSizing: 'border-box',
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Notes — only those whose start is inside the clip window are shown
              and editable; notes outside it are preserved but hidden (#232). */}
          {notes.filter((note) => isNoteStartInWindow(clip, note)).map((note) => {
            const left = contentTimeToClipLocal(clip, note.start) * pxPerSec;
            const width = Math.max(2, note.duration * pxPerSec);
            const top = pitchToY(note.pitch, rowH);
            return (
              <div
                key={note.id}
                onMouseDown={(e) => startMove(e, note)}
                onContextMenu={(e) => deleteNote(e, note)}
                title={`${pitchLabel(note.pitch)} · ${note.duration.toFixed(2)}s`}
                style={{
                  position: 'absolute', left, top, width, height: rowH - 1,
                  background: `rgba(120,170,255,${0.45 + note.velocity * 0.5})`,
                  border: '1px solid rgba(180,210,255,0.9)',
                  borderRadius: 2, boxSizing: 'border-box', cursor: 'grab',
                }}
              >
                <div
                  onMouseDown={(e) => startResize(e, note)}
                  style={{ position: 'absolute', right: 0, top: 0, width: 6, height: '100%', cursor: 'ew-resize' }}
                />
              </div>
            );
          })}

          {/* Pending (in-progress draw) note */}
          {pendingNote && (
            <div
              style={{
                position: 'absolute', left: contentTimeToClipLocal(clip, pendingNote.start) * pxPerSec, top: pitchToY(pendingNote.pitch, rowH),
                width: Math.max(2, pendingNote.duration * pxPerSec), height: rowH - 1,
                background: 'rgba(120,170,255,0.5)', border: '1px solid rgba(180,210,255,0.9)',
                borderRadius: 2, boxSizing: 'border-box', pointerEvents: 'none',
              }}
            />
          )}

          {/* Live playhead cursor */}
          {showPlayhead && (
            <div style={{ position: 'absolute', top: 0, left: clipLocalPlayhead * pxPerSec, width: 2, height: gridH, background: '#ff5252', pointerEvents: 'none' }} />
          )}
        </div>
        </div>

        <PianoRollScrollbars
          scrollRef={scrollRef}
          contentWidth={KEYBOARD_W + contentWidth}
          contentHeight={gridH}
          onZoomTime={zoomTimeStep}
          onZoomNotes={zoomNotesStep}
        />
      </div>
    </div>
  );
}
