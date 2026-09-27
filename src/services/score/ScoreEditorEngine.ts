// Score editor engine facade (issue #366, phase 3).
//
// Port of kikoromantest's MusicEngine minus what the host replaces: its
// UndoRedoManager is gone (every mutation commits durable ScoreData through
// `onCommit`, and the host historyStore owns undo), its PlaybackEngine waits
// for the audio phase, and its CoordinateMapper/ElementRegistry are replaced
// by the render layer's geometry (pixel entry lives in MouseNoteEntry).
// Owns the live ScoreModel and the editing semantics above raw slot CRUD:
// duration changes with rest backfill/erosion, ties, articulations, stems.

import type {
  ArticulationType,
  Fraction,
  Measure,
  Note,
  NoteDuration,
  NoteParams,
  PitchSpelling,
  Score,
  ScoreData,
  Tuplet,
} from '../../types/scoreClip';
import { ScoreModel } from './ScoreModel';
import { CollisionDetector } from './CollisionDetector';
import { NoteEntryCoordinator } from './NoteEntryCoordinator';
import { MouseNoteEntry, type ScoreEntryGeometry } from './MouseNoteEntry';
import {
  deleteTuplet as deleteTupletOp,
  getTuplet as getTupletOp,
  getTupletAtBeat as getTupletAtBeatOp,
  refillTupletRemainder,
} from './tupletOps';
import { durationToBeats, splitBeatsIntoDurations, getMeasureDuration } from './musicUtils';
import { durationToFraction, fracAdd, fracCompare, fracEq, fracToNumber } from './fraction';
import { spellingDiatonicPos } from './pitchSpelling';
import { CLEF_CONFIG } from './render/scoreNoteFactory';

/** Commit options: transient edits (live drags) skip the history snapshot. */
export interface ScoreCommitOptions {
  transient?: boolean;
}

export type ScoreCommitHandler = (description: string, options?: ScoreCommitOptions) => void;

/** Internal context passed to updateNote sub-methods */
interface NoteUpdateCtx {
  noteId: string;
  updates: Partial<NoteParams>;
  existingNote: Note;
  measureNotes: Note[];
  chordNotes: Note[];
  isChord: boolean;
  oldBeats: number;
  newBeats: number;
  newDuration: NoteDuration;
  newDots: number;
  beatDifference: number;
}

export class ScoreEditorEngine {
  private model: ScoreModel;
  private collisionDetector = new CollisionDetector();
  private coordinator: NoteEntryCoordinator;
  private mouseEntry: MouseNoteEntry;
  private onCommit: ScoreCommitHandler;

  constructor(
    initial: ScoreData,
    onCommit: ScoreCommitHandler,
    getGeometry: () => ScoreEntryGeometry | null,
  ) {
    this.onCommit = onCommit;
    this.model = ScoreModel.fromScoreData(initial);
    this.coordinator = new NoteEntryCoordinator(
      () => this.model,
      this.collisionDetector,
      description => this.commit(description),
    );
    this.mouseEntry = new MouseNoteEntry(
      () => this.model,
      this.coordinator,
      this.collisionDetector,
      getGeometry,
      description => this.commit(description),
    );
  }

  /** Repair measure fill invariants, then persist through the host. */
  private commit(description: string, options?: ScoreCommitOptions): void {
    this.model.repairAllMeasureGaps();
    this.onCommit(description, options);
  }

  /** Replace the model from durable data (external change: undo/redo, agent). */
  loadScoreData(data: ScoreData): void {
    this.model = ScoreModel.fromScoreData(data);
  }

  toScoreData(): ScoreData {
    return this.model.toScoreData();
  }

  // ==================== Score operations ====================

  getScore(): Score {
    return this.model.getScore();
  }

  getNote(noteId: string): Note | undefined {
    return this.model.getNote(noteId);
  }

  getTuplet(tupletId: string): Tuplet | undefined {
    return getTupletOp(this.model, tupletId);
  }

  getTupletAtBeat(measureNumber: number, beat: Fraction): Tuplet | undefined {
    return getTupletAtBeatOp(this.model, measureNumber, beat);
  }

  addMeasure(): void {
    this.model.addMeasure();
    this.commit('Add measure');
  }

  clearAllNotes(): void {
    this.model.clearAllNotes();
    this.commit('Clear notes');
  }

  // ==================== Entry ====================

  /** Beat-based entry with overflow tie-splitting (keyboard mode). */
  addNoteAtBeat(params: NoteParams): Note | null {
    return this.coordinator.addNoteAtBeat(params);
  }

  /** Pixel-position entry (mouse). */
  addNoteAtPosition(
    coords: { x: number; y: number },
    duration: NoteDuration,
    accidental?: Parameters<MouseNoteEntry['addNoteAtPosition']>[2],
    dots?: number,
    articulations?: ArticulationType[],
  ): Note | null {
    return this.mouseEntry.addNoteAtPosition(coords, duration, accidental, dots, articulations);
  }

  /** Add a note to an existing chord (same beat/measure as an existing note). */
  addChordNote(params: NoteParams): Note {
    const note = this.model.addNote(params);
    this.commit('Add chord note');
    return note;
  }

  createTupletAtPosition(
    coords: { x: number; y: number },
    duration: NoteDuration,
    spelling: PitchSpelling,
    numNotes: number = 3,
    notesOccupied: number = 2,
  ): { tuplet: Tuplet; firstNote: Note } | null {
    return this.mouseEntry.createTupletAtPosition(coords, duration, spelling, numNotes, notesOccupied);
  }

  createTupletAtBeat(
    measureNumber: number,
    beat: number,
    duration: NoteDuration,
    spelling: PitchSpelling,
    numNotes: number = 3,
    notesOccupied: number = 2,
  ): { tuplet: Tuplet; firstNote: Note } | null {
    return this.coordinator.createTupletAtBeat(measureNumber, beat, duration, spelling, numNotes, notesOccupied);
  }

  applyTupletToNote(noteId: string, numNotes: number = 3, notesOccupied: number = 2): { tuplet: Tuplet; note: Note } | null {
    return this.coordinator.applyTupletToNote(noteId, numNotes, notesOccupied);
  }

  deleteTuplet(tupletId: string): boolean {
    const result = deleteTupletOp(this.model, tupletId);
    if (result) {
      this.commit('Delete tuplet');
    }
    return result;
  }

  // ==================== Mutation ====================

  /**
   * Update a note. Dispatches to the tuplet or non-tuplet path; shortening a
   * duration backfills rests, lengthening erodes overlapped content, and a
   * non-tuplet overflow splits across the barline with a tie (Dorico-style).
   * `options.transient` skips the history snapshot (live pitch drags).
   */
  updateNote(noteId: string, updates: Partial<NoteParams>, options?: ScoreCommitOptions): Note {
    const existingNote = this.model.getNote(noteId);
    if (!existingNote) throw new Error(`Note ${noteId} not found`);

    const oldDuration = existingNote.duration;
    const oldDots = existingNote.dots || 0;
    let newDuration = updates.duration || oldDuration;
    const newDots = updates.dots !== undefined ? updates.dots : oldDots;

    const measureNotes = this.model.getNotesInMeasure(existingNote.measure);
    const chordNotes = this.getChordNotesAt(existingNote.measure, existingNote.beat);
    const isChord = chordNotes.length > 1;

    // Measure overflow check for duration/dot changes (non-tuplet notes)
    const measure = this.model.getMeasure(existingNote.measure);
    if (measure && (updates.duration || updates.dots !== undefined)) {
      const measureTotalBeats = getMeasureDuration(measure.timeSignature);
      const availableBeats = measureTotalBeats - fracToNumber(existingNote.beat);
      const requestedBeats = durationToBeats(newDuration, newDots);

      if (requestedBeats > availableBeats + 0.001 && !existingNote.tupletId) {
        if (!existingNote.isRest) {
          // Split across the barline with a tie
          const overflowAmount = requestedBeats - availableBeats;
          const oldNoteEnd = fracToNumber(existingNote.beat) + durationToBeats(oldDuration, oldDots);

          // Clear notes in the current measure inside the extended range
          for (const n of measureNotes) {
            if (n.id === noteId || chordNotes.some(c => c.id === n.id)) continue;
            const nStart = fracToNumber(n.beat);
            if (nStart >= oldNoteEnd - 0.001 && nStart < fracToNumber(existingNote.beat) + availableBeats - 0.001) {
              this.model.deleteNote(n.id);
            }
          }

          for (const chordNote of chordNotes) {
            if (chordNote.id === noteId) continue;
            this.coordinator.splitExistingNoteWithTie(chordNote, newDuration, overflowAmount, newDots);
          }
          this.coordinator.splitExistingNoteWithTie(existingNote, newDuration, overflowAmount, newDots);

          this.commit('Update note duration', options);
          return this.model.getNote(noteId)!;
        }

        // Rest overflow: clip to fit within the measure
        const fittingDuration = this.findLargestFittingDuration(availableBeats);
        if (fittingDuration) {
          newDuration = fittingDuration;
          updates = { ...updates, duration: fittingDuration, dots: 0 };
        } else {
          newDuration = oldDuration;
          updates = { ...updates };
          delete updates.duration;
          delete updates.dots;
        }
      }
    }

    const oldBeats = durationToBeats(oldDuration, oldDots);
    const newBeats = durationToBeats(newDuration, newDots);
    const beatDifference = oldBeats - newBeats;

    const ctx: NoteUpdateCtx = {
      noteId, updates, existingNote, measureNotes,
      chordNotes, isChord, oldBeats, newBeats, newDuration, newDots, beatDifference,
    };

    // Tuplet notes have their own duration constraints and filler logic
    if (existingNote.tupletId && measure) {
      const tuplet = measure.tuplets?.find(t => t.id === existingNote.tupletId);
      if (tuplet) return this.updateTupletNote(ctx, tuplet, options);
    }

    return this.updateNonTupletNote(ctx, options);
  }

  /** Duration updates for notes inside a tuplet. */
  private updateTupletNote(ctx: NoteUpdateCtx, tuplet: Tuplet, options?: ScoreCommitOptions): Note {
    let { updates, newBeats, newDuration } = ctx;
    const { noteId, existingNote, measureNotes, chordNotes, isChord, newDots } = ctx;

    const tupletRatio = tuplet.notesOccupied / tuplet.numNotes;
    const tupletTotalBeats = durationToBeats(tuplet.baseDuration) * tuplet.notesOccupied;
    const tupletEndBeat = fracToNumber(tuplet.startBeat) + tupletTotalBeats;
    const remainingTupletBeats = tupletEndBeat - fracToNumber(existingNote.beat);

    // Clamp new duration to the remaining tuplet space
    const scaledNewDuration = newBeats * tupletRatio;
    if (scaledNewDuration > remainingTupletBeats + 0.001) {
      const maxNormalBeats = remainingTupletBeats / tupletRatio;
      const fittingDuration = this.findLargestFittingDuration(maxNormalBeats);
      if (!fittingDuration) return existingNote;
      newDuration = fittingDuration;
      updates = { ...updates, duration: fittingDuration, dots: 0 };
      newBeats = durationToBeats(fittingDuration);
    }

    // Delete tuplet items inside the new note's actual time span
    const actualNewDuration = newBeats * tupletRatio;
    const existingBeatNum = fracToNumber(existingNote.beat);
    const noteEndBeat = existingBeatNum + actualNewDuration;
    const itemsToDelete = measureNotes.filter(n =>
      n.tupletId === existingNote.tupletId &&
      n.id !== noteId &&
      fracToNumber(n.beat) > existingBeatNum + 0.001 &&
      fracToNumber(n.beat) < noteEndBeat - 0.001,
    );
    for (const item of itemsToDelete) this.model.deleteNote(item.id);

    const updatedNote = this.model.updateNote(noteId, updates);

    // Recompute filler rests from the fill pointer
    refillTupletRemainder(this.model, existingNote.measure, tuplet);

    // Keep chord members' duration in sync
    if (isChord) {
      for (const chordNote of chordNotes) {
        if (chordNote.id !== noteId) {
          this.model.updateNote(chordNote.id, { duration: newDuration, dots: newDots });
        }
      }
    }

    this.commit('Update tuplet note', options);
    return updatedNote;
  }

  /** Duration updates for regular notes, chords and singles. */
  private updateNonTupletNote(ctx: NoteUpdateCtx, options?: ScoreCommitOptions): Note {
    const { noteId, updates, existingNote, measureNotes, chordNotes, isChord, oldBeats, newBeats, newDuration, newDots, beatDifference } = ctx;

    // Lengthening: remove overlapped notes/rests first
    if (beatDifference < -0.001) {
      const existingBeatNum = fracToNumber(existingNote.beat);
      const noteEndBeat = existingBeatNum + newBeats;
      const chordNoteIds = new Set(chordNotes.map(n => n.id));
      const notesToRemove: string[] = [];
      let beatsToRecover = 0;

      for (const n of measureNotes) {
        if (n.id === noteId || chordNoteIds.has(n.id)) continue;
        const nStart = fracToNumber(n.beat);
        const nEnd = nStart + durationToBeats(n.duration, n.dots || 0);
        if (nStart >= existingBeatNum + oldBeats && nStart < noteEndBeat) {
          // Starts within the extended range — remove entirely
          notesToRemove.push(n.id);
          beatsToRecover += durationToBeats(n.duration, n.dots || 0);
        } else if (nStart < existingBeatNum + oldBeats && nEnd > existingBeatNum + oldBeats && nEnd <= noteEndBeat) {
          // Starts before but extends into the range — remove
          notesToRemove.push(n.id);
          beatsToRecover += durationToBeats(n.duration, n.dots || 0);
        }
      }

      for (const id of notesToRemove) this.model.deleteNote(id);

      // Removed more than needed → backfill the excess with rests
      const excessBeats = beatsToRecover - Math.abs(beatDifference);
      if (excessBeats > 0.001) {
        let currentBeat = fracAdd(existingNote.beat, durationToFraction(newDuration, newDots));
        for (const restDuration of splitBeatsIntoDurations(excessBeats)) {
          this.model.addRest(restDuration, existingNote.measure, currentBeat);
          currentBeat = fracAdd(currentBeat, durationToFraction(restDuration));
        }
      }
    }

    // Chords: keep all members' duration and dots in sync
    if (isChord && (updates.duration || updates.dots !== undefined)) {
      for (const chordNote of chordNotes) {
        if (chordNote.id === noteId) continue;
        this.model.updateNote(chordNote.id, { duration: newDuration, dots: newDots });
      }
    }

    const note = this.model.updateNote(noteId, updates);

    // Shortening: fill the gap with rests
    if (beatDifference > 0.001) {
      let currentBeat = fracAdd(note.beat, durationToFraction(newDuration, newDots));
      for (const restDuration of splitBeatsIntoDurations(beatDifference)) {
        this.model.addRest(restDuration, note.measure, currentBeat);
        currentBeat = fracAdd(currentBeat, durationToFraction(restDuration));
      }

      // Break tiedTo if the shortened note no longer abuts its tie target
      if (note.tiedTo) {
        const tiedTarget = this.model.getNote(note.tiedTo);
        if (tiedTarget) {
          const noteEnd = fracToNumber(note.beat) + durationToBeats(newDuration, newDots);
          const targetBeat = fracToNumber(tiedTarget.beat);
          if (Math.abs(noteEnd - targetBeat) > 0.001 || note.measure !== tiedTarget.measure) {
            this.model.updateNote(note.id, { tiedTo: undefined });
            this.model.updateNote(tiedTarget.id, { tiedFrom: undefined });
          }
        }
      }
    }

    this.commit('Update note', options);
    return note;
  }

  /** Toggle an articulation on a note. Adds if absent, removes if present. */
  toggleArticulation(noteId: string, type: ArticulationType): Note | null {
    const note = this.model.getNote(noteId);
    if (!note || note.isRest) return null;

    const existing = note.articulations || [];
    const hasIt = existing.includes(type);
    const updated = hasIt ? existing.filter(a => a !== type) : [...existing, type];

    const result = this.model.updateNote(noteId, { articulations: updated });
    this.commit(hasIt ? `Remove ${type}` : `Add ${type}`);
    return result;
  }

  /**
   * Toggle a tie from a note to the immediately next slot.
   * Returns true if added, false if removed, null if no candidate.
   */
  toggleTie(noteId: string): boolean | null {
    const note = this.model.getNote(noteId);
    if (!note || note.isRest) return null;

    if (note.tiedTo) {
      const tiedToId = note.tiedTo;
      this.model.updateNote(noteId, { tiedTo: undefined });
      this.model.updateNote(tiedToId, { tiedFrom: undefined });
      this.commit('Remove tie');
      return false;
    }

    // Tie to the immediately next slot (rest or note — no pitch filter)
    const allSlots = this.model.getAllNotes()
      .sort((a, b) => (a.measure !== b.measure ? a.measure - b.measure : fracCompare(a.beat, b.beat)));
    const idx = allSlots.findIndex(n => n.id === noteId);
    const nextNote = allSlots[idx + 1];
    if (!nextNote) return null;

    this.model.updateNote(noteId, { tiedTo: nextNote.id });
    this.model.updateNote(nextNote.id, { tiedFrom: noteId });
    this.commit('Add tie');
    return true;
  }

  /**
   * Delete a note. A chord member just leaves the chord; a single note is
   * replaced by a rest of the same duration (preserving an incoming tie).
   */
  deleteNote(noteId: string): boolean {
    const note = this.model.getNote(noteId);
    if (!note) return false;

    const notesAtSameBeat = this.getChordNotesAt(note.measure, note.beat);
    const isPartOfChord = notesAtSameBeat.length > 1;

    // Save the tiedFrom source before deletion clears it — the tie is
    // re-linked to the replacement rest so the arc stays visible.
    const tiedFromSourceId = !note.isRest && !isPartOfChord ? note.tiedFrom : undefined;

    const result = this.model.deleteNote(noteId);

    if (result && !isPartOfChord && !note.isRest) {
      const replacementRest = this.model.addNote({
        duration: note.duration,
        measure: note.measure,
        beat: note.beat,
        isRest: true,
        dots: note.dots,
        tupletId: note.tupletId, // preserve tuplet membership
      });
      if (tiedFromSourceId && replacementRest) {
        this.model.updateNote(tiedFromSourceId, { tiedTo: replacementRest.id });
        this.model.updateNote(replacementRest.id, { tiedFrom: tiedFromSourceId });
      }
    } else if (result && !isPartOfChord && note.isRest && !note.tupletId) {
      // Standalone rest deleted — re-fill the measure to close the gap
      this.model.repairMeasureGaps(note.measure);
    } else if (result && !isPartOfChord && note.isRest && note.tupletId) {
      // Rest inside a tuplet deleted — fill the gap it left behind
      const measure = this.model.getMeasure(note.measure);
      const tuplet = measure?.tuplets?.find(t => t.id === note.tupletId);
      if (tuplet) refillTupletRemainder(this.model, note.measure, tuplet);
    }

    if (result) {
      this.commit(note.isRest ? 'Delete rest' : 'Delete note');
    }
    return result;
  }

  /**
   * Toggle stem direction between auto and the opposite of the natural
   * direction. "Natural" mirrors VexFlow's autoStem rule (midpoint of the
   * chord's outer notes vs the middle line), so a flip is always visible.
   * Rests are ignored (no stem).
   */
  flipStemDirection(noteId: string): Note | null {
    const note = this.model.getNote(noteId);
    if (!note || note.isRest) return null;

    let newDirection: 'auto' | 'up' | 'down';
    if (note.stemDirection === 'up' || note.stemDirection === 'down') {
      newDirection = 'auto';
    } else {
      const clef = this.model.getScore().clef ?? 'treble';
      const middleDiatonic = CLEF_CONFIG[clef].middleLineDiatonicPos;
      const chordDiatonics = this.getChordNotesAt(note.measure, note.beat)
        .map(n => spellingDiatonicPos(n.step!, n.octave!));
      const decider = (Math.min(...chordDiatonics) + Math.max(...chordDiatonics)) / 2;
      // Natural (VexFlow): midpoint below middle → up, else down. Force the opposite.
      newDirection = decider < middleDiatonic ? 'down' : 'up';
    }

    const updated = this.model.updateNote(noteId, { stemDirection: newDirection });
    this.commit('Flip stem direction');
    return updated;
  }

  /** Commit the current model as ONE history snapshot (end of a live drag). */
  commitTransientEdits(description: string): void {
    this.commit(description);
  }

  // ==================== Helpers ====================

  /** All non-rest notes at the given beat in a measure (chord members). */
  private getChordNotesAt(measureNumber: number, beat: Fraction): Note[] {
    return this.model.getNotesInMeasure(measureNumber)
      .filter(n => !n.isRest && fracEq(n.beat, beat));
  }

  /** Largest standard duration that fits within the available beats. */
  private findLargestFittingDuration(availableBeats: number): NoteDuration | null {
    const durations: { duration: NoteDuration; beats: number }[] = [
      { duration: 'w', beats: 4 },
      { duration: 'h', beats: 2 },
      { duration: 'q', beats: 1 },
      { duration: '8', beats: 0.5 },
      { duration: '16', beats: 0.25 },
      { duration: '32', beats: 0.125 },
    ];
    for (const { duration, beats } of durations) {
      if (beats <= availableBeats + 0.001) return duration;
    }
    return null;
  }

  /** Measure lookup passthrough (palette/selection controllers). */
  getMeasure(measureNumber: number): Measure | undefined {
    return this.model.getMeasure(measureNumber);
  }
}
