// Score → schedulable note events (issue #366, phase 4).
//
// The one piece of kikoromantest's Tone.js PlaybackEngine worth keeping: the
// pure extraction of sounding events from the notation model. Tuplet-aware
// (exact actualDuration), and tie-aware — a same-pitch tiedFrom continuation
// is not re-attacked, while the tie head's duration accumulates along the
// same-pitch tiedTo chain. Times are in SECONDS at score.tempo; the host
// synth (IMidiSynth.scheduleNote) consumes these directly.

import type { Chord, Score } from '../../types/scoreClip';
import { durationToBeats, getMeasureDuration } from './musicUtils';
import { fracToNumber } from './fraction';
import { spellingToMidi } from './pitchSpelling';

/** One sounding note, in seconds relative to the score start. */
export interface ScoreEvent {
  midi: number;
  /** Onset in seconds */
  start: number;
  /** Sounding duration in seconds (ties merged) */
  duration: number;
  velocity: number;
}

export interface ScoreEventsResult {
  events: ScoreEvent[];
  /** Full score length in seconds (all measures, including trailing rests) */
  totalDuration: number;
}

/** Sounding duration of a chord slot in beats (tuplet-exact when stored). */
function chordBeats(chord: Chord): number {
  return chord.actualDuration
    ? fracToNumber(chord.actualDuration)
    : durationToBeats(chord.duration, chord.dots || 0);
}

/**
 * Flatten a Score into schedulable events.
 *
 * @param score The notation model
 * @param velocity Uniform velocity 0–1 (notation has no dynamics yet)
 */
export function scoreToEvents(score: Score, velocity = 0.85): ScoreEventsResult {
  const beatsPerSecond = score.tempo / 60;
  const events: ScoreEvent[] = [];

  // Lookup: NotePitch id → its chord, to follow tie chains across measures
  const pitchInfo = new Map<string, Chord>();
  for (const measure of score.measures) {
    for (const slot of measure.slots) {
      if (slot.type !== 'chord') continue;
      for (const notePitch of slot.notes) {
        pitchInfo.set(notePitch.id, slot);
      }
    }
  }

  let measureStartBeats = 0;
  for (const measure of score.measures) {
    for (const slot of measure.slots) {
      if (slot.type !== 'chord') continue;

      const onsetBeats = measureStartBeats + fracToNumber(slot.beat);
      const baseDurationBeats = chordBeats(slot);

      for (const notePitch of slot.notes) {
        const midi = spellingToMidi(notePitch.step, notePitch.alter, notePitch.octave);

        // Skip tied continuations only when the source has the SAME pitch (a
        // true tie). A different-pitch tie is a migration artifact — play it.
        if (notePitch.tiedFrom) {
          const sourceChord = pitchInfo.get(notePitch.tiedFrom);
          const sourcePitch = sourceChord?.notes.find(n => n.id === notePitch.tiedFrom);
          if (sourcePitch && spellingToMidi(sourcePitch.step, sourcePitch.alter, sourcePitch.octave) === midi) {
            continue;
          }
        }

        // Accumulate duration along the same-pitch tiedTo chain
        let durationBeats = baseDurationBeats;
        let cursor = notePitch;
        let safety = 64;
        while (cursor.tiedTo && safety-- > 0) {
          const nextChord = pitchInfo.get(cursor.tiedTo);
          const nextPitch = nextChord?.notes.find(n => n.id === cursor.tiedTo);
          if (!nextChord || !nextPitch) break;
          if (spellingToMidi(nextPitch.step, nextPitch.alter, nextPitch.octave) !== midi) break;
          durationBeats += chordBeats(nextChord);
          cursor = nextPitch;
        }

        events.push({
          midi,
          start: onsetBeats / beatsPerSecond,
          duration: durationBeats / beatsPerSecond,
          velocity,
        });
      }
    }

    measureStartBeats += getMeasureDuration(measure.timeSignature);
  }

  return {
    events,
    totalDuration: measureStartBeats / beatsPerSecond,
  };
}
