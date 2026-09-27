// Mouse interactions: selection picking (incl. tie/accidental/articulation/
// tuplet sub-elements), click-to-add entry, 150ms-threshold pitch drags, and
// the throttled ghost preview (issue #366, phase 3).
//
// Port of kikoromantest's MouseController against the VexFlow-native hit
// tester. Popup rule: document-level listeners bind to the sheet's
// ownerDocument. Pitch drags follow the piano-roll history pattern —
// transient updates during the drag, one snapshot on release.

import type { PitchSpelling } from '../../types/scoreClip';
import { ScoreEditorEngine } from '../../services/score/ScoreEditorEngine';
import { ScoreHitTester } from '../../services/score/render/ScoreHitTester';
import { beatToFrac } from '../../services/score/musicUtils';
import { accidentalToAlter, spellingToMidi } from '../../services/score/pitchSpelling';
import { Logger } from '../../services/logger';
import type { ScoreEditorState } from './scoreEditorState';
import type { ScoreSelectionController } from './ScoreSelectionController';
import type { ScoreRenderCoordinator } from './ScoreRenderCoordinator';

const log = Logger.create('ScoreMouse');

export class ScoreMouseController {
  // --- Ephemeral interaction state (not in EditorState — no reactivity needed) ---
  private lastCanvasMousePosition: { x: number; y: number } | null = null;
  private isMouseButtonDown = false;
  private isDraggingNote = false;
  private draggedNoteOriginalPitch: PitchSpelling | null = null;
  private dragStartTime: number | null = null;
  private dragChangedPitch = false;
  private lastPreviewRender = 0;

  private readonly DRAG_TIME_THRESHOLD_MS = 150;
  private readonly PREVIEW_THROTTLE_MS = 50;

  private readonly onDocMouseDown = () => { this.isMouseButtonDown = true; };
  private readonly onDocMouseUp = () => { this.isMouseButtonDown = false; };

  private getEngine: () => ScoreEditorEngine | null;
  private getSheet: () => HTMLElement | null;
  private state: ScoreEditorState;
  private hitTester: ScoreHitTester;
  private selection: ScoreSelectionController;
  private render: ScoreRenderCoordinator;
  private getPendingArticulations: () => import('../../types/scoreClip').ArticulationType[] | undefined;
  private audition: (midi: number) => void;

  constructor(
    getEngine: () => ScoreEditorEngine | null,
    getSheet: () => HTMLElement | null,
    state: ScoreEditorState,
    hitTester: ScoreHitTester,
    selection: ScoreSelectionController,
    render: ScoreRenderCoordinator,
    getPendingArticulations: () => import('../../types/scoreClip').ArticulationType[] | undefined,
    audition: (midi: number) => void,
  ) {
    this.getEngine = getEngine;
    this.getSheet = getSheet;
    this.state = state;
    this.hitTester = hitTester;
    this.selection = selection;
    this.render = render;
    this.getPendingArticulations = getPendingArticulations;
    this.audition = audition;
  }

  /** Register document-level listeners on the POPUP document. Call on mount. */
  setup(): void {
    const doc = this.getSheet()?.ownerDocument ?? document;
    doc.addEventListener('mousedown', this.onDocMouseDown, true);
    doc.addEventListener('mouseup', this.onDocMouseUp, true);
  }

  /** Remove document-level listeners. Call on unmount. */
  teardown(): void {
    const doc = this.getSheet()?.ownerDocument ?? document;
    doc.removeEventListener('mousedown', this.onDocMouseDown, true);
    doc.removeEventListener('mouseup', this.onDocMouseUp, true);
  }

  getLastMousePosition(): { x: number; y: number } | null {
    return this.lastCanvasMousePosition;
  }

  // --- Coordinate mapping ---

  private clientToSvg(event: MouseEvent): { x: number; y: number } | null {
    const svg = this.getSheet()?.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const svgPoint = point.matrixTransform(ctm.inverse());
    return { x: svgPoint.x, y: svgPoint.y };
  }

  // --- Handlers ---

  handleMouseDown(event: MouseEvent): void {
    const engine = this.getEngine();
    if (!engine) return;
    if (this.state.selectedTool !== 'selection') return;

    const coords = this.clientToSvg(event);
    if (!coords) return;
    const { x, y } = coords;

    const measureNum = this.hitTester.measureAtPoint(coords);
    if (measureNum === null) return;

    // Tuplet bracket/number (only when the click isn't near the notes)
    const tupletId = this.hitTester.tupletAt(x, y);
    if (tupletId && this.hitTester.tupletMinNoteDistanceY(tupletId, y) > 12) {
      this.state.selectedTupletId = tupletId;
      this.state.selectedNoteId = null;
      this.render.renderScore();
      return;
    }

    this.state.selectedTupletId = null;
    this.state.selectedTieFromNoteId = null;

    // Tie arc
    const tieAt = this.hitTester.tieAt(x, y);
    if (tieAt) {
      this.state.selectedNoteId = null;
      this.state.selectedArticulationNoteId = null;
      this.state.selectedArticulationType = null;
      this.state.selectedAccidentalNoteId = null;
      this.state.selectedAccidentalType = null;
      this.state.selectedTieFromNoteId = tieAt.fromNoteId;
      this.render.renderScore();
      return;
    }

    // Accidental glyph
    const accidentalAt = this.hitTester.accidentalAt(x, y, measureNum);
    if (accidentalAt) {
      this.state.selectedNoteId = null;
      this.state.selectedArticulationNoteId = null;
      this.state.selectedArticulationType = null;
      this.state.selectedAccidentalNoteId = accidentalAt.noteId;
      this.state.selectedAccidentalType = null;
      this.render.renderScore();
      return;
    }

    // Articulation glyph
    const articulationAt = this.hitTester.articulationAt(x, y, measureNum);
    if (articulationAt) {
      this.state.selectedNoteId = null;
      this.state.selectedAccidentalNoteId = null;
      this.state.selectedAccidentalType = null;
      this.state.selectedArticulationNoteId = articulationAt.noteId;
      this.state.selectedArticulationType = articulationAt.type;
      this.render.renderScore();
      return;
    }

    // Note/rest — nearest pitch within reach
    const picked = this.hitTester.closestNoteOrRest(x, y, measureNum);
    if (picked && picked.distance < 30) {
      this.selection.selectNote(picked.noteId);
      this.render.renderScore();

      if (picked.type === 'note') {
        // Click-select audition (piano-roll behavior)
        const origNote = engine.getNote(picked.noteId);
        if (origNote?.step) {
          this.audition(spellingToMidi(origNote.step, origNote.alter!, origNote.octave!));
        }
        // Arm a pitch drag (150ms threshold separates click from drag)
        this.isDraggingNote = true;
        this.dragChangedPitch = false;
        this.draggedNoteOriginalPitch = origNote?.step
          ? { step: origNote.step, alter: origNote.alter!, octave: origNote.octave! }
          : null;
        this.dragStartTime = Date.now();
        event.preventDefault();
      }
    } else {
      this.selection.selectNote(null);
      this.render.renderScore();
    }
  }

  handleMouseUp(): void {
    if (this.isDraggingNote) {
      if (this.dragChangedPitch) {
        // Live drag updates were transient — capture ONE history snapshot now
        this.getEngine()?.commitTransientEdits('Drag pitch');
      }
      this.isDraggingNote = false;
      this.draggedNoteOriginalPitch = null;
      this.dragStartTime = null;
      this.dragChangedPitch = false;
    }
  }

  handleClick(event: MouseEvent): void {
    if (this.state.selectedTool === 'selection') return;

    const engine = this.getEngine();
    if (!engine) return;

    const coords = this.clientToSvg(event);
    if (!coords) return;
    const { x, y } = coords;

    const measureNum = this.hitTester.measureAtPoint(coords);
    if (measureNum === null) return;

    try {
      if (this.state.tupletMode) {
        this.handleTupletModeClick(coords, measureNum);
        return;
      }

      const note = engine.addNoteAtPosition(
        { x, y },
        this.state.selectedDuration,
        this.state.selectedAccidental || undefined,
        this.state.selectedDots || undefined,
        this.getPendingArticulations(),
      );

      if (note) {
        if (!note.isRest && note.step) {
          this.audition(spellingToMidi(note.step, note.alter!, note.octave!));
        }
        this.selection.selectNote(note.id);
        this.state.selectedTool = 'entry';
        this.render.renderScore();
      }
    } catch (error) {
      log.warn('Could not add note', { error: String(error) });
    }
  }

  private handleTupletModeClick(coords: { x: number; y: number }, measureNum: number): void {
    const engine = this.getEngine()!;
    const position = this.hitTester.positionFromPoint(coords);
    if (!position) return;

    const existingTuplet = engine.getTupletAtBeat(measureNum, beatToFrac(position.beat));

    if (existingTuplet) {
      // Inside an existing tuplet: plain note entry (inherits the tuplet)
      const note = engine.addNoteAtPosition(
        coords,
        this.state.selectedDuration,
        this.state.selectedAccidental || undefined,
        this.state.selectedDots || undefined,
        this.getPendingArticulations(),
      );
      if (note) {
        if (!note.isRest && note.step) {
          this.audition(spellingToMidi(note.step, note.alter!, note.octave!));
        }
        this.selection.selectNote(note.id);
        this.state.selectedTool = 'entry';
        this.render.renderScore();
      }
      return;
    }

    const naturalSpelling = this.hitTester.yToNaturalPitch(coords.y, measureNum);
    const spelling: PitchSpelling = naturalSpelling
      ? { ...naturalSpelling, alter: accidentalToAlter(this.state.selectedAccidental) }
      : { step: 'B', alter: 0, octave: 4 };

    const result = engine.createTupletAtPosition(coords, this.state.selectedDuration, spelling);
    if (result) {
      const fn = result.firstNote;
      if (!fn.isRest && fn.step) {
        this.audition(spellingToMidi(fn.step, fn.alter!, fn.octave!));
      }
      this.selection.selectNote(result.firstNote.id);
      this.state.selectedTool = 'entry';
      this.render.renderScore();
    }
  }

  handleMouseMove(event: MouseEvent): void {
    const engine = this.getEngine();
    if (!engine) return;

    const coords = this.clientToSvg(event);
    if (!coords) return;
    this.lastCanvasMousePosition = coords;

    // Pitch drag (selection mode)
    if (this.isDraggingNote && this.state.selectedNoteId && this.draggedNoteOriginalPitch !== null) {
      if (this.dragStartTime !== null && Date.now() - this.dragStartTime < this.DRAG_TIME_THRESHOLD_MS) {
        return;
      }

      const selectedNote = engine.getNote(this.state.selectedNoteId);
      if (selectedNote && !selectedNote.isRest) {
        const position = this.hitTester.positionFromPoint(coords);
        if (position) {
          // The drag PRESERVES the note's alteration (like pitchUp/Down):
          // Y resolves the diatonic step, the accidental travels with it
          const alter = selectedNote.alter ?? 0;
          const cursorMidi = spellingToMidi(position.spelling.step, alter, position.spelling.octave);
          const noteMidi = spellingToMidi(selectedNote.step!, selectedNote.alter!, selectedNote.octave!);

          if (cursorMidi !== noteMidi || position.spelling.step !== selectedNote.step) {
            engine.updateNote(this.state.selectedNoteId, {
              step: position.spelling.step,
              alter,
              octave: position.spelling.octave,
            }, { transient: true });
            this.audition(cursorMidi);
            this.dragChangedPitch = true;
            this.render.renderScore();
          }
        }
      }
      return;
    }

    if (this.state.selectedTool === 'selection') return;
    if (this.isMouseButtonDown) return;

    // Throttled ghost preview — overlay-only, never a full re-render
    const now = Date.now();
    if (now - this.lastPreviewRender < this.PREVIEW_THROTTLE_MS) return;
    this.lastPreviewRender = now;

    this.render.renderPreview(coords);
  }

  handleMouseLeave(): void {
    if (this.isDraggingNote) {
      if (this.dragChangedPitch) {
        this.getEngine()?.commitTransientEdits('Drag pitch');
      }
      this.isDraggingNote = false;
      this.draggedNoteOriginalPitch = null;
      this.dragStartTime = null;
      this.dragChangedPitch = false;
    }

    this.lastCanvasMousePosition = null;
    this.render.clearPreview();
  }

  /** Drop drag state without committing (e.g. external score reload). */
  cancelDrag(): void {
    this.isDraggingNote = false;
    this.draggedNoteOriginalPitch = null;
    this.dragStartTime = null;
    this.dragChangedPitch = false;
  }
}
