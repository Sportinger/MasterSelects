// Music utility functions for score calculations and conversions (issue #366).
// Framework-free port from the kikoromantest score editor.

import type { NoteDuration, TimeSignature, Tuplet, Measure, Note, Fraction } from '../../types/scoreClip';
import {
  durationToFraction,
  fracCreate,
  fracMul,
  fracAdd,
  fracLte,
  fracLt,
  fracGte,
  fracCompare,
} from './fraction';

/**
 * Get the multiplier for dotted notes.
 * 1 dot = 1.5x, 2 dots = 1.75x, 3 dots = 1.875x (2 - 0.5^dots).
 */
export function getDotMultiplier(dots: number): number {
  return dots > 0 ? 2 - Math.pow(0.5, dots) : 1;
}

/**
 * Convert note duration to beat value (float — for pixel/scheduling callers;
 * comparisons should use the exact-fraction variants below).
 */
export function durationToBeats(duration: NoteDuration, dots: number = 0): number {
  const durationMap: Record<NoteDuration, number> = {
    w: 4,
    h: 2,
    q: 1,
    '8': 0.5,
    '16': 0.25,
    '32': 0.125,
  };
  return durationMap[duration] * getDotMultiplier(dots);
}

/**
 * Calculate the total duration (in quarter-note beats) of a measure.
 * 3/4 = 3 beats, 6/8 = 3 beats (6 × 0.5), 2/2 = 4 beats (2 × 2).
 */
export function getMeasureDuration(timeSignature: TimeSignature): number {
  const beatValue = 4 / timeSignature.denominator;
  return timeSignature.numerator * beatValue;
}

/** Check if a note duration fits within remaining space in a measure. */
export function noteCanFitInMeasure(
  currentBeat: number,
  duration: NoteDuration,
  timeSignature: TimeSignature,
): boolean {
  const noteDuration = durationToBeats(duration);
  const measureDuration = getMeasureDuration(timeSignature);
  return currentBeat + noteDuration <= measureDuration;
}

/** Convert MIDI note number to note name with octave (e.g., 'C4', 'A#3'). */
export function midiToNoteName(midiNote: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = noteNames[midiNote % 12];
  return `${noteName}${octave}`;
}

/** Convert note name with octave to MIDI number (e.g., 'C4' → 60). */
export function noteNameToMidi(noteName: string): number {
  const noteMap: Record<string, number> = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
    'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
  };

  const match = noteName.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!match) {
    throw new Error(`Invalid note name: ${noteName}`);
  }

  const [, note, octaveStr] = match;
  const octave = parseInt(octaveStr, 10);
  const noteValue = noteMap[note];

  if (noteValue === undefined) {
    throw new Error(`Invalid note: ${note}`);
  }

  return (octave + 1) * 12 + noteValue;
}

/**
 * Calculate the next available beat position in a measure.
 * Returns -1 if the measure is full.
 */
export function getNextAvailableBeat(
  occupiedBeats: Array<{ beat: number; duration: NoteDuration; dots?: number }>,
  duration: NoteDuration,
  timeSignature: TimeSignature,
  dots: number = 0,
): number {
  const measureDuration = getMeasureDuration(timeSignature);
  const noteDuration = durationToBeats(duration, dots);

  const sorted = occupiedBeats.toSorted((a, b) => a.beat - b.beat);

  let currentPosition = 0;

  for (const occupied of sorted) {
    const occupiedDuration = durationToBeats(occupied.duration, occupied.dots || 0);

    if (currentPosition + noteDuration <= occupied.beat) {
      return currentPosition;
    }

    currentPosition = Math.max(currentPosition, occupied.beat + occupiedDuration);
  }

  if (currentPosition + noteDuration <= measureDuration) {
    return currentPosition;
  }

  return -1;
}

/** Calculate total duration of all notes in beats. */
export function calculateTotalDuration(
  notes: Array<{ duration: NoteDuration; dots?: number }>,
): number {
  return notes.reduce((total, note) => total + durationToBeats(note.duration, note.dots || 0), 0);
}

/** Convert a beat value to the closest note duration, or null if no match. */
export function beatsToDuration(beats: number): NoteDuration | null {
  const epsilon = 0.001;
  if (Math.abs(beats - 4) < epsilon) return 'w';
  if (Math.abs(beats - 2) < epsilon) return 'h';
  if (Math.abs(beats - 1) < epsilon) return 'q';
  if (Math.abs(beats - 0.5) < epsilon) return '8';
  if (Math.abs(beats - 0.25) < epsilon) return '16';
  if (Math.abs(beats - 0.125) < epsilon) return '32';
  return null;
}

/**
 * Split a duration into parts that fit within available beats.
 * Returns an array of durations that sum to the original duration.
 * Used for splitting notes across bar lines.
 */
export function splitBeatsIntoDurations(totalBeats: number): NoteDuration[] {
  const durations: NoteDuration[] = [];
  let remaining = totalBeats;
  const epsilon = 0.001;

  // Available durations from largest to smallest
  const availableDurations: { duration: NoteDuration; beats: number }[] = [
    { duration: 'w', beats: 4 },
    { duration: 'h', beats: 2 },
    { duration: 'q', beats: 1 },
    { duration: '8', beats: 0.5 },
    { duration: '16', beats: 0.25 },
    { duration: '32', beats: 0.125 },
  ];

  while (remaining > epsilon) {
    let found = false;
    for (const { duration, beats } of availableDurations) {
      if (remaining >= beats - epsilon) {
        durations.push(duration);
        remaining -= beats;
        found = true;
        break;
      }
    }
    if (!found) break; // Prevent infinite loop for very small remainders
  }

  return durations;
}

// ==================== Tuplet Utilities ====================

/**
 * Duration in beats of a single note within a tuplet (float variant).
 * For a triplet of eighth notes (3:2), each eighth = (0.5 × 2) / 3 ≈ 0.333.
 */
export function getTupletNoteDuration(
  baseDuration: NoteDuration,
  numNotes: number,
  notesOccupied: number,
): number {
  const baseBeats = durationToBeats(baseDuration);
  return (baseBeats * notesOccupied) / numNotes;
}

/**
 * Total duration in beats that a tuplet occupies (float variant).
 * For a triplet of eighth notes (3:2), total = 0.5 × 2 = 1 beat.
 */
export function getTupletTotalBeats(
  baseDuration: NoteDuration,
  notesOccupied: number,
): number {
  return durationToBeats(baseDuration) * notesOccupied;
}

// ==================== Exact Fraction Tuplet Utilities ====================
// The float variants above remain for pixel callers that need numbers.

/**
 * Exact duration (in beats) of a single note within a tuplet.
 * Result is fully reduced: triplet eighth → Fraction(1, 3).
 */
export function getTupletNoteDurationFrac(
  baseDuration: NoteDuration,
  numNotes: number,
  notesOccupied: number,
): Fraction {
  return fracMul(durationToFraction(baseDuration), fracCreate(notesOccupied, numNotes));
}

/**
 * Exact total duration (in beats) the entire tuplet group occupies.
 * e.g. triplet of eighths → 2 eighths → Fraction(1, 1).
 */
export function getTupletTotalBeatsFrac(
  baseDuration: NoteDuration,
  notesOccupied: number,
): Fraction {
  return fracMul(durationToFraction(baseDuration), fracCreate(notesOccupied, 1));
}

/**
 * Exact check: does `beat` fall within the given tuplet's time span?
 * No epsilon — comparison is cross-multiplication of integers.
 * Inclusive of startBeat, exclusive of end.
 */
export function isBeatInTupletFrac(beat: Fraction, tuplet: Tuplet): boolean {
  const end = fracAdd(tuplet.startBeat, getTupletTotalBeatsFrac(tuplet.baseDuration, tuplet.notesOccupied));
  return fracGte(beat, tuplet.startBeat) && fracLt(beat, end);
}

/**
 * Sort an array of Fraction beat positions in ascending order (mutates in place).
 * Uses exact cross-multiplication comparison.
 */
export function sortBeatsFrac(positions: Fraction[]): Fraction[] {
  return positions.sort(fracCompare);
}

/**
 * Convert a numeric beat value to an exact Fraction.
 * Used wherever beat positions are computed via float arithmetic (coordinate
 * mapping, tuplet ratios, quantization) and need exact-Fraction APIs.
 */
export function beatToFrac(beat: number): Fraction {
  // Fast path for common integer and dyadic values
  if (Number.isInteger(beat)) return fracCreate(beat, 1);
  // Try denominators that cover all standard + tuplet subdivisions
  const DENS = [2, 3, 4, 5, 6, 7, 8, 12, 14, 16, 21, 24, 28, 32, 48, 56, 96, 112];
  for (const d of DENS) {
    const n = Math.round(beat * d);
    if (Math.abs(beat - n / d) < 1e-9) return fracCreate(n, d);
  }
  // Fallback: rational approximation with den=96 (covers up to 32nd-note triplets)
  return fracCreate(Math.round(beat * 96), 96);
}

/**
 * Exact overlap check for two note spans [aStart, aStart+aDur) and [bStart, bStart+bDur).
 * Returns true if they overlap (share any time), false if adjacent or disjoint.
 */
export function noteSpansOverlapFrac(
  aStart: Fraction,
  aDur: Fraction,
  bStart: Fraction,
  bDur: Fraction,
): boolean {
  const aEnd = fracAdd(aStart, aDur);
  const bEnd = fracAdd(bStart, bDur);
  // Overlap iff aStart < bEnd AND bStart < aEnd
  return fracLt(aStart, bEnd) && fracLt(bStart, aEnd);
}

/** Check if span [start, start+dur) is fully contained within [regionStart, regionEnd). */
export function spanContainedInFrac(
  start: Fraction,
  dur: Fraction,
  regionStart: Fraction,
  regionEnd: Fraction,
): boolean {
  return fracGte(start, regionStart) && fracLte(fracAdd(start, dur), regionEnd);
}

/**
 * Flatten a Measure's ChordRest slots into a backward-compatible Note[] array.
 * Each Rest slot becomes one Note with isRest=true.
 * Each Chord slot becomes one Note per pitch.
 */
export function getMeasureNotes(measure: Measure): Note[] {
  const result: Note[] = [];
  for (const slot of measure.slots) {
    if (slot.type === 'rest') {
      result.push({
        id: slot.id,
        duration: slot.duration,
        measure: slot.measure,
        beat: slot.beat,
        isRest: true,
        dots: slot.dots,
        tupletId: slot.tupletId,
        actualDuration: slot.actualDuration,
      });
    } else {
      for (const pitch of slot.notes) {
        result.push({
          id: pitch.id,
          step: pitch.step,
          alter: pitch.alter,
          octave: pitch.octave,
          duration: slot.duration,
          measure: slot.measure,
          beat: slot.beat,
          isRest: false,
          forceAccidental: pitch.forceAccidental,
          stemDirection: slot.stemDirection,
          tiedTo: pitch.tiedTo,
          tiedFrom: pitch.tiedFrom,
          dots: slot.dots,
          tupletId: slot.tupletId,
          actualDuration: slot.actualDuration,
          articulations: slot.articulations,
        });
      }
    }
  }
  return result;
}
