// Pixel-position note/tuplet entry for the score editor (issue #366, phase 3).
//
// Port of kikoromantest's mouse-entry paths (addNoteAtPosition,
// createTupletAtPosition, resolveClickToBeat), rewritten against
// ScoreEntryGeometry — VexFlow-native stave geometry supplied by the render
// layer — instead of the old ElementRegistry's harvested bounding boxes.
// Framework-free; drives ScoreModel/NoteEntryCoordinator like keyboard entry.

import type {
  Accidental,
  ArticulationType,
  Fraction,
  Note,
  NoteDuration,
  NoteParams,
  PitchSpelling,
  Tuplet,
} from '../../types/scoreClip';
import { ScoreModel } from './ScoreModel';
import { NoteEntryCoordinator } from './NoteEntryCoordinator';
import { CollisionDetector } from './CollisionDetector';
import { createTuplet, deleteTuplet, getTupletAtBeat, refillTupletRemainder } from './tupletOps';
import {
  beatToFrac,
  durationToBeats,
  getMeasureDuration,
  getTupletNoteDurationFrac,
  getTupletTotalBeatsFrac,
} from './musicUtils';
import {
  durationToFraction,
  fracAdd,
  fracEq,
  fracGt,
  fracGte,
  fracLt,
  fracSub,
  fracToNumber,
  tupletNoteDurationFraction,
} from './fraction';
import { accidentalToAlter, spellingToMidi } from './pitchSpelling';
import { Logger } from '../logger';

const log = Logger.create('ScoreMouseEntry');

const CLOSE_THRESHOLD = 25;
const FAR_THRESHOLD = 40;

/** A note/rest neighbor of a click position, for directional entry logic. */
export interface EntryNeighbor {
  type: 'note' | 'rest';
  /** Beat position (float — pixel-side quantities stay numeric) */
  beat: number;
}

/**
 * The stave geometry the entry logic needs — implemented by the render
 * layer's hit tester from live VexFlow Stave/StaveNote objects.
 */
export interface ScoreEntryGeometry {
  /** Measure number at a point, or null when outside every measure */
  measureAtPoint(coords: { x: number; y: number }): number | null;
  /** Natural (alter=0) pitch for a Y position, diatonically snapped */
  yToNaturalPitch(y: number, measure: number): PitchSpelling | null;
  /** Note-entry X span from stave.getNoteStartX()/getNoteEndX() */
  noteEntryXRange(measure: number): { startX: number; endX: number } | null;
  /** Top/bottom staff line Y positions */
  staffYRange(measure: number): { topY: number; bottomY: number } | null;
  /** Nearest rendered note/rest left and right of x within a measure */
  findNotesLeftRight(x: number, measure: number): {
    nearestLeft: EntryNeighbor | null;
    nearestRight: EntryNeighbor | null;
    leftDistance: number;
    rightDistance: number;
  };
  /** Linear x→beat fallback across the note-entry span */
  xToBeat(x: number, measure: number, beatsInMeasure: number): number;
}

export class MouseNoteEntry {
  private getScoreModel: () => ScoreModel;
  private coordinator: NoteEntryCoordinator;
  private collisionDetector: CollisionDetector;
  private getGeometry: () => ScoreEntryGeometry | null;
  private onCommit: (description: string) => void;

  constructor(
    getScoreModel: () => ScoreModel,
    coordinator: NoteEntryCoordinator,
    collisionDetector: CollisionDetector,
    getGeometry: () => ScoreEntryGeometry | null,
    onCommit: (description: string) => void,
  ) {
    this.getScoreModel = getScoreModel;
    this.coordinator = coordinator;
    this.collisionDetector = collisionDetector;
    this.getGeometry = getGeometry;
    this.onCommit = onCommit;
  }

  /**
   * Add a note at pixel coordinates.
   *
   * Directional logic:
   * 1. Find rendered elements LEFT and RIGHT of the click position
   * 2. If the click is FAR from all elements → coordinate-based beat calculation
   * 3. Priority: the element to the RIGHT determines behavior
   *    (rest → place at its beat; note → join its chord)
   * 4. If only a close LEFT element exists → use its beat
   * 5. Same-pitch collision → find the nearest rest instead
   */
  addNoteAtPosition(
    coords: { x: number; y: number },
    duration: NoteDuration,
    accidental?: Accidental,
    dots?: number,
    articulations?: ArticulationType[],
  ): Note | null {
    const geometry = this.getGeometry();
    if (!geometry) return null;

    const measureNumber = geometry.measureAtPoint(coords);
    if (measureNumber === null || !this.getScoreModel().getMeasure(measureNumber)) {
      log.debug('Entry rejected: no measure at point');
      return null;
    }
    const measure = this.getScoreModel().getMeasure(measureNumber)!;
    const beatsInMeasure = getMeasureDuration(measure.timeSignature);

    // Entry is valid only inside the note area (past clef/time signature,
    // before the barline) and within ~2 staff heights vertically
    const xRange = geometry.noteEntryXRange(measureNumber);
    if (xRange && (coords.x < xRange.startX || coords.x > xRange.endX)) {
      log.debug('Entry rejected: X outside note entry area');
      return null;
    }
    const yRange = geometry.staffYRange(measureNumber);
    if (yRange) {
      const staffHeight = yRange.bottomY - yRange.topY;
      const maxDistance = staffHeight * 2;
      if (coords.y < yRange.topY - maxDistance || coords.y > yRange.bottomY + maxDistance) {
        log.debug('Entry rejected: Y outside valid pitch range');
        return null;
      }
    }

    // Natural pitch from Y, then the armed accidental from the palette
    const naturalSpelling = geometry.yToNaturalPitch(coords.y, measureNumber);
    if (!naturalSpelling) return null;
    const alter = accidentalToAlter(accidental);
    const spelling: PitchSpelling = { ...naturalSpelling, alter };
    const pitchMidi = spellingToMidi(spelling.step, spelling.alter, spelling.octave);

    // Resolve beat using directional element logic
    const resolved = this.resolveClickToBeat(geometry, coords, measureNumber, beatsInMeasure, durationToBeats(duration));
    let finalBeat: Fraction = beatToFrac(resolved.beat);

    // When using coordinate calculation, land on a rest (or an existing chord)
    if (resolved.usedCoordCalc) {
      const notesInMeasure = this.getScoreModel().getNotesInMeasure(measureNumber);
      const restAtBeat = this.findRestAtBeat(notesInMeasure, finalBeat);
      if (!restAtBeat) {
        const notesAtBeat = notesInMeasure.filter(n => !n.isRest && fracEq(n.beat, finalBeat));
        if (notesAtBeat.length > 0) {
          const hasSamePitch = notesAtBeat.some(n => spellingToMidi(n.step!, n.alter!, n.octave!) === pitchMidi);
          if (hasSamePitch) {
            log.debug('Entry rejected: same pitch collision at calculated beat');
            return null;
          }
          // Different pitch → will form a chord at finalBeat
        } else {
          const nearestRest = this.findNearestRestToBeat(notesInMeasure, finalBeat);
          if (!nearestRest) {
            log.debug('Entry rejected: no available position');
            return null;
          }
          finalBeat = nearestRest.beat;
        }
      }
    }

    // Tuplet handling: snap into the tuplet's fill pointer or reject/delete
    let tupletId: string | undefined;
    const tupletAtBeat = getTupletAtBeat(this.getScoreModel(), measureNumber, finalBeat);

    if (tupletAtBeat) {
      const selectedDurationFrac = durationToFraction(duration, dots);
      const tupletTotalBeatsFrac = getTupletTotalBeatsFrac(tupletAtBeat.baseDuration, tupletAtBeat.notesOccupied);
      const tupletEndBeat = fracAdd(tupletAtBeat.startBeat, tupletTotalBeatsFrac);

      // Fill pointer: end of the last real note in the tuplet
      const realNotes = this.getScoreModel().getNotesInMeasure(measureNumber)
        .filter(n => n.tupletId === tupletAtBeat.id && !n.isRest)
        .sort((a, b) => fracToNumber(a.beat) - fracToNumber(b.beat));
      let fillPointer: Fraction;
      if (realNotes.length === 0) {
        fillPointer = tupletAtBeat.startBeat;
      } else {
        const last = realNotes[realNotes.length - 1];
        const lastActual = last.actualDuration
          ?? tupletNoteDurationFraction(last.duration, last.dots ?? 0, tupletAtBeat.numNotes, tupletAtBeat.notesOccupied);
        fillPointer = fracAdd(last.beat, lastActual);
      }

      if (fracGt(selectedDurationFrac, tupletTotalBeatsFrac)) {
        // Note larger than the entire tuplet → delete tuplet, place at its start
        deleteTuplet(this.getScoreModel(), tupletAtBeat.id);
        finalBeat = tupletAtBeat.startBeat;
      } else {
        const remainingActual = fracSub(tupletEndBeat, fillPointer);
        const scaledNoteDurationFrac = tupletNoteDurationFraction(duration, dots ?? 0, tupletAtBeat.numNotes, tupletAtBeat.notesOccupied);
        if (fracGt(scaledNoteDurationFrac, remainingActual)) {
          log.debug('Entry rejected: duration exceeds remaining tuplet space');
          return null;
        }
        tupletId = tupletAtBeat.id;
        finalBeat = fillPointer;
      }
    }

    const noteParams: NoteParams = {
      step: spelling.step,
      alter: spelling.alter,
      octave: spelling.octave,
      duration,
      measure: measureNumber,
      beat: finalBeat,
      // User explicitly armed ♮ in the palette → force the natural sign
      ...(accidental === 'n' && { forceAccidental: true }),
      ...(dots && { dots }),
      ...(tupletId && { tupletId }),
      ...(articulations?.length && { articulations }),
    };

    const targetMeasure = this.getScoreModel().getMeasure(measureNumber);
    if (!targetMeasure) return null;

    const overflow = this.collisionDetector.checkMeasureOverflow(
      noteParams,
      targetMeasure,
      this.getScoreModel().getNotesInMeasure(measureNumber),
    );

    // Delete notes the new note overwrites (same-pitch replacement + range)
    const notesToOverwrite = this.findNotesToOverwrite(measureNumber, finalBeat, duration, pitchMidi, tupletAtBeat);
    for (const noteToDelete of notesToOverwrite) {
      this.getScoreModel().deleteNote(noteToDelete.id);
    }

    // Tuplet notes spanning multiple slots: clear tuplet items inside the span
    if (tupletId && tupletAtBeat) {
      const actualNoteDurationFrac = tupletNoteDurationFraction(duration, dots ?? 0, tupletAtBeat.numNotes, tupletAtBeat.notesOccupied);
      const noteEndBeat = fracAdd(finalBeat, actualNoteDurationFrac);
      const tupletItemsToDelete = this.getScoreModel().getNotesInMeasure(measureNumber)
        .filter(n => n.tupletId === tupletId && fracGt(n.beat, finalBeat) && fracLt(n.beat, noteEndBeat));
      for (const itemToDelete of tupletItemsToDelete) {
        this.getScoreModel().deleteNote(itemToDelete.id);
      }
    }

    // Overflow: split across the barline with a tie (skip for tuplet notes)
    if (overflow.willOverflow && overflow.overflowAmount && !tupletId) {
      // Split existing chord members at the same beat too (skip already-tied)
      const existingChordNotes = this.getScoreModel().getNotesInMeasure(measureNumber)
        .filter(n => !n.isRest && fracEq(n.beat, finalBeat) && spellingToMidi(n.step!, n.alter!, n.octave!) !== pitchMidi && !n.tiedTo);
      for (const chordNote of existingChordNotes) {
        this.coordinator.splitExistingNoteWithTie(chordNote, duration, overflow.overflowAmount, dots);
      }

      const splitNote = this.coordinator.addSplitNoteWithTie(noteParams, overflow.overflowAmount);
      if (splitNote) {
        this.onCommit('Add note');
      }
      return splitNote;
    }

    // Non-overflow: sync existing chord members' duration
    const existingChordNotes = this.getScoreModel().getNotesInMeasure(measureNumber)
      .filter(n => !n.isRest && fracEq(n.beat, finalBeat) && spellingToMidi(n.step!, n.alter!, n.octave!) !== pitchMidi);
    for (const chordNote of existingChordNotes) {
      if (chordNote.duration !== duration) {
        this.getScoreModel().updateNote(chordNote.id, { duration });
      }
    }

    const note = this.getScoreModel().addNote(noteParams);

    if (note && tupletAtBeat && tupletId) {
      refillTupletRemainder(this.getScoreModel(), measureNumber, tupletAtBeat);
    }

    if (note) {
      log.debug('Note added at position', { decision: resolved.reason, beat: fracToNumber(finalBeat) });
      this.onCommit('Add note');
    }

    return note;
  }

  /**
   * Create a tuplet at a pixel position: the first note at the given pitch,
   * remaining positions filled with rests.
   */
  createTupletAtPosition(
    coords: { x: number; y: number },
    duration: NoteDuration,
    spelling: PitchSpelling,
    numNotes: number = 3,
    notesOccupied: number = 2,
  ): { tuplet: Tuplet; firstNote: Note } | null {
    const geometry = this.getGeometry();
    if (!geometry) return null;

    const measureNumber = geometry.measureAtPoint(coords);
    if (measureNumber === null) return null;
    const targetMeasure = this.getScoreModel().getMeasure(measureNumber);
    if (!targetMeasure) return null;

    const beatsInMeasure = getMeasureDuration(targetMeasure.timeSignature);
    const noteDurationInBeats = durationToBeats(duration);
    const tupletTotalBeats = noteDurationInBeats * notesOccupied;

    const resolved = this.resolveClickToBeat(geometry, coords, measureNumber, beatsInMeasure, noteDurationInBeats);
    // Clamp so the whole tuplet fits in the measure
    const beat = Math.max(0, Math.min(resolved.beat, beatsInMeasure - tupletTotalBeats));

    const existingTuplet = getTupletAtBeat(this.getScoreModel(), measureNumber, beatToFrac(beat));
    if (existingTuplet) {
      log.debug('Tuplet rejected: already exists at beat', { beat });
      return null;
    }

    return this.buildTupletWithFirstNote(measureNumber, beat, duration, spelling, numNotes, notesOccupied);
  }

  // ==================== Private helpers ====================

  /**
   * Create a tuplet and place the first note (or chord with an existing note).
   * Mirrors NoteEntryCoordinator's keyboard path, kept here because only mouse
   * entry can land on an occupied start beat.
   */
  private buildTupletWithFirstNote(
    measureNumber: number,
    beat: number,
    duration: NoteDuration,
    spelling: PitchSpelling,
    numNotes: number,
    notesOccupied: number,
  ): { tuplet: Tuplet; firstNote: Note } | null {
    // Save any existing note at the start position before createTuplet deletes it
    const existingNoteAtStart = this.getScoreModel().getNotesInMeasure(measureNumber)
      .find(n => !n.isRest && !n.tupletId && Math.abs(fracToNumber(n.beat) - beat) < 0.001);
    const existingNoteData = existingNoteAtStart
      ? { step: existingNoteAtStart.step, alter: existingNoteAtStart.alter, octave: existingNoteAtStart.octave }
      : null;

    const beatFrac = beatToFrac(beat);
    const tuplet = createTuplet(this.getScoreModel(), measureNumber, beatFrac, duration, numNotes, notesOccupied);
    const actualDuration = getTupletNoteDurationFrac(duration, numNotes, notesOccupied);

    if (existingNoteData) {
      this.getScoreModel().addNote({
        step: existingNoteData.step,
        alter: existingNoteData.alter,
        octave: existingNoteData.octave,
        duration,
        measure: measureNumber,
        beat: beatFrac,
        tupletId: tuplet.id,
        actualDuration,
      });
    }

    const firstNote = this.getScoreModel().addNote({
      step: spelling.step,
      alter: spelling.alter,
      octave: spelling.octave,
      duration,
      measure: measureNumber,
      beat: beatFrac,
      tupletId: tuplet.id,
      actualDuration,
    });

    refillTupletRemainder(this.getScoreModel(), measureNumber, tuplet);
    this.onCommit('Create tuplet');
    return { tuplet, firstNote };
  }

  /**
   * Resolve a pixel click to a beat position using directional element logic:
   * nearest left/right rendered elements with thresholds, falling back to a
   * quantized coordinate-based calculation in empty space.
   */
  private resolveClickToBeat(
    geometry: ScoreEntryGeometry,
    coords: { x: number; y: number },
    measureNumber: number,
    beatsInMeasure: number,
    quantizationBeats: number,
  ): { beat: number; reason: string; usedCoordCalc: boolean } {
    const { nearestLeft, nearestRight, leftDistance, rightDistance } =
      geometry.findNotesLeftRight(coords.x, measureNumber);

    const nearestDistance = Math.min(
      nearestLeft ? leftDistance : Infinity,
      nearestRight ? rightDistance : Infinity,
    );
    const rawBeat = geometry.xToBeat(coords.x, measureNumber, beatsInMeasure);
    const quantize = (raw: number) => {
      const q = Math.round(raw / quantizationBeats) * quantizationBeats;
      return Math.max(0, Math.min(q, beatsInMeasure - quantizationBeats));
    };

    if (nearestDistance > FAR_THRESHOLD) {
      return { beat: quantize(rawBeat), reason: `coordCalc (nearest ${nearestDistance.toFixed(0)}px)`, usedCoordCalc: true };
    }

    let targetElement: EntryNeighbor | null = null;
    let reason = '';

    if (nearestRight && rightDistance <= FAR_THRESHOLD) {
      if (nearestLeft && leftDistance < CLOSE_THRESHOLD && leftDistance < rightDistance) {
        targetElement = nearestLeft;
        reason = `left (${leftDistance.toFixed(0)}px, closer than right)`;
      } else {
        targetElement = nearestRight;
        reason = `right (${rightDistance.toFixed(0)}px)`;
      }
    } else if (nearestLeft && leftDistance <= FAR_THRESHOLD) {
      targetElement = nearestLeft;
      reason = `left-only (${leftDistance.toFixed(0)}px)`;
    }

    if (!targetElement) {
      return { beat: quantize(rawBeat), reason: 'coordCalc (no valid target)', usedCoordCalc: true };
    }
    return { beat: targetElement.beat, reason: `${reason} → ${targetElement.type}@${targetElement.beat}`, usedCoordCalc: false };
  }

  /** Find a rest whose time span covers the given beat. */
  private findRestAtBeat(notes: Note[], beat: Fraction): Note | null {
    for (const note of notes) {
      if (note.isRest) {
        const restEnd = fracAdd(note.beat, note.actualDuration ?? durationToFraction(note.duration, note.dots || 0));
        if (fracGte(beat, note.beat) && fracLt(beat, restEnd)) {
          return note;
        }
      }
    }
    return null;
  }

  /** Find the rest nearest to the given beat (before or after). */
  private findNearestRestToBeat(notes: Note[], targetBeat: Fraction): Note | null {
    let nearestRest: Note | null = null;
    let smallestDistance = Infinity;

    for (const note of notes) {
      if (note.isRest) {
        const distance = Math.abs(fracToNumber(fracSub(note.beat, targetBeat)));
        if (distance < smallestDistance) {
          smallestDistance = distance;
          nearestRest = note;
        }
      }
    }
    return nearestRest;
  }

  /**
   * Find notes the new note would overwrite: same-beat same-pitch replacements
   * and notes starting inside the new note's time range. Notes in the same
   * tuplet are protected except for exact same-beat same-pitch replacement.
   */
  private findNotesToOverwrite(
    measureNumber: number,
    beat: Fraction,
    duration: NoteDuration,
    pitch: number,
    tupletInfo?: Tuplet,
  ): Note[] {
    const noteDurationFrac = tupletInfo
      ? getTupletNoteDurationFrac(tupletInfo.baseDuration, tupletInfo.numNotes, tupletInfo.notesOccupied)
      : durationToFraction(duration);
    const noteEnd = fracAdd(beat, noteDurationFrac);
    const notesInMeasure = this.getScoreModel().getNotesInMeasure(measureNumber);

    return notesInMeasure.filter(existing => {
      // Rests are handled by ScoreModel's replaceRestsWithChord
      if (existing.isRest) return false;

      if (tupletInfo && existing.tupletId === tupletInfo.id) {
        // Same tuplet: only exact same-beat same-pitch replacement
        return fracEq(existing.beat, beat) &&
          spellingToMidi(existing.step!, existing.alter!, existing.octave!) === pitch;
      }

      if (fracEq(existing.beat, beat)) {
        // Same beat: same pitch = replacement, different pitch = chord
        return spellingToMidi(existing.step!, existing.alter!, existing.octave!) === pitch;
      }

      // Starts inside the new note's time range
      return fracGt(existing.beat, beat) && fracLt(existing.beat, noteEnd);
    });
  }
}
