// VexFlow score renderer (issue #366, port phase 2).
//
// Orchestrates a full explicit re-render of a Score into an SVG container:
// layout (scoreLayout), note building (scoreNoteFactory), and beams/tuplets/
// ties (scoreSpanners). Selection and ghost-note visuals are applied as
// VexFlow styles BEFORE drawing — no post-render SVG recoloring, no DOM
// surgery, no context monkey-patching (the kikoromantest hacks are gone).
//
// The renderer keeps a per-render snapshot the interaction layer reads:
// note refs (pitch/rest id → StaveNote + key index), Stave refs, tuplets,
// measure bounds, and line layout. Model slot ids are set as VexFlow element
// ids, so each slot renders as `<g class="vf-stavenote" id="vf-<slotId>">`.

import { Formatter, Renderer, Stave, Voice } from 'vexflow';
import type { Clef, Measure, Score } from '../../../types/scoreClip';
import { fracCompare } from '../fraction';
import { Logger } from '../../logger';
import {
  type BuiltSlotNote,
  createStaveNotesFromSlots,
} from './scoreNoteFactory';
import { LAYOUT_CONFIG, type MeasureWidthInfo, calculateMeasureWidths } from './scoreLayout';
import {
  type BuiltTuplet,
  type RenderedNoteRef,
  buildBeams,
  buildPendingTie,
  buildTies,
  buildTuplets,
} from './scoreSpanners';
import {
  type MeasureBounds,
  type ScoreRenderOptions,
  type ScoreRenderSelection,
  SELECTION_STYLE,
} from './scoreRenderTypes';
import { renderGhostNote } from './scoreGhostNote';

const log = Logger.create('ScoreRenderer');

export class VexFlowScoreRenderer {
  private renderer: Renderer | null = null;
  private context: ReturnType<Renderer['getContext']> | null = null;
  private readonly svgContainer: HTMLElement;

  /** Rendered note refs: NotePitch id AND Rest slot id → StaveNote + key index */
  private noteRefs = new Map<string, RenderedNoteRef>();
  /** Stave per measure number (native geometry source for hit-testing) */
  private staves = new Map<number, Stave>();
  /** Tuplets rendered per measure, by tuplet id */
  private tuplets = new Map<string, BuiltTuplet>();
  /** Bounds per measure number */
  private measureBounds = new Map<number, MeasureBounds>();
  /** Line/width layout of the last render */
  private layoutInfo = new Map<number, MeasureWidthInfo>();

  constructor(containerElement: HTMLElement) {
    this.svgContainer = containerElement;
  }

  /** Create the SVG renderer. Call once before the first renderScore(). */
  initialize(width: number, height: number): void {
    this.svgContainer.innerHTML = '';
    this.renderer = new Renderer(this.svgContainer as HTMLDivElement, Renderer.Backends.SVG);
    this.renderer.resize(width, height);
    this.context = this.renderer.getContext();
  }

  getSVGElement(): SVGElement | null {
    return this.svgContainer.querySelector('svg');
  }

  // ---- Per-render snapshot (read by the interaction layer) ----

  getNoteRef(noteId: string): RenderedNoteRef | undefined {
    return this.noteRefs.get(noteId);
  }

  getStave(measureNumber: number): Stave | undefined {
    return this.staves.get(measureNumber);
  }

  getTuplet(tupletId: string): BuiltTuplet | undefined {
    return this.tuplets.get(tupletId);
  }

  getMeasureBounds(measureNumber: number): MeasureBounds | undefined {
    return this.measureBounds.get(measureNumber);
  }

  getLayoutInfo(): ReadonlyMap<number, MeasureWidthInfo> {
    return this.layoutInfo;
  }

  /** Total rendered height of the last render (CSS px). */
  getRenderedHeight(): number {
    const svg = this.getSVGElement();
    return svg ? parseInt(svg.getAttribute('height') || '0') : 0;
  }

  /**
   * Render the complete score. Always a full clear + re-render; selection and
   * ghost note are styled during this pass.
   */
  renderScore(score: Score, options: ScoreRenderOptions): void {
    const context = this.context;
    if (!context || !this.renderer) {
      throw new Error('Renderer not initialized. Call initialize() first.');
    }

    this.clear();

    const margin = LAYOUT_CONFIG.MARGIN;
    const staveHeight = LAYOUT_CONFIG.STAVE_HEIGHT;
    const verticalSpacing = LAYOUT_CONFIG.VERTICAL_SPACING;
    const clef: Clef = score.clef || 'treble';
    const selection = options.selection ?? null;

    this.layoutInfo = calculateMeasureWidths(score, options.width);

    let maxLine = 0;
    for (const info of this.layoutInfo.values()) {
      maxLine = Math.max(maxLine, info.lineNumber);
    }
    const totalHeight = (maxLine + 1) * (staveHeight + verticalSpacing) + margin * 2;

    // Only resize if dimensions changed (VexFlow best practice)
    const svg = this.getSVGElement();
    const currentWidth = svg ? parseInt(svg.getAttribute('width') || '0') : 0;
    const currentHeight = svg ? parseInt(svg.getAttribute('height') || '0') : 0;
    if (currentWidth !== options.width || currentHeight !== totalHeight) {
      this.renderer.resize(options.width, totalHeight);
    }

    // Render measures line by line
    let currentLine = -1;
    let currentX = margin;

    for (const measure of score.measures) {
      const widthInfo = this.layoutInfo.get(measure.number);
      if (!widthInfo) continue;

      if (widthInfo.lineNumber !== currentLine) {
        currentLine = widthInfo.lineNumber;
        currentX = margin;
      }

      const y = margin + currentLine * (staveHeight + verticalSpacing);
      const isFirstInLine = currentX === margin;

      this.renderMeasure(measure, currentX, y, widthInfo.finalWidth, isFirstInLine, clef, widthInfo.lineNumber, selection);

      currentX += widthInfo.finalWidth;
    }

    // Ties span measures — draw after all measures exist
    this.renderTies(score, selection);

    if (options.pendingTieFromNoteId) {
      const pending = buildPendingTie(score, options.pendingTieFromNoteId, this.noteRefs);
      pending?.setContext(context).drawWithStyle();
    }

    if (options.ghostNote) {
      renderGhostNote(context, score, options.ghostNote, this.layoutInfo, this.getSVGElement());
    }
  }

  /** Clear SVG content and the per-render snapshot. */
  clear(): void {
    // Keep the SVG element itself; only remove its children
    const svg = this.getSVGElement();
    if (svg) {
      while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
      }
    }
    this.noteRefs.clear();
    this.staves.clear();
    this.tuplets.clear();
    this.measureBounds.clear();
    this.layoutInfo.clear();
  }

  // ---- Internals ----

  private renderMeasure(
    measure: Measure,
    x: number,
    y: number,
    width: number,
    isFirstInLine: boolean,
    clef: Clef,
    lineNumber: number,
    selection: ScoreRenderSelection | null,
  ): void {
    const context = this.context!;

    const stave = new Stave(x, y, width);
    if (measure.number === 1 || isFirstInLine) {
      stave.addClef(clef);
    }
    if (measure.number === 1) {
      stave.addTimeSignature(`${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`);
    }
    stave.setContext(context).draw();

    this.staves.set(measure.number, stave);
    this.measureBounds.set(measure.number, {
      measureX: x,
      measureY: y,
      measureWidth: width,
      noteStartX: stave.getNoteStartX(),
      noteEndX: stave.getNoteEndX(),
      lineNumber,
    });

    if (measure.slots.length === 0) return;

    const sortedSlots = measure.slots.toSorted((a, b) => fracCompare(a.beat, b.beat));
    const builtNotes = createStaveNotesFromSlots(sortedSlots, clef);

    this.applySelectionStyles(builtNotes, selection);

    // Tuplets must exist BEFORE the voice reads ticks
    const builtTuplets = buildTuplets(builtNotes, measure);

    const staveNotes = builtNotes.map(b => b.staveNote);
    const voice = new Voice({
      numBeats: measure.timeSignature.numerator,
      beatValue: measure.timeSignature.denominator,
    });

    try {
      voice.addTickables(staveNotes);

      const beams = buildBeams(staveNotes, sortedSlots, clef);

      const noteAreaWidth = stave.getNoteEndX() - stave.getNoteStartX();
      const formatWidth = Math.max(noteAreaWidth - 15, 50);
      new Formatter().joinVoices([voice]).format([voice], formatWidth);
      voice.draw(context, stave);

      for (const beam of beams) {
        beam.setContext(context).drawWithStyle();
      }

      for (const built of builtTuplets) {
        if (selection?.tupletId && built.tupletId === selection.tupletId) {
          built.vexTuplet.setStyle(SELECTION_STYLE);
        }
        built.vexTuplet.setContext(context).drawWithStyle();
        this.tuplets.set(built.tupletId, built);
      }

      this.recordNoteRefs(builtNotes);
    } catch (error) {
      log.error('Could not render measure', { measure: measure.number, error: String(error) });
    }
  }

  /**
   * Apply selection styles BEFORE drawing (replaces the old post-render
   * HighlightController): selected pitch → key style, selected rest → whole
   * note style, plus accidental/articulation modifier styles.
   */
  private applySelectionStyles(builtNotes: BuiltSlotNote[], selection: ScoreRenderSelection | null): void {
    if (!selection) return;

    for (const { slot, staveNote, sortedPitches } of builtNotes) {
      if (slot.type === 'rest') {
        if (selection.noteId && slot.id === selection.noteId) {
          staveNote.setStyle(SELECTION_STYLE);
        }
        continue;
      }

      if (selection.noteId) {
        const keyIndex = sortedPitches.findIndex(p => p.id === selection.noteId);
        if (keyIndex !== -1) {
          staveNote.setKeyStyle(keyIndex, SELECTION_STYLE);
          if (sortedPitches.length === 1) {
            staveNote.setStemStyle(SELECTION_STYLE);
            staveNote.setFlagStyle(SELECTION_STYLE);
          }
        }
      }

      if (selection.accidentalNoteId) {
        const keyIndex = sortedPitches.findIndex(p => p.id === selection.accidentalNoteId);
        if (keyIndex !== -1) {
          for (const modifier of staveNote.getModifiers()) {
            if (modifier.getCategory() === 'Accidental' && modifier.getIndex() === keyIndex) {
              modifier.setStyle(SELECTION_STYLE);
            }
          }
        }
      }

      if (selection.articulationNoteId && sortedPitches.some(p => p.id === selection.articulationNoteId)) {
        for (const modifier of staveNote.getModifiers()) {
          if (modifier.getCategory() === 'Articulation') {
            modifier.setStyle(SELECTION_STYLE);
          }
        }
      }
    }
  }

  /** Record pitch/rest → StaveNote refs for ties and the interaction layer. */
  private recordNoteRefs(builtNotes: BuiltSlotNote[]): void {
    for (const { slot, staveNote, sortedPitches } of builtNotes) {
      if (slot.type === 'rest') {
        // Rests can be tie targets (split-and-tie overflow onto a rest slot)
        this.noteRefs.set(slot.id, { staveNote, noteIndex: 0 });
        continue;
      }
      sortedPitches.forEach((pitch, keyIndex) => {
        this.noteRefs.set(pitch.id, { staveNote, noteIndex: keyIndex });
      });
    }
  }

  /** Draw all ties with stock StaveTie, styling the selected one pre-draw. */
  private renderTies(score: Score, selection: ScoreRenderSelection | null): void {
    const context = this.context!;
    const ties = buildTies(score, this.noteRefs, this.layoutInfo);
    for (const built of ties) {
      try {
        if (selection?.tieFromNoteId && built.fromNoteId === selection.tieFromNoteId) {
          built.tie.setStyle(SELECTION_STYLE);
        }
        built.tie.setContext(context).drawWithStyle();
      } catch (error) {
        log.warn('Could not render tie', {
          from: built.fromNoteId,
          to: built.toNoteId,
          error: String(error),
        });
      }
    }
  }
}
