import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { effectOperatorGraph, effectOperatorParams, migrateLoadedEffectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { createEarlierPointwiseEffectGraph } from '../../src/services/operators/pointwiseEffectGraphs';
import { createStylizeRecipeGraph, isEarlierStylizeGraph, STYLIZE_RECIPE_EFFECT_TYPES } from '../../src/services/operators/stylizeRecipes';
import { unusedParamWarnings } from '../../src/services/operators/effectParamVisibility';
import { applyWorkerSoftwareImageGraphs, canApplyWorkerSoftwareImageGraphPlan } from '../../src/services/render/workerSoftwareImageGraphs';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { evaluateImagePasses } from '../helpers/imageGraphPasses';

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

  it('reads a step of contrast c as about c * 4 * Strength at every Width and resolution', () => {
    for (const width of [1, 2, 4]) {
      expect(peak(width, 1080)).toBeGreaterThan(0.42);
      expect(peak(width, 1080)).toBeLessThan(0.56);
    }
    expect(Math.abs(peak(2, 540) - peak(2, 1080))).toBeLessThan(0.06);
  });

  it('finds no edges in a flat picture and keeps transparent surroundings transparent', () => {
    const flat = (): Pixel => [0.4, 0.4, 0.4, 1];
    expect(evaluateImageOperatorPlan(plan('edge-detect'), flat(), { uv: [0.5, 0.5], resolution: [320, 180], sampleImage: flat })[0]).toBeLessThan(1e-4);
    const empty = (): Pixel => [0, 0, 0, 0];
    expect(evaluateImageOperatorPlan(plan('edge-detect'), empty(), { uv: [0.5, 0.5], resolution: [320, 180], sampleImage: empty })[3]).toBe(0);
  });
});

describe('Sharpen', () => {
  const width = 48, height = 27;
  const step = (x: number): Pixel => (x < 24 ? [0.2, 0.25, 0.3, 1] : [0.7, 0.75, 0.8, 1]);

  it('crisps a step edge without halos beyond the small overshoot and leaves flat areas alone', () => {
    const out = render('sharpen', { amount: 5, radius: 2 }, width, height, x => step(x));
    const row = Array.from({ length: width }, (_, x) => luma(at(out, width, x, 13)));
    const low = luma(step(0)), high = luma(step(47)), margin = 0.15 * (high - low) + 2 / 255;
    expect(Math.min(...row)).toBeGreaterThanOrEqual(low - margin);
    expect(Math.max(...row)).toBeLessThanOrEqual(high + margin);
    expect(row[23] - row[24]).toBeLessThan(0);
    expect(Math.abs(row[2] - low)).toBeLessThan(2 / 255);
    // Detail is added: the edge is steeper than in the source (two neighbours apart).
    expect(row[25] - row[22]).toBeGreaterThan(high - low - 1 / 255);
  });

  it('keeps a flat colour layer on transparency free of dark or bright fringes', () => {
    const out = render('sharpen', { amount: 3, radius: 1.5 }, width, height, (x, y) => (x > 12 && x < 36 && y > 6 && y < 20 ? [0.9, 0.5, 0.2, 1] : [0, 0, 0, 0]));
    for (let y = 7; y < 20; y++) for (let x = 13; x < 36; x++) {
      const pixel = at(out, width, x, y);
      expect(Math.abs(pixel[0] - 0.9) + Math.abs(pixel[1] - 0.5) + Math.abs(pixel[2] - 0.2)).toBeLessThan(4 / 255);
    }
  });
});

describe('Glow', () => {
  const width = 128, height = 72;
  const dot = (alphaOutside = 1, half = 2) => (x: number, y: number): Pixel => (Math.abs(x - 63.5) < half && Math.abs(y - 35.5) < half ? [1, 1, 1, 1] : [0, 0, 0, alphaOutside]);

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
    const tight = reach(10), wide = reach(150);
    expect(wide === -1 || wide > tight).toBe(true);
    expect(tight).toBeGreaterThan(1);
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
