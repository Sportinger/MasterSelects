// MIDI clip timing model (issue #232).
//
// A MIDI clip is a fixed canvas of notes plus a movable WINDOW onto that canvas:
//
//   - `note.start` is CONTENT time — seconds from the clip's content origin
//     (origin = 0). It never changes when the clip is resized; it only changes
//     when the user actually edits the note.
//   - `[clip.inPoint, clip.outPoint]` is the visible/playable window into the
//     content (`outPoint = inPoint + duration`). Resizing a clip moves this
//     window, not the notes. Extending a clip from the LEFT pushes `inPoint`
//     below 0 (empty space before the content origin), so both `inPoint` and a
//     note placed there have NEGATIVE content time — that is valid, not clamped.
//   - On the timeline the window's left edge sits at `clip.startTime`, so a note
//     at content time `t` plays at absolute time `startTime + (t - inPoint)`.
//
// Because every existing MIDI clip has `inPoint === 0`, these formulas reduce to
// the old `startTime + note.start` behavior — so this is backward compatible.
// Centralizing the mapping keeps the scheduler, piano roll, clip preview and
// ghost notes from drifting apart.

import type { MidiNote } from '../../types/midiClip';

const EPSILON = 0.0001;

/** The clip fields the timing model needs (subset of TimelineClip). */
export interface MidiClipWindow {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
}

/** Absolute timeline time (seconds) at which a note starts. */
export function noteAbsoluteStart(clip: MidiClipWindow, note: Pick<MidiNote, 'start'>): number {
  return clip.startTime + (note.start - clip.inPoint);
}

/** Convert a clip-local offset (seconds from the window's left edge) to content time. */
export function clipLocalToContentTime(clip: Pick<MidiClipWindow, 'inPoint'>, localSeconds: number): number {
  return clip.inPoint + localSeconds;
}

/** Convert a note's content time to a clip-local offset (seconds from the window's left edge). */
export function contentTimeToClipLocal(clip: Pick<MidiClipWindow, 'inPoint'>, contentTime: number): number {
  return contentTime - clip.inPoint;
}

/**
 * Whether a note's START falls inside the clip's visible window `[inPoint, outPoint)`.
 * Notes outside the window are hidden/silent but their data is preserved, so a
 * later enlarge reveals them again.
 */
export function isNoteStartInWindow(clip: Pick<MidiClipWindow, 'inPoint' | 'outPoint'>, note: Pick<MidiNote, 'start'>): boolean {
  return note.start >= clip.inPoint - EPSILON && note.start < clip.outPoint - EPSILON;
}

/** The two independent note sets produced by cutting a MIDI clip. */
export interface MidiNoteCutResult {
  /** Notes for the left clip, rebased so the clip's content origin is 0. */
  left: MidiNote[];
  /** Notes for the right clip, rebased so the clip's content origin is 0. */
  right: MidiNote[];
}

/**
 * Partition a MIDI clip's notes for a CUT at content time `cut`, producing two
 * INDEPENDENT, self-contained note sets — not two windows onto a shared array.
 *
 * A cut differs from a resize: a resize moves one window over preserved content
 * (so hidden notes can reappear), but a cut splits the clip into two standalone
 * clips, matching every DAW. So here:
 *
 *   - A note is assigned WHOLE by where its START falls (same rule the scheduler
 *     uses via {@link isNoteStartInWindow}), then REBASED to its new clip's
 *     origin: left notes shift by `inPoint`, right notes by `cut`. Notes are
 *     never sliced — a note starting just before the cut stays in the left clip
 *     and simply rings out past the cut, exactly as it did before the split.
 *   - Notes whose start is outside the visible window `[inPoint, outPoint)` are
 *     dropped — they were already silent, and a standalone clip keeps no ghosts.
 *
 * `makeNote` builds a note for a target clip from a source note plus the rebased
 * `start`/`duration`; the caller supplies it so this stays free of ID generation.
 */
export function partitionMidiNotesAtCut(
  notes: readonly MidiNote[],
  window: Pick<MidiClipWindow, 'inPoint' | 'outPoint'>,
  cut: number,
  makeNote: (source: MidiNote, rebased: { start: number; duration: number }) => MidiNote,
): MidiNoteCutResult {
  const { inPoint, outPoint } = window;
  const left: MidiNote[] = [];
  const right: MidiNote[] = [];

  for (const note of notes) {
    if (note.start >= inPoint - EPSILON && note.start < cut - EPSILON) {
      // Starts in the left half: keep the WHOLE note (never sliced), rebased to
      // the left clip's origin. A note that runs past the cut just rings out, as
      // it did before the split.
      left.push(makeNote(note, { start: note.start - inPoint, duration: note.duration }));
    } else if (note.start >= cut - EPSILON && note.start < outPoint - EPSILON) {
      // Starts in the right half: keep the whole note, rebased to the right origin.
      right.push(makeNote(note, { start: note.start - cut, duration: note.duration }));
    }
    // else: starts outside the visible window — already silent, dropped.
  }

  return { left, right };
}

/** One source MIDI clip's contribution to a merge (subset of TimelineClip). */
export interface MidiMergeSegment {
  startTime: number;
  inPoint: number;
  outPoint: number;
  notes: readonly MidiNote[];
}

/**
 * Combine several MIDI clips ("glue") into one note set on a merged clip whose
 * content origin sits at `mergedStartTime` (the merged clip has `inPoint = 0`).
 *
 * This is the inverse of {@link partitionMidiNotesAtCut}: every note keeps its
 * ABSOLUTE timeline position. A note's absolute start is `startTime + (start -
 * inPoint)` (the windowed model), so in the merged clip it becomes
 * `absoluteStart - mergedStartTime`. Only notes whose start is inside their
 * source clip's window are taken (same rule as {@link isNoteStartInWindow}), so
 * hidden/out-of-window notes are not resurrected — keeping cut↔glue symmetric.
 * Overlapping clips simply contribute their notes side by side (polyphony).
 *
 * `makeNote` mirrors the partition callback so callers share one note builder.
 */
export function mergeMidiNotes(
  segments: readonly MidiMergeSegment[],
  mergedStartTime: number,
  makeNote: (source: MidiNote, rebased: { start: number; duration: number }) => MidiNote,
): MidiNote[] {
  const merged: MidiNote[] = [];
  for (const segment of segments) {
    for (const note of segment.notes) {
      if (!isNoteStartInWindow(segment, note)) continue;
      const absoluteStart = segment.startTime + (note.start - segment.inPoint);
      merged.push(makeNote(note, { start: absoluteStart - mergedStartTime, duration: note.duration }));
    }
  }
  return merged;
}
