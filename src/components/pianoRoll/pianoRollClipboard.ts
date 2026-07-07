// Piano-roll note clipboard + paste/duplicate geometry (#249).
//
// The clipboard is a plain module-level array, deliberately NOT in a store and
// NOT persisted — copy/paste is a transient editing convenience, mirroring the
// media store's in-memory `mediaClipboardIds`. Every piano-roll popup shares the
// opener's JS heap (see PianoRollBoot), so this single array is the shared
// clipboard across all open editors: copy in one clip, paste into another.
//
// Entries hold note DATA only (no id) — ids are minted fresh on paste so a
// pasted/duplicated note is a new, independent note. `start`/`duration` stay in
// the clip's CONTENT-time space (see midiClipTiming), so positioning math below
// is pure content-time arithmetic.

import type { MidiNote } from '../../types/midiClip';

/** A clipboard note: the editable fields of a MidiNote, minus its identity. */
export type ClipboardNote = Pick<MidiNote, 'pitch' | 'start' | 'duration' | 'velocity'>;

let clipboard: ClipboardNote[] = [];

/** Replace the clipboard with a snapshot of the given notes (copy/cut). */
export function setPianoRollClipboard(notes: readonly MidiNote[]): void {
  clipboard = notes.map((n) => ({ pitch: n.pitch, start: n.start, duration: n.duration, velocity: n.velocity }));
}

/** Whether anything is available to paste. */
export function hasPianoRollClipboard(): boolean {
  return clipboard.length > 0;
}

/**
 * Notes to paste so the EARLIEST clipboard note lands at `anchorContentTime`,
 * with every other note keeping its relative offset (Cubase-style paste-at-
 * playhead). Returns content-time note data ready for `addMidiNotes`; empty when
 * the clipboard is empty.
 */
export function pasteNotesAt(anchorContentTime: number): ClipboardNote[] {
  if (clipboard.length === 0) return [];
  const earliest = Math.min(...clipboard.map((n) => n.start));
  const offset = anchorContentTime - earliest;
  return clipboard.map((n) => ({ ...n, start: n.start + offset }));
}

/**
 * Notes to duplicate `notes` to the right by their own span (latest end −
 * earliest start), FL's "Duplicate to the right of the selection" — but without
 * grid snapping, matching the editor's free placement. Returns content-time note
 * data ready for `addMidiNotes`; empty when nothing is selected.
 */
export function duplicateNotesRight(notes: readonly MidiNote[]): ClipboardNote[] {
  if (notes.length === 0) return [];
  const earliest = Math.min(...notes.map((n) => n.start));
  const latestEnd = Math.max(...notes.map((n) => n.start + n.duration));
  const span = latestEnd - earliest;
  return notes.map((n) => ({ pitch: n.pitch, start: n.start + span, duration: n.duration, velocity: n.velocity }));
}
