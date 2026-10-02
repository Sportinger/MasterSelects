// Render orchestration for the score editor popup (issue #366, phase 3).
//
// Port of kikoromantest's RenderController: full explicit re-renders carry
// the selection as pre-draw styles (no post-render recoloring), the ghost
// preview swaps only its overlay group per mousemove (never a full
// re-render), and the entry-mode cursor line is a lightweight SVG overlay.

import type { ArticulationType } from '../../types/scoreClip';
import { ScoreEditorEngine } from '../../services/score/ScoreEditorEngine';
import { VexFlowScoreRenderer } from '../../services/score/render/VexFlowScoreRenderer';
import { ScoreHitTester } from '../../services/score/render/ScoreHitTester';
import type { GhostNote, ScoreRenderSelection } from '../../services/score/render/scoreRenderTypes';
import { durationToBeats } from '../../services/score/musicUtils';
import { accidentalToAlter } from '../../services/score/pitchSpelling';
import type { ScoreEditorState } from './scoreEditorState';

const CURSOR_CLASS = 'score-keyboard-cursor';

/** Discrete zoom stops for the toolbar/shortcut/wheel zoom control. */
export const SCORE_ZOOM_LEVELS = [0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5, 1.75, 2];

export class ScoreRenderCoordinator {
  private renderer: VexFlowScoreRenderer;
  private hitTester: ScoreHitTester;
  private getEngine: () => ScoreEditorEngine | null;
  private state: ScoreEditorState;
  private getWidth: () => number;

  constructor(
    renderer: VexFlowScoreRenderer,
    hitTester: ScoreHitTester,
    getEngine: () => ScoreEditorEngine | null,
    state: ScoreEditorState,
    getWidth: () => number,
  ) {
    this.renderer = renderer;
    this.hitTester = hitTester;
    this.getEngine = getEngine;
    this.state = state;
    this.getWidth = getWidth;
  }

  /** Full re-render with the current selection styled pre-draw. */
  renderScore(): void {
    const engine = this.getEngine();
    if (!engine) return;
    // Lay out at the LOGICAL width (container ÷ zoom); the SVG then scales
    // back up via viewBox, so zooming is pure stock SVG scaling
    const logicalWidth = Math.max(Math.round(this.getWidth() / this.state.zoom), 240);
    this.renderer.renderScore(engine.getScore(), {
      width: logicalWidth,
      selection: this.buildSelection(),
    });
    this.applyZoom();
    this.drawKeyboardCursor();
  }

  /** Step the zoom level and re-render. */
  zoomBy(direction: 1 | -1): void {
    const levels = SCORE_ZOOM_LEVELS;
    const index = levels.findIndex(level => level >= this.state.zoom - 0.001);
    const currentIndex = index === -1 ? levels.length - 1 : index;
    const nextIndex = Math.max(0, Math.min(levels.length - 1, currentIndex + direction));
    if (levels[nextIndex] === this.state.zoom) return;
    this.state.zoom = levels[nextIndex];
    this.renderScore();
  }

  resetZoom(): void {
    if (this.state.zoom === 1) return;
    this.state.zoom = 1;
    this.renderScore();
  }

  /**
   * Scale the rendered SVG to the zoom level: the width/height ATTRIBUTES
   * stay the logical drawing size (VexFlow owns them), the viewBox mirrors
   * them, and CSS width/height scale the box. getScreenCTM() then maps
   * pointer coordinates back through the zoom automatically.
   */
  private applyZoom(): void {
    const svg = this.renderer.getSVGElement() as SVGSVGElement | null;
    if (!svg) return;
    const width = parseInt(svg.getAttribute('width') || '0');
    const height = parseInt(svg.getAttribute('height') || '0');
    if (!width || !height) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.width = `${Math.round(width * this.state.zoom)}px`;
    svg.style.height = `${Math.round(height * this.state.zoom)}px`;
  }

  /**
   * Update only the ghost-note overlay for a hover position.
   * Returns true if a ghost was rendered (callers hide the cursor then).
   */
  renderPreview(coords: { x: number; y: number }): boolean {
    const engine = this.getEngine();
    if (!engine) return false;

    const ghost = this.computeGhostNote(coords);
    const rendered = this.renderer.updateGhostNote(engine.getScore(), ghost);
    this.state.showCursor = !rendered;
    this.drawKeyboardCursor();
    return rendered;
  }

  /** Remove the ghost overlay (mouse left the sheet, mode switched, …). */
  clearPreview(): void {
    const engine = this.getEngine();
    if (!engine) return;
    this.renderer.updateGhostNote(engine.getScore(), null);
    this.state.showCursor = true;
    this.drawKeyboardCursor();
  }

  // ==================== Internals ====================

  private buildSelection(): ScoreRenderSelection {
    return {
      noteId: this.state.selectedNoteId,
      accidentalNoteId: this.state.selectedAccidentalNoteId,
      articulationNoteId: this.state.selectedArticulationNoteId,
      tupletId: this.state.selectedTupletId,
      tieFromNoteId: this.state.selectedTieFromNoteId,
    };
  }

  private armedArticulations(): ArticulationType[] | undefined {
    const arts: ArticulationType[] = [];
    if (this.state.accent) arts.push('accent');
    if (this.state.staccato) arts.push('staccato');
    if (this.state.tenuto) arts.push('tenuto');
    return arts.length ? arts : undefined;
  }

  /** Ghost note for a hover position, or null in invalid zones. */
  private computeGhostNote(coords: { x: number; y: number }): GhostNote | null {
    const engine = this.getEngine();
    if (!engine) return null;

    const measure = this.hitTester.measureAtPoint(coords);
    if (measure === null || !engine.getMeasure(measure)) return null;

    // Only inside the note-entry span (past clef/time signature)
    const xRange = this.hitTester.noteEntryXRange(measure);
    if (xRange && (coords.x < xRange.startX || coords.x > xRange.endX)) return null;

    const position = this.hitTester.positionFromPoint(coords, durationToBeats(this.state.selectedDuration));
    if (!position) return null;

    return {
      step: position.spelling.step,
      alter: accidentalToAlter(this.state.selectedAccidental),
      octave: position.spelling.octave,
      duration: this.state.selectedDuration,
      measure: position.measure,
      beat: position.beat,
      rawX: coords.x,
      ...(this.state.selectedDots && { dots: this.state.selectedDots }),
      ...(this.armedArticulations() && { articulations: this.armedArticulations() }),
    };
  }

  /**
   * Draw (or remove) the keyboard-entry cursor: a vertical line at the
   * insertion point after the anchor note, entry mode only.
   */
  private drawKeyboardCursor(): void {
    const svg = this.renderer.getSVGElement();
    if (!svg) return;
    svg.querySelectorAll(`.${CURSOR_CLASS}`).forEach(el => el.remove());

    if (this.state.selectedTool !== 'entry' || !this.state.selectedNoteId || !this.state.showCursor) return;

    const info = this.hitTester.keyboardCursorInfo(this.state.selectedNoteId);
    if (!info) return;

    const line = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(info.x));
    line.setAttribute('y1', String(info.topY));
    line.setAttribute('x2', String(info.x));
    line.setAttribute('y2', String(info.bottomY));
    line.setAttribute('stroke', '#3B82F6');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('class', CURSOR_CLASS);
    line.style.pointerEvents = 'none';
    svg.appendChild(line);
  }
}
