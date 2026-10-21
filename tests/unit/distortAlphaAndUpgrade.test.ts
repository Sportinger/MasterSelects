// Distort review: transparency keeps its colour (premultiplied sampling), untouched saved Fisheye
// graphs move to the fixed recipe, and Wave/Twirl/Bulge at zero strength cost nothing.
import { describe, expect, it } from 'vitest';
import { FISHEYE_PARAMS } from '../../src/effects/distort/fisheye/parameters';
import { createDefaultFisheyeGraph } from '../../src/services/operators/fisheyeEffectGraph';
import { STRAIGHT_ALPHA_FISHEYE_FINGERPRINT, upgradeFisheyeGraph } from '../../src/services/operators/fisheyeGraphUpgrade';
import { effectRecipeFingerprint } from '../../src/services/operators/recipeFingerprint';
import { organizeFisheyeGraph } from '../../src/services/operators/fisheyeGraphPresentation';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { packOperatorCompositions, expandOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { isNeutralUvDistortEffect } from '../../src/services/operators/uvDistortIdentity';
import { isNeutralEffect } from '../../src/services/operators/neutralEffects';
import { createDefaultUvDistortGraph } from '../../src/services/operators/uvDistortEffectGraphs';
import { applyWorkerSoftwareSourceResamplingEffects } from '../../src/services/render/workerSoftwareSourceResamplingEffects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

type Pixel = [number, number, number, number];
const ALPHA_FIX_NODES = ['source-premultiplied-split', 'source-premultiplied-alpha', 'source-premultiplied-rgb', 'source-premultiplied',
  'result-split', 'result-alpha', 'coverage-floor', 'result-safe-alpha', 'result-rgb', 'result'];

/** The Fisheye recipe as it shipped before the review: the frame read straight, the average written straight. */
function straightAlphaFisheye(): EffectOperatorGraph {
  const graph = createDefaultFisheyeGraph(), removed = new Set(ALPHA_FIX_NODES);
  graph.nodes = graph.nodes.filter(node => !removed.has(node.id));
  graph.edges = graph.edges.filter(edge => !removed.has(edge.from) && !removed.has(edge.to));
  graph.edges.push({ id: 'legacy-edge-color', from: 'frame', output: 'image', to: 'edge-color', input: 'image' },
    { id: 'legacy-original', from: 'frame', output: 'image', to: 'original-sample', input: 'image' },
    { id: 'legacy-output', from: 'fisheye-image', output: 'image', to: 'output', input: 'image' });
  graph.groups = graph.groups!.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !removed.has(id)) }));
  for (const id of removed) delete graph.layout[id];
  return graph;
}

const fisheyeDefaults = Object.fromEntries(Object.entries(FISHEYE_PARAMS).map(([id, schema]) => [id, schema.default]));

function fisheyePixel(graph: EffectOperatorGraph, params: Record<string, unknown>, uv: [number, number], color: Pixel): number[] {
  const effect = { type: 'fisheye', params: { ...fisheyeDefaults, ...params } as Record<string, number | boolean | string> };
  const plan = compileImageOperatorGraph(graph, effectOperatorParams(effect), effectOperatorCompileContext(effect));
  return evaluateImageOperatorPlan(plan, color, { uv, resolution: [1920, 1080], sampleImage: () => color });
}

describe('Fisheye keeps colour at transparent edges', () => {
  // Lens Radius 0.9 puts the lens rim 0.45 frame heights from the centre; Lens Feather 0.05 fades
  // the last 5 % of it. At 97.5 % of the rim the lens covers half of the pixel.
  const params = { radius: .9, outside: 'transparent', feather: .05, samples: 1 };
  const inFeather: [number, number] = [.5, .5 + .975 * .45];
  const orange: Pixel = [.8, .4, .2, 1];

  it('lowers only alpha in the feathered lens rim (a constant colour stays that colour)', () => {
    const [r, g, b, a] = fisheyePixel(createDefaultFisheyeGraph(), params, inFeather, orange);
    expect(a).toBeCloseTo(.5, 6);
    expect(r).toBeCloseTo(.8, 6); expect(g).toBeCloseTo(.4, 6); expect(b).toBeCloseTo(.2, 6);
    // The straight-alpha recipe scaled the colour as well: a dark rim.
    const legacy = fisheyePixel(straightAlphaFisheye(), params, inFeather, orange);
    expect(legacy[0]).toBeCloseTo(.4, 6);
  });

  it('averages edge samples premultiplied, so partly covered samples do not darken the result', () => {
    const [r, , , a] = fisheyePixel(createDefaultFisheyeGraph(), { ...params, samples: 8 }, inFeather, orange);
    expect(a).toBeGreaterThan(0); expect(a).toBeLessThan(1);
    expect(r).toBeCloseTo(.8, 6);
  });

  it('does the same on the worker CPU path', () => {
    const width = 64, height = 36, data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < data.length; index += 4) data.set([204, 102, 51, 255], index);
    const adjustment = { projection: 'equidistant', strength: 1, fieldOfView: 140, curveBias: 0, radius: .9, zoom: 1, centerX: .5, centerY: .5,
      squeeze: 1, rotation: 0, preserveAspect: true, outside: 'transparent', feather: .3, edgeMode: 'transparent', edgeFeather: .005,
      chromaticAberration: 0, vignette: 0, vignetteSoftness: .25, samples: 4 } as const;
    const y = Math.round((.5 + .85 * .45) * height - .5);
    const pixel = applyWorkerSoftwareSourceResamplingEffects(data, width, height, width / 2, y, { fisheyeAdjustments: [adjustment] } as never)!;
    expect(pixel[3]).toBeGreaterThan(.05); expect(pixel[3]).toBeLessThan(.95);
    expect(pixel[0]).toBeCloseTo(.8, 5); expect(pixel[1]).toBeCloseTo(.4, 5); expect(pixel[2]).toBeCloseTo(.2, 5);
  });
});

describe('saved Fisheye graphs', () => {
  it('recognizes the shipped straight-alpha recipe by its frozen fingerprint, in any presentation', () => {
    const legacy = straightAlphaFisheye();
    expect(effectRecipeFingerprint(legacy)).toBe(STRAIGHT_ALPHA_FISHEYE_FINGERPRINT);
    const presented = packOperatorCompositions(recognizeOperatorCompositions(organizeFisheyeGraph(legacy)));
    expect(effectRecipeFingerprint(JSON.parse(JSON.stringify(presented)))).toBe(STRAIGHT_ALPHA_FISHEYE_FINGERPRINT);
    expect(effectRecipeFingerprint(createDefaultFisheyeGraph())).not.toBe(STRAIGHT_ALPHA_FISHEYE_FINGERPRINT);
  });

  it('moves an untouched saved graph to the premultiplied recipe on load, and keeps edited ones', () => {
    const legacy = straightAlphaFisheye();
    expect(upgradeFisheyeGraph(legacy).nodes.some(node => node.id === 'source-premultiplied')).toBe(true);
    const loaded = migratePersistedEffectOperatorGraph({ id: 'f', name: 'Fisheye', type: 'fisheye', enabled: true, params: { ...fisheyeDefaults },
      operatorGraph: packOperatorCompositions(recognizeOperatorCompositions(organizeFisheyeGraph(legacy))) } as never);
    expect(expandOperatorCompositions(loaded.operatorGraph!).nodes.some(node => node.id === 'source-premultiplied')).toBe(true);

    const edited = straightAlphaFisheye();
    const half = edited.nodes.find(node => node.id === 'half')!; half.constants = { value: .4 };
    expect(upgradeFisheyeGraph(edited)).toBe(edited);
    const bypassed = straightAlphaFisheye(); bypassed.groups![0].bypassed = true;
    expect(upgradeFisheyeGraph(bypassed)).toBe(bypassed);
    expect(effectOperatorGraph({ type: 'fisheye', params: {}, operatorGraph: edited }).nodes.some(node => node.id === 'source-premultiplied')).toBe(false);
  });
});

describe('Wave, Twirl and Bulge at zero strength', () => {
  it('skips the passes for the built-in recipe only', () => {
    expect(isNeutralUvDistortEffect({ type: 'wave', params: { amplitudeX: 0, amplitudeY: 0 } })).toBe(true);
    expect(isNeutralUvDistortEffect({ type: 'wave', params: { amplitudeX: 0, amplitudeY: .001 } })).toBe(false);
    expect(isNeutralUvDistortEffect({ type: 'twirl', params: { amount: 0 } })).toBe(true);
    expect(isNeutralUvDistortEffect({ type: 'twirl', params: { amount: .01 } })).toBe(false);
    expect(isNeutralUvDistortEffect({ type: 'bulge', params: { amount: 1 } })).toBe(true);
    expect(isNeutralUvDistortEffect({ type: 'bulge', params: { amount: 1.6 } })).toBe(false);
    expect(isNeutralUvDistortEffect({ type: 'bulge', params: { amount: Number.NaN } })).toBe(false);
    expect(isNeutralUvDistortEffect({ type: 'bulge', params: { amount: 1 }, operatorGraph: createDefaultUvDistortGraph('bulge') })).toBe(true);
    const edited = createDefaultUvDistortGraph('bulge');
    edited.nodes.find(node => node.id === 'half')!.constants = { value: .25 };
    expect(isNeutralUvDistortEffect({ type: 'bulge', params: { amount: 1 }, operatorGraph: edited })).toBe(false);
    expect(isNeutralUvDistortEffect({ type: 'kaleidoscope', params: { segments: 1 } })).toBe(false);
    // One gate for the pipeline: blurs keep their own rule.
    expect(isNeutralEffect({ type: 'gaussian-blur', params: { radius: 0 } }, 1920, 1080)).toBe(true);
    expect(isNeutralEffect({ type: 'twirl', params: { amount: 0 } }, 1920, 1080)).toBe(true);
  });
});
