// Ghost-note preview rendering (issue #366, port phase 2).
//
// Draws the hover-preview note as a translucent blue overlay. The note is
// styled with VexFlow styles BEFORE drawing and emitted inside its own SVG
// group — replacing kikoromantest's post-draw child-index diff + recursive
// attribute rewriting. Positioning still uses a hidden padding-rest voice so
// the ghost lands where the real note would be formatted, with an optional
// horizontal shift to follow the raw pointer X.

import { Accidental, Dot, Formatter, StaveNote, Stave, Voice, type RenderContext } from 'vexflow';
import type { Clef, Score } from '../../../types/scoreClip';
import { Logger } from '../../logger';
import { spellingToVexflowKey } from '../pitchSpelling';
import { durationToBeats } from '../musicUtils';
import {
  addArticulations,
  alterToVexSign,
  convertDuration,
} from './scoreNoteFactory';
import { LAYOUT_CONFIG, type MeasureWidthInfo } from './scoreLayout';
import { GHOST_STYLE, type GhostNote } from './scoreRenderTypes';

const log = Logger.create('ScoreGhostNote');

/** Padding rest durations to fill the space before/after the ghost note. */
function beatsToRestDurations(beats: number): string[] {
  const rests: string[] = [];
  let remaining = beats;
  const epsilon = 0.001;
  while (remaining > epsilon) {
    if (remaining >= 4 - epsilon) { rests.push('wr'); remaining -= 4; }
    else if (remaining >= 2 - epsilon) { rests.push('hr'); remaining -= 2; }
    else if (remaining >= 1 - epsilon) { rests.push('qr'); remaining -= 1; }
    else if (remaining >= 0.5 - epsilon) { rests.push('8r'); remaining -= 0.5; }
    else if (remaining >= 0.25 - epsilon) { rests.push('16r'); remaining -= 0.25; }
    else if (remaining >= 0.125 - epsilon) { rests.push('32r'); remaining -= 0.125; }
    else break;
  }
  return rests;
}

/**
 * Render the ghost note as a styled overlay group.
 * Returns true if the ghost was drawn.
 */
export function renderGhostNote(
  context: RenderContext,
  score: Score,
  ghostNote: GhostNote,
  layoutInfo: ReadonlyMap<number, MeasureWidthInfo>,
  svg: SVGElement | null,
): boolean {
  try {
    const measure = score.measures.find(m => m.number === ghostNote.measure);
    const widthInfo = layoutInfo.get(ghostNote.measure);
    if (!measure || !widthInfo) return false;

    const margin = LAYOUT_CONFIG.MARGIN;

    // X position: sum widths of previous measures on the same line
    let measureX = margin;
    for (const m of score.measures) {
      if (m.number === ghostNote.measure) break;
      const mInfo = layoutInfo.get(m.number);
      if (mInfo && mInfo.lineNumber === widthInfo.lineNumber) {
        measureX += mInfo.finalWidth;
      } else if (mInfo && mInfo.lineNumber < widthInfo.lineNumber) {
        measureX = margin;
      }
    }

    const measureY = margin + widthInfo.lineNumber * (LAYOUT_CONFIG.STAVE_HEIGHT + LAYOUT_CONFIG.VERTICAL_SPACING);
    const clef: Clef = score.clef || 'treble';

    // A throwaway stave (not drawn) reproduces the real measure's note area
    const tempStave = new Stave(measureX, measureY, widthInfo.finalWidth);
    const isFirstInLine = measureX === margin;
    if (ghostNote.measure === 1 || isFirstInLine) {
      tempStave.addClef(clef);
    }
    if (ghostNote.measure === 1) {
      tempStave.addTimeSignature(`${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`);
    }
    tempStave.setContext(context);

    // Stem direction is stock VexFlow (autoStem), like real notes
    const staveNote = new StaveNote({
      keys: [spellingToVexflowKey(ghostNote.step, ghostNote.alter, ghostNote.octave)],
      duration: convertDuration(ghostNote.duration, ghostNote.dots || 0),
      autoStem: true,
      clef,
    });

    for (let d = 0; d < (ghostNote.dots || 0); d++) {
      Dot.buildAndAttach([staveNote], { all: true });
    }
    if (ghostNote.alter !== 0) {
      staveNote.addModifier(new Accidental(alterToVexSign(ghostNote.alter)), 0);
    }
    addArticulations(staveNote, ghostNote.articulations, staveNote.getStemDirection());

    // Pre-draw ghost styling — heads, stem, flag, ledger lines, and modifiers
    staveNote.setStyle(GHOST_STYLE);
    staveNote.setStemStyle(GHOST_STYLE);
    staveNote.setFlagStyle(GHOST_STYLE);
    staveNote.setLedgerLineStyle(GHOST_STYLE);
    for (const modifier of staveNote.getModifiers()) {
      modifier.setStyle(GHOST_STYLE);
    }

    // Format the ghost inside a padded SOFT voice so it lands at its beat
    const totalBeats = measure.timeSignature.numerator;
    const beatsBefore = ghostNote.beat;
    const beatsAfter = Math.max(0, totalBeats - ghostNote.beat - durationToBeats(ghostNote.duration));

    const tickables: StaveNote[] = [];
    for (const restDuration of beatsToRestDurations(beatsBefore)) {
      tickables.push(new StaveNote({ keys: ['b/4'], duration: restDuration }));
    }
    tickables.push(staveNote);
    for (const restDuration of beatsToRestDurations(beatsAfter)) {
      tickables.push(new StaveNote({ keys: ['b/4'], duration: restDuration }));
    }

    const voice = new Voice({
      numBeats: totalBeats,
      beatValue: measure.timeSignature.denominator,
    }).setMode(Voice.Mode.SOFT);
    voice.addTickables(tickables);

    const noteAreaWidth = tempStave.getNoteEndX() - tempStave.getNoteStartX();
    const formatWidth = noteAreaWidth > 0 ? Math.max(noteAreaWidth - 15, 50) : widthInfo.finalWidth - 100;
    new Formatter().joinVoices([voice]).format([voice], formatWidth);

    staveNote.setStave(tempStave);

    // Optional pointer-following shift
    let shiftX = 0;
    if (ghostNote.rawX !== undefined) {
      try {
        shiftX = ghostNote.rawX - staveNote.getAbsoluteX();
      } catch {
        // getAbsoluteX can fail before draw; keep the formatted position
      }
    }

    // Draw only the ghost note (padding rests are positioning-only), inside
    // its own group so it stays a removable, non-interactive overlay
    const group = context.openGroup('score-ghost-note') as SVGGElement | undefined;
    if (group) {
      group.style.pointerEvents = 'none';
      if (shiftX !== 0) group.setAttribute('transform', `translate(${shiftX}, 0)`);
    }
    staveNote.setContext(context).drawWithStyle();
    context.closeGroup();

    return true;
  } catch (error) {
    log.warn('Could not render ghost note', { error: String(error) });
    if (svg?.querySelector('.vf-score-ghost-note')) {
      // A partially drawn ghost would linger — remove it (VexFlow prefixes
      // group classes with "vf-")
      svg.querySelectorAll('.vf-score-ghost-note').forEach(el => el.remove());
    }
    return false;
  }
}
