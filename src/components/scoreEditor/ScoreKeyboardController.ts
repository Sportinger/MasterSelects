// Keyboard note/rest entry (issue #366, phase 3).
//
// Port of kikoromantest's KeyboardController: a–g letter entry against the
// cursor anchor (nearest-octave pitch resolution), Shift+letter chord adds,
// and rest entry — all through the engine's beat-entry path with overflow
// tie-splitting.

import type { NoteDuration, Note, PitchAlter, PitchStep } from '../../types/scoreClip';
import { ScoreEditorEngine } from '../../services/score/ScoreEditorEngine';
import { buildBeatMap } from '../../services/score/beatMap';
import { durationToBeats, getMeasureDuration, getMeasureNotes } from '../../services/score/musicUtils';
import { fracEq, fracToNumber } from '../../services/score/fraction';
import { accidentalToAlter, spellingToMidi } from '../../services/score/pitchSpelling';
import { Logger } from '../../services/logger';
import type { ScoreEditorState } from './scoreEditorState';

const log = Logger.create('ScoreKeyboard');

/** Natural (no-accidental) semitone offsets for each step letter */
const STEP_SEMITONES: Record<PitchStep, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** Letter → PitchStep mapping */
const LETTER_TO_STEP: Record<string, PitchStep> = {
  c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', a: 'A', b: 'B',
};

export class ScoreKeyboardController {
  private getEngine: () => ScoreEditorEngine | null;
  private state: ScoreEditorState;
  private getPendingArticulations: () => import('../../types/scoreClip').ArticulationType[] | undefined;
  private renderScore: () => void;
  private setSelectedNote: (id: string | null) => void;
  private getContextPitch: () => number;
  private audition: (midi: number) => void;

  constructor(
    getEngine: () => ScoreEditorEngine | null,
    state: ScoreEditorState,
    getPendingArticulations: () => import('../../types/scoreClip').ArticulationType[] | undefined,
    renderScore: () => void,
    setSelectedNote: (id: string | null) => void,
    getContextPitch: () => number,
    audition: (midi: number) => void,
  ) {
    this.getEngine = getEngine;
    this.state = state;
    this.getPendingArticulations = getPendingArticulations;
    this.renderScore = renderScore;
    this.setSelectedNote = setSelectedNote;
    this.getContextPitch = getContextPitch;
    this.audition = audition;
  }

  /** Nearest octave for a step relative to a reference MIDI pitch. */
  private nearestOctave(step: PitchStep, referenceMidi: number): number {
    const naturalPitchClass = STEP_SEMITONES[step];
    const k = Math.round((referenceMidi - naturalPitchClass) / 12);
    return Math.floor((naturalPitchClass + 12 * k) / 12) - 1;
  }

  /**
   * Enter a note by letter key (a–g).
   * Selection mode: edits the selected note in place, then switches to entry.
   * Entry mode: places a new note at the cursor position and advances it.
   */
  enterNoteByLetter(letter: string): void {
    const engine = this.getEngine();
    if (!this.state.selectedNoteId || !engine) return;

    const step = LETTER_TO_STEP[letter];
    if (!step) return;

    if (this.state.selectedTool === 'entry') {
      this.enterNoteAtCursorPosition(step);
      return;
    }

    // Selection mode: edit in place, then switch to keyboard entry mode
    const alter: PitchAlter = accidentalToAlter(this.state.selectedAccidental);
    const octave = this.nearestOctave(step, this.getContextPitch());

    engine.updateNote(this.state.selectedNoteId, {
      step,
      alter,
      octave,
      isRest: false,
      ...(this.state.selectedAccidental === 'n' && { forceAccidental: true }),
    });
    this.audition(spellingToMidi(step, alter, octave));

    this.state.selectedAccidental = null;
    this.state.selectedTool = 'entry';
    this.renderScore();
  }

  /**
   * Place a note at the cursor position (the beat after selectedNoteId),
   * overwriting what is there and handling measure overflow via tie splitting.
   * Advances the cursor past any tied continuations.
   */
  enterNoteAtCursorPosition(step: PitchStep): void {
    const engine = this.getEngine();
    if (!this.state.selectedNoteId || !engine) return;

    const score = engine.getScore();
    const { allFlat, beats } = buildBeatMap(score);

    const currentNote = allFlat.find(n => n.id === this.state.selectedNoteId);
    if (!currentNote) return;
    const currentKey = `${currentNote.measureNumber}:${currentNote.beat.num}/${currentNote.beat.den}`;
    const currentIndex = beats.findIndex(n => `${n.measureNumber}:${n.beat.num}/${n.beat.den}` === currentKey);
    if (currentIndex === -1) return;

    const nextBeat = beats[currentIndex + 1];
    if (!nextBeat) {
      log.debug('Cursor at end of score — nowhere to place note');
      return;
    }

    const targetMeasure = nextBeat.measureNumber;
    const targetBeat = nextBeat.beat;

    const alter: PitchAlter = accidentalToAlter(this.state.selectedAccidental);
    const referenceMidi = !currentNote.isRest && currentNote.step
      ? spellingToMidi(currentNote.step, currentNote.alter!, currentNote.octave!)
      : this.getContextPitch();
    const octave = this.nearestOctave(step, referenceMidi);

    const existingTuplet = engine.getTupletAtBeat(targetMeasure, targetBeat);

    let newNote: Note | null;
    if (this.state.tupletMode && !existingTuplet) {
      const result = engine.createTupletAtBeat(
        targetMeasure,
        fracToNumber(targetBeat),
        this.state.selectedDuration,
        { step, alter, octave },
      );
      newNote = result ? result.firstNote : null;
    } else {
      newNote = engine.addNoteAtBeat({
        step,
        alter,
        octave,
        duration: this.state.selectedDuration,
        measure: targetMeasure,
        beat: targetBeat,
        dots: this.state.selectedDots || undefined,
        isRest: false,
        articulations: this.getPendingArticulations(),
        ...(this.state.selectedAccidental === 'n' && { forceAccidental: true }),
        ...(existingTuplet && { tupletId: existingTuplet.id }),
      });
    }

    if (!newNote) {
      log.debug('Keyboard entry placement failed');
      this.renderScore();
      return;
    }

    if (!newNote.isRest && newNote.step) {
      this.audition(spellingToMidi(newNote.step, newNote.alter!, newNote.octave!));
    }

    // Follow the tie chain so the cursor lands after all tied continuations
    let lastNote = newNote;
    const scoreAfter = engine.getScore();
    let safetyLimit = 16;
    while (lastNote.tiedTo && safetyLimit-- > 0) {
      const tied = scoreAfter.measures.flatMap(m => getMeasureNotes(m)).find(n => n.id === lastNote.tiedTo);
      if (!tied) break;
      lastNote = tied;
    }

    this.state.selectedAccidental = null;
    this.setSelectedNote(lastNote.id);
    this.renderScore();
  }

  /**
   * Enter a rest at the cursor position (entry mode only). Rests don't tie
   * across barlines — the duration is capped to the available measure space.
   */
  enterRestAtCursorPosition(): void {
    const engine = this.getEngine();
    if (this.state.selectedTool !== 'entry' || !this.state.selectedNoteId || !engine) return;

    const score = engine.getScore();
    const { allFlat, beats } = buildBeatMap(score);

    const currentNote = allFlat.find(n => n.id === this.state.selectedNoteId);
    if (!currentNote) return;
    const currentKey = `${currentNote.measureNumber}:${currentNote.beat.num}/${currentNote.beat.den}`;
    const currentIndex = beats.findIndex(n => `${n.measureNumber}:${n.beat.num}/${n.beat.den}` === currentKey);
    if (currentIndex === -1) return;

    const nextBeat = beats[currentIndex + 1];
    if (!nextBeat) return;

    const targetMeasure = nextBeat.measureNumber;
    const targetBeat = nextBeat.beat;
    const newDurationBeats = durationToBeats(this.state.selectedDuration, this.state.selectedDots);

    const measureData = engine.getMeasure(targetMeasure);
    if (!measureData) return;
    const availableBeats = getMeasureDuration(measureData.timeSignature) - fracToNumber(targetBeat);
    const actualDurationBeats = Math.min(newDurationBeats, availableBeats);

    const durations: Array<{ dur: NoteDuration; beats: number }> = [
      { dur: 'w', beats: 4 }, { dur: 'h', beats: 2 }, { dur: 'q', beats: 1 },
      { dur: '8', beats: 0.5 }, { dur: '16', beats: 0.25 }, { dur: '32', beats: 0.125 },
    ];
    const fittingDur = durations.find(d => d.beats <= actualDurationBeats + 0.001)
      ?? { dur: this.state.selectedDuration, beats: newDurationBeats };

    const newRest = engine.addNoteAtBeat({
      duration: fittingDur.dur,
      measure: targetMeasure,
      beat: targetBeat,
      isRest: true,
    });

    if (!newRest) {
      this.renderScore();
      return;
    }

    this.state.selectedAccidental = null;
    this.setSelectedNote(newRest.id);
    this.renderScore();
  }

  /**
   * Add a note to the chord at the selected note's position (Shift+letter).
   * The new pitch lands above the chord's highest note; a selected rest falls
   * back to plain letter entry.
   */
  addChordNoteByLetter(letter: string): void {
    const engine = this.getEngine();
    if (!this.state.selectedNoteId || !engine) return;

    const step = LETTER_TO_STEP[letter];
    if (!step) return;

    const note = engine.getNote(this.state.selectedNoteId);
    if (!note) return;

    if (note.isRest) {
      this.enterNoteByLetter(letter);
      return;
    }

    const measure = engine.getMeasure(note.measure);
    const chordMidis = (measure ? getMeasureNotes(measure) : [])
      .filter(n => !n.isRest && fracEq(n.beat, note.beat))
      .map(n => spellingToMidi(n.step!, n.alter!, n.octave!));
    const baseMidi = chordMidis.length > 0
      ? Math.max(...chordMidis)
      : spellingToMidi(note.step!, note.alter!, note.octave!);

    const alter: PitchAlter = accidentalToAlter(this.state.selectedAccidental);
    const naturalPitchClass = STEP_SEMITONES[step];
    const k = Math.ceil((baseMidi - naturalPitchClass) / 12);
    let targetMidi = naturalPitchClass + 12 * k;
    if (targetMidi === baseMidi) targetMidi += 12;
    const octave = Math.floor(targetMidi / 12) - 1;

    const newNote = engine.addChordNote({
      step,
      alter,
      octave,
      duration: note.duration,
      measure: note.measure,
      beat: note.beat,
      dots: note.dots,
      isRest: false,
      tupletId: note.tupletId,
    });
    this.audition(spellingToMidi(step, alter, octave));
    this.setSelectedNote(newNote.id);
    this.renderScore();
  }
}
