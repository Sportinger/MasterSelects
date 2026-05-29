// Piano-roll editor for a single MIDI clip (issue #182).
//
// Runs inside a detached same-origin popup (see PianoRollBoot) but is a normal
// React component reading the shared Zustand timeline store. Vertical axis is
// pitch (keyboard on the left), horizontal axis is time in seconds across the
// clip. Notes are drawn/moved/resized with free placement (no grid snapping)
// and deleted via right-click. A live cursor mirrors the timeline playhead.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { MidiNote } from '../../types/midiClip';

const ROW_H = 16;          // px per pitch row
const PX_PER_SEC = 120;    // horizontal zoom
const KEYBOARD_W = 48;     // px, left keyboard column
const DEFAULT_CLICK_DURATION = 0.5; // seconds, note created by a plain click (no drag)
const PITCH_MIN = 21;      // A0
const PITCH_MAX = 108;     // C8
const PITCH_COUNT = PITCH_MAX - PITCH_MIN + 1;
const GRID_H = PITCH_COUNT * ROW_H;

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

function pitchToY(pitch: number): number {
  return (PITCH_MAX - pitch) * ROW_H;
}

function yToPitch(y: number): number {
  return PITCH_MAX - Math.floor(y / ROW_H);
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

  // Plain selectors (no useShallow): the clip object identity changes whenever
  // its notes change, so this re-renders on every edit; actions are stable refs.
  const clip = useTimelineStore((state) => state.clips.find((c) => c.id === clipId));
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const addMidiNote = useTimelineStore((state) => state.addMidiNote);
  const updateMidiNote = useTimelineStore((state) => state.updateMidiNote);
  const removeMidiNote = useTimelineStore((state) => state.removeMidiNote);

  const clipDuration = clip?.duration ?? 0;
  const contentWidth = Math.max(clipDuration, 4) * PX_PER_SEC;
  const notes = clip?.midiData?.notes ?? [];

  // Center the view near middle C on first mount so notes land in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, pitchToY(72) - el.clientHeight / 2 + ROW_H);
  }, []);

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
      const time = Math.max(0, x / PX_PER_SEC);

      if (drag.kind === 'create') {
        const next = { pitch: drag.pitch, start: drag.startTime, duration: Math.max(0.02, time - drag.startTime) };
        pendingRef.current = next;
        setPendingNote(next);
        return;
      }
      if (drag.kind === 'move') {
        const newStart = Math.max(0, time - drag.grabOffsetTime);
        const newPitch = yToPitch(y);
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
    const pitch = yToPitch(y);
    const startTime = Math.max(0, x / PX_PER_SEC);
    dragRef.current = { kind: 'create', noteId: null, pitch, startTime };
    pendingRef.current = { pitch, start: startTime, duration: 0.02 };
    setPendingNote(pendingRef.current);
    setDragActive(true);
    e.preventDefault();
  };

  const startMove = (e: React.MouseEvent, note: MidiNote) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { x } = localPoint(e.clientX, e.clientY);
    const grabTime = x / PX_PER_SEC;
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

      {/* Body: keyboard + scrollable grid */}
      <div ref={scrollRef} style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'auto' }}>
        {/* Keyboard column (sticky left) */}
        <div style={{ width: KEYBOARD_W, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2, background: '#0a0a0a' }}>
          {Array.from({ length: PITCH_COUNT }, (_, i) => {
            const pitch = PITCH_MAX - i;
            const black = isBlackKey(pitch);
            return (
              <div
                key={pitch}
                style={{
                  height: ROW_H,
                  boxSizing: 'border-box',
                  borderBottom: '1px solid #1c1c1c',
                  background: black ? '#1a1a1a' : '#2b2b2b',
                  color: black ? '#777' : '#bbb',
                  fontSize: 8,
                  lineHeight: `${ROW_H}px`,
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
          style={{ position: 'relative', width: contentWidth, height: GRID_H, flexShrink: 0, cursor: 'crosshair' }}
        >
          {/* Row backgrounds */}
          {Array.from({ length: PITCH_COUNT }, (_, i) => {
            const pitch = PITCH_MAX - i;
            return (
              <div
                key={pitch}
                style={{
                  position: 'absolute', top: i * ROW_H, left: 0, width: '100%', height: ROW_H,
                  background: isBlackKey(pitch) ? '#141414' : '#181818',
                  borderBottom: '1px solid #1d1d1d',
                  boxSizing: 'border-box',
                }}
              />
            );
          })}

          {/* Second grid lines */}
          {Array.from({ length: Math.ceil(contentWidth / PX_PER_SEC) + 1 }, (_, s) => (
            <div
              key={`s${s}`}
              style={{ position: 'absolute', top: 0, left: s * PX_PER_SEC, width: 1, height: GRID_H, background: 'rgba(255,255,255,0.07)' }}
            />
          ))}

          {/* Notes */}
          {notes.map((note) => {
            const left = note.start * PX_PER_SEC;
            const width = Math.max(2, note.duration * PX_PER_SEC);
            const top = pitchToY(note.pitch);
            return (
              <div
                key={note.id}
                onMouseDown={(e) => startMove(e, note)}
                onContextMenu={(e) => deleteNote(e, note)}
                title={`${pitchLabel(note.pitch)} · ${note.duration.toFixed(2)}s`}
                style={{
                  position: 'absolute', left, top, width, height: ROW_H - 1,
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
                position: 'absolute', left: pendingNote.start * PX_PER_SEC, top: pitchToY(pendingNote.pitch),
                width: Math.max(2, pendingNote.duration * PX_PER_SEC), height: ROW_H - 1,
                background: 'rgba(120,170,255,0.5)', border: '1px solid rgba(180,210,255,0.9)',
                borderRadius: 2, boxSizing: 'border-box', pointerEvents: 'none',
              }}
            />
          )}

          {/* Live playhead cursor */}
          {showPlayhead && (
            <div style={{ position: 'absolute', top: 0, left: clipLocalPlayhead * PX_PER_SEC, width: 2, height: GRID_H, background: '#ff5252', pointerEvents: 'none' }} />
          )}
        </div>
      </div>
    </div>
  );
}
