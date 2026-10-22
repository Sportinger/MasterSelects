import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultBrandGeneratorGraph, createDefaultCapsuleCloudGraph, createDefaultDataHatchGraph, createDefaultDitherTextGraph, createDefaultGlyphMatrixGraph, createDefaultGridGlyphGraph, createDefaultMatrixGraph, createDefaultNumberFieldGraph, createDefaultPixelCodeGraph, createDefaultPixelDitherGraph, createDefaultRetroMatrixGraph, createDefaultStitchPosterGraph, createDefaultSymbolMatrixGraph, createDefaultUiCollageGraph, createDefaultWordMosaicGraph } from '../../src/services/operators/asciiEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { imageCellHash } from '../../src/services/operators/imageOperatorEvaluation';
import { imageHashPcg2d } from '../../src/services/operators/imageHashPcg';

type Rgba = [number, number, number, number];
// Cell Size counts pixels of a 1080p frame: at 2160 × 1080 a Cell Size of 10 is a 10-pixel cell (grid 216 × 108).
const uv: [number, number] = [.3, .7], resolution: [number, number] = [2160, 1080];
const sourceAt = ([u, v]: [number, number]): Rgba => [u, v, .25, .6];
const atlasAt = (_id: string, [u, v]: [number, number]): Rgba => [0, 0, 0, u * .4 + v * .3];
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const hash2d = ([x0, y0]: [number, number]) => { const x = x0 * 127.1 + y0 * 311.7, y = x0 * 269.5 + y0 * 183.3; return ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1; };

type GlyphEffect = 'number-field' | 'grid-glyph' | 'pixel-code' | 'word-mosaic' | 'glyph-matrix' | 'data-hatch' | 'brand-generator' | 'stitch-poster' | 'dither-text' | 'symbol-matrix' | 'pixel-dither' | 'retro-matrix' | 'capsule-cloud' | 'ui-collage' | 'matrix';
function params(effect: GlyphEffect, overrides: Record<string, unknown> = {}) {
  const definition = getEffect(effect)!;
  return {
    definition,
    // The recipe as instances saved before Background existed render it (Background 0, the dark ground).
    values: { ...Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.legacyDefault ?? spec.default])), ...overrides },
  };
}

function evaluate(effect: GlyphEffect, graph: ReturnType<typeof createDefaultNumberFieldGraph>, overrides: Record<string, unknown> = {}, coords = uv, timelineTimeSeconds = 0) {
  const { definition, values } = params(effect, overrides);
  const plan = compileImageOperatorGraph(graph, values, {
    parameterSchema: definition.params,
    resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset: ' .#@', cellSize: 64 }),
  });
  const samples: Array<[string, number, number]> = [];
  const output = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: coords, resolution, timelineTimeSeconds, sampleImage: sourceAt,
    sampleResource: (id, coords) => { samples.push([id, ...coords]); return atlasAt(id, coords); } });
  return { output, samples };
}

function cell(coords = uv, offset = 0) {
  const grid: [number, number] = [resolution[0] / 10, resolution[1] / 10], id: [number, number] = [Math.floor(coords[0] * grid[0]), Math.floor(coords[1] * grid[1])];
  const local: [number, number] = [coords[0] * grid[0] - id[0], coords[1] * grid[1] - id[1]];
  const sourceUv: [number, number] = [(id[0] + .5) / grid[0], (id[1] + .5) / grid[1]];
  const source = sourceAt(sourceUv), tone = source[0] * .2126 + source[1] * .7152 + source[2] * .0722;
  const baseIndex = Math.floor(Math.max(0, Math.min(.99999, tone)) * 4), index = ((baseIndex + offset) % 4 + 4) % 4;
  const atlasUv: [number, number] = [(index % 2 + local[0]) / 2, (Math.floor(index / 2) + local[1]) / 2];
  // Amount fades from the untouched pixel at coords, not from the cell's colour.
  return { source, pixel: sourceAt(coords), tone, local, id, atlasUv, alpha: atlasAt('', atlasUv)[3] };
}

describe('shared glyph graph variants', () => {
  it('builds Number Field from the shared cell/ramp/atlas path and matches its quantized ink', () => {
    const graph = createDefaultNumberFieldGraph();
    expect(graph.nodes.filter(node => node.operator === 'glyph.atlas')).toHaveLength(1);
    expect(graph.nodes.some(node => node.operator.includes('number-field'))).toBe(false);
    const { output, samples } = evaluate('number-field', graph, { cellSize: 10, amount: .65, colorA: '#204060', colorB: '#e0c080' });
    const value = cell(), a = [0x20 / 255, 0x40 / 255, 0x60 / 255], b = [0xe0 / 255, 0xc0 / 255, 0x80 / 255];
    const level = Math.floor(value.tone * 5) / 4;
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, mix(a[index], b[index], level) * value.alpha, .65));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds Grid Glyph ruled lines through the shared glyph ink path', () => {
    // Line Width 1 px of a 1080p frame (here 1 px) along the top and left border of every 10 px cell; each pixel takes
    // the share of it the line covers, and inside the line the coverage becomes Line Glow (0.28 without a stored value).
    const lineCover = (pixel: number, halfWidth: number, cellPixels: number) => {
      const fromLine = Math.abs(pixel - halfWidth), distance = Math.min(fromLine, cellPixels - fromLine);
      return Math.max(0, Math.min(distance + .5, halfWidth) - Math.max(distance - .5, -halfWidth));
    };
    for (const coords of [uv, [(64 + .05) / 216, .7] as [number, number], [.3, (75 + .97) / 108] as [number, number]]) {
      const graph = createDefaultGridGlyphGraph(), { output, samples } = evaluate('grid-glyph', graph, { cellSize: 10, amount: .8, colorMode: 'source' }, coords);
      const value = cell(coords), line = Math.max(lineCover(value.local[0] * 10, .5, 10), lineCover(value.local[1] * 10, .5, 10));
      const coverage = mix(value.alpha, .28, line);
      const background = value.source.slice(0, 3).map(channel => channel * .08);
      const glyph = value.source.slice(0, 3).map((channel, index) => mix(background[index], channel, coverage));
      const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, glyph[index], .8));
      expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
      expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
      expect(output[3]).toBe(.6);
    }
  });

  it('builds Pixel Code with Random (Cell) indexing over the whole ramp and its legacy code ink', () => {
    // Saved before Scramble, Shadow and Highlight existed: every cell draws any character, in deep blue to mint.
    const graph = createDefaultPixelCodeGraph(), base = cell();
    const value = cell(uv, Math.floor(imageCellHash(base.id) * 4));
    const { output, samples } = evaluate('pixel-code', graph, { cellSize: 10, amount: .7 });
    const dark = [0x14, 0x4d, 0x7a].map(channel => channel / 255), light = [0x47, 0xf2, 0xb8].map(channel => channel / 255);
    const code = dark.map((channel, index) => mix(channel, light[index], value.tone) * value.alpha);
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, code[index], .7));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds Word Mosaic offset selection and connector band through shared glyph ink', () => {
    const coords: [number, number] = [.8, .7], offset = Math.floor((((coords[0] * .5) % 1) + 1) % 1 * 4), value = cell(coords, offset);
    const { output, samples } = evaluate('word-mosaic', createDefaultWordMosaicGraph(), { cellSize: 10, amount: .75, colorMode: 'source' }, coords);
    const smooth = (low: number, high: number, x: number) => { const t = Math.max(0, Math.min(1, (x - low) / (high - low))); return t * t * (3 - 2 * t); };
    const band = smooth(.04, .12, value.local[1]) * (1 - smooth(.78, .95, value.local[1]));
    const connector = (Math.abs(value.local[1] - .5) <= .08 ? 1 : 0) * (value.tone >= .25 ? 1 : 0);
    const coverage = Math.max(value.alpha, connector * band * .45), background = value.source.slice(0, 3).map(channel => channel * .08);
    const glyph = value.source.slice(0, 3).map((channel, index) => mix(background[index], channel, coverage));
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, glyph[index], .75));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds Glyph Matrix with the legacy cell-dependent wrapped time sweep', () => {
    const coords: [number, number] = [.8, .7], time = .73, speed = 1.4;
    const base = cell(coords), offset = Math.floor(time * speed * 6 + base.id[0] + base.id[1] * .35), value = cell(coords, offset);
    const { output, samples } = evaluate('glyph-matrix', createDefaultGlyphMatrixGraph(),
      { cellSize: 10, amount: .7, speed, colorMode: 'source' }, coords, time);
    const background = value.source.slice(0, 3).map(channel => channel * .08);
    const glyph = value.source.slice(0, 3).map((channel, index) => mix(background[index], channel, value.alpha));
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, glyph[index], .7));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds Data Hatching with wrapped time indexing and diagonal hatch coverage', () => {
    const coords: [number, number] = [.8, .7], time = .91, speed = 1.6;
    const value = cell(coords, Math.floor(time * speed * 2));
    const { output, samples } = evaluate('data-hatch', createDefaultDataHatchGraph(),
      { cellSize: 10, amount: .85, speed, colorMode: 'source' }, coords, time);
    const smoothstep = (low: number, high: number, input: number) => {
      const t = Math.max(0, Math.min(1, (input - low) / (high - low)));
      return t * t * (3 - 2 * t);
    };
    const diagonal = ((value.local[0] + value.local[1]) * 4) % 1;
    const hatch = 1 - smoothstep(.04, .13, Math.abs(diagonal - .5));
    const coverage = Math.max(value.alpha, hatch * (1 - value.tone) * .55);
    const background = value.source.slice(0, 3).map(channel => channel * .08);
    const glyph = value.source.slice(0, 3).map((channel, index) => mix(background[index], channel, coverage));
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, glyph[index], .85));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds Brand Generator with radial glyph indexing and viewport frame coverage', () => {
    const coords: [number, number] = [.02, .7], radius = Math.hypot(coords[0] - .5, coords[1] - .5);
    const value = cell(coords, Math.floor(radius * 4));
    const { output, samples } = evaluate('brand-generator', createDefaultBrandGeneratorGraph(),
      { cellSize: 10, amount: .72, colorMode: 'source' }, coords);
    const edge = Math.min(coords[0], 1 - coords[0], coords[1], 1 - coords[1]);
    const t = Math.max(0, Math.min(1, (edge - .02) / .03)), frame = 1 - t * t * (3 - 2 * t), coverage = Math.max(value.alpha, frame);
    const background = value.source.slice(0, 3).map(channel => channel * .08);
    const glyph = value.source.slice(0, 3).map((channel, index) => mix(background[index], channel, coverage));
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, glyph[index], .72));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds Stitch Poster diagonal thread coverage and its color-B background blend', () => {
    const coords: [number, number] = [.3, .6], value = cell(coords), colorB = [0xc0 / 255, 0x80 / 255, 0x40 / 255];
    const { output, samples } = evaluate('stitch-poster', createDefaultStitchPosterGraph(),
      { cellSize: 10, amount: .68, colorMode: 'source', colorB: '#c08040' }, coords);
    const x = value.local[0] - .5, y = value.local[1] - .5, distance = Math.min(Math.abs(x - y), Math.abs(x + y));
    const t = Math.max(0, Math.min(1, (distance - .025) / (.08 - .025))), stitch = 1 - t * t * (3 - 2 * t);
    const coverage = Math.max(value.alpha, stitch * (.35 + .65 * (1 - value.tone)));
    const dark = value.source.slice(0, 3).map(channel => channel * .08), background = colorB.map((channel, index) => mix(channel, dark[index], .25));
    const glyph = value.source.slice(0, 3).map((channel, index) => mix(background[index], channel, coverage));
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, glyph[index], .68));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds Dither Text with checker-selected tone threshold and timeline hash', () => {
    const coords: [number, number] = [.8, .7], time = .63, speed = 1.7, value = cell(coords, Math.floor(time * speed * 2));
    const { output, samples } = evaluate('dither-text', createDefaultDitherTextGraph(),
      { cellSize: 10, amount: .74, speed, colorMode: 'source' }, coords, time);
    const checker = (((value.id[0] + value.id[1]) * .5) % 1 + 1) % 1 >= .5 ? 1 : 0;
    const threshold = mix(.28, .72, checker), visible = value.tone + hash2d([value.id[0] + time, value.id[1] + time]) * .18 >= threshold ? 1 : 0;
    const coverage = value.alpha * visible, background = value.source.slice(0, 3).map(channel => channel * .08);
    const glyph = value.source.slice(0, 3).map((channel, index) => mix(background[index], channel, coverage));
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, glyph[index], .74));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds Symbol Matrix with a staggered per-cell random swap and pulsed glyph coverage', () => {
    // Each cell ticks at its own moment (four ticks a second × Speed, shifted by its Random (Cell)) and draws its
    // character from Random (Integer Hash) of (its random, its tick).
    const coords: [number, number] = [.8, .7], time = .57, speed = 1.35, base = cell(coords), cellRandom = imageCellHash(base.id);
    const tick = Math.floor(time * speed * 4 + cellRandom);
    const value = cell(coords, Math.floor(imageHashPcg2d([cellRandom, tick]) * 4));
    const { output, samples } = evaluate('symbol-matrix', createDefaultSymbolMatrixGraph(),
      { cellSize: 10, amount: .81, speed, colorMode: 'source' }, coords, time);
    const pulse = .65 + .35 * Math.sin(time * speed * 2 + hash2d(base.id) * 6.28318530718), coverage = value.alpha * pulse;
    const background = value.source.slice(0, 3).map(channel => channel * .08);
    const glyph = value.source.slice(0, 3).map((channel, index) => mix(background[index], channel, coverage));
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, glyph[index], .81));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds Pixel Dither with its custom radial glow and neon resolve', () => {
    const coords: [number, number] = [.8, .7], time = .57, speed = 1.35, value = cell(coords, Math.floor(time * speed));
    const colorA = [0x20 / 255, 0x40 / 255, 0x60 / 255], colorB = [0xe0 / 255, 0xc0 / 255, 0x80 / 255];
    const { output, samples } = evaluate('pixel-dither', createDefaultPixelDitherGraph(),
      { cellSize: 10, amount: .73, speed, colorA: '#204060', colorB: '#e0c080' }, coords, time);
    const radius = Math.hypot(value.local[0] - .5, value.local[1] - .5), glowInput = value.alpha + (1 - radius) * .18;
    const t = Math.max(0, Math.min(1, (glowInput - .05) / .6)), glow = t * t * (3 - 2 * t);
    const neon = colorA.map((channel, index) => mix(channel, colorB[index], value.tone) * glow * 1.25);
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, neon[index], .73));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds Retro Matrix with its upward scroll, fixed text, Phosphor ink and 1080p scanlines', () => {
    // The grid moves up by time × Speed × 3 rows; each cell of the scrolled grid keeps Random (Cell) of (column, line)
    // as its text and reads the picture at its current centre. Saved-before values: Roll 1, Background 0, Scanlines .36.
    const coords: [number, number] = [.8, .7], time = .41, speed = 1.2, amount = .79, scroll = time * speed * 3;
    const grid: [number, number] = [resolution[0] / 10, resolution[1] / 10], scrolled: [number, number] = [coords[0] * grid[0], coords[1] * grid[1] + scroll];
    const id: [number, number] = [Math.floor(scrolled[0]), Math.floor(scrolled[1])], local = [scrolled[0] - id[0], scrolled[1] - id[1]];
    const source = sourceAt([(id[0] + .5) / grid[0], (id[1] + .5 - scroll) / grid[1]]), tone = source[0] * .2126 + source[1] * .7152 + source[2] * .0722;
    const index = (Math.floor(Math.min(.99999, tone) * 4) + Math.floor(imageCellHash(id) * 4)) % 4;
    const atlasUv: [number, number] = [(index % 2 + local[0]) / 2, (Math.floor(index / 2) + local[1]) / 2], alpha = atlasAt('', atlasUv)[3];
    const { output, samples } = evaluate('retro-matrix', createDefaultRetroMatrixGraph(), { cellSize: 10, amount, speed }, coords, time);
    const phosphor = [1, 0x85 / 255, 0x14 / 255], lit = phosphor.map(channel => channel * alpha * (.15 + tone * 1.6));
    const scan = 1 - .36 * (.5 - .5 * Math.cos(scrolled[1] * 10 / 3 * 6.28318530718));
    const expected = sourceAt(coords).slice(0, 3).map((channel, channelIndex) => mix(channel, lit[channelIndex] * scan, amount));
    expect(samples).toHaveLength(1);
    samples[0].slice(1).forEach((value, axis) => expect(value).toBeCloseTo(atlasUv[axis], 9));
    expected.forEach((channel, channelIndex) => expect(output[channelIndex]).toBeCloseTo(channel, 9));
    expect(output[3]).toBe(.6);
  });

  it('builds Capsule Cloud with hashed cell motion and exact signed pill coverage', () => {
    const coords: [number, number] = [.8, .7], time = .43, speed = 1.4;
    const spatial = [Math.floor(coords[0] * 12), Math.floor(coords[1] * 12)] as [number, number];
    const value = cell(coords, Math.floor(time * speed + hash2d(spatial) * 4)), amount = .76;
    const { output, samples } = evaluate('capsule-cloud', createDefaultCapsuleCloudGraph(),
      { cellSize: 10, amount, speed, colorMode: 'source' }, coords, time);
    const px = Math.abs(value.local[0] - .5) - .43, py = Math.abs(value.local[1] - .5) - .26;
    const distance = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - .18;
    const t = Math.max(0, Math.min(1, (distance + .02) / .05)), pill = 1 - t * t * (3 - 2 * t);
    const coverage = Math.max(value.alpha, pill * .18), background = value.source.slice(0, 3).map(channel => channel * .08);
    const glyph = value.source.slice(0, 3).map((channel, index) => mix(background[index], channel, coverage));
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, glyph[index], amount));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds UI Collage with hashed cell motion, border and cursor decorations', () => {
    const coords: [number, number] = [.8, .7], time = .37, speed = 1.6;
    const spatial = [Math.floor(coords[0] * 7), Math.floor(coords[1] * 7)] as [number, number];
    const value = cell(coords, Math.floor(time * speed + hash2d(spatial) * 4)), amount = .82;
    const { output, samples } = evaluate('ui-collage', createDefaultUiCollageGraph(),
      { cellSize: 10, amount, speed, colorMode: 'source' }, coords, time);
    const edgeDistance = Math.min(value.local[0], 1 - value.local[0], value.local[1], 1 - value.local[1]);
    const t = Math.max(0, Math.min(1, (edgeDistance - .03) / .06)), border = 1 - t * t * (3 - 2 * t);
    const cursor = Math.hypot(value.local[0] - .72, value.local[1] - .28) <= .07 ? 1 : 0;
    const coverage = Math.max(value.alpha, border * .42, cursor), background = value.source.slice(0, 3).map(channel => channel * .08);
    const glyph = value.source.slice(0, 3).map((channel, index) => mix(background[index], channel, coverage));
    const expected = value.pixel.slice(0, 3).map((channel, index) => mix(channel, glyph[index], amount));
    expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.6);
  });

  it('builds Matrix Rain from falling drops with fading trails, lit by the picture, and staggered character swaps', () => {
    // Each column falls at its own pace and spacing (Random (Cell) of the column with seeds 1, 2, 3); Behind is how many
    // rows the cell lies above the nearest head below it. The trail fades over Trail × the spacing (squared), the head cell
    // turns towards white, and the light is the brighter of the fade × (0.05 + 1.5 × tone²) and the head's own 0.85 (Black
    // Level 0: shown everywhere). Characters swap like Symbol Matrix's, twice a second.
    const coords: [number, number] = [.8, .7], speed = 1.45, amount = .84, base = cell(coords), [column, row] = base.id;
    const rain = [0x29 / 255, 1, 0x6b / 255], clamp01 = (value: number) => Math.max(0, Math.min(1, value));
    const rate = 12 * (.6 + .8 * imageCellHash([column, 1])), spacing = 32 * (.6 + .8 * imageCellHash([column, 2]));
    const rainAt = (time: number) => {
      const drops = (time * speed * rate - row) / spacing + imageCellHash([column, 3]), behind = (drops - Math.floor(drops)) * spacing;
      const tail = clamp01(1 - behind / Math.max(.5 * spacing, 1));
      return { fade: tail * tail, head: clamp01(1 - behind) };
    };
    const times = Array.from({ length: 48 }, (_, index) => index / 24);
    // Over two seconds a drop passes the cell: lit by its trail at one moment, dark between two drops at another.
    expect(Math.max(...times.map(time => rainAt(time).fade))).toBeGreaterThan(.5);
    expect(Math.min(...times.map(time => rainAt(time).fade))).toBe(0);
    for (const time of times.filter((_, index) => index % 6 === 0).concat(times.filter(time => rainAt(time).head > 0))) {
      const cellRandom = imageCellHash(base.id), tick = Math.floor(time * speed * 2 + cellRandom);
      const value = cell(coords, Math.floor(imageHashPcg2d([cellRandom, tick]) * 4)), { fade, head } = rainAt(time);
      const { output, samples } = evaluate('matrix', createDefaultMatrixGraph(), { cellSize: 10, amount, speed }, coords, time);
      const light = Math.max(fade * (.05 + 1.5 * value.tone * value.tone), head * .85);
      // Saved without Background (0): no ground, only the lit characters.
      const glyph = rain.map(channel => mix(channel, 1, head * .8) * light * value.alpha);
      const expected = base.pixel.slice(0, 3).map((channel, index) => mix(channel, glyph[index], amount));
      expect(samples).toEqual([['glyph-atlas:atlas', ...value.atlasUv]]);
      expected.forEach((channel, index) => expect(output[index], `t ${time}`).toBeCloseTo(channel, 12));
      expect(output[3]).toBe(.6);
    }
  });
});
