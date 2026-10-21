import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { acuarelaParamWarnings } from '../../src/effects/stylize/acuarela/warnings';
import { createDefaultAcuarelaGraph } from '../../src/services/operators/acuarelaWatercolorGraph';
import { createLegacyAcuarelaGraph, hasLegacyAcuarelaParams } from '../../src/services/operators/acuarelaEffectGraph';
import { withLegacyAcuarelaGraph } from '../../src/services/operators/acuarelaIdentity';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { effectParamDefinitions } from '../../src/services/operators/effectParamVisibility';
import { isNeutralEffect } from '../../src/services/operators/neutralEffects';
import { IMAGE_EFFECT_GRAPH_LIMITS } from '../../src/services/operators/effectGraphLimits';
import { EFFECT_GRAPH_PARAM } from '../../src/services/operators/effectGraph';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import { applyWorkerSoftwareImageGraphs } from '../../src/services/render/workerSoftwareImageGraphs';
import type { Effect } from '../../src/types/effects';
import type { Layer } from '../../src/types/layers';
import { applyLookToClip } from '../../src/effects/looks/applyLook';
import { useTimelineStore } from '../../src/stores/timeline';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { createMockClip, createMockTrack } from '../helpers/mockData';

type Rgba = [number, number, number, number];
const watercolour = (overrides: Record<string, number> = {}) => ({ ...getDefaultParams('acuarela'), ...overrides }) as Record<string, number | string | boolean>;
const SMOKE = { opacity: 1, gain: 0.01, speed: 4, detail: 4, strength: 0.32, density: 4, gainX: 0.3, gainY: 0.3, reset: false, historyLoop: 'reset' };
/** Only the pigment wash: no pooling, tones, shadow pigment, granulation, blooms, paper light or lift. */
const PLAIN = { edges: 0, simplify: 0, shadows: 0, granulation: 0, blooms: 0, paper: 0, lift: 0 };
const plan = (params: Record<string, unknown>) => compileImageOperatorGraph(createDefaultAcuarelaGraph(), params, {});
const layer = (effect: Effect): Layer => ({ id: 'layer', name: 'Layer', visible: true, opacity: 1, blendMode: 'normal', source: { type: 'solid' },
  position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, effects: [effect] } as Layer);
const effect = (params: Record<string, unknown>): Effect => ({ id: 'water', type: 'acuarela', name: 'Acuarela', enabled: true, params } as Effect);

/** 1920 x 1080 frame: dark grey (0.2) left of x = 960 px, light grey (0.8) right of it, opaque. */
const step = ([u]: [number, number]): Rgba => u < 0.5 ? [0.2, 0.2, 0.2, 1] : [0.8, 0.8, 0.8, 1];

describe('Acuarela watercolour recipe', () => {
  it('runs as four passes without frame history, within the graph limits', () => {
    const graph = createDefaultAcuarelaGraph();
    const compiled = plan(watercolour());
    expect(compiled.passes?.map(pass => pass.outputResource ?? 'output')).toEqual(['image-resource:source-cache:image', 'image-resource:wash-first-cache:image',
      'image-resource:wash-cache:image', 'output']);
    expect(compiled.frameHistoryResource).toBeUndefined();
    expect(graph.nodes.some(node => node.operator === 'image.frame-history')).toBe(false);
    expect(graph.nodes.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.nodes);
    expect(graph.edges.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.edges);
    for (const id of ['wash', 'bleed', 'edges', 'simplify', 'blooms', 'shadows', 'granulation', 'paper', 'grainSize', 'lift', 'flow', 'opacity']) {
      expect(graph.nodes.some(node => node.bindings.value === id), id).toBe(true);
    }
  });

  it('shows the recipe in pipeline-ordered folders without dropping any to a cycle', () => {
    const organized = effectOperatorGraph(effect(watercolour()), { inspectionOnly: true });
    expect((organized.groups ?? []).map(group => group.label)).toEqual(expect.arrayContaining(['Premultiplied Source (cached)',
      'Frame & Paper Coordinates', 'Wet Patches & Bleed', 'Pigment Wash (edge-aware, cached)', 'Second Wash & Wet Bleeding (cached)', 'Edge Pooling',
      'Simplify (tones)', 'Shadow Pigment', 'Paper & Granulation', 'Blooms', 'Pigment Density', 'Paper Light, Lift & Mix']));
  });

  it('keeps a flat opaque colour exactly when only the wash acts (any wash, bleed and flow)', () => {
    const data = new Uint8ClampedArray(24 * 16 * 4);
    for (let index = 0; index < data.length; index += 4) data.set([51, 153, 204, 255], index);
    applyWorkerSoftwareImageGraphs(data, 24, 16, [plan(watercolour({ ...PLAIN, wash: 6, bleed: 20, flow: 1 }))], 2.5);
    for (let index = 0; index < data.length; index += 4) expect([...data.subarray(index, index + 4)]).toEqual([51, 153, 204, 255]);
  });

  it('keeps a hard border in the edge-aware wash where a plain Gaussian blur would mix it', () => {
    const wash = plan(watercolour({ ...PLAIN, wash: 3, bleed: 0 })).passes![1].program;
    const pixel = (x: number): Rgba => evaluateImageOperatorPlan(wash, [0, 0, 0, 0], { uv: [(x + 0.5) / 1920, 0.5], resolution: [1920, 1080],
      timelineTimeSeconds: 0, sampleImage: step, sampleResource: (_id, uv) => step(uv) }) as Rgba;
    // Sigma 3 px: a Gaussian blur gives the pixel one texel left of the border sum_{k>=1} g(k)/sum g(k) of light (about 0.37).
    const gaussianLightShare = [...Array(13).keys()].map(k => k + 1).reduce((sum, k) => sum + Math.exp(-k * k / 18), 0)
      / [...Array(27).keys()].map(k => k - 13).reduce((sum, k) => sum + Math.exp(-k * k / 18), 0);
    expect(0.2 + 0.6 * gaussianLightShare).toBeGreaterThan(0.4);
    expect(pixel(958)[0]).toBeCloseTo(0.2, 6);
    expect(pixel(961)[0]).toBeCloseTo(0.8, 6);
  });

  it('pools pigment on the dark side of a wash border with the documented density model', () => {
    const final = plan(watercolour({ ...PLAIN, edges: 1, bleed: 0 })).passes![3].program;
    const pixel = (x: number): Rgba => evaluateImageOperatorPlan(final, [0, 0, 0, 0], { uv: [(x + 0.5) / 1920, 0.5], resolution: [1920, 1080],
      timelineTimeSeconds: 0, sampleImage: step, sampleResource: (_id, uv) => step(uv) }) as Rgba;
    // One pixel left of the border: the four reads 2 px away see one light value, mean luminance 0.35.
    // pool = clamp((0.35 - 0.2) * 6, -1, 1) = 0.9, d = 1 + 1.5 * 0.9 = 2.35, C' = C - (C - C^2)(d - 1) < 0 -> 0.
    expect(pixel(959)[0]).toBeCloseTo(0, 6);
    // One pixel right of it: mean 0.65, pool = -0.9, d = 1 - 0.25 * 0.9 = 0.775, C' = 0.8 + 0.16 * 0.225 = 0.836.
    expect(pixel(960)[0]).toBeCloseTo(0.836, 5);
    // Far from the border nothing changes; white paper and black stay put at any density.
    expect(pixel(400)[0]).toBeCloseTo(0.2, 6);
    expect(pixel(1500)[0]).toBeCloseTo(0.8, 6);
    expect(pixel(959)[3]).toBe(1);
  });

  it('never produces NaN or out-of-range colour for extreme values', () => {
    const extreme = plan(watercolour({ wash: -3, bleed: -5, edges: 40, granulation: -9, paper: 50, blooms: 30, lift: -2, opacity: 4, grainSize: 0, flow: -3 }));
    const data = new Uint8ClampedArray(20 * 12 * 4);
    for (let index = 0; index < data.length; index += 4) data.set([index % 255, (index * 3) % 255, 90, index % 8 ? 255 : 0], index);
    applyWorkerSoftwareImageGraphs(data, 20, 12, [extreme], 1.25);
    expect([...data].every(value => Number.isFinite(value))).toBe(true);
  });

  it('reports clamped and special values by parameter id, and nothing for the smoke recipe', () => {
    expect(acuarelaParamWarnings(watercolour())).toEqual([]);
    expect(acuarelaParamWarnings(watercolour({ wash: -1, bleed: -2, grainSize: 0.1, lift: 1.5, opacity: -0.5 }))).toEqual([
      'wash: -1 is below 0; it renders as 0 (no wash).', 'bleed: -2 is below 0; it renders as 0 (no bleeding).',
      'grainSize: 0.1 is below 0.25; it renders as 0.25 (the finest grain).', 'opacity: -0.5 is outside 0-1; it is clamped to 0.',
      'lift: 1.5 is outside 0-1; it is clamped to 1.']);
    expect(acuarelaParamWarnings(watercolour({ wash: 20 }))[0]).toMatch(/^wash: above 12 px/);
    expect(acuarelaParamWarnings(watercolour({ edges: -1, granulation: 3, simplify: 2 }))).toEqual([
      'simplify: 2 is outside 0-1; it is clamped to 1.', 'edges: -1 is below 0 and lightens the pooled side of every edge.',
      'granulation: 3 is above the 0-2 range; the effect is exaggerated.']);
    // Edges 2, Granulation 2 and Blooms 2 can reach 1 + 3 + 1.68 + 1.1 = 6.78, above the density cap of 4.
    expect(acuarelaParamWarnings(watercolour({ edges: 2, granulation: 2, blooms: 2 })).at(-1)).toMatch(/^density: .* 6\.78; it is clamped to 4/);
    // Saved smoke-recipe effects get the smoke notes (their Gain is clamped to 0-1).
    expect(acuarelaParamWarnings({ ...SMOKE, strength: 9 })).toEqual([]);
    expect(acuarelaParamWarnings({ ...SMOKE, gain: 3 })).toEqual(['gain: 3 is outside 0-1; it is clamped to 1.']);
  });
});

describe('Acuarela saved with the watery-smoke recipe', () => {
  it('recognizes graph-less smoke effects by their parameters', () => {
    expect(hasLegacyAcuarelaParams(SMOKE)).toBe(true);
    expect(hasLegacyAcuarelaParams(watercolour())).toBe(false);
    expect(hasLegacyAcuarelaParams({})).toBe(false);
    expect(hasLegacyAcuarelaParams({ strength: 0.5, wash: 2 })).toBe(false);
  });

  it('renders graph-less smoke effects with the smoke recipe and fresh effects as watercolour', () => {
    const history = (graph: { nodes: { operator: string }[] }) => graph.nodes.some(node => node.operator === 'image.frame-history');
    expect(history(effectOperatorGraph(effect(SMOKE)))).toBe(true);
    expect(history(effectOperatorGraph(effect(watercolour())))).toBe(false);
    // Loading a project stores the resolved graph, so the smoke look is kept from then on.
    const migrated = migratePersistedEffectOperatorGraph(effect(SMOKE));
    expect(history(migrated.operatorGraph!)).toBe(true);
    expect(migrated.params).toEqual(SMOKE);
  });

  it('shows each recipe its own controls', () => {
    const visible = (owner: Effect) => Object.entries(effectParamDefinitions(owner)).filter(([, definition]) => !definition.hidden).map(([id]) => id);
    const smoke = visible(migratePersistedEffectOperatorGraph(effect(SMOKE)));
    expect(smoke).toEqual(expect.arrayContaining(['opacity', 'strength', 'speed', 'gainX', 'historyLoop', 'reset']));
    expect(smoke).not.toContain('wash');
    const paint = visible(effect(watercolour()));
    expect(paint).toEqual(expect.arrayContaining(['opacity', 'wash', 'bleed', 'edges', 'blooms', 'granulation', 'paper', 'grainSize', 'lift', 'flow']));
    expect(paint).not.toEqual(expect.arrayContaining(['strength']));
    expect(paint).not.toContain('historyLoop');
  });

  it('keeps custom Looks with the smoke Acuarela on the smoke recipe after defaults are filled in', () => {
    const lookParams = withLegacyAcuarelaGraph('acuarela', SMOKE);
    const instantiated = effect({ ...getDefaultParams('acuarela'), ...lookParams });
    expect(effectOperatorGraph(instantiated).nodes.some(node => node.operator === 'image.frame-history')).toBe(true);
    expect(JSON.parse(String(lookParams[EFFECT_GRAPH_PARAM]))).toEqual(createLegacyAcuarelaGraph());
    expect(withLegacyAcuarelaGraph('acuarela', watercolour())).not.toHaveProperty(EFFECT_GRAPH_PARAM);
    expect(withLegacyAcuarelaGraph('glow', SMOKE)).toBe(SMOKE);
  });

  it('moves a smoke Look graph into the effect graph when the Look is applied', () => {
    const clip = createMockClip({ id: 'smoke-look-clip' });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    applyLookToClip({ id: 'old-smoke', name: 'Old', category: 'editorial', tags: [], builtIn: false, thumbnail: { kind: 'generated' },
      stack: [{ effectId: 'acuarela', enabled: true, params: { ...SMOKE } }] }, clip.id);
    const applied = useTimelineStore.getState().clips[0].effects[0];
    expect(applied.params).not.toHaveProperty(EFFECT_GRAPH_PARAM);
    expect(applied.operatorGraph?.nodes.some(node => node.operator === 'image.frame-history')).toBe(true);
    expect(applied.params).toMatchObject({ strength: 0.32, gain: 0.01 });
  });

  it('names the watercolour ports only on the watercolour recipe, not on saved smoke graphs', () => {
    const clip = createMockClip({ id: 'labels-clip' });
    const label = (owner: Effect, id: string) => buildEffectOperatorGraph(clip, owner).nodes.find(node => node.id === id)?.outputs[0]?.label;
    expect(label(effect(watercolour()), 'density')).toBe('Pigment Density');
    const smoke = migratePersistedEffectOperatorGraph(effect(SMOKE));
    expect(smoke.operatorGraph!.nodes.some(node => node.id === 'density')).toBe(true);
    expect(label(smoke, 'density')).not.toBe('Pigment Density');
  });

  it('runs the smoke recipe on the worker CPU and leaves the watercolour to the GPU fallback', () => {
    const smoke = workerSoftwareEffectPlanForLayer(layer(effect(SMOKE)))!;
    expect(smoke.pixelEffects.acuarelaAdjustments).toHaveLength(1);
    // Stored smoke graphs keep running as graph plans with their history.
    expect(workerSoftwareEffectPlanForLayer(layer(migratePersistedEffectOperatorGraph(effect(SMOKE))))?.pixelEffects.imageOperatorPlans).toHaveLength(1);
    // The watercolour is unsupported in software (minutes per frame), fresh or stored: the frame falls back to the GPU renderer.
    expect(workerSoftwareEffectPlanForLayer(layer(effect(watercolour())))).toBeNull();
    expect(workerSoftwareEffectPlanForLayer(layer(migratePersistedEffectOperatorGraph(effect(watercolour()))))).toBeNull();
  });

  it('skips the watercolour at Mix 0 but never the smoke recipe, whose history keeps running', () => {
    expect(isNeutralEffect(effect(watercolour({ opacity: 0 })), 1920, 1080)).toBe(true);
    expect(isNeutralEffect(effect(watercolour({ opacity: 0.01 })), 1920, 1080)).toBe(false);
    expect(isNeutralEffect(effect({ ...SMOKE, opacity: 0 }), 1920, 1080)).toBe(false);
  });
});
