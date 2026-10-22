// Pixel Code (the glyph engine as a picture written in code): every cell draws a random character of its Scramble
// window from Random (Cell), which is the same on every GPU (the sine hash drew diagonal stripes across the frame);
// Scramble 0 keeps the character of the cell's brightness, 1 draws from the whole ramp (saved instances); Black Level
// clears the dark stage; Invert Ramp acts below Scramble 1 and the card says when it cannot; the code is coloured from
// Shadow to Highlight (saved instances keep the earlier deep blue and mint); setups saved without these nodes hide them.
import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { ASCII_RAMP_PRESETS } from '../../src/effects/_shared/asciiRamps';
import { planGlyphAtlas } from '../../src/effects/_shared/glyphAtlas';
import { PIXEL_CODE_LEGACY_HIGHLIGHT, PIXEL_CODE_LEGACY_SHADOW, PIXEL_CODE_SCRAMBLE } from '../../src/effects/glyph/pixelCode';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { effectParamDefinitions } from '../../src/services/operators/effectParamVisibility';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { imageCellHash } from '../../src/services/operators/imageOperatorEvaluation';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const RESOLUTION: [number, number] = [1920, 1080];
const BINARY = ASCII_RAMP_PRESETS.binary;
const hex = (value: string) => [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16) / 255);

function plan(overrides: Record<string, unknown>, graph?: EffectOperatorGraph) {
  const params: Record<string, unknown> = { ...getDefaultParams('pixel-code'), amount: 1, background: 0, blackLevel: 0, ...overrides };
  const charset = String(params.customRamp || BINARY);
  return compileImageOperatorGraph(graph ?? effectOperatorGraph({ type: 'pixel-code', params: params as Effect['params'] }), params, {
    parameterSchema: getEffect('pixel-code')!.params, resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset, cellSize: 64 }) });
}

/** The characters drawn by the cells of a flat grey picture of brightness `tone` (Cell Size 10: 192 × 108 cells). */
function characters(tone: number, overrides: Record<string, unknown> = {}, cells = 48) {
  const compiled = plan({ cellSize: 10, ...overrides }), ramp = String(overrides.customRamp || BINARY);
  const atlas = planGlyphAtlas({ fontFamily: 'monospace', fontWeight: 600, charset: ramp, cellSize: 64 });
  const drawn: Array<{ cell: [number, number]; glyph: string }> = [];
  for (let x = 0; x < cells; x += 1) for (let y = 0; y < cells; y += 1) {
    let read: [number, number] = [0, 0];
    evaluateImageOperatorPlan(compiled, [0, 0, 0, 0], { uv: [(x + .5) / 192, (y + .5) / 108], resolution: RESOLUTION, sampleImage: () => [tone, tone, tone, 1],
      sampleResource: (_id, uv) => { read = uv as [number, number]; return [0, 0, 0, 1]; } });
    drawn.push({ cell: [x, y], glyph: atlas.glyphs[Math.floor(read[1] * atlas.rows) * atlas.columns + Math.floor(read[0] * atlas.columns)] });
  }
  return drawn;
}

const set = (drawn: ReturnType<typeof characters>) => [...new Set(drawn.map(item => item.glyph))].toSorted();

/** The colour of a fully covered pixel of a cell on a flat grey picture of brightness `tone` (its ink). */
function ink(tone: number, overrides: Record<string, unknown> = {}, graph?: EffectOperatorGraph) {
  const out = evaluateImageOperatorPlan(plan(overrides, graph), [0, 0, 0, 0], { uv: [.5, .5], resolution: RESOLUTION,
    sampleImage: () => [tone, tone, tone, 1], sampleResource: () => [0, 0, 0, 1] }) as number[];
  return out.slice(0, 3);
}

describe('Pixel Code', () => {
  it('has Scramble, Shadow and Highlight of its own and four presets', () => {
    const { params, presets } = getEffect('pixel-code')!;
    expect(params.scramble).toMatchObject({ label: 'Scramble', default: PIXEL_CODE_SCRAMBLE, legacyDefault: 1, min: 0, max: 1, renderMin: 0, renderMax: 1,
      group: 'Glyphs', graphOnly: true, lookOwn: true });
    expect(params.shadow).toMatchObject({ label: 'Shadow', legacyDefault: PIXEL_CODE_LEGACY_SHADOW, group: 'Color', graphOnly: true, lookOwn: true });
    expect(params.highlight).toMatchObject({ label: 'Highlight', legacyDefault: PIXEL_CODE_LEGACY_HIGHLIGHT, group: 'Color', graphOnly: true, lookOwn: true });
    expect(Object.keys(params).filter(key => params[key].group === 'Color' && !params[key].deprecated)).toEqual(['shadow', 'highlight']);
    expect(presets?.map(preset => preset.name)).toEqual(['Binary Portrait', 'Hex Dump', 'Heat Map', 'Source Code']);
    for (const preset of presets ?? []) for (const key of ['customRamp', 'blackLevel', 'scramble', 'shadow', 'highlight']) expect(preset.params, `${preset.name} ${key}`).toHaveProperty(key);
  });

  it('draws each cell from Random (Cell), not the sine hash that striped the frame', () => {
    const graph = effectOperatorGraph({ type: 'pixel-code', params: getDefaultParams('pixel-code') });
    expect(graph.nodes.some(node => node.operator === 'noise.hash2d.vec2')).toBe(false);
    expect(graph.nodes.find(node => node.id === 'index-cell-random')?.operator).toBe('noise.cell-hash.vec2');
    // Scramble 1 on mid grey (own character '0', the second): the draw moves it on through the whole ramp, wrapping.
    for (const { cell, glyph } of characters(.5, { scramble: 1 }, 24)) expect(glyph, `cell ${cell}`).toBe(BINARY[(1 + Math.floor(imageCellHash(cell) * 3)) % 3]);
    // Every character takes about a third of the cells.
    const drawn = characters(.5, { scramble: 1 });
    for (const glyph of BINARY) expect(drawn.filter(item => item.glyph === glyph).length / drawn.length).toBeCloseTo(1 / 3, 1);
  });

  it('Scramble 0 keeps the character of the brightness, 1 draws any, and in between the window around it', () => {
    expect(set(characters(.1, { scramble: 0 }, 8))).toEqual([' ']);
    expect(set(characters(.5, { scramble: 0 }, 8))).toEqual(['0']);
    expect(set(characters(.9, { scramble: 0 }, 8))).toEqual(['1']);
    for (const tone of [.1, .9]) expect(set(characters(tone, { scramble: 1 }, 16))).toEqual([' ', '0', '1']);
    // With the three characters of Binary, any Scramble up to 0.5 is a window of two: dark cells space or 0, bright ones 0 or 1,
    // so the lit figure is written densely and the dark stage sparsely.
    expect(set(characters(.1, { scramble: .5 }, 16))).toEqual([' ', '0']);
    expect(set(characters(.9, { scramble: .5 }, 16))).toEqual(['0', '1']);
    expect(characters(.9, { scramble: .3 }, 16)).toEqual(characters(.9, { scramble: .5 }, 16));
  });

  it('Black Level clears the dark stage even at Scramble 1', () => {
    expect(set(characters(.1, { scramble: 1, blackLevel: .15 }, 16))).toEqual([' ']);
    expect(set(characters(.9, { scramble: 1, blackLevel: .15 }, 16))).toEqual([' ', '0', '1']);
  });

  it('Invert Ramp acts below Scramble 1, and the card says when it only reshuffles', () => {
    expect(set(characters(.9, { scramble: .5, invert: true }, 16))).toEqual([' ', '0']);
    expect(set(characters(.1, { scramble: 0, invert: true }, 8))).toEqual(['1']);
    const warnings = getEffect('pixel-code')!.paramWarnings!;
    expect(warnings({ ...getDefaultParams('pixel-code'), invert: true, scramble: 1 }, 1920, 1080)).toEqual([
      'At Scramble 1 every cell draws any character of the ramp, so Invert Ramp only reshuffles them; lower Scramble to let it act.',
    ]);
    expect(warnings({ ...getDefaultParams('pixel-code'), invert: true }, 1920, 1080)).toEqual([]);
    // With Black Level set, Invert Ramp still decides the character the dark cells keep.
    expect(warnings({ ...getDefaultParams('pixel-code'), invert: true, scramble: 1, blackLevel: .1 }, 1920, 1080)).toEqual([]);
    expect(set(characters(.1, { scramble: 1, blackLevel: .15, invert: true }, 8))).toEqual(['1']);
  });

  it('renders Scramble clamped to 0..1 and says so', () => {
    expect(characters(.9, { scramble: 3 }, 12)).toEqual(characters(.9, { scramble: 1 }, 12));
    expect(characters(.9, { scramble: -1 }, 12)).toEqual(characters(.9, { scramble: 0 }, 12));
    const graph = effectOperatorGraph({ type: 'pixel-code', params: getDefaultParams('pixel-code') });
    expect(paramRangeNotes(getEffect('pixel-code')!.params, { scramble: 3 }, graph).map(note => note.message)).toEqual([
      'Scramble 3 is above the rendered range (0 to 1) and renders as 1.',
    ]);
  });

  it('colours the code from Shadow to Highlight by the brightness', () => {
    const shadow = hex('#204060'), highlight = hex('#e0c080');
    for (const tone of [0, .25, .5, 1]) {
      ink(tone, { shadow: '#204060', highlight: '#e0c080', customRamp: '█' })
        .forEach((channel, index) => expect(channel, `tone ${tone}`).toBeCloseTo(shadow[index] + (highlight[index] - shadow[index]) * tone, 6));
    }
  });

  it('shows Scramble, Shadow and Highlight but not the shared colours it never reads', () => {
    const definitions = effectParamDefinitions({ type: 'pixel-code', params: getDefaultParams('pixel-code') });
    for (const key of ['colorMode', 'colorA', 'colorB']) expect(definitions[key].hidden || Boolean(definitions[key].deprecated), key).toBe(true);
    for (const key of ['scramble', 'shadow', 'highlight']) expect(definitions[key].hidden, key).toBeFalsy();
    const graph = effectOperatorGraph({ type: 'pixel-code', params: getDefaultParams('pixel-code') });
    for (const id of ['color-mode', 'color-a', 'color-b']) expect(graph.nodes.some(node => node.id === id), id).toBe(false);
  });

  it('a node setup saved without its own nodes hides them and keeps the whole ramp in deep blue and mint', () => {
    const graph = structuredClone(effectOperatorGraph({ type: 'pixel-code', params: getDefaultParams('pixel-code') }));
    for (const id of ['scramble', 'code-shadow', 'code-highlight']) graph.nodes.find(node => node.id === id)!.bindings = {};
    const definitions = effectParamDefinitions({ type: 'pixel-code', params: getDefaultParams('pixel-code'), operatorGraph: graph });
    for (const key of ['scramble', 'shadow', 'highlight']) expect(definitions[key].hidden, key).toBe(true);
    const shadow = hex(PIXEL_CODE_LEGACY_SHADOW), mint = hex(PIXEL_CODE_LEGACY_HIGHLIGHT);
    ink(0, { customRamp: '█', shadow: '#ff0000' }, graph).forEach((channel, index) => expect(channel).toBeCloseTo(shadow[index], 6));
    ink(1, { customRamp: '█', highlight: '#ff0000' }, graph).forEach((channel, index) => expect(channel).toBeCloseTo(mint[index], 6));
    // The earlier fixed colours, within half a step of the 0–255 hex.
    shadow.forEach((channel, index) => expect(Math.abs(channel - [.08, .3, .48][index])).toBeLessThan(.5 / 255 + 1e-9));
    mint.forEach((channel, index) => expect(Math.abs(channel - [.28, .95, .72][index])).toBeLessThan(.5 / 255 + 1e-9));
  });
});
