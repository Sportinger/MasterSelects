// The shared glyph-mosaic engine (createGlyphEffect + createDefaultGlyphGraph), checked across every look:
// every shown control reaches the output, Background keeps saved looks and lifts new ones, Cell Size
// counts pixels of a 1080p frame, a keyframed Speed moves by its travelled distance, the looks hold
// still while paused, and the emitted WGSL has valid literals.
import { describe, expect, it } from 'vitest';
import { getAllEffects, getDefaultParams, getEffect } from '../../src/effects';
import { GLYPH_NO_TRAVEL, GLYPH_SPEED_TRAVEL, glyphCellPixels, glyphCellWarnings } from '../../src/effects/glyph/glyphGrid';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { effectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { effectParamDefinitions } from '../../src/services/operators/effectParamVisibility';
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
      expect(background.default).toBe(type === 'stitch-poster' ? 0 : .3);
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
    // Matrix: the green ground follows the cell's tone (its rain colour ignores the picture).
    const matrix = render('matrix', { background: 1 }, { time: 0 }).output;
    expect(matrix[0]).toBeCloseTo(.04 * tone, 12);
    expect(matrix[2]).toBeCloseTo(.13 * tone, 12);
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

  it('Weight is not keyframeable and draws one of the nine font weights, so no value builds an atlas of its own', () => {
    for (const type of GLYPH_LOOKS) {
      const definition = getEffect(type)!;
      expect(definition.params.fontWeight.animatable, type).toBe(false);
      const atlas = (fontWeight: number) => definition.glyphAtlas!({ ...getDefaultParams(type), fontWeight } as Record<string, number | boolean | string>).fontWeight;
      expect([atlas(612.5), atlas(649), atlas(651), atlas(2000), atlas(-5)], type).toEqual([600, 600, 700, 900, 100]);
    }
  });
});

