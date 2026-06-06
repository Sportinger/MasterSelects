// Ghost notes for the piano roll (issue #232).
//
// When clips overlap in time (now allowed on MIDI tracks — see overlapPolicy),
// the piano roll for the *active* clip shows the notes of every OTHER MIDI clip
// that overlaps it as read-only "ghost" bars. Ghosts exist only so the user can
// read what coexists; editing still happens in each note's own clip.
//
// All coordinates are expressed in the ACTIVE clip's local time space (seconds
// from the active clip's start), so the piano roll can draw them with the exact
// same `start * PX_PER_SEC` / `pitchToY` mapping it uses for real notes.

import type { TimelineClip } from '../../types';
import { isNoteStartInWindow, noteAbsoluteStart } from '../../services/midi/midiClipTiming';

export interface GhostNote {
  /** Stable key: `${sourceClipId}:${noteId}`. */
  key: string;
  pitch: number;
  /** Start in the active clip's local time (seconds), clamped to >= 0. */
  start: number;
  /** Visible duration in seconds, clamped to the active clip's window. */
  duration: number;
}

const EPSILON = 0.0001;

/**
 * Collect ghost notes for `activeClip` from all other MIDI clips in `clips`.
 *
 * A note becomes a ghost when its absolute timeline span intersects the active
 * clip's span `[activeClip.startTime, activeClip.startTime + activeClip.duration]`.
 * Each ghost is clipped to that window and converted to active-clip-local time.
 * Velocity is intentionally dropped — ghosts carry note data only.
 */
export function computeGhostNotes(
  activeClip: Pick<TimelineClip, 'id' | 'startTime' | 'duration'>,
  clips: TimelineClip[],
): GhostNote[] {
  const windowStart = activeClip.startTime;
  const windowEnd = activeClip.startTime + activeClip.duration;
  const ghosts: GhostNote[] = [];

  for (const clip of clips) {
    if (clip.id === activeClip.id) continue;
    if (clip.source?.type !== 'midi') continue;
    const notes = clip.midiData?.notes;
    if (!notes || notes.length === 0) continue;

    for (const note of notes) {
      // Only notes inside the source clip's own window are visible/playable (#232).
      if (!isNoteStartInWindow(clip, note)) continue;
      const absStart = noteAbsoluteStart(clip, note);
      const absEnd = absStart + note.duration;

      // Skip notes that don't intersect the active clip's window.
      if (absEnd <= windowStart + EPSILON || absStart >= windowEnd - EPSILON) continue;

      // Clamp the visible span to the window, then convert to local time.
      const visibleStart = Math.max(absStart, windowStart);
      const visibleEnd = Math.min(absEnd, windowEnd);
      const localStart = visibleStart - windowStart;
      const localDuration = visibleEnd - visibleStart;
      if (localDuration <= EPSILON) continue;

      ghosts.push({
        key: `${clip.id}:${note.id}`,
        pitch: note.pitch,
        start: localStart,
        duration: localDuration,
      });
    }
  }

  return ghosts;
}
