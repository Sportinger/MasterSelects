// Grid Glyph: the glyph engine with a ruled line around every cell, like a type case, a table of figures or a
// tiled wall. The lines lie on the cell borders and glow in the colour of their cell, so they light up with the
// picture and fade in the dark. Shared by the effect definition (index.ts) and the runtime graph
// (src/services/operators/asciiEffectGraph.ts, its 'grid-glyph' branch, the reference). shader.wgsl is not
// compiled for the glyph looks and is out of date.
import { GLYPH_FONT_OPTIONS } from '../_shared/glyphFonts';
import type { EffectParam, EffectPreset } from '../types';

/** Line Width of new instances and of instances saved before it existed: a hairline of one 1080p pixel. */
export const GRID_LINE_WIDTH = 1;
/** Widest line that renders, in pixels of a 1080p frame (wider values render clamped and the card says so). */
export const GRID_MAX_LINE_WIDTH = 8;
/** Line Glow of new instances: the lines carry 40 % of their cell's colour. */
export const GRID_LINE_GLOW = 0.4;
/** Line Glow of instances saved before it existed: the earlier fixed 0.28. */
export const GRID_LEGACY_LINE_GLOW = 0.28;
/** Cell Size of new instances: large enough for the ruled cells to read at a glance. */
export const GRID_DEFAULT_CELL_SIZE = 18;

/** Its own controls (lookOwn): how wide and how bright the ruled lines are. */
export const GRID_GLYPH_PARAMS: Record<string, EffectParam> = {
  lineWidth: {
    type: 'number', label: 'Line Width', default: GRID_LINE_WIDTH, legacyDefault: GRID_LINE_WIDTH, min: 0, max: GRID_MAX_LINE_WIDTH, step: 0.1,
    unit: ' px', animatable: true, group: 'Grid', renderMin: 0, renderMax: GRID_MAX_LINE_WIDTH, graphOnly: true, lookOwn: true,
  },
  lineGlow: {
    type: 'number', label: 'Line Glow', default: GRID_LINE_GLOW, legacyDefault: GRID_LEGACY_LINE_GLOW, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Grid', renderMin: 0, renderMax: 1, graphOnly: true, lookOwn: true,
  },
};

const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** A line is at most half a cell wide, so the characters stay visible: the card says when Line Width is cut there. */
export function gridGlyphWarnings(values: Record<string, number | boolean | string>): string[] {
  const cell = Math.max(finite(values.cellSize, GRID_DEFAULT_CELL_SIZE), 2);
  const width = Math.min(Math.max(finite(values.lineWidth, GRID_LINE_WIDTH), 0), GRID_MAX_LINE_WIDTH);
  const round = (value: number) => Math.round(value * 10) / 10;
  return width > cell / 2
    ? [`Line Width ${round(width)} px is more than half the ${round(cell)} px cells and renders as ${round(cell / 2)} px (half a cell), so the characters stay visible; lower Line Width or raise Cell Size.`]
    : [];
}

// Every preset names Custom Ramp (a text control keeps its value otherwise), Black Level and both line controls.
export const GRID_GLYPH_PRESETS: readonly EffectPreset[] = [
  // Large serif letters, each in its own box, like the compartments of a printer's type case.
  { id: 'type-case', name: 'Type Case', params: {
    cellSize: 26, rampPreset: 'detailed', customRamp: '', fontFamily: GLYPH_FONT_OPTIONS[1].value, fontWeight: 500, background: 0.15, blackLevel: 0.12, lineWidth: 1.5, lineGlow: 0.5,
  } },
  // Pale figures in a slate-blue table that rules the whole frame, like a spreadsheet of numbers.
  { id: 'data-sheet', name: 'Data Sheet', params: {
    cellSize: 16, rampPreset: 'numeric', customRamp: '', background: 0.35, blackLevel: 0.1, lineWidth: 1, lineGlow: 0.5,
    colorMode: 'duotone', colorA: '#1a2633', colorB: '#eef4f8',
  } },
  // Bold gold zeros and ones in a fine grid on dark board green, like the copper traces of a circuit board.
  { id: 'circuit-board', name: 'Circuit Board', params: {
    cellSize: 14, rampPreset: 'binary', customRamp: '', background: 0.25, blackLevel: 0.15, lineWidth: 1, lineGlow: 0.6, fontWeight: 700,
    colorMode: 'duotone', colorA: '#05301a', colorB: '#ffd36b',
  } },
  // One full block per cell in the picture's colour with dark joints between them: a wall of square tiles.
  { id: 'mosaic-tiles', name: 'Mosaic Tiles', params: {
    cellSize: 20, rampPreset: 'standard', customRamp: '█', background: 0.5, blackLevel: 0, lineWidth: 2.5, lineGlow: 0.05,
  } },
];
