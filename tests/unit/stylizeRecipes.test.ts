import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { effectOperatorGraph, effectOperatorParams, migrateLoadedEffectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { createEarlierPointwiseEffectGraph } from '../../src/services/operators/pointwiseEffectGraphs';
import { createStylizeRecipeGraph, earlierStylizeRecipeNote, isEarlierStylizeGraph, isPreviousStylizeGraph, previousStylizeRecipeNote, STYLIZE_RECIPE_EFFECT_TYPES, stylizeRecipeUpdate } from '../../src/services/operators/stylizeRecipes';
import { unusedParamWarnings } from '../../src/services/operators/effectParamVisibility';
import { createSpreadWindowSharpenGraph } from '../../src/services/operators/sharpenEffectGraph';
import { createWholeTapEdgeDetectGraph } from '../../src/services/operators/edgeDetectEffectGraph';
import { createDefaultGlowGraph, createGlowGraphBefore20261022 } from '../../src/services/operators/glowBloomEffectGraph';
import { effectDefinitionNotes } from '../../src/services/operators/effectParamVisibility';
import { applyWorkerSoftwareImageGraphs, canApplyWorkerSoftwareImageGraphPlan } from '../../src/services/render/workerSoftwareImageGraphs';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { evaluateImagePasses } from '../helpers/imageGraphPasses';
import { imageCellHash } from '../../src/services/operators/imageOperatorEvaluation';
import { thresholdValue, posterizeValue } from '../../src/effects/stylize/pointwiseModel';
import { grainResponse, GRAIN_PATTERN_SPAN, GRAIN_SEED_ROW } from '../../src/effects/stylize/grain/grainModel';
import { glowContribution, glowLevelWeights } from '../../src/effects/stylize/glow/glowBloom';
import { vignetteDistance } from '../../src/effects/stylize/vignette/vignetteModel';

type Pixel = [number, number, number, number];
const TYPES = [...STYLIZE_RECIPE_EFFECT_TYPES];
const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));

/** The plan the editor compiles for a new effect of this type (current recipe) with these values. */
function plan(type: string, params: Record<string, unknown> = {}, operatorGraph = createStylizeRecipeGraph(type)) {
  const effect = { type, params: { ...getDefaultParams(type), ...params } as Effect['params'], operatorGraph };
  return compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect));
}

/** Straight-alpha RGBA8 raster through the software pass runtime (real resource sizes, linear filtering). */
function render(type: string, params: Record<string, unknown>, width: number, height: number,
  pixel: (x: number, y: number) => Pixel, time = 0): Float64Array {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y).map(value => Math.round(value * 255)), (y * width + x) * 4);
  const compiled = plan(type, params);
  expect(canApplyWorkerSoftwareImageGraphPlan(compiled)).toBe(true);
  applyWorkerSoftwareImageGraphs(data, width, height, [compiled], time);
  return Float64Array.from(data, value => value / 255);
}
const at = (raster: Float64Array, width: number, x: number, y: number): Pixel =>
  Array.from(raster.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)) as Pixel;
const luma = (p: readonly number[]) => p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722;

describe('stylize recipes: ownership and saved projects', () => {
  it.each(TYPES)('%s: the current recipe is valid, compiles and also runs in the software renderer', type => {
    const graph = createStylizeRecipeGraph(type)!;
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(canApplyWorkerSoftwareImageGraphPlan(plan(type))).toBe(true);
    expect(isEarlierStylizeGraph(type, graph)).toBe(false);
  });

  it('keeps an untouched Sharpen of 3.2.7 (spread halo window) as saved, offers the current recipe and still reports its value notes', () => {
    const released = createSpreadWindowSharpenGraph(), current = createStylizeRecipeGraph('sharpen')!;
    expect(matchesEffectRecipe(released, current)).toBe(false);
    const resolve = (operatorGraph: ReturnType<typeof createSpreadWindowSharpenGraph>) =>
      effectOperatorGraph({ type: 'sharpen', params: getDefaultParams('sharpen') as Effect['params'], operatorGraph }, { inspectionOnly: true });
    expect(matchesEffectRecipe(resolve(released), released)).toBe(true);
    expect(isPreviousStylizeGraph('sharpen', released)).toBe(true);
    expect(isEarlierStylizeGraph('sharpen', released)).toBe(false);
    expect(stylizeRecipeUpdate('sharpen', released)).toMatchObject({ label: 'Use the new Sharpen', message: expect.stringContaining('3.2.7') });
    expect(stylizeRecipeUpdate('sharpen', current)).toBeUndefined();
    expect(previousStylizeRecipeNote('sharpen', released)).toContain('3.2.7');
    expect(earlierStylizeRecipeNote('sharpen', released)).toBeUndefined();
    const edited = createSpreadWindowSharpenGraph();
    edited.nodes = edited.nodes.map(node => (node.id === 'overshoot' ? { ...node, constants: { value: 0.5 } } : node));
    expect(isPreviousStylizeGraph('sharpen', edited)).toBe(false);
    expect(stylizeRecipeUpdate('sharpen', edited)).toBeUndefined();
  });

  it('keeps an untouched Edge Detect of 3.2.7 (whole-tap window) as saved and offers the current recipe', () => {
    const released = createWholeTapEdgeDetectGraph(), current = createStylizeRecipeGraph('edge-detect')!;
    expect(matchesEffectRecipe(released, current)).toBe(false);
    const resolved = effectOperatorGraph({ type: 'edge-detect', params: getDefaultParams('edge-detect') as Effect['params'], operatorGraph: released }, { inspectionOnly: true });
    expect(matchesEffectRecipe(resolved, released)).toBe(true);
    expect(isPreviousStylizeGraph('edge-detect', released)).toBe(true);
    expect(isEarlierStylizeGraph('edge-detect', released)).toBe(false);
    expect(stylizeRecipeUpdate('edge-detect', released)).toMatchObject({ label: 'Use the new Edge Detect', message: expect.stringContaining('3.2.7') });
    expect(stylizeRecipeUpdate('edge-detect', current)).toBeUndefined();
    expect(previousStylizeRecipeNote('edge-detect', released)).toContain('Width is animated');
  });

  it.each([['edge-detect', createWholeTapEdgeDetectGraph], ['sharpen', createSpreadWindowSharpenGraph]] as const)(
    '%s of 3.2.7 opens with the same stage folders as the current recipe', (type, released) => {
      const folders = (operatorGraph: ReturnType<typeof released>) => (effectOperatorGraph({ type, params: getDefaultParams(type) as Effect['params'], operatorGraph },
        { inspectionOnly: true }).groups ?? []).map(group => group.label).filter(label => !/^(Pair Tap Offsets|Merge Pair Weights)$/.test(label));
      const current = folders(createStylizeRecipeGraph(type)!);
      expect(current.length).toBeGreaterThan(5);
      expect(folders(released())).toEqual(current);
    });

  it('loads an untouched Glow of 3.2.7 (one unused weight card more, same pixels) as the current recipe: folders and plain notes', () => {
    const released = createGlowGraphBefore20261022(), current = createDefaultGlowGraph();
    expect(released.nodes.length).toBe(current.nodes.length + 1);
    const effect = (operatorGraph: typeof released) => ({ type: 'glow', params: { ...getDefaultParams('glow'), threshold: 1.2 } as Effect['params'], operatorGraph });
    const resolved = effectOperatorGraph(effect(released), { inspectionOnly: true });
    expect(matchesEffectRecipe(resolved, current)).toBe(true);
    expect((resolved.groups ?? []).map(group => group.label)).toEqual((effectOperatorGraph(effect(current), { inspectionOnly: true }).groups ?? []).map(group => group.label));
    expect(effectDefinitionNotes(effect(released), 640, 360)).toEqual(effectDefinitionNotes(effect(current), 640, 360));
    expect(effectDefinitionNotes(effect(released), 640, 360).join(' ')).not.toMatch(/edited graph/);
    expect(stylizeRecipeUpdate('glow', released)).toBeUndefined();
    // An edited 3.2.7 graph is user work and stays as saved.
    const edited = { ...released, nodes: released.nodes.map(node => node.id === 'ramp-floor' ? { ...node, constants: { ...node.constants, value: 0.2 } } : node) } as typeof released;
    expect(matchesEffectRecipe(effectOperatorGraph(effect(edited), { inspectionOnly: true }), current)).toBe(false);
  });

  it('gives new stylize effects their current recipe graph', () => {
    const clip = createMockClip({ id: 'stylize-clip', effects: [] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    for (const type of TYPES) {
      const id = useTimelineStore.getState().addClipEffect(clip.id, type);
      const effect = useTimelineStore.getState().clips[0].effects.find(item => item.id === id)!;
      expect(matchesEffectRecipe(effect.operatorGraph!, createStylizeRecipeGraph(type)!)).toBe(true);
    }
  });

  it.each(['glow', 'grain', 'sharpen', 'vignette', 'scanlines', 'edge-detect'])(
    '%s: a graphless effect in a project file keeps the earlier recipe it rendered; a saved graph wins', type => {
      const graphless: Effect = { id: `${type}-old`, name: type, type: type as Effect['type'], enabled: true, params: getDefaultParams(type) };
      const loaded = migrateLoadedEffectOperatorGraph(graphless);
      expect(isEarlierStylizeGraph(type, loaded.operatorGraph)).toBe(true);
      // Saving and loading again keeps it (packed compositions and all).
      expect(isEarlierStylizeGraph(type, migrateLoadedEffectOperatorGraph(JSON.parse(JSON.stringify(loaded))).operatorGraph)).toBe(true);
      const current = migrateLoadedEffectOperatorGraph({ ...graphless, operatorGraph: createStylizeRecipeGraph(type) });
      expect(isEarlierStylizeGraph(type, current.operatorGraph)).toBe(false);
      // An in-editor graphless effect (transitions, tools) is a new one: the current recipe.
      expect(isEarlierStylizeGraph(type, migratePersistedEffectOperatorGraph(graphless).operatorGraph)).toBe(false);
    });

  it('does not flag an edited earlier recipe as untouched', () => {
    const edited = migrateLoadedEffectOperatorGraph({ id: 'v', name: 'v', type: 'vignette', enabled: true, params: {} }).operatorGraph!;
    const literal = edited.nodes.find(node => node.operator === 'values.number' && typeof node.constants?.value === 'number')!;
    literal.constants = { value: Number(literal.constants!.value) + 0.25 };
    expect(isEarlierStylizeGraph('vignette', edited)).toBe(false);
  });

  it.each(['threshold', 'posterize'] as const)('%s: an untouched earlier graph reads as the current recipe with the same pixels at Softness 0', type => {
    const owned = effectOperatorGraph({ type, params: {}, operatorGraph: createEarlierPointwiseEffectGraph(type) });
    expect(matchesEffectRecipe(owned, createStylizeRecipeGraph(type)!)).toBe(true);
    const params = type === 'threshold' ? { level: 0.43 } : { levels: 5 };
    const earlier = compileImageOperatorGraph(createEarlierPointwiseEffectGraph(type), params);
    const current = plan(type, params);
    for (let index = 0; index <= 255; index += 3) {
      const value = index / 255, pixel: Pixel = [value, (255 - index) / 255, value * 0.5, 0.6];
      const expected = evaluateImageOperatorPlan(earlier, pixel).map(channel => Math.min(1, Math.max(0, channel)));
      expect(evaluateImageOperatorPlan(current, pixel)).toEqual(expected);
    }
  });

  it('hides parameters the instance graph does not read and reports them to tools', () => {
    const ring = migrateLoadedEffectOperatorGraph({ id: 'g', name: 'Glow', type: 'glow', enabled: true, params: getDefaultParams('glow') });
    expect(unusedParamWarnings(ring, ['color'])[0]).toMatch(/does not read it/);
    const bloom = { ...ring, operatorGraph: createStylizeRecipeGraph('glow') };
    expect(unusedParamWarnings(bloom, ['color'])).toEqual([]);
    expect(unusedParamWarnings(bloom, ['rings'])[0]).toMatch(/ring version/);
  });
});

describe('stylize recipes: any value stays finite', () => {
  const extremes: Record<string, Record<string, unknown>[]> = {
    glow: [{ amount: -2, threshold: -1, softness: -1, radius: -10 }, { amount: 50, threshold: 0, softness: 0, radius: 0 }, { radius: 1e6, threshold: 2, softness: 5 }],
    grain: [{ amount: -1, size: -3, speed: -2, chroma: -1 }, { amount: 5, size: 0, speed: 1e4, seed: 1e9, chroma: 3 }],
    sharpen: [{ amount: -5, radius: -1 }, { amount: 100, radius: 0 }, { amount: 2, radius: 400 }],
    vignette: [{ amount: -1, size: -2, softness: -1, roundness: -3 }, { amount: 5, size: 3, softness: 0, roundness: 7 }],
    scanlines: [{ density: -4, opacity: -1, speed: -3 }, { density: 0, opacity: 4, speed: 1e5 }, { density: 1e5, opacity: 1 }],
    'edge-detect': [{ strength: -1, width: -2, colorize: -1 }, { strength: 1e3, width: 0, colorize: 5, invert: true }, { width: 1e4 }],
    threshold: [{ level: -1, softness: -1 }, { level: 2, softness: 10 }, { level: 0.5, softness: 0 }],
    posterize: [{ levels: -5, softness: -1 }, { levels: 0, softness: 0 }, { levels: 1e6, softness: 3 }, { levels: 2.5, softness: 0.5 }],
  };
  it.each(TYPES)('%s renders finite colours inside 0-1 for negative, zero and huge values', type => {
    const source = (u: number, v: number): Pixel => [u, v, 1 - u, u > 0.3 && u < 0.7 ? 1 : 0.4];
    for (const params of extremes[type]) {
      const compiled = plan(type, params);
      for (const uv of [[0.5, 0.5], [0.05, 0.9], [0.31, 0.22], [0.97, 0.03]] as [number, number][]) {
        const result = compiled.passes?.length
          ? evaluateImagePasses(compiled, uv, [32, 18], ([u, v]) => source(u, v), { filterResources: true, timelineTimeSeconds: 0.7 })
          : evaluateImageOperatorPlan(compiled, source(...uv), { uv, resolution: [32, 18], timelineTimeSeconds: 0.7, sampleImage: ([u, v]) => source(u, v) });
        for (const channel of result) expect(Number.isFinite(channel), `${type} ${JSON.stringify(params)} at ${uv}`).toBe(true);
      }
    }
  });

  it.each(TYPES)('%s reports out-of-range values instead of clamping silently', type => {
    const warn = (getEffect(type) as FullscreenEffectDefinition).paramWarnings!;
    expect(warn(getDefaultParams(type) as Record<string, number>, 1920, 1080)).toEqual([]);
    const [first] = extremes[type];
    expect(warn({ ...getDefaultParams(type), ...first } as Record<string, number>, 1920, 1080).length).toBeGreaterThan(0);
  });
});

describe('stylize recipes: notes for values that change nothing', () => {
  it('says when Glow cannot glow and when Grain Speed has no further effect', () => {
    const glowNotes = (getEffect('glow') as FullscreenEffectDefinition).paramWarnings!;
    expect(glowNotes({ ...getDefaultParams('glow'), threshold: 1.5, softness: 0.2 } as Record<string, number>, 1920, 1080).join(' ')).toMatch(/does not glow/);
    expect(glowNotes({ ...getDefaultParams('glow'), threshold: 1, softness: 0.5 } as Record<string, number>, 1920, 1080).join(' ')).toMatch(/only pixels brighter than white/);
    expect(glowNotes({ ...getDefaultParams('glow'), threshold: 0.99, softness: 0.5 } as Record<string, number>, 1920, 1080)).toEqual([]);
    const grainNotes = (getEffect('grain') as FullscreenEffectDefinition).paramWarnings!;
    expect(grainNotes({ ...getDefaultParams('grain'), speed: 5 } as Record<string, number>, 1920, 1080).join(' ')).toMatch(/changes nothing above 1/);
  });
});

describe('Vignette', () => {
  const grey: Pixel = [0.6, 0.6, 0.6, 1];
  const gain = (params: Record<string, unknown>, uv: [number, number], resolution: [number, number]) =>
    evaluateImageOperatorPlan(plan('vignette', params), grey, { uv, resolution })[0] / grey[0];

  it('leaves the centre alone and darkens the corners by Amount', () => {
    expect(gain({}, [0.5, 0.5], [1920, 1080])).toBeCloseTo(1, 2);
    expect(gain({ amount: 0.8, size: 0, softness: 0.95 }, [0.5 / 1920, 0.5 / 1080], [1920, 1080])).toBeCloseTo(0.2, 1);
  });

  it('is a circle in pixels at Roundness 1 and follows the frame at Roundness 0, on any aspect', () => {
    for (const resolution of [[1920, 1080], [1080, 1920]] as [number, number][]) {
      const [w, h] = resolution, r = 400;
      const right = gain({ size: 0.2 }, [0.5 + r / w, 0.5], resolution), below = gain({ size: 0.2 }, [0.5, 0.5 + r / h], resolution);
      expect(Math.abs(right - below)).toBeLessThan(0.01);
      const edgeX = gain({ roundness: 0, size: 0.4 }, [0.999, 0.5], resolution), edgeY = gain({ roundness: 0, size: 0.4 }, [0.5, 0.999], resolution);
      expect(Math.abs(edgeX - edgeY)).toBeLessThan(0.01);
    }
  });

  it('follows the model: gain = 1 - Amount * smoothstep(Size, Size + Softness, distance) (dither at most half an 8-bit step)', () => {
    const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    for (const [x, y] of [[100, 80], [1500, 300], [960, 1000], [30, 1050]]) {
      const reference = 1 - 0.7 * smooth(0.3, 0.8, vignetteDistance(x + 0.5, y + 0.5, 1920, 1080, 0.5));
      expect(Math.abs(gain({ amount: 0.7, size: 0.3, softness: 0.5, roundness: 0.5 }, [(x + 0.5) / 1920, (y + 0.5) / 1080], [1920, 1080]) - reference)).toBeLessThan(1 / 255);
    }
  });

  it('says when Size starts the darkening at or past the corners, where it changes nothing', () => {
    const notes = (getEffect('vignette') as FullscreenEffectDefinition).paramWarnings!;
    expect(notes({ ...getDefaultParams('vignette'), size: 1.2 } as Record<string, number>, 1920, 1080).join(' ')).toMatch(/nothing darkens/);
    expect(notes({ ...getDefaultParams('vignette'), size: 0.95 } as Record<string, number>, 1920, 1080)).toEqual([]);
    for (const size of [1, 1.2, 1.5]) for (const uv of [[0.5 / 1920, 0.5 / 1080], [0.999, 0.5]] as [number, number][]) {
      expect(gain({ amount: 1, size, softness: 1, roundness: 0 }, uv, [1920, 1080])).toBeCloseTo(1, 3);
    }
    expect(gain({ amount: 1, size: 0.95, softness: 0.1 }, [0.5 / 1920, 0.5 / 1080], [1920, 1080])).toBeLessThan(0.9);
  });

  it('ends the Size slider at the corners (1) and keeps up to 1.5 in the number field for saved Vignettes', () => {
    const size = getEffect('vignette')!.params.size as { max?: number; renderMax?: number };
    expect(size.max).toBe(1);
    expect(size.renderMax).toBe(1.5);
  });

  it('looks the same at every resolution', () => {
    for (const uv of [[0.1, 0.2], [0.8, 0.9], [0.3, 0.5]] as [number, number][]) {
      expect(Math.abs(gain({ amount: 0.7 }, uv, [960, 540]) - gain({ amount: 0.7 }, uv, [3840, 2160]))).toBeLessThan(0.006);
    }
  });
});

describe('Film Grain', () => {
  const mid: Pixel = [0.5, 0.5, 0.5, 0.8];
  const sample = (params: Record<string, unknown>, resolution: [number, number], time: number, count = 3000) => {
    const compiled = plan('grain', params), values: number[] = [];
    for (let index = 0; index < count; index++) {
      const uv: [number, number] = [((index * 0.618034) % 1), ((index * 0.7548777) % 1)];
      values.push(evaluateImageOperatorPlan(compiled, mid, { uv, resolution, timelineTimeSeconds: time })[1] - mid[1]);
    }
    return values;
  };
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = (values: number[]) => Math.sqrt(mean(values.map(value => value * value)) - mean(values) ** 2);

  it('is zero-mean film grain of the documented strength in the midtones and keeps alpha', () => {
    const values = sample({ amount: 0.2 }, [1920, 1080], 0.5);
    expect(Math.abs(mean(values))).toBeLessThan(0.004);
    // Amount 0.1 gives a standard deviation of about 0.035 in the midtones (grainModel.ts).
    expect(deviation(values)).toBeGreaterThan(0.06);
    expect(deviation(values)).toBeLessThan(0.085);
    expect(evaluateImageOperatorPlan(plan('grain'), mid, { uv: [0.3, 0.3], resolution: [64, 36], timelineTimeSeconds: 0 })[3]).toBe(0.8);
  });

  it('shows a new pattern each frame, repeats it at the same time and freezes at Speed 0', () => {
    const a = sample({}, [1920, 1080], 1, 400), again = sample({}, [1920, 1080], 1, 400), next = sample({}, [1920, 1080], 1 + 1 / 30, 400);
    expect(again).toEqual(a);
    const correlation = mean(a.map((value, index) => value * next[index])) / (deviation(a) * deviation(next));
    expect(Math.abs(correlation)).toBeLessThan(0.15);
    expect(sample({ speed: 0 }, [1920, 1080], 3, 50)).toEqual(sample({ speed: 0 }, [1920, 1080], 7.2, 50));
  });

  it('has no grid direction: its edges run along the axes as often as along the diagonals', () => {
    // Gradient orientation energy over half-pixel samples; a single axis-aligned value-noise layer
    // puts about 1.8 times as much of it on the axes as on the diagonals (square grain).
    const compiled = plan('grain', { size: 4, amount: 0.5 }), n = 72, bins = new Float64Array(6);
    for (const time of [0.25, 0.5, 0.75]) {
      const field = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) =>
        evaluateImageOperatorPlan(compiled, mid, { uv: [(100 + x / 2) / 1920, (100 + y / 2) / 1080], resolution: [1920, 1080], timelineTimeSeconds: time })[1]));
      for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
        const gx = field[y][x + 1] - field[y][x - 1], gy = field[y + 1][x] - field[y - 1][x];
        bins[Math.round(((Math.atan2(gy, gx) * 180 / Math.PI + 360) % 90) / 15) % 6] += gx * gx + gy * gy;
      }
    }
    const average = bins.reduce((sum, value) => sum + value, 0) / bins.length;
    for (const value of bins) {
      expect(value / average).toBeGreaterThan(0.85);
      expect(value / average).toBeLessThan(1.18);
    }
  });

  it('shows a new pattern on every frame of a long timeline (the pattern index stays exact in f32)', () => {
    // Reference of the pattern offset: f32 index, then Random (Cell) of whole numbers, as the shader computes it.
    const offset = (time: number) => {
      const index = Math.floor(Math.fround(Math.fround(time) * 60) + 0.5);
      return [imageCellHash([index, 0]) * GRAIN_PATTERN_SPAN, imageCellHash([index, GRAIN_SEED_ROW]) * GRAIN_PATTERN_SPAN];
    };
    const offsets = Array.from({ length: 300 }, (_, frame) => offset(7200 + frame / 30));
    const distinct = new Set(offsets.map(([x, y]) => `${Math.round(x)}:${Math.round(y)}`));
    expect(distinct.size).toBe(300);
    // And the plan agrees: two frames two hours in are unrelated grain.
    const a = sample({}, [1920, 1080], 7200, 400), b = sample({}, [1920, 1080], 7200 + 1 / 30, 400);
    expect(Math.abs(mean(a.map((value, index) => value * b[index])) / (deviation(a) * deviation(b)))).toBeLessThan(0.15);
  });

  it('follows the film response: full grain in the midtones, 30 % of it in black and white', () => {
    const spread = (level: number) => {
      const compiled = plan('grain', { amount: 0.2 }), values: number[] = [];
      for (let index = 0; index < 2000; index++) {
        const uv: [number, number] = [((index * 0.618034) % 1), ((index * 0.7548777) % 1)];
        values.push(evaluateImageOperatorPlan(compiled, [level, level, level, 1], { uv, resolution: [1920, 1080], timelineTimeSeconds: 0.5 })[1] - level);
      }
      return deviation(values);
    };
    expect(spread(0.25) / spread(0.5)).toBeCloseTo(grainResponse(0.25) / grainResponse(0.5), 1);
  });

  it('keeps its grain size at every resolution: the same picture position gets the same grain', () => {
    const small = sample({ size: 2 }, [960, 540], 0.25, 200), large = sample({ size: 2 }, [3840, 2160], 0.25, 200);
    small.forEach((value, index) => expect(large[index]).toBeCloseTo(value, 4));
  });
});

describe('Edge Detect', () => {
  /** Peak edge brightness across a vertical step of contrast `contrast` at frame height `height`. */
  const peak = (width: number, height: number, contrast = 0.5) => {
    const resolution: [number, number] = [height * 16 / 9, height];
    const source = ([u]: [number, number]): Pixel => (u < 0.5 ? [0.2, 0.2, 0.2, 1] : [0.2 + contrast, 0.2 + contrast, 0.2 + contrast, 1]);
    const compiled = plan('edge-detect', { width, strength: 0.25 });
    let best = 0;
    for (let x = resolution[0] / 2 - 3; x <= resolution[0] / 2 + 2; x++) {
      const uv: [number, number] = [(x + 0.5) / resolution[0], 0.5];
      best = Math.max(best, evaluateImageOperatorPlan(compiled, source(uv), { uv, resolution, sampleImage: source })[0]);
    }
    return best;
  };

  // The line strength is 1 - exp(-x) of the response x = c * 4 * Strength (soft roll-off, no clip).
  const response = (edge: number) => -Math.log(1 - edge);

  it('reads a step of contrast c as a response of about c * 4 * Strength at every Width and resolution, rolled off softly', () => {
    for (const width of [1, 2, 4]) {
      expect(response(peak(width, 1080))).toBeGreaterThan(0.42);
      expect(response(peak(width, 1080))).toBeLessThan(0.56);
    }
    expect(Math.abs(response(peak(2, 540)) - response(peak(2, 1080)))).toBeLessThan(0.06);
    // Strong edges approach white without clipping flat: twice the contrast is still brighter.
    expect(peak(1, 1080, 0.75)).toBeGreaterThan(peak(1, 1080, 0.5) + 0.05);
  });

  it('changes smoothly when Width is animated across a step of the window (no jump)', () => {
    // The window grows by one tap per side whenever 2 sigma passes a whole pixel. The new outer taps
    // enter with their covered share, so a 0.02 px sigma step there changes the lines no more than
    // the same step between two window sizes (before, the Gaussian's outer ring popped in at once).
    const size = 40, pixel = (x: number, y: number): Pixel => {
      const v = (x > 19 ? 0.65 : 0.3) + 0.15 * Math.sin(1.3 * x + 0.4 * y) * Math.cos(1.1 * y); return [v, v, v, 1];
    };
    const frame = (sigma: number) => render('edge-detect', { strength: 1, width: sigma * 1080 / size }, size, size, pixel);
    const change = (sigma: number) => {
      const [before, after] = [frame(sigma - 0.01), frame(sigma + 0.01)];
      let largest = 0;
      for (let index = 0; index < before.length; index++) largest = Math.max(largest, Math.abs(after[index] - before[index]));
      return largest;
    };
    // Compared with the same step just before and after (the lines change faster at small Widths).
    for (const edge of [1, 1.5, 2, 2.5]) {
      const steady = Math.max(change(edge - 0.06), change(edge + 0.06));
      expect(change(edge)).toBeLessThanOrEqual(steady + 1 / 255);
    }
  });

  it('draws the same line at 1080p and at 4K: past 8 taps per side the window spreads its taps instead of ending at 8 px', () => {
    // Line brightness across a vertical step, at positions measured in 1080p pixels from the step.
    const profile = (graph: ReturnType<typeof createStylizeRecipeGraph>, width: number, height: number) => {
      const resolution: [number, number] = [height * 16 / 9, height], scale = height / 1080;
      // A soft step over 3 px of a 1080p frame (as in real footage), the same share of every frame.
      const source = ([u]: [number, number]): Pixel => {
        const t = Math.min(1, Math.max(0, ((u - 0.5) * resolution[0] / scale + 1.5) / 3)), v = 0.2 + 0.5 * t * t * (3 - 2 * t);
        return [v, v, v, 1];
      };
      const compiled = plan('edge-detect', { width, strength: 0.5 }, graph);
      return Array.from({ length: 31 }, (_, index) => {
        const uv: [number, number] = [0.5 + (index - 15 + 0.5) * scale / resolution[0], 0.5];
        return evaluateImageOperatorPlan(compiled, source(uv), { uv, resolution, sampleImage: source })[0];
      });
    };
    const largest = (a: number[], b: number[]) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));
    for (const width of [3, 5]) {
      const current = createStylizeRecipeGraph('edge-detect');
      expect(largest(profile(current, width, 1080), profile(current, width, 2160))).toBeLessThan(0.02);
      expect(largest(profile(current, width, 540), profile(current, width, 2160))).toBeLessThan(0.04);
    }
    // The 3.2.7 window ended at 8 px: at 4K, Width 3 drew a clearly thinner line than at 1080p.
    const released = createWholeTapEdgeDetectGraph();
    expect(largest(profile(released, 3, 1080), profile(released, 3, 2160))).toBeGreaterThan(0.08);
    // No note claims a cut window any more.
    expect((getEffect('edge-detect') as FullscreenEffectDefinition).paramWarnings!({ ...getDefaultParams('edge-detect'), width: 6 } as Record<string, number>, 3840, 2160)).toEqual([]);
  });

  it('changes smoothly when an animated Width starts spreading the taps (2 sigma = 8 px)', () => {
    const size = 32, pixel = (x: number, y: number): Pixel => {
      const v = (x > 15 ? 0.65 : 0.3) + 0.15 * Math.sin(1.3 * x + 0.4 * y) * Math.cos(1.1 * y); return [v, v, v, 1];
    };
    const frame = (sigma: number) => render('edge-detect', { strength: 1, width: sigma * 1080 / size }, size, size, pixel);
    const change = (sigma: number) => {
      const [before, after] = [frame(sigma - 0.01), frame(sigma + 0.01)];
      let largestChange = 0;
      for (let index = 0; index < before.length; index++) largestChange = Math.max(largestChange, Math.abs(after[index] - before[index]));
      return largestChange;
    };
    expect(change(4)).toBeLessThanOrEqual(Math.max(change(3.94), change(4.06)) + 1 / 255);
  }, 60_000);

  it('finds no edges in a flat picture and keeps transparent surroundings transparent', () => {
    const flat = (): Pixel => [0.4, 0.4, 0.4, 1];
    expect(evaluateImageOperatorPlan(plan('edge-detect'), flat(), { uv: [0.5, 0.5], resolution: [320, 180], sampleImage: flat })[0]).toBeLessThan(1e-4);
    const empty = (): Pixel => [0, 0, 0, 0];
    expect(evaluateImageOperatorPlan(plan('edge-detect'), empty(), { uv: [0.5, 0.5], resolution: [320, 180], sampleImage: empty })[3]).toBe(0);
  });
});

describe('Edge Detect on a transparent layer', () => {
  const width = 64, height = 36;
  const square = (x: number, y: number): Pixel => (x >= 24 && x < 40 && y >= 10 && y < 26 ? [0.9, 0.3, 0.1, 1] : [0, 0, 0, 0]);
  /** Straight colours and alphas of the row through the middle, left of and across the left edge. */
  const row = (params: Record<string, unknown>) => {
    const out = render('edge-detect', { width: 2, ...params }, width, height, square);
    return Array.from({ length: 8 }, (_, step) => at(out, width, 18 + step, 18));
  };

  it('draws the outline outside the layer in the full line colour (no darkened or grey fringe)', () => {
    for (const [params, line] of [[{}, [1, 1, 1]], [{ invert: true }, [0, 0, 0]]] as const) {
      const pixels = row(params), outside = pixels.slice(0, 6).filter(pixel => pixel[3] > 0.05);
      expect(outside.length).toBeGreaterThan(0);
      for (const pixel of outside) for (let channel = 0; channel < 3; channel++) expect(Math.abs(pixel[channel] - line[channel])).toBeLessThan(2 / 255);
    }
  });

  it('colours that outline with the layer colour at full brightness (Color 1)', () => {
    const outside = row({ colorize: 1 }).slice(0, 6).filter(pixel => pixel[3] > 0.05);
    expect(outside.length).toBeGreaterThan(0);
    for (const pixel of outside) {
      expect(pixel[0]).toBeGreaterThan(0.97);
      expect(Math.abs(pixel[1] - 0.3 / 0.9)).toBeLessThan(0.03);
      expect(Math.abs(pixel[2] - 0.1 / 0.9)).toBeLessThan(0.03);
    }
  });
});

describe('Sharpen', () => {
  // Rows of a picture that only changes along x. Radius is in pixels of a 1080p frame, so
  // `radiusFor` gives the Radius whose blur sigma is `sigma` pixels on this small frame.
  const width = 96, height = 12, radiusFor = (sigma: number) => sigma * 1080 / height;
  const sharpenRow = (signal: (x: number) => number, amount: number, sigma: number) => {
    const out = render('sharpen', { amount, radius: radiusFor(sigma) }, width, height, x => { const v = signal(x); return [v, v, v, 1]; });
    return Array.from({ length: width }, (_, x) => luma(at(out, width, x, 6)));
  };
  /** Independent reference: plain unsharp mask, l + Amount * (l - Gaussian(l)), clamp-to-edge. */
  const plainUnsharp = (signal: (x: number) => number, amount: number, sigma: number) => Array.from({ length: width }, (_, x) => {
    let sum = 0, total = 0;
    for (let offset = -Math.ceil(4 * sigma); offset <= Math.ceil(4 * sigma); offset++) {
      const weight = Math.exp(-offset * offset / (2 * sigma * sigma));
      sum += weight * signal(Math.min(width - 1, Math.max(0, x + offset))); total += weight;
    }
    return signal(x) + amount * (signal(x) - sum / total);
  });
  const step = (x: number) => (x < 48 ? 0.25 : 0.7);

  it('crisps a step edge with only a small halo and leaves flat areas alone', () => {
    for (const amount of [1, 3, 5]) {
      const row = sharpenRow(step, amount, 2), plain = plainUnsharp(step, amount, 2);
      const halo = Math.max(Math.max(...row) - 0.7, 0.25 - Math.min(...row));
      const plainHalo = Math.max(...plain) - 0.7;
      // At most half the plain unsharp mask's halo, and at most 27 % of the edge even at Amount 5.
      expect(halo).toBeLessThan(Math.min(0.27 * 0.45, plainHalo / 2));
      expect(row[47] - step(47)).toBeLessThan(-0.02);
      expect(row[48] - step(48)).toBeGreaterThan(0.02);
      for (const x of [4, 20, 76, 91]) expect(Math.abs(row[x] - step(x))).toBeLessThan(1.5 / 255);
    }
  });

  it('keeps texture: neighbouring pixels never swap their order and contrast grows with Amount', () => {
    // A strong ±0.2 texture at Radius 3 px: the worst case of the halo limit, whose range is the whole texture.
    const sine = (x: number) => 0.5 + 0.2 * Math.sin(0.5 * x);
    const amplitudes = [1, 3, 5].map(amount => {
      const row = sharpenRow(sine, amount, 3);
      for (let x = 13; x < width - 13; x++) {
        const rising = sine(x) - sine(x - 1), moved = (row[x] - row[x - 1]) * Math.sign(rising);
        // Never against the source; at Amount 1 every source step of 2 levels or more stays a step
        // (stronger settings may round two neighbours at a peak into the same level, never reverse them).
        if (Math.abs(rising) > 1.5 / 255) expect(moved).toBeGreaterThanOrEqual(amount === 1 ? 0.5 / 255 : 0);
      }
      const middle = row.slice(13, width - 13);
      return (Math.max(...middle) - Math.min(...middle)) / 2;
    });
    expect(amplitudes[0]).toBeGreaterThan(0.2);
    expect(amplitudes[1]).toBeGreaterThan(amplitudes[0] + 2 / 255);
    expect(amplitudes[2]).toBeGreaterThan(amplitudes[1] + 2 / 255);
  });

  it('sharpens fine, faint texture on a gradient almost like the plain unsharp mask (Amount 3, Radius 2 px)', () => {
    const texture = (x: number) => 0.3 + 0.4 * x / width + 0.02 * Math.sin(0.9 * x);
    const highPass = (row: number[]) => row.slice(12, width - 12).map((value, index) => value - (row[index + 11] + row[index + 13]) / 2);
    const energy = (values: number[]) => values.reduce((sum, value) => sum + value * value, 0);
    const kept = energy(highPass(sharpenRow(texture, 3, 2))) / energy(highPass(plainUnsharp(texture, 3, 2)));
    expect(kept).toBeGreaterThan(0.8);
  });

  it('changes smoothly when Radius is animated across a step of the halo window (no flicker)', () => {
    // The halo window grows by one tap per side whenever 2 sigma passes a whole pixel. A tap enters
    // with its covered share, so a 0.02 px sigma step there changes the picture no more than the
    // same step between two window sizes (before, it jumped by about three times that).
    const size = 40, pixel = (x: number, y: number): Pixel => {
      const v = (x > 19 ? 0.65 : 0.3) + 0.15 * Math.sin(1.3 * x + 0.4 * y) * Math.cos(1.1 * y); return [v, v, v, 1];
    };
    const frame = (sigma: number) => render('sharpen', { amount: 5, radius: sigma * 1080 / size }, size, size, pixel);
    const change = (sigma: number) => {
      const [before, after] = [frame(sigma - 0.01), frame(sigma + 0.01)];
      let largest = 0;
      for (let index = 0; index < before.length; index++) largest = Math.max(largest, Math.abs(after[index] - before[index]));
      return largest;
    };
    const steady = Math.max(change(1.25), change(1.3));
    for (const edge of [1, 1.5]) expect(change(edge)).toBeLessThanOrEqual(steady + 1 / 255);
  });

  it('does not read the timeline time', () => {
    expect(plan('sharpen', { amount: 5, radius: 5 }).passes!.some(pass => pass.program.capabilities.includes('time'))).toBe(false);
  });

  it('keeps a flat colour layer on transparency free of dark or bright fringes', () => {
    const out = render('sharpen', { amount: 3, radius: radiusFor(1.5) }, 48, 27, (x, y) => (x > 12 && x < 36 && y > 6 && y < 20 ? [0.9, 0.5, 0.2, 1] : [0, 0, 0, 0]));
    for (let y = 7; y < 20; y++) for (let x = 13; x < 36; x++) {
      const pixel = at(out, 48, x, y);
      expect(Math.abs(pixel[0] - 0.9) + Math.abs(pixel[1] - 0.5) + Math.abs(pixel[2] - 0.2)).toBeLessThan(4 / 255);
    }
  });
});

describe('Glow', () => {
  const width = 128, height = 72;
  const dot = (alphaOutside = 1, half = 2) => (x: number, y: number): Pixel => (Math.abs(x - 63.5) < half && Math.abs(y - 35.5) < half ? [1, 1, 1, 1] : [0, 0, 0, alphaOutside]);

  it('lets light through on a smooth ramp from just below Threshold up to white (model reference)', () => {
    // Threshold 0.8, Softness 0.5: the ramp starts at 0.8 - 0.5 * min(0.8, 0.2) = 0.7 and ends at white.
    const ramp = (peak: number) => { const t = Math.min(1, Math.max(0, (peak - 0.7) / 0.3)); return t * t * (3 - 2 * t); };
    for (const peak of [0.3, 0.7, 0.75, 0.85, 0.95, 1, 1.4]) expect(glowContribution(peak, 0.8, 0.5)).toBeCloseTo(ramp(peak), 9);
    // Threshold 0.3: the ramp starts at 0.3 - 0.5 * 0.3 = 0.15, so a mid grey glows partly.
    expect(glowContribution(0.5, 0.3, 0.5)).toBeCloseTo(((0.35 / 0.85) ** 2) * (3 - 2 * 0.35 / 0.85), 9);
    // At or above white only brighter (HDR) values glow.
    expect(glowContribution(1, 1.2, 0.5)).toBe(0);
    expect(glowContribution(1.3, 1.2, 0.5)).toBe(1);
  });

  it('leaves pictures below the threshold untouched', () => {
    const out = render('glow', { threshold: 0.8, softness: 0.2 }, width, height, (x, y) => [0.3, 0.4 * x / width, 0.5 * y / height, 1]);
    for (let y = 0; y < height; y += 7) for (let x = 0; x < width; x += 9) {
      expect(at(out, width, x, y)[0]).toBeCloseTo(0.3, 2);
    }
  });

  it('spreads a light into a smooth, round halo whose reach grows with Radius', () => {
    const reach = (radius: number) => {
      const out = render('glow', { radius, amount: 2 }, width, height, dot());
      const ray = Array.from({ length: 30 }, (_, step) => at(out, width, 66 + step, 35)[0]);
      for (let index = 1; index < ray.length; index++) expect(ray[index]).toBeLessThanOrEqual(ray[index - 1] + 1 / 255);
      // Left/right and up/down agree (no ring or grid pattern).
      expect(Math.abs(at(out, width, 70, 35)[0] - at(out, width, 57, 35)[0])).toBeLessThan(3 / 255);
      expect(Math.abs(at(out, width, 63, 42)[0] - at(out, width, 63, 29)[0])).toBeLessThan(3 / 255);
      return ray.findIndex(value => value < 4 / 255);
    };
    const tight = reach(40), wide = reach(300);
    expect(wide === -1 || wide > tight).toBe(true);
    expect(tight).toBeGreaterThan(1);
  });

  it('screens the glow on: a mid-bright saturated sky stays its colour, and strong glows never clip', () => {
    const hue = ([r, g, b]: readonly number[]) => { const max = Math.max(r, g, b), d = max - Math.min(r, g, b); return 60 * (max === b ? 4 + (r - g) / d : max === g ? 2 + (b - r) / d : (g - b) / d); };
    // A whole frame of sky is the worst case: every neighbour adds its light.
    // At the defaults a mid-bright daylight sky (brightest channel 0.78) stays out of the glow entirely.
    const sky: Pixel = [0.3, 0.53, 0.78, 1], calm = at(render('glow', {}, 32, 18, () => sky), 32, 16, 9);
    for (let channel = 0; channel < 3; channel++) expect(Math.abs(calm[channel] - sky[channel])).toBeLessThan(2 / 255);
    // With a low Threshold that lets the whole sky glow, a moderate glow keeps its hue (a strong one washes towards white).
    const lifted = at(render('glow', { threshold: 0.6, amount: 0.25 }, 32, 18, () => sky), 32, 16, 9);
    expect(lifted[2]).toBeGreaterThan(sky[2] + 0.02);
    expect(Math.abs(hue(lifted) - hue(sky))).toBeLessThan(4);
    const neon: Pixel = [0.81, 0.09, 0.73, 1];
    const strong = at(render('glow', { amount: 2, threshold: 0.2 }, 32, 18, () => neon), 32, 16, 9);
    expect(strong[0]).toBeLessThan(1);
    // Screen: 1 - (1 - picture) * exp(-glow) keeps the darkest channel well below white.
    expect(strong[1]).toBeLessThan(0.6);
    expect(strong[0] - strong[1]).toBeGreaterThan(0.35);
  });

  it('looks the same at a reduced preview size: a tight glow stays tight, a wide one keeps its reach', () => {
    /** Glow over a disc of 0.06 h at 0.12 h from its centre, at frame height h. */
    const halo = (radius: number, h: number) => {
      const w = h * 16 / 9, disc = (x: number, y: number): Pixel => (Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) < 0.06 * h ? [1, 1, 1, 1] : [0, 0, 0, 1]);
      return at(render('glow', { radius, amount: 2 }, w, h, disc), w, Math.round(w / 2 + 0.12 * h), h / 2)[0];
    };
    expect(halo(4, 54)).toBeLessThan(2 / 255);
    expect(halo(4, 108)).toBeLessThan(2 / 255);
    expect(Math.abs(halo(300, 54) - halo(300, 108))).toBeLessThan(0.03);
    // The level weights follow 1080p: at half size level 0 stands for 1080p level 1.
    expect(glowLevelWeights(40, 540)[0]).toBeCloseTo(1, 6);
    expect(glowLevelWeights(40, 1080)[0]).toBe(0);
    expect(glowLevelWeights(40, 2160).slice(0, 2)).toEqual([0, 0]);
  });

  it('has no dead nodes: every card of the recipe feeds the output (no dangling folder ports)', () => {
    const graph = createStylizeRecipeGraph('glow');
    const reached = new Set(['output']), queue = ['output'];
    while (queue.length) {
      const id = queue.pop()!;
      for (const edge of graph.edges) if (edge.to === id && !reached.has(edge.from)) { reached.add(edge.from); queue.push(edge.from); }
    }
    const bound = new Set(graph.nodes.filter(node => Object.keys(node.bindings ?? {}).length).map(node => node.id));
    expect(graph.nodes.map(node => node.id).filter(id => !reached.has(id) && !bound.has(id))).toEqual([]);
  });

  it('tints the halo with Color and carries it onto transparent surroundings', () => {
    const out = render('glow', { amount: 3, radius: 300, color: '#ff0000' }, width, height, dot(0, 6));
    const halo = at(out, width, 71, 35);
    expect(halo[3]).toBeGreaterThan(0.02);
    expect(halo[0]).toBeGreaterThan(0.9);
    expect(halo[1] + halo[2]).toBeLessThan(0.05);
    expect(at(out, width, 63, 35)).toEqual([1, 1, 1, 1]);
  });
});

describe('Threshold and Posterize Softness', () => {
  const ramp = (type: 'threshold' | 'posterize', params: Record<string, unknown>) => {
    const compiled = plan(type, params);
    return Array.from({ length: 401 }, (_, index) => evaluateImageOperatorPlan(compiled, [index / 400, index / 400, index / 400, 0.7])[0]);
  };

  it('turns the hard Threshold step into a smooth ramp of that brightness width around Level', () => {
    const soft = ramp('threshold', { level: 0.5, softness: 0.2 });
    expect(soft[150]).toBe(0); expect(soft[250]).toBe(1); expect(soft[160]).toBeCloseTo(0, 9); expect(soft[200]).toBeCloseTo(0.5, 6);
    for (let index = 1; index < soft.length; index++) {
      expect(soft[index]).toBeGreaterThanOrEqual(soft[index - 1]);
      expect(soft[index] - soft[index - 1]).toBeLessThan(0.04);
    }
  });

  it('matches the model references of Threshold and Posterize', () => {
    const threshold = ramp('threshold', { level: 0.4, softness: 0.1 }), posterize = ramp('posterize', { levels: 5, softness: 0.3 });
    threshold.forEach((value, index) => expect(value).toBeCloseTo(thresholdValue(index / 400, 0.4, 0.1), 6));
    posterize.forEach((value, index) => expect(value).toBeCloseTo(posterizeValue(index / 400, 5, 0.3), 6));
  });

  it('Posterize Brightness Only steps the brightest channel and keeps hue and saturation (no false colours)', () => {
    const compiled = plan('posterize', { levels: 5, brightnessOnly: true });
    for (const pixel of [[0.78, 0.76, 0.82, 1], [0.8, 0.3, 0.1, 0.5], [0.05, 0.2, 0.6, 1]] as Pixel[]) {
      const out = evaluateImageOperatorPlan(compiled, pixel), peak = Math.max(...pixel.slice(0, 3));
      const expected = Math.floor(peak * 5) / 4;
      for (let channel = 0; channel < 3; channel++) expect(out[channel]).toBeCloseTo(pixel[channel] * expected / peak, 6);
      expect(out[3]).toBe(pixel[3]);
    }
    // Off, it is the per-channel staircase: the light cloud splits into lavender.
    const perChannel = evaluateImageOperatorPlan(plan('posterize', { levels: 5 }), [0.78, 0.76, 0.82, 1]);
    expect(perChannel[2] - perChannel[0]).toBeGreaterThan(0.2);
  });

  it('rounds every Posterize step into a continuous ramp and keeps the levels in between', () => {
    const levels = 4, soft = ramp('posterize', { levels, softness: 0.5 });
    for (let index = 1; index < soft.length; index++) {
      expect(soft[index]).toBeGreaterThanOrEqual(soft[index - 1] - 1e-9);
      expect(soft[index] - soft[index - 1]).toBeLessThan(0.05);
    }
    // Inside a band (away from its edges) the value is exactly that level: floor(v * L) / (L - 1).
    expect(soft[Math.round(400 * 0.375)]).toBeCloseTo(1 / 3, 6);
    expect(soft[Math.round(400 * 0.625)]).toBeCloseTo(2 / 3, 6);
    expect(Math.max(...soft)).toBeLessThanOrEqual(1);
  });
});
