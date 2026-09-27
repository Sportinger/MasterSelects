// Note selection, navigation and pitch adjustment (issue #366, phase 3).
//
// Port of kikoromantest's SelectionController: framework-free, mutates the
// observable ScoreEditorState directly. Scroll-into-view reads rendered
// geometry from the hit tester instead of the old ElementRegistry.

import type { Accidental, Measure, Note, PitchAlter, PitchStep } from '../../types/scoreClip';
import { ScoreEditorEngine } from '../../services/score/ScoreEditorEngine';
import { ScoreHitTester } from '../../services/score/render/ScoreHitTester';
import { buildBeatMap } from '../../services/score/beatMap';
import { fracCompare, fracEq, fracLt } from '../../services/score/fraction';
import { getMeasureNotes } from '../../services/score/musicUtils';
import { spellingDiatonicPos, spellingToMidi } from '../../services/score/pitchSpelling';
import type { ScoreEditorState } from './scoreEditorState';

export class ScoreSelectionController {
  private getEngine: () => ScoreEditorEngine | null;
  private state: ScoreEditorState;
  private hitTester: ScoreHitTester;
  private getScrollContainer: () => HTMLElement | null;
  private renderScore: () => void;
  private audition: (midi: number) => void;

  constructor(
    getEngine: () => ScoreEditorEngine | null,
    state: ScoreEditorState,
    hitTester: ScoreHitTester,
    getScrollContainer: () => HTMLElement | null,
    renderScore: () => void,
    audition: (midi: number) => void,
  ) {
    this.getEngine = getEngine;
    this.state = state;
    this.hitTester = hitTester;
    this.getScrollContainer = getScrollContainer;
    this.renderScore = renderScore;
    this.audition = audition;
  }

  /**
   * Which accidental sign is actually displayed for a note, given the running
   * accidental state of its measure up to that beat (palette sync).
   */
  private computeDisplayedAccidental(note: Note, measure: Measure): Accidental | null {
    if (note.isRest || note.tiedFrom) return null;
    if (note.forceAccidental && note.alter) return note.alter > 0 ? '#' : 'b';

    const active = new Map<number, number>();
    const preceding = getMeasureNotes(measure)
      .filter(n => !n.isRest && !n.tiedFrom && fracLt(n.beat, note.beat))
      .sort((a, b) => fracCompare(a.beat, b.beat));
    for (const n of preceding) {
      active.set(spellingDiatonicPos(n.step!, n.octave!), n.alter ?? 0);
    }

    const activeAlter = active.get(spellingDiatonicPos(note.step!, note.octave!));
    const noteAlter = note.alter ?? 0;

    if (noteAlter !== 0) {
      return activeAlter === noteAlter ? null : noteAlter > 0 ? '#' : 'b';
    }
    if (activeAlter !== undefined && activeAlter !== 0) return 'n';
    if (note.forceAccidental) return 'n';
    return null;
  }

  /**
   * Select a note by ID and sync the palette (duration, accidental, dots) to
   * it. Pass null to clear. Also clears every sub-element selection.
   */
  selectNote(noteId: string | null): void {
    this.state.selectedNoteId = noteId;
    this.state.selectedArticulationNoteId = null;
    this.state.selectedArticulationType = null;
    this.state.selectedAccidentalNoteId = null;
    this.state.selectedAccidentalType = null;
    this.state.selectedTieFromNoteId = null;

    if (!noteId) return;
    const engine = this.getEngine();
    if (!engine) return;
    const score = engine.getScore();
    for (const measure of score.measures) {
      const note = getMeasureNotes(measure).find(n => n.id === noteId);
      if (note) {
        this.state.selectedDuration = note.duration;
        this.state.selectedAccidental = this.computeDisplayedAccidental(note, measure);
        this.state.selectedDots = note.dots || 0;
        break;
      }
    }
  }

  /**
   * Navigate selection left/right. Chords are one unit; past the first/last
   * beat clears the selection.
   */
  navigateSelection(direction: number): void {
    const engine = this.getEngine();
    if (this.state.selectedTool !== 'selection' || !this.state.selectedNoteId || !engine) return;

    const score = engine.getScore();
    const { allFlat, beats } = buildBeatMap(score);

    const currentNote = allFlat.find(n => n.id === this.state.selectedNoteId);
    if (!currentNote) return;
    const currentKey = `${currentNote.measureNumber}:${currentNote.beat.num}/${currentNote.beat.den}`;
    const currentIndex = beats.findIndex(n => `${n.measureNumber}:${n.beat.num}/${n.beat.den}` === currentKey);
    if (currentIndex === -1) return;

    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= beats.length) {
      this.selectNote(null);
      this.renderScore();
      return;
    }

    this.selectNote(beats[newIndex].id);
    this.renderScore();
    this.scrollSelectedNoteIntoView();
  }

  /** Navigate within a chord by pitch (up/down), clamped at the outer notes. */
  navigateChord(direction: number): void {
    const engine = this.getEngine();
    if (this.state.selectedTool !== 'selection' || !this.state.selectedNoteId || !engine) return;

    const note = engine.getNote(this.state.selectedNoteId);
    if (!note || note.isRest) return;

    const measure = engine.getMeasure(note.measure);
    if (!measure) return;

    const chordNotes = getMeasureNotes(measure)
      .filter(n => !n.isRest && fracEq(n.beat, note.beat))
      .sort((a, b) => spellingToMidi(a.step!, a.alter!, a.octave!) - spellingToMidi(b.step!, b.alter!, b.octave!));

    if (chordNotes.length <= 1) return;

    const currentIndex = chordNotes.findIndex(n => n.id === this.state.selectedNoteId);
    if (currentIndex === -1) return;

    const newIndex = Math.max(0, Math.min(chordNotes.length - 1, currentIndex + direction));
    if (newIndex === currentIndex) return;

    this.selectNote(chordNotes[newIndex].id);
    this.renderScore();
  }

  /** Adjust pitch of the selected note by one diatonic step. No-op on rests. */
  adjustPitch(direction: number): void {
    const engine = this.getEngine();
    if (!this.state.selectedNoteId || !engine) return;

    const selectedNote = engine.getNote(this.state.selectedNoteId);
    if (!selectedNote || selectedNote.isRest) return;

    const next = this.movePitchDiatonically(
      selectedNote.step!, selectedNote.alter!, selectedNote.octave!, direction,
    );
    engine.updateNote(this.state.selectedNoteId, {
      step: next.step, alter: next.alter, octave: next.octave,
    });
    this.audition(spellingToMidi(next.step, next.alter, next.octave));
    this.renderScore();
  }

  /** Adjust pitch of the selected note by one octave. No-op on rests. */
  adjustOctave(direction: number): void {
    const engine = this.getEngine();
    if (!this.state.selectedNoteId || !engine) return;

    const selectedNote = engine.getNote(this.state.selectedNoteId);
    if (!selectedNote || selectedNote.isRest) return;

    engine.updateNote(this.state.selectedNoteId, { octave: selectedNote.octave! + direction });
    this.audition(spellingToMidi(selectedNote.step!, selectedNote.alter!, selectedNote.octave! + direction));
    this.renderScore();
  }

  /**
   * Reference pitch (MIDI) from neighboring notes for octave context:
   * the average of the nearest prev/next non-rest notes, or middle C.
   */
  getContextPitch(): number {
    const engine = this.getEngine();
    if (!engine || !this.state.selectedNoteId) return 60;

    const score = engine.getScore();
    const allNotes = score.measures
      .flatMap(m => getMeasureNotes(m).map(n => ({ ...n, measureNumber: m.number })))
      .sort((a, b) =>
        a.measureNumber !== b.measureNumber
          ? a.measureNumber - b.measureNumber
          : fracCompare(a.beat, b.beat),
      );

    const currentIndex = allNotes.findIndex(n => n.id === this.state.selectedNoteId);
    if (currentIndex === -1) return 60;

    let prevMidi: number | null = null;
    let nextMidi: number | null = null;
    for (let i = currentIndex - 1; i >= 0; i--) {
      const n = allNotes[i];
      if (!n.isRest && n.step) { prevMidi = spellingToMidi(n.step, n.alter!, n.octave!); break; }
    }
    for (let i = currentIndex + 1; i < allNotes.length; i++) {
      const n = allNotes[i];
      if (!n.isRest && n.step) { nextMidi = spellingToMidi(n.step, n.alter!, n.octave!); break; }
    }

    if (prevMidi !== null && nextMidi !== null) return Math.round((prevMidi + nextMidi) / 2);
    return prevMidi ?? nextMidi ?? 60;
  }

  /** Scroll the sheet container so the selected note is visible. */
  scrollSelectedNoteIntoView(): void {
    const scrollContainer = this.getScrollContainer();
    if (!scrollContainer || !this.state.selectedNoteId) return;

    const svgRect = this.hitTester.noteRect(this.state.selectedNoteId);
    if (!svgRect) return;
    // Hit-tester rects are SVG-logical; the sheet displays them zoomed
    const z = this.state.zoom;
    const rect = { x: svgRect.x * z, y: svgRect.y * z, width: svgRect.width * z, height: svgRect.height * z };

    const padding = 50;
    const containerRect = scrollContainer.getBoundingClientRect();

    const visibleLeft = scrollContainer.scrollLeft;
    const visibleRight = scrollContainer.scrollLeft + containerRect.width;
    if (rect.x < visibleLeft + padding) {
      scrollContainer.scrollLeft = Math.max(0, rect.x - padding);
    } else if (rect.x + rect.width > visibleRight - padding) {
      scrollContainer.scrollLeft = rect.x + rect.width - containerRect.width + padding;
    }

    const visibleTop = scrollContainer.scrollTop;
    const visibleBottom = scrollContainer.scrollTop + containerRect.height;
    if (rect.y < visibleTop + padding) {
      scrollContainer.scrollTop = Math.max(0, rect.y - padding);
    } else if (rect.y + rect.height > visibleBottom - padding) {
      scrollContainer.scrollTop = rect.y + rect.height - containerRect.height + padding;
    }
  }

  private movePitchDiatonically(
    step: PitchStep, alter: PitchAlter, octave: number, direction: number,
  ): { step: PitchStep; alter: PitchAlter; octave: number } {
    const STEPS: PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    let idx = STEPS.indexOf(step) + direction;
    let newOctave = octave;
    if (idx > 6) { idx = 0; newOctave++; }
    else if (idx < 0) { idx = 6; newOctave--; }
    return { step: STEPS[idx], alter, octave: newOctave };
  }
}
