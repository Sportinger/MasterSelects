// Measure width / line-break layout for the score renderer (issue #366).
//
// Two-pass proportional layout: pass 1 estimates each measure's minimum width
// with VexFlow's Formatter and assigns measures to lines against the actual
// container width (the old port hardcoded 1000px); pass 2 distributes each
// line's remaining space proportionally.

import { Formatter, Tuplet as VexFlowTuplet, Voice } from 'vexflow';
import type { Clef, Measure, Score } from '../../../types/scoreClip';
import { fracCompare } from '../fraction';
import { Logger } from '../../logger';
import { createStaveNotesFromSlots } from './scoreNoteFactory';

const log = Logger.create('ScoreLayout');

/** Layout configuration for proportional measure spacing. */
export const LAYOUT_CONFIG = {
  /** Minimum pixels between notes for clickability */
  MIN_NOTE_SPACING: 18,
  /** Minimum measure width even for empty measures */
  MIN_MEASURE_WIDTH: 100,
  /** Maximum measure width to prevent one measure dominating */
  MAX_MEASURE_WIDTH: 400,
  /** Space for clef symbol on first measure of line */
  CLEF_WIDTH: 45,
  /** Space for time signature */
  TIME_SIG_WIDTH: 30,
  /** Padding before/after barlines */
  BARLINE_PADDING: 10,
  /** Margin around the score */
  MARGIN: 20,
  /** Stave height */
  STAVE_HEIGHT: 120,
  /** Vertical spacing between lines */
  VERTICAL_SPACING: 30,
};

/** Width calculation result for a measure. */
export interface MeasureWidthInfo {
  measureNumber: number;
  minWidth: number;
  finalWidth: number;
  lineNumber: number;
}

/**
 * Calculate minimum width needed for a single measure based on its content,
 * using VexFlow's Formatter to estimate note space.
 */
function calculateMinimumMeasureWidth(measure: Measure, isFirstInLine: boolean, clef: Clef): number {
  let overhead = LAYOUT_CONFIG.BARLINE_PADDING * 2;

  if (isFirstInLine) {
    overhead += LAYOUT_CONFIG.CLEF_WIDTH;
  }
  if (measure.number === 1) {
    overhead += LAYOUT_CONFIG.TIME_SIG_WIDTH;
  }

  // If measure has no notes (only rests), use minimum width
  const actualNotes = measure.slots.filter(s => s.type === 'chord');
  if (actualNotes.length === 0) {
    return Math.max(LAYOUT_CONFIG.MIN_MEASURE_WIDTH, overhead + 40);
  }

  // Create a temporary voice to calculate width
  const sortedSlots = measure.slots.toSorted((a, b) => fracCompare(a.beat, b.beat));
  const builtNotes = createStaveNotesFromSlots(sortedSlots, clef);
  const staveNotes = builtNotes.map(b => b.staveNote);

  // VexFlow Tuplets must exist BEFORE the voice reads ticks — they adjust
  // the notes' tick values.
  const tupletNotes = new Map<string, typeof staveNotes>();
  builtNotes.forEach(({ slot, staveNote }) => {
    if (!slot.tupletId) return;
    if (!tupletNotes.has(slot.tupletId)) tupletNotes.set(slot.tupletId, []);
    tupletNotes.get(slot.tupletId)!.push(staveNote);
  });
  for (const [tupletId, notes] of tupletNotes) {
    const tupletData = (measure.tuplets || []).find(t => t.id === tupletId);
    if (tupletData && notes.length >= 2) {
      try {
        new VexFlowTuplet(notes, {
          numNotes: tupletData.numNotes,
          notesOccupied: tupletData.notesOccupied,
        });
      } catch {
        // Tick estimation proceeds without the tuplet adjustment
      }
    }
  }

  const voice = new Voice({
    numBeats: measure.timeSignature.numerator,
    beatValue: measure.timeSignature.denominator,
  });

  try {
    voice.addTickables(staveNotes);

    const formatter = new Formatter();
    formatter.joinVoices([voice]);
    const minNoteWidth = formatter.preCalculateMinTotalWidth([voice]);

    // Safety buffer (15%) and minimum per-note spacing for clickability
    const noteCount = sortedSlots.filter(s => s.type === 'chord').length;
    const minSpacingWidth = noteCount * LAYOUT_CONFIG.MIN_NOTE_SPACING;
    const calculatedWidth = Math.max(minNoteWidth * 1.15, minSpacingWidth);

    let totalWidth = calculatedWidth + overhead;
    totalWidth = Math.max(totalWidth, LAYOUT_CONFIG.MIN_MEASURE_WIDTH);
    totalWidth = Math.min(totalWidth, LAYOUT_CONFIG.MAX_MEASURE_WIDTH);

    return totalWidth;
  } catch (error) {
    log.warn('Could not calculate measure width; using minimum', {
      measure: measure.number,
      error: String(error),
    });
    return LAYOUT_CONFIG.MIN_MEASURE_WIDTH;
  }
}

/** Distribute available width proportionally among measures on a line. */
function distributeLineWidths(measureInfos: MeasureWidthInfo[], availableWidth: number): void {
  if (measureInfos.length === 0) return;

  const totalMinWidth = measureInfos.reduce((sum, m) => sum + m.minWidth, 0);

  if (totalMinWidth >= availableWidth) {
    // Need to compress — distribute proportionally to minimum widths
    const compressionRatio = availableWidth / totalMinWidth;
    if (compressionRatio < 0.7) {
      log.warn('Severe measure compression on line', {
        percent: Math.round(compressionRatio * 100),
      });
    }
    for (const info of measureInfos) {
      info.finalWidth = info.minWidth * compressionRatio;
    }
  } else {
    // Extra space — distribute proportionally
    const extraSpace = availableWidth - totalMinWidth;
    for (const info of measureInfos) {
      const proportion = info.minWidth / totalMinWidth;
      info.finalWidth = info.minWidth + extraSpace * proportion;
    }
  }
}

/**
 * Calculate widths and line assignments for all measures.
 *
 * @param score The score to lay out
 * @param containerWidth Available container width in CSS px
 */
export function calculateMeasureWidths(score: Score, containerWidth: number): Map<number, MeasureWidthInfo> {
  const results = new Map<number, MeasureWidthInfo>();
  const clef: Clef = score.clef || 'treble';
  const availableWidth = Math.max(containerWidth - LAYOUT_CONFIG.MARGIN * 2, LAYOUT_CONFIG.MIN_MEASURE_WIDTH);

  // Pass 1: minimum widths + line assignment
  let currentLine = 0;
  let currentLineWidth = 0;
  let currentLineMeasures: MeasureWidthInfo[] = [];

  for (const measure of score.measures) {
    const isFirstInLine = currentLineMeasures.length === 0;
    const minWidth = calculateMinimumMeasureWidth(measure, isFirstInLine, clef);

    if (currentLineWidth + minWidth > availableWidth && currentLineMeasures.length > 0) {
      // Finalize current line
      distributeLineWidths(currentLineMeasures, availableWidth);
      for (const info of currentLineMeasures) {
        results.set(info.measureNumber, info);
      }

      // Start new line — recalculate width (first-in-line overhead differs)
      currentLine++;
      const newMinWidth = calculateMinimumMeasureWidth(measure, true, clef);
      const info: MeasureWidthInfo = {
        measureNumber: measure.number,
        minWidth: newMinWidth,
        finalWidth: newMinWidth,
        lineNumber: currentLine,
      };
      currentLineMeasures = [info];
      currentLineWidth = newMinWidth;
    } else {
      const info: MeasureWidthInfo = {
        measureNumber: measure.number,
        minWidth,
        finalWidth: minWidth,
        lineNumber: currentLine,
      };
      currentLineMeasures.push(info);
      currentLineWidth += minWidth;
    }
  }

  // Finalize last line
  if (currentLineMeasures.length > 0) {
    distributeLineWidths(currentLineMeasures, availableWidth);
    for (const info of currentLineMeasures) {
      results.set(info.measureNumber, info);
    }
  }

  return results;
}
