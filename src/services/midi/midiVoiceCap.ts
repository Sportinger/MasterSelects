// Analytic polyphony cap for the OFFLINE export path (issue #298, plan §5).
//
// The live scheduler steals voices at runtime as they are created, but the offline
// renderer schedules every note into one OfflineAudioContext up front — there is no
// "currently sounding" set to steal from. So the cap must be enforced analytically
// at plan time: sweep note starts in time order and, whenever a new note would push
// concurrency past the cap, drop the lowest-priority note that is sounding at that
// instant. The priority (quietest first, then oldest) mirrors the live stealer so an
// export drops the same notes the user heard get stolen during playback — the §2
// offline-parity requirement. Pure + framework-free so it is unit-testable.

/** Minimal shape the cap needs; PlannedMidiNote satisfies it. */
export interface CappableNote {
  startTime: number; // seconds
  duration: number;  // seconds
  velocity: number;  // 0–1
}

/** Default simultaneous-voice ceiling, shared by the live and offline paths. */
export const DEFAULT_MAX_VOICES = 32;

interface ActiveEntry<T> {
  note: T;
  index: number;
  endsAt: number;
}

/**
 * Return the subset of `notes` (in original order) that survives a `maxVoices`
 * polyphony cap. A note is evicted when, at its start, the number of overlapping
 * notes would exceed the cap; the evicted note is the quietest currently sounding
 * (tie-break: oldest start), which may be the just-arrived note itself.
 */
export function capConcurrentNotes<T extends CappableNote>(
  notes: readonly T[],
  maxVoices: number = DEFAULT_MAX_VOICES,
): T[] {
  if (maxVoices <= 0) return [];
  if (notes.length <= maxVoices) return notes.slice();

  // Walk notes in start-time order (stable by original index on ties).
  const order = notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.startTime - b.note.startTime || a.index - b.index);

  const dropped = new Set<number>();
  const active: ActiveEntry<T>[] = [];

  for (const { note, index } of order) {
    // Retire notes that have finished before this one starts.
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endsAt <= note.startTime) active.splice(i, 1);
    }

    active.push({ note, index, endsAt: note.startTime + Math.max(0, note.duration) });

    if (active.length > maxVoices) {
      // Evict the lowest-priority sounding note: quietest, then oldest.
      let victim = 0;
      for (let i = 1; i < active.length; i++) {
        const a = active[i];
        const b = active[victim];
        if (
          a.note.velocity < b.note.velocity ||
          (a.note.velocity === b.note.velocity && a.note.startTime < b.note.startTime)
        ) {
          victim = i;
        }
      }
      dropped.add(active[victim].index);
      active.splice(victim, 1);
    }
  }

  return notes.filter((_, index) => !dropped.has(index));
}
