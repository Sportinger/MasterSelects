import { createLegacyAlphaGlowGraph } from '../../src/services/operators/legacyAlphaGlowGraph';
import { describe, expect, it } from 'vitest';
import { createDefaultGlowGraph, createLegacyGlowGraph } from '../../src/services/operators/glowEffectGraph';
import { upgradeGlowGraph } from '../../src/services/operators/glowGraphUpgrade';
import {
  effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType, migratePersistedEffectOperatorGraph,
} from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { expandOperatorCompositions, packOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { PROCESSING_COMPOSITIONS } from '../../src/services/operators/processingCompositions';
import { applyWorkerSoftwareImageGraphs, canApplyWorkerSoftwareImageGraphPlan } from '../../src/services/render/workerSoftwareImageGraphs';
import { applyWorkerSoftwareGlow, prepareWorkerSoftwareGlow } from '../../src/services/render/workerSoftwareGlow';
import { glowQualityNote, glowRingOffsetUv, resolveGlowSampling } from '../../src/effects/stylize/glow/glowSampling';
import type { Effect } from '../../src/types/effects';

type Pixel = [number, number, number, number];
const DEFAULTS = { amount: 5, threshold: .7935, radius: 1, softness: .496, rings: 6.85, samplesPerRing: 17.95 };
const luma = (pixel: Pixel) => pixel[0] * .2126 + pixel[1] * .7152 + pixel[2] * .0722;
const smoothstep = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
/** The resolve pass reads the source only at its own pixel; the passes before it own all source taps. */
const noSourceResampling = (): Pixel => { throw new Error('The ring pass must sample the prefiltered resource, not the source.'); };
const computational = (graph: ReturnType<typeof effectOperatorGraph>) => expandOperatorCompositions(graph).nodes
  .filter(node => !(node.operator.startsWith('values.') && node.constants && !Object.keys(node.bindings).length))
  .map(node => `${node.id}:${node.operator}`).toSorted();

/** Straight-alpha RGBA8 raster: dark opaque card with a thin bright stroke, on transparent black. */
function strokeRaster(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4, inside = x >= 6 && x < width - 6 && y >= 6 && y < height - 6;
    const stroke = inside && (x === 6 || x === 7 || y === 6 || y === 7);
    data.set(stroke ? [40, 255, 255, 255] : inside ? [13, 3, 38, 255] : [0, 0, 0, 0], offset);
  }
  return data;
}

function referenceGlow(source: Uint8ClampedArray, width: number, height: number, params: typeof DEFAULTS) {
  const field = prepareWorkerSoftwareGlow(source, width, height, params);
  const result = new Float64Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) result.set(applyWorkerSoftwareGlow(field, source, x, y), (y * width + x) * 4);
  return result;
}

describe('glow sampling contract', () => {
  it('keeps the iPad defaults and derives an even ring sampling with a matched prefilter', () => {
    const plan = resolveGlowSampling(DEFAULTS);
    expect(plan).toMatchObject({ rings: 6, samplesPerRing: 17, requiredSamplesPerRing: 38, effectiveSamplesPerRing: 38,
      ringStepPx: 10, sampleSpacingPx: 10, prefilterSigmaPx: 5, prefilterTapsPerSide: 8, sampleCapReached: false, prefilterCapReached: false });
    expect(glowQualityNote(plan)).toBeUndefined();
    // The reported flyer settings stay within the smooth range.
    const flyer = resolveGlowSampling({ ...DEFAULTS, radius: 2.4 });
    expect(flyer).toMatchObject({ ringStepPx: 24, prefilterSigmaPx: 12, prefilterTapsPerSide: 19, prefilterCapReached: false });
  });

  it('widens the prefilter instead of leaving gaps when the per-ring sample cap is reached', () => {
    const plan = resolveGlowSampling({ ...DEFAULTS, rings: 20, radius: 1 });
    expect(plan.requiredSamplesPerRing).toBe(126);
    expect(plan.effectiveSamplesPerRing).toBe(64);
    expect(plan.sampleCapReached).toBe(true);
    expect(plan.sampleSpacingPx).toBeCloseTo(10 * (Math.PI * 2 * 20) / 64, 12);
    expect(glowQualityNote(plan)).toMatch(/capped at 64/);
  });

  it('reports a capped prefilter reach and clamped counts instead of degrading silently', () => {
    const wide = resolveGlowSampling({ ...DEFAULTS, radius: 10 });
    expect(wide).toMatchObject({ prefilterSigmaPx: 50, requiredPrefilterTapsPerSide: 76, prefilterTapsPerSide: 32, prefilterCapReached: true });
    expect(glowQualityNote(wide)).toMatch(/±150 px prefilter.*capped at ±63 px/);
    const clamped = resolveGlowSampling({ ...DEFAULTS, rings: 40, samplesPerRing: 2 });
    expect(clamped).toMatchObject({ rings: 32, samplesPerRing: 4, ringsClamped: true, samplesClamped: true });
    expect(glowQualityNote(clamped)).toMatch(/Rings is limited to 1–32; using 32\. Samples\/Ring is limited to 4–64; using 4\./);
  });

  it('converts ring offsets per axis so the glow stays round on a 1080x1920 layer', () => {
    const plan = resolveGlowSampling({ ...DEFAULTS, radius: 2.4 });
    for (let ring = 1; ring <= plan.rings; ring++) for (let sample = 0; sample < plan.effectiveSamplesPerRing; sample++) {
      const [u, v] = glowRingOffsetUv(ring, sample, plan, 1080, 1920);
      expect(Math.hypot(u * 1080, v * 1920)).toBeCloseTo(ring * 24, 9);
    }
  });
});

describe('glow image graph', () => {
  it('compiles to a bright/horizontal pass, a vertical pass and the ring resolve with the six stable bindings', () => {
    const graph = createDefaultGlowGraph();
    expect(Object.fromEntries(graph.nodes.flatMap(item => Object.entries(item.bindings).map(([port, binding]) => [binding, `${item.id}.${port}`])))).toEqual({
      amount: 'amount.value', threshold: 'threshold.value', radius: 'radius.value', softness: 'softness.value', rings: 'rings.value', samplesPerRing: 'samples.value',
    });
    expect(graph.nodes.some(item => item.operator.includes('glow'))).toBe(false);
    const plan = compileImageOperatorGraph(graph, DEFAULTS);
    expect(plan.passes?.map(pass => pass.outputResource ?? 'final')).toEqual([
      'image-resource:horizontal-cache:image', 'image-resource:prefiltered-cache:image', 'final']);
    expect(plan.resources?.every(resource => resource.format === 'rgba16float' && resource.maxEdge === undefined)).toBe(true);
    expect(plan.passes?.[1].inputResources).toEqual(['image-resource:horizontal-cache:image']);
    expect(plan.resourceInputs).toEqual(['image-resource:prefiltered-cache:image']);
    expect(plan.passes?.every(pass => pass.program.rectScopes?.length === 1)).toBe(true);
  });

  it('samples the prefiltered light at isotropic pixel offsets and keeps each ring total weight', () => {
    const params = { ...DEFAULTS, amount: .7, threshold: .38, radius: 2.4, softness: .42, rings: 2.9, samplesPerRing: 4.9 };
    const plan = compileImageOperatorGraph(createDefaultGlowGraph(), params), sampling = resolveGlowSampling(params);
    const uv: [number, number] = [.43, .57], resolution: [number, number] = [108, 192], light: Pixel = [.3, .2, .1, 1];
    const center: Pixel = [.8, .9, .7, 1], coordinates: Array<[number, number]> = [];
    const actual = evaluateImageOperatorPlan(plan, center, { uv, resolution, sampleImage: noSourceResampling,
      sampleResource: (id, at) => { expect(id).toBe('image-resource:prefiltered-cache:image'); coordinates.push(at); return light; } });
    expect(coordinates).toHaveLength(sampling.rings * sampling.effectiveSamplesPerRing);
    expect(sampling.effectiveSamplesPerRing).toBe(13);
    coordinates.forEach((at, index) => {
      const ring = Math.floor(index / 13) + 1;
      expect(Math.hypot((at[0] - uv[0]) * resolution[0], (at[1] - uv[1]) * resolution[1])).toBeCloseTo(ring * 24, 9);
    });
    let weightSum = 0;
    for (let ring = 1; ring <= 2; ring++) weightSum += 4 * Math.exp(-((ring / 2) ** 2) / ((2 * (params.softness + .3)) * (params.softness + .3)));
    const bright = smoothstep(params.threshold - .1, params.threshold + .1, luma(center));
    const expected = [0, 1, 2].map(channel => Math.min(1, center[channel]
      + ((light[channel] * weightSum + center[channel] * bright * 2) / (weightSum + 2)) * params.amount * 2));
    expect(actual.slice(0, 3)).toEqual(expected.map(value => expect.closeTo(value, 12)));
    expect(actual[3]).toBe(1);
  });

  it('carries the halo outside transparent pixels with straight alpha', () => {
    const plan = compileImageOperatorGraph(createDefaultGlowGraph(), { ...DEFAULTS, amount: 1 });
    const light: Pixel = [.05, .1, .2, 1];
    const halo = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.5, .5], resolution: [64, 64], sampleImage: noSourceResampling, sampleResource: () => light });
    const glow = light.slice(0, 3).map(value => value * resolveGlowSampling(DEFAULTS).samplesPerRing);
    expect(halo[3]).toBeGreaterThan(0);
    // Straight color times alpha reproduces the premultiplied light: normal compositing adds it to the background.
    const premultiplied = halo.slice(0, 3).map(value => value * halo[3]);
    expect(premultiplied[2]).toBeCloseTo(halo[3], 12);
    expect(premultiplied[0] / premultiplied[2]).toBeCloseTo(glow[0] / glow[2], 9);
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.5, .5], resolution: [64, 64], sampleImage: noSourceResampling, sampleResource: () => [0, 0, 0, 0] }))
      .toEqual([0, 0, 0, 0]);
  });

  it('matches the independent CPU reference through the software pass runtime on a non-square layer', () => {
    const width = 24, height = 40, params = { ...DEFAULTS, amount: 1.6, threshold: .35, radius: .6 };
    const source = strokeRaster(width, height), expected = referenceGlow(source, width, height, params);
    const plan = compileImageOperatorGraph(createDefaultGlowGraph(), params);
    expect(canApplyWorkerSoftwareImageGraphPlan(plan)).toBe(true);
    const actual = source.slice();
    applyWorkerSoftwareImageGraphs(actual, width, height, [plan], 0);
    let maxDelta = 0;
    actual.forEach((value, index) => { maxDelta = Math.max(maxDelta, Math.abs(value - Math.round(Math.min(1, Math.max(0, expected[index])) * 255))); });
    expect(maxDelta).toBeLessThanOrEqual(1);
  });

  it('renders a smooth, round halo where the legacy sparse rings produced blotches', () => {
    // Opaque black portrait layer with a 2x2 white dot centred at pixel coordinate (31, 61).
    const width = 61, height = 121, params = { ...DEFAULTS, amount: 1, threshold: .3, radius: 1.2, rings: 3, samplesPerRing: 8 };
    const source = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index++) source.set([0, 0, 0, 255], index * 4);
    for (const [x, y] of [[30, 60], [31, 60], [30, 61], [31, 61]]) source.set([255, 255, 255, 255], (y * width + x) * 4);
    const texel = (x: number, y: number): Pixel => {
      const offset = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
      return [source[offset] / 255, source[offset + 1] / 255, source[offset + 2] / 255, source[offset + 3] / 255];
    };
    const sampleImage = ([u, v]: [number, number]): Pixel => {
      const px = u * width - .5, py = v * height - .5, x0 = Math.floor(px), y0 = Math.floor(py), tx = px - x0, ty = py - y0;
      const [a, b, c, d] = [texel(x0, y0), texel(x0 + 1, y0), texel(x0, y0 + 1), texel(x0 + 1, y0 + 1)];
      return a.map((value, channel) => { const top = value + (b[channel] - value) * tx; return top + (c[channel] + (d[channel] - c[channel]) * tx - top) * ty; }) as Pixel;
    };
    const legacyPlan = compileImageOperatorGraph(createLegacyGlowGraph(), params), field = prepareWorkerSoftwareGlow(source, width, height, params);
    const legacyAt = (x: number, y: number) => evaluateImageOperatorPlan(legacyPlan, texel(x, y),
      { uv: [(x + .5) / width, (y + .5) / height], resolution: [width, height], sampleImage })[1];
    const currentAt = (x: number, y: number) => applyWorkerSoftwareGlow(field, source, x, y)[1];
    const variation = (at: (x: number, y: number) => number, radius: number) => {
      const values = Array.from({ length: 72 }, (_, step) => {
        const angle = step / 72 * Math.PI * 2;
        return at(Math.floor(31 + Math.cos(angle) * radius), Math.floor(61 + Math.sin(angle) * radius));
      });
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      expect(mean).toBeGreaterThan(0);
      return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) / mean;
    };
    expect(variation(legacyAt, 12)).toBeGreaterThan(.5);
    expect(variation(currentAt, 12)).toBeLessThan(.1);
    expect(variation(currentAt, 24)).toBeLessThan(.1);
    // Mirror points across the diagonal receive the same glow on this portrait layer (round, not oval).
    const horizontal = currentAt(12, 60), vertical = currentAt(30, 42);
    expect(Math.abs(horizontal - vertical) / horizontal).toBeLessThan(.05);
  });
});

describe('glow graph ownership and migration', () => {
  it('uses catalog defaults through the contextual owner without becoming inline-local', () => {
    const effect = { type: 'glow', params: {} };
    expect(isImageGraphEffectType('glow')).toBe(true);
    expect(isLocalImageEffectType('glow')).toBe(false);
    expect(effectOperatorParams(effect)).toMatchObject(DEFAULTS);
    const owned = effectOperatorGraph(effect);
    expect(computational(owned)).toEqual(computational(createDefaultGlowGraph()));
    expect(effectOperatorGraph({ ...effect, operatorGraph: createDefaultGlowGraph() })).toEqual(owned);
    expect(owned.groups?.map(group => group.label)).toEqual(expect.arrayContaining(['Bright Pass', 'Vertical Prefilter', 'Ring Sampling']));
  });

  it('upgrades untouched saved legacy graphs, including packed and organized ones', () => {
    const legacy = createLegacyGlowGraph();
    expect(computational(upgradeGlowGraph(legacy))).toEqual(computational(createDefaultGlowGraph()));
    const packed = packOperatorCompositions(recognizeOperatorCompositions(legacy));
    expect(packed.nodes.some(node => node.operator === 'color.soft-bright-pass')).toBe(true);
    const saved = { ...packed, effectPresentationRules: 1 as const, groups: [{ id: 'organized-glow-count', label: 'Ring & Sample Counts',
      color: '#6b99bd', nodeIds: ['rings-clamped', 'rings-count'], collapsedByDefault: true }] };
    expect(computational(upgradeGlowGraph(saved))).toEqual(computational(createDefaultGlowGraph()));
    const effect: Effect = { id: 'fx', type: 'glow', name: 'Glow', enabled: true, params: { ...DEFAULTS }, operatorGraph: saved };
    expect(computational(effectOperatorGraph(effect))).toEqual(computational(createDefaultGlowGraph()));
    const persisted = migratePersistedEffectOperatorGraph(effect);
    expect(computational(persisted.operatorGraph!)).toEqual(computational(createDefaultGlowGraph()));
    expect(compileImageOperatorGraph(expandOperatorCompositions(persisted.operatorGraph!), DEFAULTS).passes).toHaveLength(3);
  });

  it('upgrades alpha-aware single-pass graphs while retaining authored modifications', () => {
    const legacy = createLegacyAlphaGlowGraph();
    for (const saved of [legacy, packOperatorCompositions(recognizeOperatorCompositions(legacy))]) {
      expect(computational(upgradeGlowGraph(saved))).toEqual(computational(createDefaultGlowGraph()));
    }
    const edited = createLegacyAlphaGlowGraph();
    edited.nodes.find(node => node.id === 'ten')!.constants = { value: 8 };
    expect(upgradeGlowGraph(edited)).toBe(edited);
  });

  it('keeps edited legacy graphs, bypassed folders and incomplete drafts as authored', () => {
    const edited = createLegacyGlowGraph();
    edited.nodes.find(node => node.id === 'ten')!.constants = { value: 8 };
    expect(upgradeGlowGraph(edited)).toBe(edited);
    const bypassed = { ...createLegacyGlowGraph(), groups: [{ id: 'g', label: 'Weights', color: '#fff', nodeIds: ['ring-weight'], bypassed: true }] };
    expect(upgradeGlowGraph(bypassed)).toBe(bypassed);
    const draft = { ...createLegacyGlowGraph(), incomplete: 'connect output' };
    expect(upgradeGlowGraph(draft)).toBe(draft);
    expect(compileImageOperatorGraph(edited, DEFAULTS).passes).toBeUndefined();
  });

  it('keeps the shared Bright Pass composition stable and reuses it inside the new graph', () => {
    const brightPass = PROCESSING_COMPOSITIONS.find(item => item.id === 'color.soft-bright-pass');
    expect(brightPass?.composition?.graph.nodes.map(node => `${node.id}:${node.operator}`)).toEqual([
      'sample-luma:color.luminance-rec709.image', 'sample-bright:math.smoothstep.scalar', 'bright-sample:math.multiply.image-scalar']);
    expect(recognizeOperatorCompositions(createDefaultGlowGraph()).nodes.some(node => node.operator === 'color.soft-bright-pass')).toBe(true);
  });
});
