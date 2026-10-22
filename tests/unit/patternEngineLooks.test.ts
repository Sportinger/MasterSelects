// The two-tone-pattern engine (about 25 looks over seven picker groups): every look keeps time with the
// playhead (no re-rendering while paused), measures its pattern in pixels of a 1080p frame (preview
// qualities, thumbnails and every export size show the same pattern), moves a keyframed Speed by the
// distance it has travelled (a ramp never jumps), and every shown shared control changes the picture.
import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { effectEngineMembers } from '../../src/effects/effectCatalogGroups';
import { CATALOG_SPEED_TRAVEL } from '../../src/effects/_shared/catalogEffect';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan, type ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { bindImageOperatorValues } from '../../src/services/operators/imageOperatorValueBindings';
import { measureInReferenceFrame } from '../../src/services/operators/patternReferenceFrame';
import { imageResourceSize } from '../../src/services/operators/imageResourceScale';
import { evaluateEffectKeyframes } from '../../src/stores/timeline/keyframes/effectKeyframeEvaluation';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

type Rgba = [number, number, number, number];
type Params = Record<string, number | boolean | string>;
const LOOKS = effectEngineMembers('two-tone-pattern');
/** Looks whose pattern edges are one output pixel soft at every size (sharper on larger frames). */
const SOFT_EDGE_IN_OUTPUT_PIXELS = new Set(['halftone', 'riso', 'riso-glow']);
/** A picture with soft gradients and hard edges, sampled by position (the same at every resolution). */
const picture = ([u, v]: [number, number]): Rgba => {
  const x = Math.min(Math.max(u, 0), 1), y = Math.min(Math.max(v, 0), 1), disc = Math.hypot(x - .45, y - .55) < .28 ? 1 : 0;
  return [.5 + .4 * Math.sin(x * 9 + y * 4), .5 + .4 * Math.sin(y * 13 - x * 3), .15 + .7 * disc, 1];
};
const POINTS: [number, number][] = Array.from({ length: 96 }, (_, index) => [((index * 37) % 96 + .5) / 96, ((index * 61) % 96 + .5) / 96]);

function compile(type: string, params: Params): { plan: ImageOperatorPlan; graph: EffectOperatorGraph } {
  const effect = { type, params: { ...getDefaultParams(type), ...params } };
  const graph = effectOperatorGraph(effect);
  return { graph, plan: compileImageOperatorGraph(graph, effectOperatorParams(effect), effectOperatorCompileContext(effect)) };
}
/** Evaluates `plan` at the same frame positions at every resolution. Materialized passes are
 * evaluated where a later pass reads them (point samples instead of a filtered raster, the same for every render). */
function render(plan: ImageOperatorPlan, resolution: [number, number], time: number): Rgba[] {
  const descriptors = new Map((plan.resources ?? []).map(resource => [resource.id, resource]));
  const producers = new Map((plan.passes ?? []).filter(pass => pass.outputResource).map(pass => [pass.outputResource!, pass.program]));
  const at = (program: ImageOperatorPlan, size: [number, number], uv: [number, number]): Rgba => evaluateImageOperatorPlan(program, picture(uv), {
    uv, resolution: size, timelineTimeSeconds: time, sampleImage: picture,
    loadImage: ([x, y]) => picture([(x + .5) / resolution[0], (y + .5) / resolution[1]]),
    sampleResource: (id, point) => produce(id, point),
    loadResource: (id, [x, y]) => { const own = sizeOf(id); return produce(id, [(x + .5) / own[0], (y + .5) / own[1]]); },
    pixelCoordinate: [Math.floor(uv[0] * size[0]), Math.floor(uv[1] * size[1])], derivativeAutoMode: 'coarse',
  });
  const sizeOf = (id: string): [number, number] => { const size = imageResourceSize(descriptors.get(id), resolution[0], resolution[1]); return [size.width, size.height]; };
  const produce = (id: string, uv: [number, number]): Rgba => {
    const program = producers.get(id);
    if (!program) throw new Error(`No pass produces ${id}.`);
    return at(program, sizeOf(id), uv);
  };
  const final = plan.passes?.length ? plan.passes.at(-1)!.program : plan;
  return POINTS.map(uv => at(final, resolution, uv));
}
/** Share of sample points whose colours agree within `tolerance`. */
const agreement = (a: Rgba[], b: Rgba[], tolerance = .03) =>
  a.filter((color, index) => color.every((channel, c) => Math.abs(channel - b[index][c]) <= tolerance)).length / a.length;

describe('two-tone-pattern engine', () => {
  it('covers the engine looks', () => {
    expect(LOOKS.length).toBeGreaterThanOrEqual(25);
    for (const type of LOOKS) expect(getEffect(type), type).toBeDefined();
  });

  it('keeps time with the playhead: no look re-renders on the wall clock while paused', () => {
    for (const type of LOOKS) {
      const effect = getEffect(type)!;
      expect(effect.requiresContinuousRender, type).toBe(false);
      const speed = effect.params.speed;
      if (speed && !speed.deprecated) {
        expect('timelineAnimated' in effect && effect.timelineAnimated, type).toBe(true);
        expect(speed.integratedAs, type).toBe(CATALOG_SPEED_TRAVEL);
      }
    }
  });

  it('measures every pattern in 1080p pixels: half-quality preview, 1080p and 4K show the same pattern', () => {
    const differing: string[] = [];
    for (const type of LOOKS) {
      const { plan } = compile(type, {});
      // Dithering draws whole pixels: at half quality its default 3 px cells would be 1.5 pixels, so compare at 720p (2 pixels).
      const hd = render(plan, [1920, 1080], 1.25);
      const uhd = render(plan, [3840, 2160], 1.25), preview = render(plan, type === 'dither' ? [1280, 720] : [960, 540], 1.25);
      // Halftone, Riso and Riso Glow smooth their dot edges over one output pixel: a 4K edge is sharper, but no point turns from ink to paper.
      const tolerance = SOFT_EDGE_IN_OUTPUT_PIXELS.has(type) ? .5 : .03;
      if (agreement(hd, uhd, tolerance) < .98 || agreement(hd, preview, tolerance) < .98) differing.push(`${type} (4K ${agreement(hd, uhd).toFixed(2)}, half ${agreement(hd, preview).toFixed(2)})`);
    }
    expect(differing).toEqual([]);
  });

  it('a measured size is the 1080p size × shorter side / 1080, never under its pixel floor', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
      { id: 'resolution', operator: 'image.resolution', operatorVersion: 1, bindings: {} },
      { id: 'size', operator: 'values.number', operatorVersion: 1, bindings: { value: 'scale' } },
      { id: 'size-vec2', operator: 'convert.scalar-to-vec2', operatorVersion: 1, bindings: {} },
      { id: 'cells', operator: 'math.divide-ieee.vec2', operatorVersion: 1, bindings: {} },
      { id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} },
      { id: 'cells-x', operator: 'vector.split.vec2', operatorVersion: 1, bindings: {} },
      { id: 'shade', operator: 'convert.scalar-to-rgb', operatorVersion: 1, bindings: {} },
      { id: 'frame-split', operator: 'vector.split.rgba', operatorVersion: 1, bindings: {} },
      { id: 'combine', operator: 'vector.combine.rgba', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
    ], edges: [
      { id: 'a', from: 'size', output: 'value', to: 'size-vec2', input: 'value' },
      { id: 'b', from: 'resolution', output: 'value', to: 'cells', input: 'a' },
      { id: 'c', from: 'size-vec2', output: 'value', to: 'cells', input: 'b' },
      { id: 'd', from: 'cells', output: 'value', to: 'cells-x', input: 'value' },
      { id: 'e', from: 'cells-x', output: 'x', to: 'shade', input: 'value' },
      { id: 'f', from: 'shade', output: 'rgb', to: 'combine', input: 'rgb' },
      { id: 'g', from: 'frame', output: 'image', to: 'frame-split', input: 'image' },
      { id: 'h', from: 'frame-split', output: 'alpha', to: 'combine', input: 'alpha' },
      { id: 'i', from: 'combine', output: 'image', to: 'output', input: 'image' },
    ] };
    const measured = measureInReferenceFrame(graph, 'size', { minimumPixels: 1 });
    const cellsAcross = (scale: number, resolution: [number, number]) =>
      evaluateImageOperatorPlan(compileImageOperatorGraph(measured, { scale }), [0, 0, 0, 1], { uv: [.5, .5], resolution })[0];
    expect(cellsAcross(10, [1920, 1080])).toBeCloseTo(192, 6);
    expect(cellsAcross(10, [3840, 2160])).toBeCloseTo(192, 6);
    expect(cellsAcross(10, [1080, 1920])).toBeCloseTo(108, 6); // portrait: the shorter side is the width
    expect(cellsAcross(1, [480, 270])).toBeCloseTo(480, 6); // 0.25 px would be thinner than a pixel: one pixel
    expect(() => measureInReferenceFrame(measured, 'size')).toThrow(/twice/u);
  });

  it('says when a pattern size is thinner than one pixel of a small frame', () => {
    const notes = (type: string, params: Params, width: number, height: number) => getEffect(type)!.paramWarnings?.({ ...getDefaultParams(type), ...params }, width, height) ?? [];
    expect(notes('halftone', { scale: 2 }, 1920, 1080)).toEqual([]);
    expect(notes('halftone', { scale: 2 }, 640, 360)).toEqual(['Dot Size 2 px is thinner than one pixel on this 640×360 frame; it renders 1 pixel.']);
    expect(notes('dither', { scale: 1 }, 1280, 720).join(' ')).toMatch(/^Pixel Size 1 px is thinner than one pixel on this 1280×720 frame/u);
    expect(notes('bricks', { scale: 1 }, 640, 360)).toEqual([]); // the floor of 5 px is 1.7 px there
    // Dither cells are whole pixels: 3 px of a 1080p frame are 1.5 pixels at 540p and render as 2.
    expect(notes('dither', { scale: 3 }, 960, 540)).toEqual(['Pixel Size 3 px is 1.5 pixels on this 960×540 frame; dither cells are whole pixels, so it renders 2.']);
    expect(notes('dither', { scale: 3 }, 1280, 720)).toEqual([]);
    const cells = (resolution: [number, number]) => render(compile('dither', { scale: 3, amount: 1 }).plan, resolution, 0);
    expect(agreement(cells([960, 540]), render(compile('dither', { scale: 4, amount: 1 }).plan, [960, 540], 0), 0)).toBe(1); // 1.5 → 2, like 4 px
  });

  it('moves a keyframed Speed by the distance travelled, so a ramp does not jump', () => {
    // Speed keyed 0 → 4 over two seconds: at two seconds it has travelled 4 (the area under the ramp).
    const effect: Effect = { id: 'fx', name: 'Glitch Grid', type: 'glitch-grid', enabled: true, params: getDefaultParams('glitch-grid') };
    const keys = [0, 2].map((time, index) => ({ id: `k${index}`, clipId: 'clip', time, property: 'effect.fx.speed', value: time * 2, easing: 'linear' }) as Keyframe);
    const [evaluated] = evaluateEffectKeyframes([effect], keys, 2);
    expect(evaluated.params.speed).toBeCloseTo(4, 9);
    expect(evaluated.params[CATALOG_SPEED_TRAVEL]).toBeCloseTo(4, 9);
    const mismatched: string[] = [];
    for (const type of LOOKS) {
      if (!getEffect(type)!.params.speed || getEffect(type)!.params.speed.deprecated) continue;
      // Keyed: speed 3 now, 1.7 travelled at time 5 — renders like a constant Speed 1 at time 1.7.
      const keyed = render(compile(type, { speed: 3, [CATALOG_SPEED_TRAVEL]: 1.7 }).plan, [640, 360], 5);
      const constant = render(compile(type, { speed: 1 }).plan, [640, 360], 1.7);
      if (agreement(keyed, constant, 1e-5) < 1) mismatched.push(type);
    }
    expect(mismatched).toEqual([]);
  });

  it('adding or removing Speed keys only rebinds the plan values', () => {
    const fresh = compile('drift-lines', { speed: 2, [CATALOG_SPEED_TRAVEL]: 3.5 }).plan;
    const { plan, graph } = compile('drift-lines', { speed: 2 });
    const effect = { type: 'drift-lines', params: { ...getDefaultParams('drift-lines'), speed: 2, [CATALOG_SPEED_TRAVEL]: 3.5 } };
    const rebound = bindImageOperatorValues(plan, effectOperatorParams(effect), effectOperatorCompileContext(effect));
    expect(rebound.values).toEqual(fresh.values);
    expect(render(rebound, [320, 180], 9)).toEqual(render(fresh, [320, 180], 9));
    expect(graph.nodes.find(node => node.id === 'time-speed')?.operator).toBe('math.multiply.scalar'); // the graph still reads Time × Speed
    expect(() => compile('drift-lines', { [CATALOG_SPEED_TRAVEL]: Number.NaN })).toThrow(/finite/u);
  });

  it('every shown shared control changes the picture', () => {
    const changed: Params = { scale: 23, amount: .2, angle: 37, colorA: '#ff2200', colorB: '#00ffaa', speed: 2.3 };
    // Controls that act in one setting of another control only; their card notes say so (paramWarnings).
    const setting: Record<string, Params> = { 'film-prism.angle': { mode: 'prism' } };
    const silent: string[] = [];
    for (const type of LOOKS) {
      const params = getEffect(type)!.params;
      for (const [key, value] of Object.entries(changed)) {
        const spec = params[key];
        if (!spec || spec.hidden || spec.deprecated) continue;
        const context = setting[`${type}.${key}`] ?? {}, base = render(compile(type, context).plan, [1280, 720], 1.37);
        const next = key === 'amount' && Number(spec.default) <= .5 ? .9 : key === 'scale' && Number(spec.default) === 23 ? 31 : value;
        if (agreement(base, render(compile(type, { ...context, [key]: next }).plan, [1280, 720], 1.37), 1e-4) === 1) silent.push(`${type}.${key}`);
      }
    }
    expect(getEffect('film-prism')!.paramWarnings?.({ ...getDefaultParams('film-prism'), mode: 'lens', angle: 30 }).join(' ')).toMatch(/Prism Angle only acts/u);
    expect(silent).toEqual([]);
  });
});
