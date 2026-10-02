// ScoreModel — core notation data model for the score editor (issue #366).
//
// Owns the Score object and all slot-level CRUD (notes, chords, rests, ties).
// Rest-filling policy lives in ./restFill.ts; tuplet lifecycle operations in
// ./tupletOps.ts. Ported (framework-free) from the kikoromantest score editor;
// the editor's own undo system was dropped — the host historyStore owns undo,
// with the durable form stored as `TimelineClip.scoreData` (ScoreData).

import type {
  Score,
  Measure,
  Note,
  NoteParams,
  TimeSignature,
  NoteDuration,
  ChordRest,
  Chord,
  Rest,
  NotePitch,
  PitchAlter,
  ScoreData,
  Fraction,
} from '../../types/scoreClip';
import { SCORE_DATA_SCHEMA_VERSION } from '../../types/scoreClip';
import { noteSpansOverlapFrac } from './musicUtils';
import {
  durationToFraction,
  fracCreate,
  fracMul,
  fracCompare,
  fracEq,
} from './fraction';
import { fillGapsWithRests, fillMeasureWithRests } from './restFill';
import { generateScoreElementId } from './scoreIds';

/**
 * ScoreModel manages the musical score data and provides CRUD operations.
 * Time unit: quarter-note beats, exact fractions (see ./fraction.ts).
 */
export class ScoreModel {
  private score: Score;

  constructor(title: string = 'Untitled Score', tempo: number = 120) {
    this.score = {
      id: generateScoreElementId(),
      title,
      tempo,
      keySignature: { key: 'C', accidentals: 0 },
      defaultTimeSignature: { numerator: 4, denominator: 4 },
      measures: [],
      schemaVersion: SCORE_DATA_SCHEMA_VERSION,
    };
    // Initialize with one empty measure
    this.addMeasure();
  }

  /** Get the complete score (the live object, not a copy). */
  getScore(): Score {
    return this.score;
  }

  setTitle(title: string): void {
    this.score.title = title;
  }

  setTempo(tempo: number): void {
    if (tempo < 20 || tempo > 300) {
      throw new Error('Tempo must be between 20 and 300 BPM');
    }
    this.score.tempo = tempo;
  }

  /**
   * Add a new measure to the score.
   * The measure is automatically filled with rests to match the time signature.
   */
  addMeasure(timeSignature?: TimeSignature): Measure {
    const measureNumber = this.score.measures.length + 1;
    const ts = timeSignature || this.score.defaultTimeSignature;
    const measure: Measure = {
      id: generateScoreElementId(),
      number: measureNumber,
      slots: [],
      timeSignature: ts,
      tuplets: [],
    };
    this.score.measures.push(measure);
    fillMeasureWithRests(measure);
    return measure;
  }

  /** Get a measure by its number (1-indexed). */
  getMeasure(measureNumber: number): Measure | undefined {
    return this.score.measures.find(m => m.number === measureNumber);
  }

  /** Remove a measure by its number, renumbering subsequent measures. */
  removeMeasure(measureNumber: number): boolean {
    const index = this.score.measures.findIndex(m => m.number === measureNumber);
    if (index === -1) return false;

    this.score.measures.splice(index, 1);
    for (let i = index; i < this.score.measures.length; i++) {
      this.score.measures[i].number = i + 1;
      this.score.measures[i].slots.forEach(slot => {
        slot.measure = i + 1;
      });
    }
    return true;
  }

  // ==================== Internal helpers ====================

  /** Find the slot containing the given note/pitch ID. */
  private findSlot(noteId: string):
    | { type: 'chord'; chord: Chord; pitch: NotePitch }
    | { type: 'rest'; rest: Rest }
    | undefined {
    for (const measure of this.score.measures) {
      for (const slot of measure.slots) {
        if (slot.type === 'rest' && slot.id === noteId) {
          return { type: 'rest', rest: slot };
        }
        if (slot.type === 'chord') {
          const pitch = slot.notes.find(n => n.id === noteId);
          if (pitch) return { type: 'chord', chord: slot, pitch };
        }
      }
    }
    return undefined;
  }

  /** Assemble a flat Note from a Chord + NotePitch. */
  private toFlatNote(chord: Chord, pitch: NotePitch): Note {
    return {
      id: pitch.id,
      step: pitch.step,
      alter: pitch.alter,
      octave: pitch.octave,
      duration: chord.duration,
      measure: chord.measure,
      beat: chord.beat,
      isRest: false,
      forceAccidental: pitch.forceAccidental,
      stemDirection: chord.stemDirection,
      tiedTo: pitch.tiedTo,
      tiedFrom: pitch.tiedFrom,
      dots: chord.dots,
      tupletId: chord.tupletId,
      actualDuration: chord.actualDuration,
      articulations: chord.articulations,
    };
  }

  /** Assemble a flat Note from a Rest. */
  private restToFlatNote(rest: Rest): Note {
    return {
      id: rest.id,
      duration: rest.duration,
      measure: rest.measure,
      beat: rest.beat,
      isRest: true,
      dots: rest.dots,
      tupletId: rest.tupletId,
      actualDuration: rest.actualDuration,
      tiedFrom: rest.tiedFrom,
    };
  }

  /** Compute the exact sounding duration of a slot as a Fraction. */
  computeActualDurationForSlot(
    slot: ChordRest | { duration: NoteDuration; dots?: number; tupletId?: string },
    measure: Measure,
  ): Fraction {
    const base = durationToFraction(slot.duration, slot.dots ?? 0);
    if (slot.tupletId && measure.tuplets) {
      const tuplet = measure.tuplets.find(t => t.id === slot.tupletId);
      if (tuplet) {
        return fracMul(base, fracCreate(tuplet.notesOccupied, tuplet.numNotes));
      }
    }
    return base;
  }

  // ==================== Note Entry ====================

  /**
   * Add a note to the score.
   * If adding a regular note (not a rest), this will replace overlapping rests
   * and may join an existing Chord at the same beat.
   */
  addNote(params: NoteParams): Note {
    const measure = this.getMeasure(params.measure);
    if (!measure) {
      throw new Error(`Measure ${params.measure} does not exist`);
    }

    // Validate pitch (skip validation for rests)
    if (!params.isRest && !params.step) {
      throw new Error('Non-rest notes must have a step');
    }

    if (params.isRest) {
      const rest: Rest = {
        id: generateScoreElementId(),
        type: 'rest',
        beat: params.beat,
        duration: params.duration,
        measure: params.measure,
        dots: params.dots,
        tupletId: params.tupletId,
        actualDuration: params.actualDuration,
      };
      rest.actualDuration = this.computeActualDurationForSlot(rest, measure);
      measure.slots.push(rest);
      measure.slots.sort((a, b) => fracCompare(a.beat, b.beat));
      return this.restToFlatNote(rest);
    }

    // Regular note — look for existing Chord at same beat
    const existingChord = measure.slots.find(
      (s): s is Chord => s.type === 'chord' && fracEq(s.beat, params.beat),
    );

    if (existingChord) {
      // Add pitch to existing chord
      const notePitch: NotePitch = {
        id: generateScoreElementId(),
        step: params.step!,
        alter: (params.alter ?? 0) as PitchAlter,
        octave: params.octave!,
        forceAccidental: params.forceAccidental,
        tiedTo: params.tiedTo,
        tiedFrom: params.tiedFrom,
      };
      if (params.articulations !== undefined) existingChord.articulations = params.articulations;
      existingChord.notes.push(notePitch);
      // Sync duration/dots if new note differs (and neither is a tuplet note)
      if (!existingChord.tupletId && !params.tupletId) {
        const noteDots = params.dots || 0;
        if (existingChord.duration !== params.duration || (existingChord.dots || 0) !== noteDots) {
          existingChord.duration = params.duration;
          existingChord.dots = params.dots;
          existingChord.actualDuration = this.computeActualDurationForSlot(existingChord, measure);
        }
      }
      if (params.actualDuration !== undefined) {
        existingChord.actualDuration = params.actualDuration;
      }
      return this.toFlatNote(existingChord, notePitch);
    }

    // No existing chord at beat — replace any overlapping rests and create new Chord
    const notePitch: NotePitch = {
      id: generateScoreElementId(),
      step: params.step!,
      alter: (params.alter ?? 0) as PitchAlter,
      octave: params.octave!,
      forceAccidental: params.forceAccidental,
      tiedTo: params.tiedTo,
      tiedFrom: params.tiedFrom,
    };

    const chord: Chord = {
      id: generateScoreElementId(),
      type: 'chord',
      beat: params.beat,
      duration: params.duration,
      dots: params.dots,
      measure: params.measure,
      tupletId: params.tupletId,
      actualDuration: params.actualDuration,
      articulations: params.articulations,
      notes: [notePitch],
    };
    chord.actualDuration = this.computeActualDurationForSlot(chord, measure);

    this.replaceRestsWithChord(measure, chord);

    return this.toFlatNote(chord, notePitch);
  }

  /**
   * Replace rests overlapping a new Chord and fill gaps with new rests.
   * Also inherits tupletId from any replaced tuplet rest.
   */
  private replaceRestsWithChord(measure: Measure, chord: Chord): void {
    const chordDurFrac = chord.actualDuration ?? durationToFraction(chord.duration, chord.dots ?? 0);

    // Remove overlapping rests; keep non-overlapping slots (both chords and rests)
    let inheritedTupletId: string | undefined = chord.tupletId;
    const remaining: ChordRest[] = [];

    for (const existing of measure.slots) {
      if (existing.type === 'rest') {
        const existingDurFrac =
          existing.actualDuration ?? durationToFraction(existing.duration, existing.dots ?? 0);
        const overlaps = noteSpansOverlapFrac(chord.beat, chordDurFrac, existing.beat, existingDurFrac);
        if (overlaps) {
          if (existing.tupletId && !chord.tupletId) {
            inheritedTupletId = existing.tupletId;
          }
          // Migrate any tie pointing TO this rest onto the new chord's first note
          if (chord.notes.length > 0) {
            const newNp = chord.notes[0];
            if (existing.tiedFrom) newNp.tiedFrom = existing.tiedFrom;
            this.migrateRestTieTo(existing.id, newNp.id);
          }
          // Remove (don't keep)
        } else {
          remaining.push(existing);
        }
      } else {
        // Existing chord — keep it
        remaining.push(existing);
      }
    }

    // Apply inherited tupletId
    if (inheritedTupletId && !chord.tupletId) {
      chord.tupletId = inheritedTupletId;
      // Recompute actual duration with the now-known tuplet
      chord.actualDuration = this.computeActualDurationForSlot(chord, measure);
    }

    measure.slots = remaining;
    measure.slots.push(chord);

    fillGapsWithRests(measure);

    measure.slots.sort((a, b) => fracCompare(a.beat, b.beat));
  }

  /**
   * Update all NotePitch.tiedTo pointers that reference a deleted rest ID,
   * redirecting them to newNotePitchId.
   */
  private migrateRestTieTo(restId: string, newNotePitchId: string): void {
    for (const measure of this.score.measures) {
      for (const slot of measure.slots) {
        if (slot.type === 'chord') {
          for (const pitch of slot.notes) {
            if (pitch.tiedTo === restId) {
              pitch.tiedTo = newNotePitchId;
            }
          }
        }
      }
    }
  }

  /** Add a rest to the score. */
  addRest(duration: NoteParams['duration'], measure: number, beat: Fraction): Note {
    return this.addNote({
      duration,
      measure,
      beat,
      isRest: true,
    });
  }

  /** Get a note by its ID (flat view). */
  getNote(noteId: string): Note | undefined {
    const found = this.findSlot(noteId);
    if (!found) return undefined;
    if (found.type === 'rest') return this.restToFlatNote(found.rest);
    return this.toFlatNote(found.chord, found.pitch);
  }

  /** Get all notes in a specific measure (as flat Note objects). */
  getNotesInMeasure(measureNumber: number): Note[] {
    const measure = this.getMeasure(measureNumber);
    if (!measure) return [];
    const result: Note[] = [];
    for (const slot of measure.slots) {
      if (slot.type === 'rest') {
        result.push(this.restToFlatNote(slot));
      } else {
        for (const pitch of slot.notes) {
          result.push(this.toFlatNote(slot, pitch));
        }
      }
    }
    return result;
  }

  /** Get the slots in a measure (copy of the internal ChordRest[]). */
  getSlotsInMeasure(measureNumber: number): ChordRest[] {
    const measure = this.getMeasure(measureNumber);
    return measure ? [...measure.slots] : [];
  }

  /** Update a note (pitch fields, timing, ties, articulations, measure moves). */
  updateNote(noteId: string, updates: Partial<NoteParams>): Note {
    const found = this.findSlot(noteId);
    if (!found) {
      throw new Error(`Note ${noteId} not found`);
    }

    if (found.type === 'rest') {
      return this.updateRestSlot(found.rest, updates);
    }

    // Chord case
    const { chord, pitch } = found;
    const oldMeasure = chord.measure;

    // Pitch updates — apply spelling fields directly
    if (updates.step !== undefined) pitch.step = updates.step;
    if (updates.alter !== undefined) pitch.alter = updates.alter;
    if (updates.octave !== undefined) pitch.octave = updates.octave;
    if ('forceAccidental' in updates) pitch.forceAccidental = updates.forceAccidental;
    if (updates.tiedTo !== undefined) pitch.tiedTo = updates.tiedTo;
    if (updates.tiedFrom !== undefined) pitch.tiedFrom = updates.tiedFrom;
    if (updates.articulations !== undefined) chord.articulations = updates.articulations;

    // Handle explicit undefined for tie fields
    if ('tiedTo' in updates && updates.tiedTo === undefined) pitch.tiedTo = undefined;
    if ('tiedFrom' in updates && updates.tiedFrom === undefined) pitch.tiedFrom = undefined;

    // Chord-level timing and style updates
    if (updates.duration !== undefined) chord.duration = updates.duration;
    if (updates.dots !== undefined) chord.dots = updates.dots;
    if (updates.tupletId !== undefined) chord.tupletId = updates.tupletId;
    if (updates.beat !== undefined) chord.beat = updates.beat;
    if (updates.actualDuration !== undefined) chord.actualDuration = updates.actualDuration;
    if (updates.stemDirection !== undefined) chord.stemDirection = updates.stemDirection === 'auto' ? undefined : updates.stemDirection;

    // If measure is being changed, move the whole chord
    if (updates.measure !== undefined && updates.measure !== oldMeasure) {
      const oldMeasureObj = this.getMeasure(oldMeasure);
      const newMeasureObj = this.getMeasure(updates.measure);
      if (!newMeasureObj) throw new Error(`Target measure ${updates.measure} does not exist`);
      if (oldMeasureObj) {
        oldMeasureObj.slots = oldMeasureObj.slots.filter(s => s.id !== chord.id);
      }
      chord.measure = updates.measure;
      chord.actualDuration = this.computeActualDurationForSlot(chord, newMeasureObj);
      newMeasureObj.slots.push(chord);
      newMeasureObj.slots.sort((a, b) => fracCompare(a.beat, b.beat));
    } else {
      if (updates.beat !== undefined) {
        const m = this.getMeasure(chord.measure);
        if (m) m.slots.sort((a, b) => fracCompare(a.beat, b.beat));
      }
      if (updates.duration !== undefined || updates.dots !== undefined || updates.tupletId !== undefined) {
        const m = this.getMeasure(chord.measure);
        if (m) chord.actualDuration = this.computeActualDurationForSlot(chord, m);
      }
    }

    return this.toFlatNote(chord, pitch);
  }

  /** updateNote() branch for Rest slots, including rest → chord conversion. */
  private updateRestSlot(rest: Rest, updates: Partial<NoteParams>): Note {
    // Convert rest → chord when isRest is explicitly set to false
    if (updates.isRest === false && updates.step !== undefined) {
      const measure = this.getMeasure(rest.measure);
      if (!measure) throw new Error(`Measure ${rest.measure} does not exist`);

      const notePitch: NotePitch = {
        id: rest.id, // reuse rest ID so the caller's selectedNoteId stays valid
        step: updates.step!,
        alter: (updates.alter ?? 0) as PitchAlter,
        octave: updates.octave!,
        forceAccidental: updates.forceAccidental,
        tiedFrom: rest.tiedFrom, // preserve incoming tie
      };
      const chord: Chord = {
        id: generateScoreElementId(),
        type: 'chord',
        beat: updates.beat ?? rest.beat,
        duration: updates.duration ?? rest.duration,
        dots: updates.dots ?? rest.dots,
        measure: rest.measure,
        tupletId: updates.tupletId ?? rest.tupletId,
        actualDuration: rest.actualDuration,
        articulations: updates.articulations,
        notes: [notePitch],
      };
      chord.actualDuration = this.computeActualDurationForSlot(chord, measure);

      measure.slots = measure.slots.filter(s => s.id !== rest.id);
      measure.slots.push(chord);
      measure.slots.sort((a, b) => fracCompare(a.beat, b.beat));

      return this.toFlatNote(chord, notePitch);
    }

    const oldMeasure = rest.measure;

    // If measure is being changed, move the rest
    if (updates.measure !== undefined && updates.measure !== oldMeasure) {
      const oldMeasureObj = this.getMeasure(oldMeasure);
      const newMeasureObj = this.getMeasure(updates.measure);
      if (!newMeasureObj) throw new Error(`Target measure ${updates.measure} does not exist`);
      if (oldMeasureObj) {
        oldMeasureObj.slots = oldMeasureObj.slots.filter(s => s.id !== rest.id);
      }
      if (updates.duration !== undefined) rest.duration = updates.duration;
      if (updates.dots !== undefined) rest.dots = updates.dots;
      if (updates.beat !== undefined) rest.beat = updates.beat;
      if (updates.tupletId !== undefined) rest.tupletId = updates.tupletId;
      rest.measure = updates.measure;
      rest.actualDuration = this.computeActualDurationForSlot(rest, newMeasureObj);
      newMeasureObj.slots.push(rest);
      newMeasureObj.slots.sort((a, b) => fracCompare(a.beat, b.beat));
    } else {
      if (updates.duration !== undefined) rest.duration = updates.duration;
      if (updates.dots !== undefined) rest.dots = updates.dots;
      if (updates.tupletId !== undefined) rest.tupletId = updates.tupletId;
      if (updates.tiedFrom !== undefined) rest.tiedFrom = updates.tiedFrom;
      if ('tiedFrom' in updates && updates.tiedFrom === undefined) rest.tiedFrom = undefined;
      if (updates.beat !== undefined) {
        rest.beat = updates.beat;
        const m = this.getMeasure(rest.measure);
        if (m) m.slots.sort((a, b) => fracCompare(a.beat, b.beat));
      }
      if (updates.duration !== undefined || updates.dots !== undefined || updates.tupletId !== undefined) {
        const m = this.getMeasure(rest.measure);
        if (m) rest.actualDuration = this.computeActualDurationForSlot(rest, m);
      }
    }
    return this.restToFlatNote(rest);
  }

  /** Delete a note or rest, cleaning up tie partners. */
  deleteNote(noteId: string): boolean {
    const found = this.findSlot(noteId);
    if (!found) return false;

    if (found.type === 'rest') {
      const rest = found.rest;
      // Clean up tie partners before removing
      if (rest.tiedFrom) {
        const partner = this.findSlot(rest.tiedFrom);
        if (partner?.type === 'chord') partner.pitch.tiedTo = undefined;
      }
      for (const measure of this.score.measures) {
        const idx = measure.slots.findIndex(s => s.id === rest.id);
        if (idx !== -1) {
          measure.slots.splice(idx, 1);
          return true;
        }
      }
      return false;
    }

    // Chord case
    const { chord, pitch } = found;

    // Clean up tie partners before removing this pitch
    if (pitch.tiedTo) {
      const partner = this.findSlot(pitch.tiedTo);
      if (partner?.type === 'chord') partner.pitch.tiedFrom = undefined;
      else if (partner?.type === 'rest') partner.rest.tiedFrom = undefined;
    }
    if (pitch.tiedFrom) {
      const partner = this.findSlot(pitch.tiedFrom);
      if (partner?.type === 'chord') partner.pitch.tiedTo = undefined;
    }

    for (const measure of this.score.measures) {
      const idx = measure.slots.findIndex(s => s.id === chord.id);
      if (idx !== -1) {
        if (chord.notes.length <= 1) {
          // Remove the whole chord slot
          measure.slots.splice(idx, 1);
        } else {
          // Remove just this pitch from the chord
          chord.notes = chord.notes.filter(n => n.id !== pitch.id);
        }
        return true;
      }
    }
    return false;
  }

  /** Get all notes in the score (as flat Note objects). */
  getAllNotes(): Note[] {
    return this.score.measures.flatMap(m => this.getNotesInMeasure(m.number));
  }

  /** Repair gaps in a single measure by filling with rests. */
  repairMeasureGaps(measureNumber: number): void {
    const measure = this.getMeasure(measureNumber);
    if (measure) {
      fillGapsWithRests(measure);
    }
  }

  /** Repair gaps in all measures. Called as a pre-render safety net. */
  repairAllMeasureGaps(): void {
    for (const measure of this.score.measures) {
      fillGapsWithRests(measure);
    }
  }

  /** Clear all notes from the score and refill with rests. */
  clearAllNotes(): void {
    this.score.measures.forEach(measure => {
      measure.slots = [];
      measure.tuplets = [];
      fillMeasureWithRests(measure);
    });
  }

  // ==================== Durable ScoreData round-trip ====================

  /**
   * Snapshot the score as durable clip data (`TimelineClip.scoreData`).
   * Deep-cloned plain JSON — safe to hand to the timeline store.
   */
  toScoreData(): ScoreData {
    return structuredClone({ ...this.score, schemaVersion: SCORE_DATA_SCHEMA_VERSION });
  }

  /**
   * Load a model from durable clip data. The input is deep-cloned, and
   * actualDuration is recomputed for all slots (not trusted across versions).
   */
  static fromScoreData(data: ScoreData): ScoreModel {
    const model = new ScoreModel();
    model.score = structuredClone(data);

    for (const measure of model.score.measures) {
      for (const slot of measure.slots ?? []) {
        slot.actualDuration = model.computeActualDurationForSlot(slot, measure);
      }
    }

    return model;
  }
}
