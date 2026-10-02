// Note collision and measure-overflow checks for the score editor (issue #366).
// Framework-free port from the kikoromantest score editor.

import type { Note, NoteParams, Measure, TimeSignature, NoteDuration } from '../../types/scoreClip';
import { durationToBeats, getMeasureDuration, beatToFrac } from './musicUtils';
import { spellingToMidi } from './pitchSpelling';
import {
  durationToFraction,
  fracAdd,
  fracCompare,
  fracCreate,
  fracEq,
  fracGt,
  fracGte,
  fracLt,
  fracToNumber,
} from './fraction';

/** Result of a collision check */
export interface CollisionResult {
  hasCollision: boolean;
  /** IDs of notes that collide */
  collidingNotes: string[];
  reason?: string;
}

/** Result of an overflow check */
export interface OverflowResult {
  willOverflow: boolean;
  /** Amount of overflow in beats */
  overflowAmount?: number;
  /** Suggested next measure for overflow notes */
  suggestedMeasure?: number;
}

/**
 * CollisionDetector handles note collision detection and measure overflow checks.
 */
export class CollisionDetector {
  /**
   * Check if a new note would collide with existing notes.
   *
   * Collision rules:
   * 1. Same beat + same pitch + same duration = DUPLICATE (collision)
   * 2. Same beat + different pitch + same duration = CHORD (allowed)
   * 3. Overlapping time but different beats = COLLISION (not allowed)
   */
  checkNoteCollision(newNote: NoteParams, existingNotes: Note[]): CollisionResult {
    const newNoteDurFrac = newNote.actualDuration ?? durationToFraction(newNote.duration, newNote.dots ?? 0);
    const newNoteEnd = fracAdd(newNote.beat, newNoteDurFrac);

    const collidingNotes: string[] = [];

    for (const existing of existingNotes) {
      // Skip notes in different measures
      if (existing.measure !== newNote.measure) continue;

      // Skip rests - they don't participate in chords
      if (existing.isRest) continue;
      // Pitched notes must have all three pitch fields; skip malformed data
      if (existing.step === undefined || existing.octave === undefined) continue;

      const existingDurFrac = existing.actualDuration ?? durationToFraction(existing.duration, existing.dots ?? 0);
      const existingEnd = fracAdd(existing.beat, existingDurFrac);

      // Check if notes start at the exact same beat position (exact — no epsilon)
      const sameStartBeat = fracEq(newNote.beat, existing.beat);

      if (sameStartBeat) {
        // Notes starting at same beat - check if they form a chord or duplicate.
        // Compare by sounding MIDI pitch (enharmonic duplicates also collide).
        const samePitch = !newNote.isRest &&
          newNote.step !== undefined && newNote.octave !== undefined &&
          spellingToMidi(existing.step, existing.alter ?? 0, existing.octave) ===
          spellingToMidi(newNote.step, newNote.alter ?? 0, newNote.octave);
        const sameDuration = fracEq(newNoteDurFrac, existingDurFrac);

        if (samePitch && sameDuration) {
          // Exact duplicate note - reject
          collidingNotes.push(existing.id);
        }
        // Different pitch or duration at same beat = chord (allowed, no collision)
      } else {
        // Different start beats - check for partial time overlap (true collision)
        const timeOverlap =
          (fracGt(newNote.beat, existing.beat) && fracLt(newNote.beat, existingEnd)) ||
          (fracGt(newNoteEnd, existing.beat) && fracLt(newNoteEnd, existingEnd)) ||
          (fracLt(newNote.beat, existing.beat) && fracGte(newNoteEnd, existingEnd));

        if (timeOverlap) {
          collidingNotes.push(existing.id);
        }
      }
    }

    return {
      hasCollision: collidingNotes.length > 0,
      collidingNotes,
      reason: collidingNotes.length > 0 ? 'Note overlaps with existing note(s) or is a duplicate' : undefined,
    };
  }

  /** Check if adding a note would cause measure overflow. */
  checkMeasureOverflow(
    note: NoteParams,
    measure: Measure,
    _existingNotes: Note[],
  ): OverflowResult {
    const noteDurFrac = note.actualDuration ?? durationToFraction(note.duration, note.dots ?? 0);
    const noteEnd = fracToNumber(fracAdd(note.beat, noteDurFrac));
    const measureDuration = getMeasureDuration(measure.timeSignature);

    if (noteEnd > measureDuration) {
      return {
        willOverflow: true,
        overflowAmount: noteEnd - measureDuration,
        suggestedMeasure: measure.number + 1,
      };
    }

    return { willOverflow: false };
  }

  /** Find the next available position in a measure for a note (in beats). */
  findNextAvailablePosition(
    duration: NoteDuration,
    measure: Measure,
    existingNotes: Note[],
    startFromBeat: number = 0,
  ): number | null {
    const noteDuration = durationToBeats(duration);
    const measureDuration = getMeasureDuration(measure.timeSignature);

    const sortedNotes = existingNotes.toSorted((a, b) => fracCompare(a.beat, b.beat));

    let currentBeat = startFromBeat;

    for (const note of sortedNotes) {
      const noteEnd = fracToNumber(note.beat) + durationToBeats(note.duration, note.dots || 0);

      if (currentBeat + noteDuration <= fracToNumber(note.beat)) {
        return currentBeat;
      }

      currentBeat = Math.max(currentBeat, noteEnd);
    }

    if (currentBeat + noteDuration <= measureDuration) {
      return currentBeat;
    }

    return null;
  }

  /** Get all notes that would be affected by inserting a note at a position. */
  getAffectedNotes(newNote: NoteParams, existingNotes: Note[]): Note[] {
    const newNoteDurFrac = newNote.actualDuration ?? durationToFraction(newNote.duration, newNote.dots ?? 0);
    const newNoteEnd = fracAdd(newNote.beat, newNoteDurFrac);

    return existingNotes.filter(note => {
      if (note.measure !== newNote.measure) return false;

      const noteDurFrac = note.actualDuration ?? durationToFraction(note.duration, note.dots ?? 0);
      const noteEnd = fracAdd(note.beat, noteDurFrac);

      return (
        (fracGte(newNote.beat, note.beat) && fracLt(newNote.beat, noteEnd)) ||
        (fracGt(newNoteEnd, note.beat) && fracLt(newNoteEnd, noteEnd)) ||
        (fracLt(newNote.beat, note.beat) && fracGte(newNoteEnd, noteEnd))
      );
    });
  }

  /** Calculate total duration used in a measure. */
  getMeasureUsage(measure: Measure, notes: Note[]): {
    used: number;
    available: number;
    percentage: number;
  } {
    const measureDuration = getMeasureDuration(measure.timeSignature);
    const measureNotes = notes.filter(n => n.measure === measure.number);

    let maxEnd = 0;
    for (const note of measureNotes) {
      const noteDurFrac = note.actualDuration ?? durationToFraction(note.duration, note.dots ?? 0);
      const noteEnd = fracToNumber(fracAdd(note.beat, noteDurFrac));
      maxEnd = Math.max(maxEnd, noteEnd);
    }

    return {
      used: maxEnd,
      available: measureDuration - maxEnd,
      percentage: (maxEnd / measureDuration) * 100,
    };
  }

  /** Validate that all notes in a measure fit within its time signature. */
  validateMeasure(measure: Measure, notes: Note[]): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const measureDuration = getMeasureDuration(measure.timeSignature);
    const measureNotes = notes.filter(n => n.measure === measure.number);

    for (const note of measureNotes) {
      const noteDurFrac = note.actualDuration ?? durationToFraction(note.duration, note.dots ?? 0);
      const noteEnd = fracToNumber(fracAdd(note.beat, noteDurFrac));

      if (noteEnd > measureDuration) {
        errors.push(
          `Note ${note.id} extends beyond measure (ends at ${noteEnd}, measure duration is ${measureDuration})`,
        );
      }

      if (fracLt(note.beat, fracCreate(0, 1))) {
        errors.push(`Note ${note.id} has negative beat position: ${fracToNumber(note.beat)}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Suggest automatic note quantization to fit in measure.
   * Quantizes beat position to nearest valid subdivision.
   */
  quantizeNote(
    note: NoteParams,
    timeSignature: TimeSignature,
    subdivision: number = 4,
  ): NoteParams {
    const measureDuration = getMeasureDuration(timeSignature);
    const quantum = measureDuration / subdivision;
    const beatNum = fracToNumber(note.beat);
    const noteDuration = durationToBeats(note.duration, note.dots || 0);

    const quantizedBeat = Math.round(beatNum / quantum) * quantum;
    const clampedBeat = Math.max(0, Math.min(quantizedBeat, measureDuration - noteDuration));

    return {
      ...note,
      beat: beatToFrac(clampedBeat),
    };
  }
}
