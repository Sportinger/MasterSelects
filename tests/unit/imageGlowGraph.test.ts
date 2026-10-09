import { describe, expect, it } from 'vitest';
import { createDefaultGlowGraph, createLegacyGlowGraph } from '../../src/services/operators/glowEffectGraph';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType } from '../../src/services/operators/effectGraphOwner';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

type Pixel = [number, number, number, number];
const luma = (pixel: Pixel) => pixel[0] * .2126 + pixel[1] * .7152 + pixel[2] * .0722;
const smoothstep = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
const source = ([u, v]: [number, number]): Pixel => [u * .7 + .1, v * .6 + .15, (u + v) * .25, .17 + u * .4];

// Owner presentation may share literal leaves and add composition folders; computational nodes stay the catalog recipe.
const computationalNodes = (graph: ReturnType<typeof effectOperatorGraph>) => graph.nodes
  .filter(node => !(node.operator.startsWith('values.') && node.constants && !Object.keys(node.bindings).length))
  .toSorted((a, b) => a.id.localeCompare(b.id));

describe('glow image graph', () => {
  it('is a granular single-pass graph with transparent halo coverage with all six stable bindings', () => {
    const graph = createDefaultGlowGraph();
    expect(graph.nodes.length).toBeLessThan(100);
    expect(graph.nodes.filter(item => item.operator === 'image.kernel-rect-reduce')).toHaveLength(1);
    expect(graph.nodes.some(item => item.operator.includes('glow'))).toBe(false);
    expect(Object.fromEntries(graph.nodes.flatMap(item => Object.entries(item.bindings).map(([port, binding]) => [binding, `${item.id}.${port}`])))).toMatchObject({
      amount: 'amount.value', threshold: 'threshold.value', radius: 'radius.value', softness: 'softness.value', rings: 'rings.value', samplesPerRing: 'samples.value',
    });
    const plan = compileImageOperatorGraph(graph, { amount: 5, threshold: .7935, radius: 1, softness: .496, rings: 6.85, samplesPerRing: 17.95 });
    expect(plan.passes).toBeUndefined();
    expect(plan.kernelScopes).toHaveLength(0);
    expect(plan.rectScopes).toHaveLength(1);
    const rectangle = plan.instructions.find(item => item.operation === 'rect-sum');
    expect(rectangle).toBeDefined();
    expect(rectangle?.value).toBe(plan.rectScopes?.[0].id);
    expect(rectangle?.inputs.map(register => plan.instructions[register].nodeId)).toEqual(['rings-count', 'samples-count']);
  });

  it('matches an independent ring-major reference, truncates counts, and extends alpha for the halo', () => {
    const uv: [number, number] = [.43, .57], resolution: [number, number] = [37, 19], center = source(uv);
    const params = { amount: .7, threshold: .38, radius: 2.4, softness: .42, rings: 2.9, samplesPerRing: 4.9 };
    const coordinates: Array<[number, number]> = [];
    const actual = evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultGlowGraph(), params), center, {
      uv, resolution, sampleImage: at => { coordinates.push(at); return source(at); },
    });
    let glow: [number, number, number] = [0, 0, 0], totalWeight = 0;
    for (let ring = 1; ring <= 2; ring++) for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI * 2) / 4 + ring * .5;
      const distance = ((ring * params.radius) * (1 / resolution[0])) * 10;
      const at: [number, number] = [uv[0] + Math.cos(angle) * distance, uv[1] + Math.sin(angle) * distance * resolution[0] / resolution[1]];
      const pixel = source(at), bright = smoothstep(params.threshold - .1, params.threshold + .1, luma(pixel));
      const weight = Math.exp(-((ring / 2) ** 2) / ((2 * (params.softness + .3)) * (params.softness + .3)));
      glow = [glow[0] + pixel[0] * pixel[3] * bright * weight, glow[1] + pixel[1] * pixel[3] * bright * weight, glow[2] + pixel[2] * pixel[3] * bright * weight];
      totalWeight += weight;
    }
    const centerBright = smoothstep(params.threshold - .1, params.threshold + .1, luma(center));
    glow = glow.map((value, channel) => (value + center[channel] * center[3] * centerBright * 2) / (totalWeight + 2)) as [number, number, number];
    const halo = glow.map(value => value * params.amount * 2);
    const alpha = center[3] + Math.max(0, Math.min(1, Math.max(...halo))) * (1 - center[3]);
    const expected = halo.map((value, channel) => Math.max(0, Math.min(1, (center[channel] * center[3] + value) / Math.max(alpha, 1e-6))));
    expect(actual.slice(0, 3)).toEqual(expected.map(value => expect.closeTo(value, 12)));
    expect(actual[3]).toBeCloseTo(alpha, 12);
    expect(coordinates).toHaveLength(8);
    expect(coordinates[0][0]).toBeCloseTo(uv[0] + Math.cos(.5) * (params.radius / resolution[0]) * 10, 14);
    expect(coordinates[0][1]).toBeCloseTo(uv[1] + Math.sin(.5) * (params.radius / resolution[1]) * 10, 14);
  });

  it('adds coverage on transparent pixels and ignores hidden bright RGB', () => {
    const plan = compileImageOperatorGraph(createDefaultGlowGraph(), { amount: 2, threshold: .2, radius: 1, softness: .5, rings: 2, samplesPerRing: 8 });
    const halo = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.5,.5], resolution: [64,64], sampleImage: () => [1,1,1,.5] });
    expect(halo[3]).toBeGreaterThan(0); expect(halo[0]).toBeGreaterThan(0);
    expect(evaluateImageOperatorPlan(plan, [1,1,1,0], { uv: [.5,.5], resolution: [64,64], sampleImage: () => [1,1,1,0] })).toEqual([0,0,0,0]);
  });

  it('upgrades saved canonical and grouped recipes while preserving custom rewiring', () => {
    for (const graph of [createLegacyGlowGraph(), recognizeOperatorCompositions(createLegacyGlowGraph())]) {
      const migrated = effectOperatorGraph({ type: 'glow', params: {}, operatorGraph: graph });
      expect(migrated.nodes.some(n => n.id === 'halo-coverage')).toBe(true);
    }
    const custom = createLegacyGlowGraph();
    custom.edges.find(e => e.to === 'combine' && e.input === 'rgb')!.from = 'center-split';
    custom.edges.find(e => e.to === 'combine' && e.input === 'rgb')!.output = 'rgb';
    expect(effectOperatorGraph({ type: 'glow', params: {}, operatorGraph: custom }).nodes.some(n => n.id === 'halo-coverage')).toBe(false);
  });

  it('uses catalog defaults through the contextual owner without becoming inline-local', () => {
    const effect = { type: 'glow', params: {} };
    expect(isImageGraphEffectType('glow')).toBe(true);
    expect(isLocalImageEffectType('glow')).toBe(false);
    expect(effectOperatorParams(effect)).toMatchObject({ amount: 5, threshold: .7935, radius: 1, softness: .496, rings: 6.85, samplesPerRing: 17.95 });
    const owned = effectOperatorGraph(effect), recipe = createDefaultGlowGraph();
    expect(owned.compositionRules).toBe(2);
    expect(computationalNodes(owned)).toEqual(computationalNodes(recipe));
    expect(effectOperatorGraph({ ...effect, operatorGraph: recipe })).toEqual(owned);
  });
});
