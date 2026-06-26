// Velocity controller lane (#249). Renders one bottom-anchored bar per note,
// height ∝ velocity, colored by the shared velocity→color ramp. Dragging a bar
// edits velocity live (one undo per gesture); if the dragged note is in the
// current selection every selected note shifts by the SAME delta (each clamped
// to [0,1] individually at the rails — standard Cubase behavior), otherwise only
// the dragged note moves.
//
// Velocity is a per-note property, so this lane reuses the existing
// `updateMidiNote(..., { captureHistory })` store action exactly like the note
// move/resize drags — no new data model or synth work (see the plan).

import { useRef } from 'react';
import type { MidiNote } from '../../../types/midiClip';
import { contentTimeToClipLocal, type MidiClipWindow } from '../../../services/midi/midiClipTiming';
import { clamp01, vel01ToMidi, velocityToColor } from './pianoRollLaneTypes';

// updateMidiNote's exact shape (storeTypes/clipActionTypes.ts) — kept local so
// the lane doesn't reach into the store's type surface.
type UpdateMidiNote = (
  clipId: string,
  noteId: string,
  patch: Partial<Pick<MidiNote, 'pitch' | 'start' | 'duration' | 'velocity'>>,
  options?: { captureHistory?: boolean },
) => void;

// A thin stalk at each note's start (not the note's full width): adjacent notes
// stay individually grabbable, like Cubase's velocity lane.
const VELOCITY_BAR_W = 7;
const MIN_BAR_H = 2;          // so a near-zero-velocity note still shows a sliver
const OUT_OF_WINDOW_OPACITY = 0.32; // mirror the grid's out-of-window dimming

interface PianoRollVelocityLaneProps {
  clipId: string;
  /** Editable notes whose start is inside the clip window. */
  inWindowNotes: MidiNote[];
  /** Trimmed-off notes just outside the window — drawn dimmed, non-interactive. */
  outOfWindowNotes: MidiNote[];
  /** The effective clip window (live clip, or the in-progress resize preview). */
  effWindow: MidiClipWindow;
  pxPerSec: number;
  /** Left margin in px (grid pixel 0 = the left "outside" margin edge). */
  marginPx: number;
  /** Drawable lane height: a full-height drag = a full 0→1 velocity swing. */
  laneInnerH: number;
  selectedIds: ReadonlySet<string>;
  updateMidiNote: UpdateMidiNote;
  /** Live numeric (0–127) readout while dragging; null clears it. */
  onReadoutChange?: (midi: number | null) => void;
}

export function PianoRollVelocityLane({
  clipId,
  inWindowNotes,
  outOfWindowNotes,
  effWindow,
  pxPerSec,
  marginPx,
  laneInnerH,
  selectedIds,
  updateMidiNote,
  onReadoutChange,
}: PianoRollVelocityLaneProps) {
  const laneRef = useRef<HTMLDivElement | null>(null);

  const barLeft = (note: MidiNote) =>
    marginPx + contentTimeToClipLocal(effWindow, note.start) * pxPerSec;
  const barHeight = (velocity: number) =>
    Math.max(MIN_BAR_H, clamp01(velocity) * laneInnerH);

  const onBarMouseDown = (e: React.MouseEvent, note: MidiNote) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const draggedStart = note.velocity;
    // Target set: the whole selection if the dragged note is part of it, else
    // just this note. Snapshot each target's starting velocity so the delta
    // applies from a fixed base (differences preserved until a rail is hit).
    const targets = selectedIds.has(note.id)
      ? inWindowNotes.filter((n) => selectedIds.has(n.id))
      : [note];
    const origins = targets.map((n) => ({ id: n.id, startVel: n.velocity }));
    const innerH = Math.max(1, laneInnerH);
    const doc = laneRef.current?.ownerDocument ?? document;
    let didMove = false;
    onReadoutChange?.(vel01ToMidi(draggedStart));

    const onMove = (ev: MouseEvent) => {
      didMove = true;
      const delta = (startY - ev.clientY) / innerH;
      for (const o of origins) {
        updateMidiNote(clipId, o.id, { velocity: clamp01(o.startVel + delta) }, { captureHistory: false });
      }
      onReadoutChange?.(vel01ToMidi(clamp01(draggedStart + delta)));
    };

    const onUp = (ev: MouseEvent) => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      onReadoutChange?.(null);
      if (!didMove) return; // a plain click never lands a no-op in history
      const delta = (startY - ev.clientY) / innerH;
      // One committing snapshot for the whole gesture (live drags were silent);
      // the snapshot captures every target's final velocity.
      updateMidiNote(clipId, note.id, { velocity: clamp01(draggedStart + delta) });
    };

    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
  };

  return (
    <div ref={laneRef} style={{ position: 'absolute', inset: 0 }}>
      {/* Out-of-window bars: dimmed context, non-interactive (drawn first). */}
      {outOfWindowNotes.map((note) => (
        <div
          key={`oow-${note.id}`}
          style={{
            position: 'absolute',
            left: barLeft(note),
            bottom: 0,
            width: VELOCITY_BAR_W,
            height: barHeight(note.velocity),
            background: velocityToColor(note.velocity),
            opacity: OUT_OF_WINDOW_OPACITY,
            borderRadius: '2px 2px 0 0',
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Editable bars. Color tracks velocity (shared ramp), the amber outline
          marks the current selection (the bars that move together on drag). */}
      {inWindowNotes.map((note) => {
        const selected = selectedIds.has(note.id);
        return (
          <div
            key={note.id}
            onMouseDown={(e) => onBarMouseDown(e, note)}
            title={`Velocity ${vel01ToMidi(note.velocity)}`}
            style={{
              position: 'absolute',
              left: barLeft(note),
              bottom: 0,
              width: VELOCITY_BAR_W,
              height: barHeight(note.velocity),
              background: velocityToColor(note.velocity),
              border: selected ? '1px solid #ffd54a' : '1px solid rgba(0,0,0,0.35)',
              boxSizing: 'border-box',
              borderRadius: '2px 2px 0 0',
              cursor: 'ns-resize',
            }}
          />
        );
      })}
    </div>
  );
}
