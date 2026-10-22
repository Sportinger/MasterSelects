// Grid Glyph (the glyph engine with a ruled line around every cell): Line Width counts pixels of a 1080p frame and
// every pixel takes the share of it the line covers, so the grid carries the same light at every preview quality and
// export size (the earlier line, a share of the cell, vanished at half size and came and went where a cell was not a
// whole number of pixels); a 1 px line fills exactly one pixel row; Line Glow lights the line on the ground and
// cuts a darker joint through a full block; out-of-range values render clamped and say so; setups saved without the
// new controls hide them.
import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { GRID_LEGACY_LINE_GLOW, GRID_LINE_GLOW, GRID_LINE_WIDTH } from '../../src/effects/glyph/gridGlyph';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { effectParamDefinitions } from '../../src/services/operators/effectParamVisibility';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { Effect } from '../../src/types/effects';

const GREY = .5;
/** Grid Glyph on a flat grey picture; the character covers `glyph` of every cell (0: no character, 1: a full block). */
function renderer(overrides: Record<string, unknown>, resolution: [number, number], glyph = 0) {
  const params: Record<string, unknown> = { ...getDefaultParams('grid-glyph'), background: 0, amount: 1, lineGlow: 1, ...overrides };
  const plan = compileImageOperatorGraph(effectOperatorGraph({ type: 'grid-glyph', params: params as Effect['params'] }), params, {
    parameterSchema: getEffect('grid-glyph')!.params, resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset: ' .#@', cellSize: 64 }) });
  /** The ink coverage of the pixel (x, y): 0 = the dark ground (grey × 0.08), 1 = the full cell colour. */
  return (x: number, y: number) => {
    const out = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [(x + .5) / resolution[0], (y + .5) / resolution[1]], resolution,
      sampleImage: () => [GREY, GREY, GREY, 1], sampleResource: () => [0, 0, 0, glyph] }) as number[];
    return (out[1] / GREY - .08) / .92;
  };
}

/** The light of the column lines along one pixel row through the middle of the cells' height, per output pixel. */
function rowLight(overrides: Record<string, unknown>, resolution: [number, number]) {
  const coverage = renderer(overrides, resolution), cellPixels = (overrides.cellSize as number) * resolution[1] / 1080;
  const y = Math.floor(cellPixels / 2), width = Math.floor(cellPixels * 6);
  return Array.from({ length: width }, (_, x) => coverage(x, y)).reduce((sum, value) => sum + value, 0) / width;
}

describe('Grid Glyph', () => {
  it('has Line Width and Line Glow of its own in the Grid section, 18 px cells and four presets', () => {
    const { params, presets } = getEffect('grid-glyph')!;
    expect(params.lineWidth).toMatchObject({ label: 'Line Width', default: GRID_LINE_WIDTH, min: 0, max: 8, renderMin: 0, renderMax: 8, unit: ' px', group: 'Grid', graphOnly: true, lookOwn: true });
    expect(params.lineGlow).toMatchObject({ label: 'Line Glow', default: GRID_LINE_GLOW, legacyDefault: GRID_LEGACY_LINE_GLOW, min: 0, max: 1, group: 'Grid', graphOnly: true, lookOwn: true });
    expect(Object.keys(params).filter(key => params[key].group === 'Grid')).toEqual(['cellSize', 'lineWidth', 'lineGlow']);
    expect(getDefaultParams('grid-glyph')).toMatchObject({ cellSize: 18, lineWidth: 1, lineGlow: .4, background: .2 });
    expect(presets?.map(preset => preset.name)).toEqual(['Type Case', 'Data Sheet', 'Circuit Board', 'Mosaic Tiles']);
    for (const preset of presets ?? []) for (const key of ['customRamp', 'blackLevel', 'lineWidth', 'lineGlow']) expect(preset.params, `${preset.name} ${key}`).toHaveProperty(key);
  });

  it('a 1 px line fills exactly one pixel row and one pixel column at the top left of every cell', () => {
    const coverage = renderer({ cellSize: 18 }, [1920, 1080]);
    expect(coverage(36, 45)).toBeCloseTo(1, 6);
    expect(coverage(37, 45)).toBeCloseTo(0, 6);
    expect(coverage(35, 45)).toBeCloseTo(0, 6);
    expect(coverage(45, 54)).toBeCloseTo(1, 6);
    expect(coverage(45, 50)).toBeCloseTo(0, 6);
  });

  it('carries the same light at every frame size, also where a cell is not a whole number of pixels', () => {
    // Cell Size 14: 7, 9.33, 14 and 28 pixels. The earlier line (a share of the cell) gave 0 at 960 and an uneven grid at 1280.
    const light = ([960, 540, 1280, 720, 1920, 1080, 3840, 2160] as const).reduce<number[]>((all, _, index, sizes) => index % 2
      ? all : [...all, rowLight({ cellSize: 14, lineWidth: 1 }, [sizes[index], sizes[index + 1]])], []);
    for (const value of light) expect(value).toBeCloseTo(1 / 14, 3);
    expect(rowLight({ cellSize: 14, lineWidth: 2.5 }, [1280, 720])).toBeCloseTo(2.5 / 14, 3);
  });

  it('Line Width 0 rules no lines; Line Glow lights the line on the ground and cuts a darker joint through a full block', () => {
    expect(rowLight({ cellSize: 18, lineWidth: 0 }, [1920, 1080])).toBe(0);
    expect(renderer({ cellSize: 18, lineGlow: .3 }, [1920, 1080], 0)(36, 45)).toBeCloseTo(.3, 6);
    const block = renderer({ cellSize: 18, lineGlow: .1 }, [1920, 1080], 1);
    expect(block(36, 45)).toBeCloseTo(.1, 6);
    expect(block(40, 45)).toBeCloseTo(1, 6);
  });

  it('renders Line Width and Line Glow clamped outside their range and says so', () => {
    expect(rowLight({ cellSize: 36, lineWidth: 30 }, [1920, 1080])).toBeCloseTo(rowLight({ cellSize: 36, lineWidth: 8 }, [1920, 1080]), 6);
    const graph = effectOperatorGraph({ type: 'grid-glyph', params: getDefaultParams('grid-glyph') });
    expect(paramRangeNotes(getEffect('grid-glyph')!.params, { lineWidth: 30, lineGlow: -1 }, graph).map(note => note.message)).toEqual([
      'Line Width 30 is above the rendered range (0 to 8) and renders as 8.',
      'Line Glow -1 is below the rendered range (0 to 1) and renders as 0.',
    ]);
  });

  it('a node setup saved without Line Width or Line Glow hides them in the card', () => {
    const graph = structuredClone(effectOperatorGraph({ type: 'grid-glyph', params: getDefaultParams('grid-glyph') }));
    for (const id of ['line-width', 'line-glow']) graph.nodes.find(node => node.id === id)!.bindings = {};
    const definitions = effectParamDefinitions({ type: 'grid-glyph', params: getDefaultParams('grid-glyph'), operatorGraph: graph });
    expect(definitions.lineWidth.hidden).toBe(true);
    expect(definitions.lineGlow.hidden).toBe(true);
  });
});
