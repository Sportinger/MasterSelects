// Pitch spelling utilities — enharmonic-aware pitch representation (issue #366).
//
// Industry standard (MusicXML, MuseScore, music21) stores pitch as
// step + alter + octave, not as a raw MIDI integer. This lets the system
// distinguish C# from Db, D# from Eb, etc.
//
// These helpers are pure functions with no side effects; none of them depend
// on any other score-editor module — safe to import anywhere.

import type { PitchSpelling, PitchStep, PitchAlter, Accidental } from '../../types/scoreClip';

export type { PitchSpelling, PitchStep, PitchAlter };

/** Semitone offset from C within an octave, for each diatonic step */
const STEP_SEMITONES: Record<PitchStep, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** Diatonic index within octave (C=0 … B=6) */
const STEP_INDEX: Record<PitchStep, number> = {
  C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6,
};

// ---------------------------------------------------------------------------
// Conversion: PitchSpelling → other representations
// ---------------------------------------------------------------------------

/**
 * Convert a pitch spelling to a MIDI note number. Middle C (C4) = 60.
 *
 * @example
 * spellingToMidi('C',  0, 4) // 60  — middle C
 * spellingToMidi('C',  1, 4) // 61  — C#4
 * spellingToMidi('D', -1, 4) // 61  — Db4  (same MIDI, different spelling)
 */
export function spellingToMidi(step: PitchStep, alter: PitchAlter, octave: number): number {
  return (octave + 1) * 12 + STEP_SEMITONES[step] + alter;
}

/**
 * Convert a pitch spelling to a VexFlow key string (e.g. 'c#/4', 'db/4').
 * VexFlow expects lowercase step, accidental suffix, slash, then octave.
 */
export function spellingToVexflowKey(step: PitchStep, alter: PitchAlter, octave: number): string {
  const acc =
    alter === 2 ? '##' :
    alter === 1 ? '#' :
    alter === -1 ? 'b' :
    alter === -2 ? 'bb' : '';
  return `${step.toLowerCase()}${acc}/${octave}`;
}

/**
 * Diatonic position of a spelling, counting diatonic steps from C0.
 * Adjacent notes on a staff differ by exactly 1, regardless of accidentals.
 *
 * This is the correct basis for staff-line/space calculations; using
 * chromatic (MIDI) arithmetic for staff positions gives wrong results
 * when accidentals are involved.
 *
 * Reference values (treble clef):
 *   E4=30 (bottom line), G4=32, B4=34 (middle line), D5=36, F5=38 (top line)
 */
export function spellingDiatonicPos(step: PitchStep, octave: number): number {
  return octave * 7 + STEP_INDEX[step];
}

/**
 * Derive the legacy Accidental display character from a PitchAlter.
 * Returns undefined for naturals (alter === 0) when no accidental sign is needed.
 * Double-sharps/flats fall back to single (VexFlow limitation in current use).
 */
export function alterToAccidental(alter: PitchAlter): Accidental | undefined {
  if (alter > 0) return '#';
  if (alter < 0) return 'b';
  return undefined;
}

/**
 * Convert a legacy Accidental string to a PitchAlter integer.
 * '#' → 1, 'b' → -1, 'n' or null/undefined → 0
 */
export function accidentalToAlter(acc: Accidental | null | undefined): PitchAlter {
  if (acc === '#') return 1;
  if (acc === 'b') return -1;
  return 0;
}

// ---------------------------------------------------------------------------
// Conversion: MIDI → PitchSpelling
// ---------------------------------------------------------------------------

type SpellingEntry = { step: PitchStep; alter: PitchAlter };

const WHITE_KEYS: Partial<Record<number, SpellingEntry>> = {
  0: { step: 'C', alter: 0 },
  2: { step: 'D', alter: 0 },
  4: { step: 'E', alter: 0 },
  5: { step: 'F', alter: 0 },
  7: { step: 'G', alter: 0 },
  9: { step: 'A', alter: 0 },
  11: { step: 'B', alter: 0 },
};

const BLACK_SHARP: Record<number, SpellingEntry> = {
  1: { step: 'C', alter: 1 },
  3: { step: 'D', alter: 1 },
  6: { step: 'F', alter: 1 },
  8: { step: 'G', alter: 1 },
  10: { step: 'A', alter: 1 },
};

const BLACK_FLAT: Record<number, SpellingEntry> = {
  1: { step: 'D', alter: -1 },
  3: { step: 'E', alter: -1 },
  6: { step: 'G', alter: -1 },
  8: { step: 'A', alter: -1 },
  10: { step: 'B', alter: -1 },
};

/**
 * Convert a MIDI note number to a PitchSpelling.
 *
 * The optional `hint` resolves the enharmonic ambiguity for black keys:
 *   - '#' or undefined → sharp spelling (C#, D#, F#, G#, A#)
 *   - 'b' → flat spelling (Db, Eb, Gb, Ab, Bb)
 *   - 'n' → treat as no hint (the note is a white key with a courtesy natural)
 *
 * White keys are always unambiguous regardless of hint.
 *
 * @example
 * midiToSpelling(60)      // { step:'C', alter:0, octave:4 }  — middle C
 * midiToSpelling(61)      // { step:'C', alter:1, octave:4 }  — C#4 (default)
 * midiToSpelling(61, 'b') // { step:'D', alter:-1, octave:4 } — Db4
 */
export function midiToSpelling(midi: number, hint?: '#' | 'b' | 'n'): PitchSpelling {
  const pc = ((midi % 12) + 12) % 12; // pitch class 0–11, safe for negative input
  const octave = Math.floor(midi / 12) - 1;

  const white = WHITE_KEYS[pc];
  if (white) return { ...white, octave };

  const useFlat = hint === 'b';
  const entry = useFlat ? BLACK_FLAT[pc] : BLACK_SHARP[pc];
  return { ...entry, octave };
}

// ---------------------------------------------------------------------------
// Utility: compare two spellings
// ---------------------------------------------------------------------------

/**
 * True if two spellings represent the same pitch spelling
 * (same step, same alter, same octave — NOT enharmonic equivalence).
 */
export function spellingEquals(a: PitchSpelling, b: PitchSpelling): boolean {
  return a.step === b.step && a.alter === b.alter && a.octave === b.octave;
}

/**
 * True if two spellings sound at the same pitch (enharmonic equivalence).
 * C#4 and Db4 return true; C#4 and C#5 return false.
 */
export function spellingEnharmonic(a: PitchSpelling, b: PitchSpelling): boolean {
  return spellingToMidi(a.step, a.alter, a.octave) === spellingToMidi(b.step, b.alter, b.octave);
}
