// The shared glyph-mosaic engine (createGlyphEffect + createDefaultGlyphGraph), checked across every look:
// every shown control reaches the output, Background keeps saved looks and lifts new ones, Cell Size
// counts pixels of a 1080p frame, a keyframed Speed moves by its travelled distance, Roll keeps the moving
// looks inside a window of their ramp, the looks hold still while paused, and the emitted WGSL has valid literals.
import { describe, expect, it } from 'vitest';
import { getAllEffects, getDefaultParams, getEffect } from '../../src/effects';
import { GLYPH_NO_TRAVEL, GLYPH_SPEED_TRAVEL, glyphCellPixels, glyphCellWarnings } from '../../src/effects/glyph/glyphGrid';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { RETRO_LINE_SPACING, RETRO_SCROLL_PERIOD, RETRO_SCROLL_RATE } from '../../src/effects/glyph/retroMatrix';
import { effectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { effectParamDefinitions } from '../../src/services/operators/effectParamVisibility';
import { effectStyleOptions } from '../../src/services/effects/effectStyles';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { evaluateEffectKeyframes } from '../../src/stores/timeline/keyframes/effectKeyframeEvaluation';
import { FEEDBACK_PARAMETERS } from '../../src/effects/_shared/feedbackParameters';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';

const GLYPH_LOOKS = getAllEffects().filter(effect => 'glyphAtlas' in effect && effect.glyphAtlas).map(effect => effect.id);
const OWN_PALETTE = ['matrix', 'retro-matrix', 'pixel-code'];
type Rgba = [number, number, number, number];
const source: Rgba = [.8, .6, .4, 1];
const tone = .8 * .2126 + .6 * .7152 + .4 * .0722;

function compile(type: string, params: Record<string, unknown>) {
  return compileImageOperatorGraph(effectOperatorGraph({ type, params: params as Effect['params'] }), params, { parameterSchema: getEffect(type)!.params,
    resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset: ' .#@', cellSize: 64 }), allowFrameHistory: true });
}

function render(type: string, overrides: Record<string, unknown> = {}, options: { uv?: [number, number]; resolution?: [number, number]; time?: number; omit?: string; glyph?: number } = {}) {
  const params: Record<string, unknown> = { ...getDefaultParams(type), ...overrides };
  if (options.omit) delete params[options.omit];
  const plan = compile(type, params);
  const atlas: Array<[number, number]> = [];
  const output = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: options.uv ?? [.31, .47], resolution: options.resolution ?? [1920, 1080],
    timelineTimeSeconds: options.time ?? 0, sampleImage: () => source,
    sampleResource: (_id, coords) => { atlas.push(coords); return [0, 0, 0, options.glyph ?? 0]; } });
  return { output, atlas, plan };
}

/** Bindings of the nodes the output node depends on (dangling nodes do not count). */
function reachableBindings(graph: EffectOperatorGraph): Set<string> {
  const reached = new Set<string>(), queue = graph.nodes.filter(node => node.operator === 'image.output').map(node => node.id);
  while (queue.length) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const edge of graph.edges) if (edge.to === id) queue.push(edge.from);
  }
  return new Set(graph.nodes.filter(node => reached.has(node.id)).flatMap(node => [
    ...Object.values(node.bindings).filter((binding): binding is string => typeof binding === 'string'),
    ...node.operator === 'image.frame-history' ? Object.keys(FEEDBACK_PARAMETERS).concat('reset') : [],
  ]));
}

describe('glyph engine', () => {
  it('covers all nineteen looks', () => {
    expect(GLYPH_LOOKS.toSorted()).toEqual(['ascii', 'ascii-ghost', 'brand-generator', 'capsule-cloud', 'contour-type', 'data-hatch',
      'dither-text', 'glyph-matrix', 'grid-glyph', 'inscribe', 'matrix', 'number-field', 'pixel-code', 'pixel-dither', 'retro-matrix',
      'stitch-poster', 'symbol-matrix', 'ui-collage', 'word-mosaic']);
  });

  it('every shown control of every look reaches the output; colour controls a look never reads are retired', () => {
    const unread: string[] = [];
    for (const type of GLYPH_LOOKS) {
      const definition = getEffect(type)!;
      const reached = reachableBindings(effectOperatorGraph({ type, params: getDefaultParams(type) }));
      for (const [key, param] of Object.entries(definition.params)) {
        if (param.hidden || param.deprecated) continue;
        if (!reached.has(key)) unread.push(`${type}.${key}`);
      }
    }
    expect(unread).toEqual([]);
    for (const type of OWN_PALETTE) for (const key of ['colorMode', 'colorA', 'colorB']) {
      expect(getEffect(type)!.params[key].deprecated, `${type}.${key}`).toMatch(/own colours: .+ is ignored/u);
    }
    for (const type of ['number-field', 'pixel-dither']) {
      expect(getEffect(type)!.params.colorMode.deprecated).toMatch(/Color Source is ignored/u);
      expect(getEffect(type)!.params.colorA.deprecated).toBeUndefined();
    }
  });

  it('Background lifts the ground of new instances and leaves saved ones on the dark ground', () => {
    for (const type of GLYPH_LOOKS) {
      const background = getEffect(type)!.params.background;
      expect(background).toMatchObject({ legacyDefault: 0, min: 0, max: 1, renderMin: 0, renderMax: 1, graphOnly: true });
      expect(background.default).toBe(type === 'stitch-poster' ? 0 : .2);
    }
    // ASCII, no character in the cell: the ground is the source colour × .08, lifted towards the ink.
    const dark = render('ascii', { background: 0 }).output, lifted = render('ascii', { background: .5 }).output;
    source.slice(0, 3).forEach((channel, index) => {
      expect(dark[index]).toBeCloseTo(channel * .08, 12);
      expect(lifted[index]).toBeCloseTo(channel * .08 + (channel - channel * .08) * .5, 12);
    });
    // A param missing from an edited setup renders the dark ground, not the full picture.
    const missing = render('ascii', {}, { omit: 'background' });
    expect(missing.output[0]).toBeCloseTo(source[0] * .08, 12);
    // Matrix Rain: no character in the cell, so only the ground shows: the Rain Color × Background × the cell's tone,
    // from 0.45 of it between two drops up to all of it where a trail passes.
    const matrix = render('matrix', { background: 1 }, { time: 0 }).output, halfMatrix = render('matrix', { background: .5 }, { time: 0 }).output;
    expect(matrix[0] / matrix[1]).toBeCloseTo(0x29 / 255, 12);
    expect(matrix[2] / matrix[1]).toBeCloseTo(0x6b / 255, 12);
    expect(matrix[1]).toBeGreaterThanOrEqual(.45 * tone - 1e-12);
    expect(matrix[1]).toBeLessThanOrEqual(tone + 1e-12);
    expect(halfMatrix[1]).toBeCloseTo(matrix[1] / 2, 12);
    expect(render('matrix', { background: 0 }, { time: 0 }).output[1]).toBe(0);
    // Out-of-range values render clamped and say so.
    expect(render('ascii', { background: 3 }).output[0]).toBeCloseTo(render('ascii', { background: 1 }).output[0], 12);
    expect(paramRangeNotes(getEffect('ascii')!.params, { background: 3 }, effectOperatorGraph({ type: 'ascii', params: getDefaultParams('ascii') }))[0].message)
      .toBe('Background 3 is above the rendered range (0 to 1) and renders as 1.');
  });

  it('a node setup saved before Background existed hides it in the card', () => {
    const graph = structuredClone(effectOperatorGraph({ type: 'ascii', params: getDefaultParams('ascii') }));
    const node = graph.nodes.find(candidate => candidate.id === 'background-value')!;
    node.bindings = {}; node.constants = { value: 0 };
    expect(effectParamDefinitions({ type: 'ascii', params: { ...getDefaultParams('ascii'), background: 0 }, operatorGraph: graph }).background.hidden).toBe(true);
    expect(effectParamDefinitions({ type: 'ascii', params: getDefaultParams('ascii') }).background.hidden).toBeFalsy();
    // An instance saved without the key (before Background existed) loads on the dark ground.
    expect(migratePersistedEffectOperatorGraph({ id: 'old', name: 'ASCII', type: 'ascii', enabled: true, params: { cellSize: 14 } }).params.background).toBe(0);
  });

  it('Cell Size counts pixels of a 1080p frame, so every frame size shows the same grid', () => {
    expect(glyphCellPixels(14, 1920, 1080)).toBe(14);
    expect(glyphCellPixels(14, 3840, 2160)).toBe(28);
    expect(glyphCellPixels(14, 960, 540)).toBe(7);
    expect(glyphCellPixels(14, 1080, 1920)).toBe(14);
    expect(glyphCellPixels(1, 1920, 1080)).toBe(2);
    expect(glyphCellPixels(14, 256, 144)).toBe(2);
    // The same point of the picture lands on the same cell and the same spot inside its character.
    const uv: [number, number] = [.4123, .6271];
    const at = (resolution: [number, number]) => render('ascii', { cellSize: 18 }, { uv, resolution }).atlas[0];
    const reference = at([1920, 1080]);
    for (const resolution of [[3840, 2160], [960, 540], [1280, 720]] as Array<[number, number]>) {
      at(resolution).forEach((value, index) => expect(value).toBeCloseTo(reference[index], 9));
    }
    expect(glyphCellWarnings({ cellSize: 14 }, 256, 144)).toEqual(['Cell Size 14 px is smaller than 2 pixels on this 256×144 frame; the characters render 2 pixels wide.']);
    expect(glyphCellWarnings({ cellSize: 14 }, 1920, 1080)).toEqual([]);
    expect(paramRangeNotes(getEffect('ascii')!.params, { cellSize: 1 }, effectOperatorGraph({ type: 'ascii', params: getDefaultParams('ascii') }))[0].message)
      .toBe('Cell Size 1 is below the rendered minimum (2) and renders as 2.');
  });

  it('a keyframed Speed moves by its travelled distance, without keys by timeline time × Speed', () => {
    const uv: [number, number] = [.2, .3];
    const atTravel = (params: Record<string, unknown>, time: number) => render('glyph-matrix', { speed: 2, ...params }, { uv, time }).atlas[0];
    // Unkeyed: identical to timeline time × Speed (no travel param).
    expect(atTravel({}, 1.25)).toEqual(atTravel({ speed: 1, [GLYPH_SPEED_TRAVEL]: undefined }, 2.5));
    // Keyed: the travel wins over time × Speed.
    expect(atTravel({ [GLYPH_SPEED_TRAVEL]: 2.5 }, 99)).toEqual(atTravel({}, 1.25));
    expect(getEffect('glyph-matrix')!.params.speed.integratedAs).toBe(GLYPH_SPEED_TRAVEL);
    // A ramp from 1 to 3 between 10 s and 11 s: the timeline writes ∫ Speed, which grows by at most 3 per second.
    const effect: Effect = { id: 'glyph', name: 'Glyph Matrix', type: 'glyph-matrix', enabled: true, params: getDefaultParams('glyph-matrix') };
    const keys = [10, 11].map((time, index) => ({ id: `k${index}`, clipId: 'clip', time, property: 'effect.glyph.speed', value: index ? 3 : 1, easing: 'linear' }) as Keyframe);
    const travel = (time: number) => evaluateEffectKeyframes([effect], keys, time, 0)[0].params[GLYPH_SPEED_TRAVEL] as number;
    for (let time = 9.5; time < 11.5; time += 1 / 30) expect(travel(time + 1 / 30) - travel(time)).toBeLessThanOrEqual(3 / 30 + 1e-9);
    expect(travel(10.5)).toBeCloseTo(10 + .5 * 1.5, 6);
    expect(GLYPH_NO_TRAVEL).toBeLessThan(-1e19);
  });

  it('the looks hold still while paused and the emitted WGSL has no invalid number literals', () => {
    for (const type of GLYPH_LOOKS) {
      const definition = getEffect(type)!;
      expect(definition.requiresContinuousRender, type).toBe(false);
      const moving = 'speed' in definition.params || definition.usesFeedback === true;
      expect('timelineAnimated' in definition && definition.timelineAnimated === true, type).toBe(moving);
      const plan = compile(type, getDefaultParams(type));
      const programs = [plan, ...(plan.passes ?? []).map(pass => pass.program)];
      for (const program of programs) if (program.wgsl) expect(program.wgsl, type).not.toMatch(/\de[+-]?\d+\.0\b/u);
    }
  });

  it('the Ramp menu names its ramps, and the card reports a Custom Ramp it shortens or a ramp it does not know', () => {
    const long = 'x'.repeat(300);
    for (const type of GLYPH_LOOKS) {
      const definition = getEffect(type)!;
      const ramp = definition.params.rampPreset;
      expect(ramp.type === 'select' && ramp.options!.map(option => option.label), type)
        .toEqual(['Standard', 'Detailed', 'Blocks', 'Bars', 'Binary', 'Numeric', 'Symbols']);
      const warnings = definition.paramWarnings!({ ...getDefaultParams(type), customRamp: long } as Record<string, number | boolean | string>, 1920, 1080);
      expect(warnings, type).toContain('Custom Ramp has 300 characters; 256 of them are drawn, spread evenly from the first to the last.');
      expect(definition.glyphAtlas!({ ...getDefaultParams(type), customRamp: long } as Record<string, number | boolean | string>).charset, type).toHaveLength(256);
    }
  });

  it('Amount 0 gives back the untouched picture, pixel for pixel, in every look', () => {
    // Every pixel has its own colour and alpha, so the cell's centre colour (the old fade target) differs from it.
    const pixel = (uv: [number, number]): Rgba => [uv[0], uv[1], .5, .4 + uv[0] / 2];
    const pixelCoordinate: [number, number] = [602, 508], uv: [number, number] = [602.5 / 1920, 508.5 / 1080];
    // ASCII Ghost also keeps the fading trail of earlier frames on top (its feedback), so it is left out here.
    for (const type of GLYPH_LOOKS.filter(look => look !== 'ascii-ghost')) {
      const params: Record<string, unknown> = { ...getDefaultParams(type), amount: 0 };
      const plan = compile(type, params);
      const output = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, pixelCoordinate, derivativeAutoMode: 'fine', resolution: [1920, 1080], timelineTimeSeconds: 1,
        sampleImage: pixel, sampleResource: () => [0, 0, 0, 1] }) as number[];
      expect(output.map(value => Number(value.toFixed(5))), type).toEqual(pixel(uv).map(value => Number(value.toFixed(5))));
    }
  });

  it('Roll keeps a moving look inside a window of its ramp: 1 runs through the whole ramp (the earlier look), 0 holds each cell still', () => {
    for (const type of GLYPH_LOOKS) {
      const roll = getEffect(type)!.params.roll;
      if (!('speed' in getEffect(type)!.params)) { expect(roll, type).toBeUndefined(); continue; }
      expect(roll, type).toMatchObject({ legacyDefault: 1, min: 0, max: 1, renderMin: 0, renderMax: 1, graphOnly: true, animatable: true, group: 'Motion' });
      expect(roll.default, type).toBe(type === 'glyph-matrix' ? .2 : type === 'symbol-matrix' ? .4 : type === 'retro-matrix' ? .3 : type === 'matrix' ? .5 : 1);
    }
    // The test atlas ' .#@' is 2 × 2 glyphs; the source tone (.63) picks '#' (index 2).
    const glyphAt = (params: Record<string, unknown>, time: number) => {
      const [x, y] = render('glyph-matrix', { speed: 1, ...params }, { time }).atlas[0];
      return Math.floor(x * 2) + Math.floor(y * 2) * 2;
    };
    const times = Array.from({ length: 40 }, (_, index) => index / 24);
    const seen = (params: Record<string, unknown>) => new Set(times.map(time => glyphAt(params, time)));
    // Roll 1: the earlier sweep, (tone index + floor(6 t + column + .35 row)) wrapped over the ramp; uv (.31, .47) is cell (42, 36).
    for (const time of times) expect(glyphAt({ roll: 1 }, time), `t ${time}`).toBe((2 + Math.floor(6 * time + 42 + .35 * 36)) % 4);
    expect(seen({ roll: 1 })).toEqual(new Set([0, 1, 2, 3]));
    // Roll 0: the character of the cell's brightness, at every moment.
    expect(seen({ roll: 0 })).toEqual(new Set([2]));
    // 1 + ceil(Roll × 3) characters, centred on the cell's own and kept inside the ramp: any Roll above 0 moves.
    expect(seen({ roll: .01 })).toEqual(new Set([1, 2]));
    expect(seen({ roll: .3 })).toEqual(new Set([1, 2]));
    expect(seen({ roll: .5 })).toEqual(new Set([1, 2, 3]));
    expect(seen({ roll: .75 })).toEqual(new Set([0, 1, 2, 3]));
    // Out of range renders clamped and says so; an instance saved before Roll existed loads with the whole ramp.
    expect(seen({ roll: 3 })).toEqual(seen({ roll: 1 }));
    expect(seen({ roll: -1 })).toEqual(new Set([2]));
    expect(paramRangeNotes(getEffect('glyph-matrix')!.params, { roll: 3 }, effectOperatorGraph({ type: 'glyph-matrix', params: getDefaultParams('glyph-matrix') }))[0].message)
      .toBe('Roll 3 is above the rendered range (0 to 1) and renders as 1.');
    expect(migratePersistedEffectOperatorGraph({ id: 'old', name: 'Glyph Matrix', type: 'glyph-matrix', enabled: true, params: { cellSize: 14 } }).params.roll).toBe(1);
    // A node setup saved before Roll existed hides it in the card.
    const graph = structuredClone(effectOperatorGraph({ type: 'glyph-matrix', params: getDefaultParams('glyph-matrix') }));
    graph.nodes.find(node => node.id === 'roll')!.bindings = {};
    expect(effectParamDefinitions({ type: 'glyph-matrix', params: getDefaultParams('glyph-matrix'), operatorGraph: graph }).roll.hidden).toBe(true);
    // The Style menu offers the other moving looks.
    expect(effectStyleOptions('glyph-matrix').map(option => option.value)).toEqual(expect.arrayContaining(['matrix', 'symbol-matrix', 'retro-matrix', 'data-hatch']));
    expect(effectStyleOptions('ascii').map(option => option.value)).toEqual(expect.arrayContaining(['word-mosaic', 'pixel-code', 'number-field']));
    // Every look of the engine is a style (S1's rule): ASCII also offers the moving looks.
    expect(effectStyleOptions('ascii').map(option => option.value)).toContain('glyph-matrix');
  });

  it('Symbol Matrix swaps every cell at its own moment to an unrelated random character', () => {
    // 8 × 8 cells of 14 px on a flat picture, so every cell has the same own character; Roll 1 draws from the whole ramp.
    const cells = Array.from({ length: 64 }, (_, index) => [index % 8, Math.floor(index / 8)] as const);
    const plans = [0, 1].map(speed => compile('symbol-matrix', { ...getDefaultParams('symbol-matrix'), roll: 1, speed }));
    const glyphAt = ([x, y]: readonly [number, number], time: number, speed = 1) => {
      let glyph = -1;
      evaluateImageOperatorPlan(plans[speed], [0, 0, 0, 0], { uv: [(x + 20.5) * 14 / 1920, (y + 20.5) * 14 / 1080], resolution: [1920, 1080],
        timelineTimeSeconds: time, sampleImage: () => source, sampleResource: (_id, [u, v]) => { glyph = Math.floor(u * 2) + Math.floor(v * 2) * 2; return [0, 0, 0, 0]; } });
      return glyph;
    };
    const frames = Array.from({ length: 25 }, (_, frame) => cells.map(cell => glyphAt(cell, frame / 24)));
    const changed = frames.slice(1).map((frame, index) => frame.filter((glyph, cell) => glyph !== frames[index][cell]).length);
    // Four swaps a second per cell, spread over all frames: never every cell on one frame (as when all ticked together).
    expect(changed.every(count => count > 0 && count < 32), changed.join(' ')).toBe(true);
    // The draws are not one random field sliding along the diagonal (cell + 1 one tick later showed the same glyph).
    const slid = cells.filter(([x, y]) => x < 7 && y < 7).filter(([x, y]) => glyphAt([x, y], 1.3) === glyphAt([x + 1, y + 1], 1.05)).length;
    expect(slid / 49).toBeLessThan(.5);
    // Speed 0 holds each cell on one character.
    expect(new Set([0, .4, 1.7].map(time => glyphAt([3, 3], time, 0))).size).toBe(1);
  });

  it('Retro Matrix scrolls whole characters up row by row, and its scanlines match at every frame size', () => {
    const plan = compile('retro-matrix', { ...getDefaultParams('retro-matrix'), roll: 1, speed: 1 });
    // The atlas tile a pixel reads (2 × 2 test atlas) and the scan factor it is lit with (ink 1 on a flat picture).
    const at = (uv: [number, number], time: number, resolution: [number, number] = [1920, 1080], params?: Record<string, unknown>) => {
      let glyph = -1;
      const output = evaluateImageOperatorPlan(params ? compile('retro-matrix', { ...getDefaultParams('retro-matrix'), ...params }) : plan, [0, 0, 0, 0], {
        uv, resolution, timelineTimeSeconds: time, sampleImage: () => source,
        sampleResource: (_id, [u, v]) => { glyph = Math.floor(u * 2) + Math.floor(v * 2) * 2; return [0, 0, 0, 1]; } }) as number[];
      return { glyph, red: output[0] };
    };
    // 14 px cells at 1080p; Speed 1 scrolls 3 rows a second, so after 1/3 s each row shows what the row below it showed.
    const cellUv = (x: number, y: number, inside = .5): [number, number] => [(x + .5) * 14 / 1920, (y + inside) * 14 / 1080];
    for (const [x, y] of [[3, 10], [7, 22], [40, 50]]) expect(at(cellUv(x, y), 1 / 3).glyph).toBe(at(cellUv(x, y + 1), 0).glyph);
    // Every pixel of a scrolled cell shows the same character: no seam cuts it (before, bands of uv.y × ramp did).
    for (const time of [0, .07, .21, 1.9]) {
      const shift = (time * 3) % 1, rowStart = (5 - shift) * 14 / 1080;
      const glyphs = new Set(Array.from({ length: 12 }, (_, step) => at([.2, rowStart + (step + .5) / 12 * 14 / 1080], time).glyph));
      expect(glyphs.size, `t ${time}`).toBe(1);
    }
    // Speed 0 holds the text still.
    expect(at(cellUv(9, 9), 2.5, undefined, { speed: 0 }).glyph).toBe(at(cellUv(9, 9), 0, undefined, { speed: 0 }).glyph);
    // The scroll wraps every RETRO_SCROLL_PERIOD rows and the text repeats with it, so hours into a show the grid
    // stays small (f32 on the GPU): 4096 s on (12 288 rows) shows the same characters and scanlines, also across a wrap.
    const period = RETRO_SCROLL_PERIOD / RETRO_SCROLL_RATE;
    expect(period).toBe(4096);
    for (const [uv, time] of [[cellUv(3, 10, .3), .4], [cellUv(30, 60, .8), 1.37], [[.2, .13], period - .1], [[.7, .9], 2 * period - .05]] as Array<[[number, number], number]>) {
      const later = at(uv, time + period, undefined, { scanlines: .8 }), now = at(uv, time, undefined, { scanlines: .8 });
      expect(later.glyph, `t ${time}`).toBe(now.glyph);
      expect(later.red, `t ${time}`).toBeCloseTo(now.red, 6);
    }
    // At 10 h (36 000 s) the scanline factor still equals 1 − Scanlines × sin²(π × scrolled row pixel / pitch).
    const flat = { scanlines: .8, roll: 0, background: 0 };
    const v = .4507, unlit = at([.4, v], 36000, undefined, { ...flat, scanlines: 0 }).red, scanned = at([.4, v], 36000, undefined, flat).red;
    const rowPixel = (v * 1080 / 14 + 36000 * RETRO_SCROLL_RATE) * 14;
    expect(scanned / unlit).toBeCloseTo(1 - .8 * Math.sin(Math.PI * rowPixel / RETRO_LINE_SPACING) ** 2, 4);
    // Scanlines count pixels of a 1080p frame: a 4K frame shows the same lines at the same place as 1080p ...
    for (const v of [.3011, .4507, .62]) expect(at([.4, v], .4, [3840, 2160], { scanlines: .8 }).red).toBeCloseTo(at([.4, v], .4, [1920, 1080], { scanlines: .8 }).red, 9);
    // ... and lines closer than 3 output pixels fade into an even dimming of 1 − Scanlines / 2 instead of a moiré.
    const small = [.3011, .4507, .62].map(v => at([.4, v], .4, [480, 270], { scanlines: .8, roll: 0, background: 0 }).red);
    const clean = [.3011, .4507, .62].map(v => at([.4, v], .4, [480, 270], { scanlines: 0, roll: 0, background: 0 }).red);
    small.forEach((red, index) => expect(red).toBeCloseTo(clean[index] * .6, 9));
    // Scanlines out of range render clamped and say so; instances saved before Scanlines and Phosphor existed keep the earlier look.
    expect(paramRangeNotes(getEffect('retro-matrix')!.params, { scanlines: 2 }, effectOperatorGraph({ type: 'retro-matrix', params: getDefaultParams('retro-matrix') }))[0].message)
      .toBe('Scanlines 2 is above the rendered range (0 to 1) and renders as 1.');
    const loaded = migratePersistedEffectOperatorGraph({ id: 'old', name: 'Retro Matrix', type: 'retro-matrix', enabled: true, params: { cellSize: 14 } }).params;
    expect([loaded.scanlines, loaded.roll, loaded.background]).toEqual([.36, 1, 0]);
    // Phosphor colours the characters (amber by default).
    expect(getEffect('retro-matrix')!.params.phosphor).toMatchObject({ type: 'color', default: '#ff8514', group: 'Color', graphOnly: true });
    const green = evaluateImageOperatorPlan(compile('retro-matrix', { ...getDefaultParams('retro-matrix'), phosphor: '#00ff00', scanlines: 0 }), [0, 0, 0, 0], {
      uv: [.31, .47], resolution: [1920, 1080], timelineTimeSeconds: 0, sampleImage: () => source, sampleResource: () => [0, 0, 0, 1] }) as number[];
    expect([green[0], green[2]]).toEqual([0, 0]);
    expect(green[1]).toBeGreaterThan(.9);
  });

  it('Weight is keyframeable in steps: it draws one of the nine font weights, so no value builds an atlas of its own', () => {
    for (const type of GLYPH_LOOKS) {
      const definition = getEffect(type)!;
      expect(definition.params.fontWeight.animatable, type).toBe(true);
      const atlas = (fontWeight: number) => definition.glyphAtlas!({ ...getDefaultParams(type), fontWeight } as Record<string, number | boolean | string>).fontWeight;
      expect([atlas(612.5), atlas(649), atlas(651), atlas(2000), atlas(-5)], type).toEqual([600, 600, 700, 900, 100]);
    }
  });

  it('Amount mixes premultiplied, so the hidden colour of a transparent pixel never leaks into the fade (every look)', () => {
    const uv: [number, number] = [602.5 / 1920, 508.5 / 1080], pixelCoordinate: [number, number] = [602, 508];
    const hiddenGreen: Rgba = [0, 1, 0, 0], opaque: Rgba = [.8, .6, .4, 1];
    const at = (type: string, amount: number, pixel: Rgba, cell: Rgba) => evaluateImageOperatorPlan(compile(type, { ...getDefaultParams(type), amount }), [0, 0, 0, 0], {
      uv, pixelCoordinate, derivativeAutoMode: 'fine', resolution: [1920, 1080], timelineTimeSeconds: 1,
      sampleImage: (coords: [number, number]) => (Math.abs(coords[0] - uv[0]) < 1e-9 && Math.abs(coords[1] - uv[1]) < 1e-9 ? pixel : cell),
      sampleResource: () => [0, 0, 0, 1] }) as number[];
    const round = (values: number[]) => values.map(value => Number(value.toFixed(4)));
    for (const type of GLYPH_LOOKS.filter(look => look !== 'ascii-ghost')) {
      // A transparent pixel inside an opaque cell: half the look's colour at half alpha, no green.
      const look = at(type, 1, hiddenGreen, opaque);
      expect(round(at(type, .5, hiddenGreen, opaque)), type).toEqual(round([look[0], look[1], look[2], .5]));
      // An opaque pixel inside a transparent cell: the original colour at half alpha.
      expect(round(at(type, .5, opaque, hiddenGreen)), type).toEqual(round([.8, .6, .4, .5]));
    }
  });

  it('reads the atlas half a texel inside each tile, so blocks join without seams at fractional cell sizes', () => {
    // 1000×563: a 14 px cell is 7.298 output pixels; this pixel sits just before a cell edge.
    const cell = glyphCellPixels(14, 1000, 563), x = cell * 5 - .001;
    for (const type of ['ascii', 'glyph-matrix', 'symbol-matrix', 'retro-matrix']) {
      const { atlas } = render(type, {}, { uv: [x / 1000, .5], resolution: [1000, 563] });
      // The ' .#@' test atlas is 2 × 2 tiles of 64 pixels.
      for (const [u, v] of atlas) for (const texel of [u * 128 % 64, v * 128 % 64]) {
        expect(texel, type).toBeGreaterThanOrEqual(.5 - 1e-6);
        expect(texel, type).toBeLessThanOrEqual(63.5 + 1e-6);
      }
    }
  });

  it('Black Level drops dark tones to the first character and spreads the rest over the ramp; 0 keeps the tone', () => {
    const glyphAt = (grey: number, blackLevel?: number, invert = false) => {
      const params: Record<string, unknown> = { ...getDefaultParams('ascii'), invert, ...(blackLevel === undefined ? {} : { blackLevel }) };
      const coords: Array<[number, number]> = [];
      evaluateImageOperatorPlan(compile('ascii', params), [0, 0, 0, 0], { uv: [.31, .47], resolution: [1920, 1080], timelineTimeSeconds: 0,
        sampleImage: () => [grey, grey, grey, 1], sampleResource: (_id, at) => { coords.push(at); return [0, 0, 0, 1]; } });
      const [u, v] = coords[0];
      return Math.floor(v * 2) * 2 + Math.floor(u * 2);
    };
    expect([glyphAt(.3), glyphAt(.55)]).toEqual([1, 2]);
    expect([glyphAt(.3, 0), glyphAt(.55, 0)]).toEqual([1, 2]);
    // (0.3 − 0.3) / 0.7 = 0 → the space; (0.55 − 0.3) / 0.7 = 0.36 → '.'.
    expect([glyphAt(.3, .3), glyphAt(.55, .3), glyphAt(.98, .3)]).toEqual([0, 1, 3]);
    // Black Level works on the tone before Invert Ramp: with it, the dark stage gets the last, densest character.
    expect([glyphAt(.1, .3, true), glyphAt(.98, .3, true)]).toEqual([3, 0]);
    const definition = getEffect('ascii')!;
    expect(definition.params.blackLevel).toMatchObject({ default: 0, renderMin: 0, renderMax: .9, graphOnly: true });
    expect(paramRangeNotes(definition.params, { blackLevel: .95 }, effectOperatorGraph({ type: 'ascii', params: getDefaultParams('ascii') }))[0]?.message)
      .toBe('Black Level 0.95 is above the rendered range (0 to 0.9) and renders as 0.9.');
  });

  it('with Black Level above 0 a moving look holds cells at or below it still, so the dark stage drops out', () => {
    // Grey 0.1 under Black Level 0.3 is tone 0: the first character ('space'), at every moment, even at Roll 1.
    const glyphsOf = (type: string, grey: number, blackLevel: number, invert = false) => {
      const plan = compile(type, { ...getDefaultParams(type), roll: 1, speed: 1, blackLevel, invert });
      return new Set(Array.from({ length: 30 }, (_, frame) => {
        let glyph = -1;
        evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.31, .47], resolution: [1920, 1080], timelineTimeSeconds: frame / 12,
          sampleImage: () => [grey, grey, grey, 1], sampleResource: (_id, [u, v]) => { glyph = Math.floor(v * 2) * 2 + Math.floor(u * 2); return [0, 0, 0, 1]; } });
        return glyph;
      }));
    };
    for (const type of ['glyph-matrix', 'symbol-matrix', 'retro-matrix', 'matrix']) {
      expect(glyphsOf(type, .1, .3), type).toEqual(new Set([0]));
      // With Invert Ramp the held character is the last, densest one (the pages say so).
      expect(glyphsOf(type, .1, .3, true), type).toEqual(new Set([3]));
      // Above the level the cell still rolls; at Black Level 0 (also saved effects) every cell rolls, as before.
      expect(glyphsOf(type, .7, .3).size, type).toBeGreaterThan(1);
      expect(glyphsOf(type, .1, 0).size, type).toBeGreaterThan(1);
    }
  });

  it('Symbol Matrix Twinkle sets how far each sign dims as it breathes; saved effects keep the earlier 0.3–1 pulse', () => {
    const twinkle = getEffect('symbol-matrix')!.params.twinkle;
    expect(twinkle).toMatchObject({ default: .35, legacyDefault: .7, min: 0, max: 1, renderMin: 0, renderMax: 1, graphOnly: true, lookOwn: true, group: 'Motion' });
    expect(getEffect('glyph-matrix')!.params.twinkle).toBeUndefined();
    // A full sign (coverage 1) held on one character (Roll 0) over a dark ground: its brightness over 4 s.
    const range = (overrides: Record<string, unknown>, omit?: string) => {
      const params: Record<string, unknown> = { ...getDefaultParams('symbol-matrix'), roll: 0, background: 0, colorMode: 'duotone', colorA: '#000000', colorB: '#ffffff', ...overrides };
      if (omit) delete params[omit];
      const plan = compile('symbol-matrix', params);
      const levels = Array.from({ length: 96 }, (_, frame) => evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.31, .47], resolution: [1920, 1080],
        timelineTimeSeconds: frame / 24, sampleImage: () => [1, 1, 1, 1], sampleResource: () => [0, 0, 0, 1] })[0] as number);
      return [Math.min(...levels), Math.max(...levels)].map(value => +value.toFixed(2));
    };
    expect(range({ twinkle: 0 })).toEqual([1, 1]);
    expect(range({ twinkle: .35 })[0]).toBeCloseTo(.65, 1);
    expect(range({ twinkle: 1 })[0]).toBeCloseTo(0, 1);
    // Saved before Twinkle existed: the value is missing and the sign dims to 0.3, as with the earlier 0.65 + 0.35 × sin.
    expect(range({}, 'twinkle')[0]).toBeCloseTo(.3, 1);
    expect(migratePersistedEffectOperatorGraph({ id: 'old', name: 'Symbol Matrix', type: 'symbol-matrix', enabled: true, params: { cellSize: 14 } }).params.twinkle).toBe(.7);
    expect(paramRangeNotes(getEffect('symbol-matrix')!.params, { twinkle: 2 }, effectOperatorGraph({ type: 'symbol-matrix', params: getDefaultParams('symbol-matrix') }))[0]?.message)
      .toBe('Twinkle 2 is above the rendered range (0 to 1) and renders as 1.');
  });

  it('warns that Speed does nothing at Roll 0 in the looks that move only by rolling', () => {
    const warnings = (type: string, values: Record<string, unknown>) => getEffect(type)!.paramWarnings!({ ...getDefaultParams(type), ...values } as Record<string, number | boolean | string>, 1920, 1080);
    for (const type of ['glyph-matrix', 'data-hatch', 'pixel-dither', 'capsule-cloud', 'ui-collage', 'ascii-ghost']) {
      expect(warnings(type, { roll: 0, speed: 2 }).join(' '), type).toMatch(/Roll 0 holds every character still, so Speed has no effect/u);
      expect(warnings(type, { roll: 0, speed: 0 }), type).toEqual([]);
      expect(warnings(type, { roll: .2, speed: 2 }), type).toEqual([]);
    }
    // Their rain head, pulse or scroll keeps moving at Roll 0.
    for (const type of ['matrix', 'symbol-matrix', 'retro-matrix']) expect(warnings(type, { roll: 0, speed: 2 }), type).toEqual([]);
  });

  it('dims Dark and Light while Color Source is Source and Ramp while a Custom Ramp is typed', () => {
    for (const type of ['ascii', 'glyph-matrix', 'symbol-matrix']) {
      const params = getEffect(type)!.params;
      expect(params.colorA.activeWhen, type).toMatchObject({ param: 'colorMode', values: ['duotone'] });
      expect(params.colorB.activeWhen, type).toMatchObject({ param: 'colorMode', values: ['duotone'] });
      expect(params.rampPreset.activeWhen, type).toMatchObject({ param: 'customRamp', values: [''] });
    }
    // Number Field and Dither Glow always colour between Dark and Light.
    for (const type of ['number-field', 'pixel-dither']) expect(getEffect(type)!.params.colorA.activeWhen, type).toBeUndefined();
  });
});
