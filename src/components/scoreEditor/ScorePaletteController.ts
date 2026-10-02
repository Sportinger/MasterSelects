// Palette actions: duration, accidental, articulations, tie, dot, tuplet
// (issue #366, phase 3). Port of kikoromantest's PaletteController.
//
// In selection mode with a note selected, palette actions edit the note; in
// entry mode they arm the pending values for the next entered note and
// refresh the ghost preview at the last hover position.

import type { Accidental, ArticulationType, NoteDuration, PitchAlter } from '../../types/scoreClip';
import { ScoreEditorEngine } from '../../services/score/ScoreEditorEngine';
import { fracCompare, fracLt } from '../../services/score/fraction';
import { getMeasureNotes } from '../../services/score/musicUtils';
import { spellingDiatonicPos } from '../../services/score/pitchSpelling';
import type { ScoreEditorState } from './scoreEditorState';

export class ScorePaletteController {
  private getEngine: () => ScoreEditorEngine | null;
  private state: ScoreEditorState;
  private renderScore: () => void;
  private renderPreview: (coords: { x: number; y: number }) => void;
  private getLastMousePosition: () => { x: number; y: number } | null;
  private selectNote: (id: string | null) => void;

  constructor(
    getEngine: () => ScoreEditorEngine | null,
    state: ScoreEditorState,
    renderScore: () => void,
    renderPreview: (coords: { x: number; y: number }) => void,
    getLastMousePosition: () => { x: number; y: number } | null,
    selectNote: (id: string | null) => void,
  ) {
    this.getEngine = getEngine;
    this.state = state;
    this.renderScore = renderScore;
    this.renderPreview = renderPreview;
    this.getLastMousePosition = getLastMousePosition;
    this.selectNote = selectNote;
  }

  /** Articulations currently armed for the next note entry. */
  getPendingArticulations(): ArticulationType[] | undefined {
    const arts: ArticulationType[] = [];
    if (this.state.accent) arts.push('accent');
    if (this.state.staccato) arts.push('staccato');
    if (this.state.tenuto) arts.push('tenuto');
    return arts.length ? arts : undefined;
  }

  private refreshPreview(): void {
    const pos = this.getLastMousePosition();
    if (pos) this.renderPreview(pos);
  }

  setDuration(duration: NoteDuration): void {
    this.state.selectedDuration = duration;
    this.state.selectedDots = 0;
    this.state.tupletMode = false;
    const engine = this.getEngine();
    if (this.state.selectedNoteId && engine && this.state.selectedTool === 'selection') {
      engine.updateNote(this.state.selectedNoteId, { duration, dots: 0 });
      this.renderScore();
    } else if (this.state.selectedTool === 'selection') {
      this.state.selectedTool = 'entry';
      this.refreshPreview();
    }
  }

  setAccidental(accidental: Accidental | null): void {
    const newValue = this.state.selectedAccidental === accidental ? null : accidental;
    this.state.selectedAccidental = newValue;
    const engine = this.getEngine();

    if (this.state.selectedNoteId && engine && this.state.selectedTool === 'selection') {
      const note = engine.getNote(this.state.selectedNoteId);
      // Rests have no accidental — keep the palette value armed for entry
      if (note?.isRest) return;
      if (newValue === null) {
        if (note?.forceAccidental) {
          engine.updateNote(this.state.selectedNoteId, { forceAccidental: undefined });
        } else {
          engine.updateNote(this.state.selectedNoteId, { alter: 0, forceAccidental: undefined });
        }
      } else if (newValue === 'n') {
        // Force the natural sign only when measure context wouldn't show it
        const measure = note ? engine.getMeasure(note.measure) : undefined;
        let wouldAutoShow = false;
        if (measure && note) {
          const active = new Map<number, PitchAlter>();
          const preceding = getMeasureNotes(measure)
            .filter(n => !n.isRest && !n.tiedFrom && fracLt(n.beat, note.beat))
            .sort((a, b) => fracCompare(a.beat, b.beat));
          for (const n of preceding) {
            active.set(spellingDiatonicPos(n.step!, n.octave!), (n.alter ?? 0) as PitchAlter);
          }
          const activeAlter = active.get(spellingDiatonicPos(note.step!, note.octave!));
          wouldAutoShow = activeAlter !== undefined && activeAlter !== 0;
        }
        engine.updateNote(this.state.selectedNoteId, {
          alter: 0,
          forceAccidental: wouldAutoShow ? undefined : true,
        });
      } else {
        const newAlter: PitchAlter = newValue === '#' ? 1 : -1;
        const forceAccidental = note?.alter === newAlter ? true : undefined;
        engine.updateNote(this.state.selectedNoteId, { alter: newAlter, forceAccidental });
      }
      this.renderScore();
      this.selectNote(this.state.selectedNoteId);
    } else if (this.state.selectedTool === 'selection') {
      this.state.selectedTool = 'entry';
      this.refreshPreview();
    } else {
      this.refreshPreview();
    }
  }

  private toggleArticulationOrArm(type: ArticulationType, key: 'accent' | 'staccato' | 'tenuto'): void {
    const engine = this.getEngine();
    if (this.state.selectedTool === 'selection' && this.state.selectedNoteId && engine) {
      engine.toggleArticulation(this.state.selectedNoteId, type);
      this.renderScore();
    } else {
      this.state[key] = !this.state[key];
      this.refreshPreview();
    }
  }

  toggleAccent(): void {
    this.toggleArticulationOrArm('accent', 'accent');
  }

  toggleStaccato(): void {
    this.toggleArticulationOrArm('staccato', 'staccato');
  }

  toggleTenuto(): void {
    this.toggleArticulationOrArm('tenuto', 'tenuto');
  }

  toggleTie(): void {
    const engine = this.getEngine();
    if (!this.state.selectedNoteId || !engine) return;
    engine.toggleTie(this.state.selectedNoteId);
    this.renderScore();
  }

  toggleDot(): void {
    const newValue = this.state.selectedDots >= 1 ? 0 : 1;
    this.state.selectedDots = newValue;
    const engine = this.getEngine();
    if (this.state.selectedNoteId && engine && this.state.selectedTool === 'selection') {
      engine.updateNote(this.state.selectedNoteId, { dots: newValue });
      this.renderScore();
    } else if (this.state.selectedTool === 'selection') {
      this.state.selectedTool = 'entry';
      this.refreshPreview();
    } else {
      this.refreshPreview();
    }
  }

  toggleTuplet(): void {
    const engine = this.getEngine();
    if (this.state.selectedNoteId && engine && this.state.selectedTool === 'selection') {
      const note = engine.getNote(this.state.selectedNoteId);
      if (!note) return;
      if (note.tupletId) {
        engine.deleteTuplet(note.tupletId);
      } else {
        const result = engine.applyTupletToNote(this.state.selectedNoteId);
        if (result) this.selectNote(result.note.id);
      }
      this.renderScore();
      return;
    }
    this.state.tupletMode = !this.state.tupletMode;
    if (this.state.tupletMode) {
      this.state.selectedDots = 0;
    }
  }

  resetToDefaults(): void {
    this.state.selectedDuration = 'q';
    this.state.selectedAccidental = null;
    this.state.selectedDots = 0;
    this.state.accent = false;
    this.state.staccato = false;
    this.state.tenuto = false;
  }

  // --- Toolbar button active-state helpers ---
  // Selection mode reflects the selected note's actual state; entry mode
  // reflects the pending palette state.

  private noteHasArticulation(type: ArticulationType, pendingKey: 'accent' | 'staccato' | 'tenuto'): boolean {
    const engine = this.getEngine();
    if (this.state.selectedTool === 'selection' && engine) {
      if (this.state.selectedArticulationNoteId) {
        return this.state.selectedArticulationType === type;
      }
      if (this.state.selectedNoteId) {
        const note = engine.getNote(this.state.selectedNoteId);
        return note?.articulations?.includes(type) ?? false;
      }
    }
    return this.state[pendingKey];
  }

  noteHasAccent(): boolean {
    return this.noteHasArticulation('accent', 'accent');
  }

  noteHasStaccato(): boolean {
    return this.noteHasArticulation('staccato', 'staccato');
  }

  noteHasTenuto(): boolean {
    return this.noteHasArticulation('tenuto', 'tenuto');
  }

  noteHasTie(): boolean {
    const engine = this.getEngine();
    if (!this.state.selectedNoteId || !engine) return false;
    return !!engine.getNote(this.state.selectedNoteId)?.tiedTo;
  }
}
