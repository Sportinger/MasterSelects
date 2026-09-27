// Beat-level navigation structures for the score editor (issue #366).

import type { Note, Score } from '../../types/scoreClip';
import { fracCompare } from './fraction';
import { getMeasureNotes } from './musicUtils';
import { spellingToMidi } from './pitchSpelling';

/** A note augmented with its parent measure number (for cross-measure sorting). */
export type FlatNote = Note & { measureNumber: number };

/**
 * Builds two related structures from a Score for beat-level navigation:
 *
 * - `allFlat`: every note/rest in the score, sorted by measure then beat.
 * - `beats`: one representative entry per (measure, beat) position.
 *   Preference order: non-rest over rest; among non-rests, lowest pitch.
 *   This collapses chords into a single entry so horizontal navigation
 *   moves between beats, not between individual chord notes.
 */
export function buildBeatMap(score: Score): { allFlat: FlatNote[]; beats: FlatNote[] } {
  const allFlat: FlatNote[] = score.measures
    .flatMap(m => getMeasureNotes(m).map(n => ({ ...n, measureNumber: m.number })))
    .toSorted((a, b) =>
      a.measureNumber !== b.measureNumber
        ? a.measureNumber - b.measureNumber
        : fracCompare(a.beat, b.beat),
    );

  // Key uses num/den so {num:1,den:3} and {num:2,den:6} (same value) reduce to the same key
  const beatMap = new Map<string, FlatNote>();
  for (const n of allFlat) {
    const key = `${n.measureNumber}:${n.beat.num}/${n.beat.den}`;
    const existing = beatMap.get(key);
    if (!existing) {
      beatMap.set(key, n);
    } else if (!n.isRest && (existing.isRest || spellingToMidi(n.step!, n.alter!, n.octave!) < spellingToMidi(existing.step!, existing.alter!, existing.octave!))) {
      // Prefer non-rest; among non-rests prefer the lowest pitch
      beatMap.set(key, n);
    }
  }

  return { allFlat, beats: Array.from(beatMap.values()) };
}
