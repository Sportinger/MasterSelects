// Note/tuplet entry logic for the score editor (issue #366).
//
// Handles beat-based note entry with full overflow handling: splitting notes
// across barlines with ties, Sibelius-style erosion of displaced content, and
// tuplet-aware duration clamping. Delegates data mutations to ScoreModel and
// calls onCommit(description) so the host can persist scoreData + capture a
// history snapshot.
//
// The pixel-position entry paths (mouse clicks) from kikoromantest depended on
// its ElementRegistry and are ported in the interaction phase together with
// the VexFlow-native hit-test layer; this module is framework-free.

import type { Note, NoteParams, Tuplet, NoteDuration, PitchSpelling } from '../../types/scoreClip';
import { ScoreModel } from './ScoreModel';
import { CollisionDetector } from './CollisionDetector';
import {
  durationToBeats,
  splitBeatsIntoDurations,
  getTupletTotalBeatsFrac,
  beatToFrac,
} from './musicUtils';
import {
  fracToNumber,
  fracAdd,
  fracSub,
  fracMul,
  fracGt,
  fracFromInt,
  fracCreate,
  durationToFraction,
} from './fraction';
import {
  createTuplet,
  getTupletAtBeat,
  getNotesInTuplet,
  refillTupletRemainder,
} from './tupletOps';
import { Logger } from '../logger';

const log = Logger.create('ScoreNoteEntry');

/**
 * Coordinates note and tuplet entry against a ScoreModel.
 * `onCommit(description)` fires after each complete entry operation.
 */
export class NoteEntryCoordinator {
  private getScoreModel: () => ScoreModel;
  private collisionDetector: CollisionDetector;
  private onCommit: (description: string) => void;

  constructor(
    getScoreModel: () => ScoreModel,
    collisionDetector: CollisionDetector,
    onCommit: (description: string) => void,
  ) {
    this.getScoreModel = getScoreModel;
    this.collisionDetector = collisionDetector;
    this.onCommit = onCommit;
  }

  // ==================== Public: Beat-based Entry ====================

  /**
   * Add a note by beat/measure position with full overflow handling (tie
   * splitting across barlines). Returns the first note placed (in the current
   * measure), or null if placement failed.
   */
  addNoteAtBeat(params: NoteParams): Note | null {
    const targetMeasure = this.getScoreModel().getMeasure(params.measure);
    if (!targetMeasure) return null;

    // Detect tuplet context: auto-assign tupletId and snap beat if this beat falls inside a tuplet
    const finalBeatFrac = params.beat;
    let tupletId = params.tupletId;
    const tupletAtBeat = tupletId
      ? (targetMeasure.tuplets || []).find(t => t.id === tupletId)
      : getTupletAtBeat(this.getScoreModel(), params.measure, params.beat);

    if (tupletAtBeat && !tupletId) {
      tupletId = tupletAtBeat.id;
    }

    // Clamp note duration to remaining actual tuplet space. If the selected
    // written duration would overflow the tuplet, silently use the largest
    // standard duration that fits instead — same behaviour as Sibelius.
    if (tupletAtBeat) {
      const ratio = fracCreate(tupletAtBeat.notesOccupied, tupletAtBeat.numNotes);
      const tupletEnd = fracAdd(tupletAtBeat.startBeat, getTupletTotalBeatsFrac(tupletAtBeat.baseDuration, tupletAtBeat.notesOccupied));
      const remainingActual = fracSub(tupletEnd, finalBeatFrac);
      const noteActual = fracMul(durationToFraction(params.duration, params.dots || 0), ratio);
      if (fracGt(noteActual, remainingActual)) {
        const maxWritten = fracToNumber(fracMul(remainingActual, fracCreate(tupletAtBeat.numNotes, tupletAtBeat.notesOccupied)));
        const fitting = splitBeatsIntoDurations(maxWritten);
        if (fitting.length === 0) return null;
        log.debug('Tuplet duration clamped', { from: params.duration, to: fitting[0] });
        params = { ...params, duration: fitting[0], dots: 0 };
      }
    }

    // Calculate effective note duration (scaled by tuplet ratio when inside a tuplet)
    const finalBeat = fracToNumber(finalBeatFrac);
    const nominalDuration = durationToBeats(params.duration, params.dots || 0);
    const tupletRatio = tupletAtBeat ? tupletAtBeat.notesOccupied / tupletAtBeat.numNotes : 1;
    const effectiveDuration = nominalDuration * tupletRatio;
    // Set actualDuration so checkMeasureOverflow uses the scaled duration, not the written one
    const actualDuration = tupletAtBeat
      ? fracMul(durationToFraction(params.duration, params.dots || 0), fracCreate(tupletAtBeat.notesOccupied, tupletAtBeat.numNotes))
      : undefined;

    const finalParams: NoteParams = { ...params, beat: finalBeatFrac, ...(tupletId ? { tupletId } : {}), ...(actualDuration ? { actualDuration } : {}) };
    const noteEnd = finalBeat + effectiveDuration;

    // Remove overlapping CHORD notes atomically, using scaled durations for tuplet notes.
    // Rests are intentionally skipped here — replaceRestsWithChord (inside addNote) handles
    // rest removal with proper tie migration, so deleting rests here would break that.
    const epsilon = 0.001;
    const toDelete = this.getScoreModel().getNotesInMeasure(params.measure).filter(n => {
      if (n.isRest) return false;
      let nDuration = durationToBeats(n.duration, n.dots || 0);
      if (n.tupletId) {
        const nTuplet = (targetMeasure.tuplets || []).find(t => t.id === n.tupletId);
        if (nTuplet) nDuration *= nTuplet.notesOccupied / nTuplet.numNotes;
      }
      const nBeat = fracToNumber(n.beat);
      const nEnd = nBeat + nDuration;
      return nBeat + epsilon < noteEnd && nEnd - epsilon > finalBeat;
    });
    for (const n of toDelete) {
      this.getScoreModel().deleteNote(n.id);
    }

    const overflow = this.collisionDetector.checkMeasureOverflow(
      finalParams,
      targetMeasure,
      this.getScoreModel().getNotesInMeasure(params.measure),
    );

    if (overflow.willOverflow && overflow.overflowAmount) {
      log.debug('Entry overflows measure — splitting with tie', {
        step: params.step, octave: params.octave, duration: params.duration,
        measure: params.measure, beat: finalBeat, overflow: overflow.overflowAmount,
      });
      const splitNote = this.addSplitNoteWithTie(finalParams, overflow.overflowAmount);
      if (splitNote) {
        this.onCommit('Enter note');
      }
      return splitNote;
    }

    const note = this.getScoreModel().addNote(finalParams);

    if (tupletAtBeat && tupletId) {
      refillTupletRemainder(this.getScoreModel(), params.measure, tupletAtBeat);
    }

    this.onCommit('Enter note');
    return note;
  }

  // ==================== Public: Tuplet Entry ====================

  /**
   * Create a tuplet at a specific beat position (keyboard entry mode):
   * a complete tuplet with the first note at the given pitch and remaining
   * positions as rests.
   */
  createTupletAtBeat(
    measureNumber: number,
    beat: number,
    duration: NoteDuration,
    spelling: PitchSpelling,
    numNotes: number = 3,
    notesOccupied: number = 2,
  ): { tuplet: Tuplet; firstNote: Note } | null {
    const targetMeasure = this.getScoreModel().getMeasure(measureNumber);
    if (!targetMeasure) return null;

    const existingTuplet = getTupletAtBeat(this.getScoreModel(), measureNumber, beatToFrac(beat));
    if (existingTuplet) return null;

    return this.buildTupletWithFirstNote(measureNumber, beat, duration, spelling, numNotes, notesOccupied);
  }

  /**
   * Convert an existing selected note or rest into the first element of a
   * tuplet. Used when the user presses the tuplet button in selection mode
   * with a note/rest selected.
   */
  applyTupletToNote(
    noteId: string,
    numNotes: number = 3,
    notesOccupied: number = 2,
  ): { tuplet: Tuplet; note: Note } | null {
    const note = this.getScoreModel().getNote(noteId);
    if (!note || note.tupletId) return null;

    const existingTuplet = getTupletAtBeat(this.getScoreModel(), note.measure, note.beat);
    if (existingTuplet) return null;

    // createTuplet removes overlapping slots; places no initial rests
    const tuplet = createTuplet(this.getScoreModel(), note.measure, note.beat, note.duration, numNotes, notesOccupied);
    const actualDuration = fracMul(durationToFraction(note.duration), fracCreate(notesOccupied, numNotes));

    let resultNote: Note;
    if (note.isRest) {
      // Tuplet starts empty — refill will place the full-span filler rest
      refillTupletRemainder(this.getScoreModel(), note.measure, tuplet);
      const rests = getNotesInTuplet(this.getScoreModel(), tuplet.id);
      resultNote = rests[0];
      if (!resultNote) return null;
    } else {
      // Place the original note as the first tuplet note, then fill remainder
      resultNote = this.getScoreModel().addNote({
        step: note.step,
        alter: note.alter,
        octave: note.octave,
        duration: note.duration,
        measure: note.measure,
        beat: tuplet.startBeat,
        tupletId: tuplet.id,
        actualDuration,
        ...(note.stemDirection && { stemDirection: note.stemDirection }),
      });
      refillTupletRemainder(this.getScoreModel(), note.measure, tuplet);
    }

    this.onCommit('Apply tuplet');
    return { tuplet, note: resultNote };
  }

  // ==================== Private Helpers ====================

  /**
   * Create a tuplet and place the first note (or chord with an existing note).
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

    // Create the tuplet (removes overlapping slots, places no initial rests)
    const beatFrac = beatToFrac(beat);
    const tuplet = createTuplet(this.getScoreModel(), measureNumber, beatFrac, duration, numNotes, notesOccupied);
    const actualDuration = fracMul(durationToFraction(duration), fracCreate(notesOccupied, numNotes));

    if (existingNoteData) {
      // Re-add the pre-existing note as chord member before the new note
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
   * Split an existing note with a tie when its duration changes to overflow.
   */
  splitExistingNoteWithTie(existingNote: Note, newDuration: NoteParams['duration'], overflowAmount: number, newDots: number = 0): void {
    const totalBeats = durationToBeats(newDuration, newDots);
    const beatsInCurrentMeasure = totalBeats - overflowAmount;
    const beatsInNextMeasure = overflowAmount;

    const currentMeasureDurations = splitBeatsIntoDurations(beatsInCurrentMeasure);
    const nextMeasureDurations = splitBeatsIntoDurations(beatsInNextMeasure);

    if (currentMeasureDurations.length === 0 || nextMeasureDurations.length === 0) {
      log.warn('Could not split existing note into valid durations');
      return;
    }

    // Update the existing note's duration to the first part (clear dots — split durations are always plain)
    this.getScoreModel().updateNote(existingNote.id, { duration: currentMeasureDurations[0], dots: 0 });

    // Check if next measure exists, if not create it
    const nextMeasureNumber = existingNote.measure + 1;
    if (!this.ensureMeasureExists(nextMeasureNumber)) {
      log.warn('Could not create next measure for tie split');
      return;
    }

    // Erode notes in the overflow zone of the next measure (Sibelius-style)
    this.erodeOverflowZone(nextMeasureNumber, beatsInNextMeasure);

    // Build a chain of tied notes across the barline.
    // Chain: existingNote → [extra current-measure notes if needed] → [next-measure notes]
    let previousNoteId = existingNote.id;

    // Add any extra tied notes within the current measure (when split needs > 1 duration, e.g. 3 beats → h + q)
    let currentBeat = fracAdd(existingNote.beat, durationToFraction(currentMeasureDurations[0]));
    for (let i = 1; i < currentMeasureDurations.length; i++) {
      const dur = currentMeasureDurations[i];
      const extraNote = this.getScoreModel().addNote({
        step: existingNote.step,
        alter: existingNote.alter,
        octave: existingNote.octave,
        duration: dur,
        measure: existingNote.measure,
        beat: currentBeat,
      });
      this.getScoreModel().updateNote(previousNoteId, { tiedTo: extraNote.id });
      this.getScoreModel().updateNote(extraNote.id, { tiedFrom: previousNoteId });
      previousNoteId = extraNote.id;
      currentBeat = fracAdd(currentBeat, durationToFraction(dur));
    }

    // Add tied continuation notes in the next measure
    let nextBeat = fracFromInt(0);
    for (const duration of nextMeasureDurations) {
      const continuationNote = this.getScoreModel().addNote({
        step: existingNote.step,
        alter: existingNote.alter,
        octave: existingNote.octave,
        duration,
        measure: nextMeasureNumber,
        beat: nextBeat,
      });
      this.getScoreModel().updateNote(previousNoteId, { tiedTo: continuationNote.id });
      this.getScoreModel().updateNote(continuationNote.id, { tiedFrom: previousNoteId });
      previousNoteId = continuationNote.id;
      nextBeat = fracAdd(nextBeat, durationToFraction(duration));
    }
  }

  /** Create measures up to and including measureNumber; false if impossible. */
  private ensureMeasureExists(measureNumber: number): boolean {
    let attempts = 20;
    while (!this.getScoreModel().getMeasure(measureNumber) && attempts-- > 0) {
      this.getScoreModel().addMeasure();
    }
    return Boolean(this.getScoreModel().getMeasure(measureNumber));
  }

  /**
   * Add a note that spans across a bar line by splitting it with a tie.
   * Returns the first note (in current measure) or null if failed.
   */
  private addSplitNoteWithTie(noteParams: NoteParams, overflowAmount: number): Note | null {
    const totalBeats = durationToBeats(noteParams.duration, noteParams.dots || 0);
    const beatsInCurrentMeasure = totalBeats - overflowAmount;
    const beatsInNextMeasure = overflowAmount;

    const currentMeasureDurations = splitBeatsIntoDurations(beatsInCurrentMeasure);
    const nextMeasureDurations = splitBeatsIntoDurations(beatsInNextMeasure);

    if (currentMeasureDurations.length === 0 || nextMeasureDurations.length === 0) {
      log.warn('Could not split note into valid durations');
      return null;
    }

    // Check if next measure exists, if not create it
    const nextMeasureNumber = noteParams.measure + 1;
    if (!this.ensureMeasureExists(nextMeasureNumber)) {
      log.warn('Could not create next measure for tie split');
      return null;
    }

    // Erode notes in the overflow zone of the next measure (Sibelius-style)
    this.erodeOverflowZone(nextMeasureNumber, beatsInNextMeasure);

    // Add notes in current measure (may need multiple if duration splits, e.g., dotted notes).
    // Split durations are standard non-dotted durations — no dots on the parts.
    let currentBeat = noteParams.beat;
    let firstNote: Note | null = null;
    let previousNote: Note | null = null;

    for (const duration of currentMeasureDurations) {
      const note = this.getScoreModel().addNote({
        step: noteParams.step,
        alter: noteParams.alter,
        octave: noteParams.octave,
        duration,
        measure: noteParams.measure,
        beat: currentBeat,
      });
      if (!firstNote) firstNote = note;

      // Link with previous note in current measure if there are multiple
      if (previousNote) {
        this.getScoreModel().updateNote(previousNote.id, { tiedTo: note.id });
        this.getScoreModel().updateNote(note.id, { tiedFrom: previousNote.id });
      }

      previousNote = note;
      currentBeat = fracAdd(currentBeat, durationToFraction(duration));
    }

    // Add notes in next measure
    let nextBeat = fracFromInt(0);
    for (const duration of nextMeasureDurations) {
      const note = this.getScoreModel().addNote({
        step: noteParams.step,
        alter: noteParams.alter,
        octave: noteParams.octave,
        duration,
        measure: nextMeasureNumber,
        beat: nextBeat,
      });

      // Link with previous note (tie across bar line)
      if (previousNote) {
        this.getScoreModel().updateNote(previousNote.id, { tiedTo: note.id });
        this.getScoreModel().updateNote(note.id, { tiedFrom: previousNote.id });
      }

      previousNote = note;
      nextBeat = fracAdd(nextBeat, durationToFraction(duration));
    }

    return firstNote;
  }

  /**
   * Erode all notes in the overflow zone of the next measure.
   * Notes fully within [0, overflowBeats) are deleted.
   * Notes that straddle the boundary are trimmed and moved to start at overflowBeats.
   * Notes with a downstream tiedTo are deleted (punt case).
   */
  private erodeOverflowZone(measureNumber: number, overflowBeats: number): void {
    const epsilon = 0.001;
    const notes = this.getScoreModel().getNotesInMeasure(measureNumber);
    for (const note of notes) {
      if (note.isRest) continue;
      const noteBeat = fracToNumber(note.beat);
      if (noteBeat >= overflowBeats - epsilon) continue;
      this.erodeNoteAtBoundary(note, overflowBeats);
    }
  }

  /**
   * Erode a single note that starts within the overflow zone.
   * - Fully consumed (noteEnd <= overflowBeats): break upstream tiedFrom, delete.
   * - Straddles (noteEnd > overflowBeats, no tiedTo): trim duration and move to overflowBeats.
   *   If the remainder needs multiple durations, build a tie chain for the tail.
   * - Has tiedTo (downstream chain): delete (punt case — too complex to rewire).
   */
  private erodeNoteAtBoundary(note: Note, overflowBeats: number): void {
    const epsilon = 0.001;
    const noteBeat = fracToNumber(note.beat);
    const noteDurBeats = durationToBeats(note.duration, note.dots ?? 0);
    const noteEnd = noteBeat + noteDurBeats;

    if (noteEnd <= overflowBeats + epsilon) {
      // Fully consumed — break upstream tie pointer then delete
      if (note.tiedFrom) {
        this.getScoreModel().updateNote(note.tiedFrom, { tiedTo: undefined });
      }
      this.getScoreModel().deleteNote(note.id);
      return;
    }

    // Straddles boundary — punt to deletion if note has a downstream tie chain
    if (note.tiedTo) {
      this.getScoreModel().deleteNote(note.id);
      return;
    }

    // Trim: remainder starts at overflowBeats
    const remainderBeats = noteEnd - overflowBeats;
    const remainderDurations = splitBeatsIntoDurations(remainderBeats);
    if (remainderDurations.length === 0) {
      this.getScoreModel().deleteNote(note.id);
      return;
    }

    // Break incoming tie
    if (note.tiedFrom) {
      this.getScoreModel().updateNote(note.tiedFrom, { tiedTo: undefined });
    }

    // Update the note: first remainder duration, moved to overflowBeats
    this.getScoreModel().updateNote(note.id, {
      duration: remainderDurations[0],
      dots: 0,
      beat: beatToFrac(overflowBeats),
      tiedFrom: undefined,
    });

    // Build tie chain for any additional remainder durations
    if (remainderDurations.length > 1) {
      let prevId = note.id;
      let currentBeat = fracAdd(beatToFrac(overflowBeats), durationToFraction(remainderDurations[0]));
      for (let i = 1; i < remainderDurations.length; i++) {
        const dur = remainderDurations[i];
        const tailNote = this.getScoreModel().addNote({
          step: note.step,
          alter: note.alter,
          octave: note.octave,
          duration: dur,
          measure: note.measure,
          beat: currentBeat,
        });
        this.getScoreModel().updateNote(prevId, { tiedTo: tailNote.id });
        this.getScoreModel().updateNote(tailNote.id, { tiedFrom: prevId });
        prevId = tailNote.id;
        currentBeat = fracAdd(currentBeat, durationToFraction(dur));
      }
    }
  }
}
