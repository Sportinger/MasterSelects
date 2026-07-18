// Analytic polyphony cap for the OFFLINE export path (issue #298, plan §5).
//
// The live scheduler steals voices at runtime as they are created, but the offline
// renderer schedules every note into one OfflineAudioContext up front — there is no
// "currently sounding" set to steal from. So the cap must be enforced analytically
// at plan time: sweep note starts in time order and, whenever a new note arrives at
// the cap, steal the lowest-priority voice that was already sounding before admitting
// the arrival. The priority (quietest first, then oldest) mirrors the live stealer so
// an export drops the same notes the user heard get stolen during playback — the §2
// offline-parity requirement. Pure + framework-free so it is unit-testable.

/** Minimal shape the cap needs; PlannedMidiNote satisfies it. */
export interface CappableNote {
  startTime: number; // seconds
  duration: number;  // seconds
  velocity: number;  // 0–1
}

/** Default simultaneous-voice ceiling, shared by the live and offline paths. */
export const DEFAULT_MAX_VOICES = 32;

/** Comparable priority shared by live voice stealing and offline planning. */
export interface MidiVoiceStealPriority {
  isReleasing: boolean;
  velocity: number;
  startTime: number;
}

/** Scheduled lifetime used by both look-ahead playback and offline planning. */
export interface MidiVoiceLifecycleCandidate {
  startTime: number;
  noteOffTime: number;
  endsAt: number;
  velocity: number;
}

export interface MidiVoiceLifecycle {
  noteOffTime: number;
  endsAt: number;
}

/** Negative means `a` should be stolen before `b`. */
export function compareMidiVoiceStealPriority(
  a: MidiVoiceStealPriority,
  b: MidiVoiceStealPriority,
): number {
  if (a.isReleasing !== b.isReleasing) return a.isReleasing ? -1 : 1;
  return a.velocity - b.velocity || a.startTime - b.startTime;
}

export function isMidiVoiceActiveAt(
  candidate: MidiVoiceLifecycleCandidate,
  atTime: number,
): boolean {
  return candidate.startTime <= atTime && candidate.endsAt > atTime;
}

/** Return the candidate index that the live/offline policy would steal. */
export function findMidiVoiceStealCandidateIndex(
  candidates: readonly MidiVoiceLifecycleCandidate[],
  atTime: number,
): number | null {
  let victim: number | null = null;
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (!isMidiVoiceActiveAt(candidate, atTime)) continue;
    if (victim === null) {
      victim = index;
      continue;
    }
    const currentVictim = candidates[victim];
    if (compareMidiVoiceStealPriority(
      {
        isReleasing: atTime >= candidate.noteOffTime,
        velocity: candidate.velocity,
        startTime: candidate.startTime,
      },
      {
        isReleasing: atTime >= currentVictim.noteOffTime,
        velocity: currentVictim.velocity,
        startTime: currentVictim.startTime,
      },
    ) < 0) {
      victim = index;
    }
  }
  return victim;
}

interface ActiveEntry<T> extends MidiVoiceLifecycleCandidate {
  note: T;
}

/**
 * Return forced stop times for voices stolen by a `maxVoices` polyphony cap.
 * Notes remain present before their stop time: live playback lets an established
 * voice sound until the later arrival steals it, so offline export must truncate
 * and fade that voice at the arrival rather than remove its entire history.
 */
export function planConcurrentNoteStops<T extends CappableNote>(
  notes: readonly T[],
  maxVoices: number = DEFAULT_MAX_VOICES,
  resolveLifecycle: (note: T) => MidiVoiceLifecycle = (note) => {
    const noteOffTime = note.startTime + Math.max(0, note.duration);
    return { noteOffTime, endsAt: noteOffTime };
  },
): Map<T, number> {
  if (maxVoices <= 0) {
    return new Map(notes.map((note) => [note, note.startTime]));
  }
  if (notes.length <= maxVoices) return new Map();

  // Walk notes in start-time order (stable by original index on ties).
  const order = notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.startTime - b.note.startTime || a.index - b.index);

  const forcedStops = new Map<T, number>();
  const active: ActiveEntry<T>[] = [];

  for (const { note } of order) {
    // Retire notes that have finished before this one starts.
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endsAt <= note.startTime) active.splice(i, 1);
    }

    if (active.length >= maxVoices) {
      // Steal the lowest-priority existing voice before admitting the arrival:
      // quietest first, then oldest. Do not include the incoming note among the
      // candidates; the live synth cannot reject a voice it has not built yet.
      const victim = findMidiVoiceStealCandidateIndex(active, note.startTime);
      if (victim !== null) {
        forcedStops.set(active[victim].note, note.startTime);
        active.splice(victim, 1);
      }
    }

    const lifecycle = resolveLifecycle(note);
    const noteOffTime = Math.max(note.startTime, lifecycle.noteOffTime);
    active.push({
      note,
      startTime: note.startTime,
      noteOffTime,
      endsAt: Math.max(noteOffTime, lifecycle.endsAt),
      velocity: note.velocity,
    });
  }

  return forcedStops;
}
