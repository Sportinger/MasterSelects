import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { acuarelaParamWarnings } from '../../src/effects/stylize/acuarela/warnings';
import { createAcuarelaGraphBefore20261022, createDefaultAcuarelaGraph } from '../../src/services/operators/acuarelaWatercolorGraph';
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

  it('pools pigment on the dark side of a wash border as a soft gradient with the documented density model', () => {
    const final = plan(watercolour({ ...PLAIN, edges: 1, bleed: 0 })).passes![3].program;
    const pixel = (x: number): Rgba => evaluateImageOperatorPlan(final, [0, 0, 0, 0], { uv: [(x + 0.5) / 1920, 0.5], resolution: [1920, 1080],
      timelineTimeSeconds: 0, sampleImage: step, sampleResource: (_id, uv) => step(uv) }) as Rgba;
    // Independent reference: Gaussian mean (5 x 5 reads 1.5 px apart, sigma 2 px) of the step's luminance,
    // contrast to the centre, smoothstep(0.005, 0.08), dark side x 1.5 (light side x 0.25), excess eased by
    // 1 - exp(-e) (or exp(e) - 1 below 0), C' = C - (C - C^2) e.
    const smooth = (low: number, high: number, value: number) => { const t = Math.min(Math.max((value - low) / (high - low), 0), 1); return t * t * (3 - 2 * t); };
    const expected = (x: number) => {
      let sum = 0, weights = 0;
      for (let i = -2; i <= 2; i += 1) for (let j = -2; j <= 2; j += 1) {
        const weight = Math.exp(-(i * i + j * j) * 2.25 / 8); weights += weight;
        sum += weight * step([(x + 0.5 + i * 1.5) / 1920, 0.5])[0];
      }
      const centre = step([(x + 0.5) / 1920, 0.5])[0], contrast = sum / weights - centre;
      const e = 1.5 * smooth(0.005, 0.08, contrast) - 0.25 * smooth(0.005, 0.08, -contrast);
      const eased = e >= 0 ? 1 - Math.exp(-e) : Math.exp(e) - 1;
      return centre - (centre - centre * centre) * eased;
    };
    // (x 958 and 961 have a read exactly on the border, where float rounding picks the side.)
    for (const x of [954, 956, 957, 959, 960, 962, 963]) expect(pixel(x)[0], `x ${x}`).toBeCloseTo(expected(x), 5);
    // A gradient a few pixels wide, darkest at the border and never below C^2 (the eased density stays under 2).
    expect(pixel(959)[0]).toBeLessThan(pixel(957)[0]);
    expect(pixel(957)[0]).toBeLessThan(pixel(956)[0]);
    expect(pixel(956)[0]).toBeCloseTo(0.2, 6);
    expect(pixel(959)[0]).toBeGreaterThan(0.2 * 0.2);
    expect(pixel(960)[0]).toBeGreaterThan(0.8);
    // Far from the border nothing changes.
    expect(pixel(400)[0]).toBeCloseTo(0.2, 6);
    expect(pixel(1500)[0]).toBeCloseTo(0.8, 6);
    expect(pixel(959)[3]).toBe(1);
  });

  it('paints a thin dark line as a deeper tint of its own colour, never below the Lift floor or black', () => {
    // A 3 px line (x 958-960) on light paper at 1920 x 1080; the final pass reads the frame as its wash.
    const paperColour: Rgba = [0.85, 0.82, 0.78, 1];
    const hue = ([r, g, b]: readonly number[]) => {
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const line of [[0.45, 0.3, 0.2, 1], [0.2, 0.35, 0.6, 1]] as Rgba[]) {
      const frame = ([u]: [number, number]): Rgba => { const x = u * 1920; return x >= 958 && x < 961 ? line : paperColour; };
      const centre = (params: Record<string, number>) => evaluateImageOperatorPlan(plan(watercolour(params)).passes![3].program, [0, 0, 0, 0], {
        uv: [959.5 / 1920, 0.5], resolution: [1920, 1080], timelineTimeSeconds: 0, sampleImage: frame, sampleResource: (_id, uv) => frame(uv) }) as Rgba;
      // Defaults: every channel stays at or above the Lift floor (Lift 0.1 lets 8 % white paper through).
      const painted = centre({});
      for (const channel of painted.slice(0, 3)) expect(channel).toBeGreaterThanOrEqual(0.08 - 1e-6);
      // Pigment only (no Shadow Pigment, no Lift): darker than the line but not below C^2, the same hue.
      const pigment = centre({ shadows: 0, lift: 0, simplify: 0, paper: 0 });
      for (let channel = 0; channel < 3; channel += 1) {
        expect(pigment[channel]).toBeLessThanOrEqual(line[channel] + 1e-6);
        expect(pigment[channel]).toBeGreaterThanOrEqual(line[channel] * line[channel] - 1e-6);
      }
      expect(Math.abs(hue(pigment) - hue(line))).toBeLessThan(8);
    }
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
    // The pigment density eases inside 0..2 instead of clamping, so even the largest values need no note.
    expect(acuarelaParamWarnings(watercolour({ edges: 2, granulation: 2, blooms: 2 }))).toEqual([]);
    // Above 16 px the wobble of the read position stays at its 12 px cap.
    expect(acuarelaParamWarnings(watercolour({ bleed: 16 }))).toEqual([]);
    expect(acuarelaParamWarnings(watercolour({ bleed: 25 }))).toEqual(['bleed: above 16 px the wobble stays at 12 px; higher values only widen the wet bleeding.']);
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
      stack: [{ effectId: 'acuarela', enabled: true, params: { ...SMOKE, gain: 3 } }] }, clip.id);
    const applied = useTimelineStore.getState().clips[0].effects[0];
    expect(applied.params).not.toHaveProperty(EFFECT_GRAPH_PARAM);
    expect(applied.operatorGraph?.nodes.some(node => node.operator === 'image.frame-history')).toBe(true);
    expect(applied.params).toMatchObject({ strength: 0.32, gain: 3 });
    // The watercolour defaults addClipEffect filled in are gone, so the smoke notes (and the worker CPU pass) apply.
    expect(applied.params).not.toHaveProperty('wash');
    expect(acuarelaParamWarnings(applied.params as Record<string, number | string | boolean>)).toEqual(['gain: 3 is outside 0-1; it is clamped to 1.']);
    expect(workerSoftwareEffectPlanForLayer(layer(applied))?.pixelEffects.imageOperatorPlans).toHaveLength(1);
  });

  it('names the watercolour ports only on the watercolour recipe, not on saved smoke graphs', () => {
    const clip = createMockClip({ id: 'labels-clip' });
    const label = (owner: Effect, id: string) => buildEffectOperatorGraph(clip, owner).nodes.find(node => node.id === id)?.outputs[0]?.label;
    expect(label(effect(watercolour()), 'density-painted')).toBe('Painted Colour');
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

  it('has no dead nodes: every card of the recipe feeds the output (no dangling folder ports)', () => {
    const graph = createDefaultAcuarelaGraph();
    const reached = new Set(['output']), queue = ['output'];
    while (queue.length) {
      const id = queue.pop()!;
      for (const edge of graph.edges) if (edge.to === id && !reached.has(edge.from)) { reached.add(edge.from); queue.push(edge.from); }
    }
    const bound = new Set(graph.nodes.filter(node => Object.keys(node.bindings ?? {}).length).map(node => node.id));
    expect(graph.nodes.map(node => node.id).filter(id => !reached.has(id) && !bound.has(id))).toEqual([]);
  });

  it('still counts untouched copies saved before 2026-10-22 (with the unused density card) as the built-in recipe', () => {
    const before = createAcuarelaGraphBefore20261022();
    expect(before.nodes.some(node => node.id === 'density')).toBe(true);
    const saved = (graph: typeof before): Effect => ({ ...effect(watercolour({ opacity: 0 })), operatorGraph: graph });
    expect(isNeutralEffect(saved(before), 1920, 1080)).toBe(true);
    expect(isNeutralEffect(saved(createDefaultAcuarelaGraph()), 1920, 1080)).toBe(true);
    const edited = { ...before, nodes: before.nodes.filter(node => node.id !== 'bloom-density') };
    expect(isNeutralEffect(saved(edited), 1920, 1080)).toBe(false);
    // Same pixels: the dropped card fed nothing.
    const paint = (graph: typeof before) => {
      const data = new Uint8ClampedArray(12 * 8 * 4);
      for (let index = 0; index < data.length; index += 4) data.set([index % 251, 90, 200 - (index % 97), 255], index);
      applyWorkerSoftwareImageGraphs(data, 12, 8, [compileImageOperatorGraph(graph, watercolour(), {})], 1.5);
      return [...data];
    };
    expect(paint(createDefaultAcuarelaGraph())).toEqual(paint(before));
  });

  it('loads an untouched copy saved before 2026-10-22 as the current recipe, so it keeps its stage folders', () => {
    const before = createAcuarelaGraphBefore20261022();
    const folders = (graph: typeof before) => (effectOperatorGraph({ ...effect(watercolour()), operatorGraph: graph }, { inspectionOnly: true }).groups ?? []).length;
    const current = folders(createDefaultAcuarelaGraph());
    expect(current).toBeGreaterThan(10);
    expect(folders(before)).toBe(current);
    const constant = before.nodes.find(node => node.operator === 'values.number' && typeof node.constants?.value === 'number')!;
    const edited = { ...before, nodes: before.nodes.map(node => node === constant ? { ...node, constants: { ...node.constants, value: Number(node.constants!.value) + 0.5 } } : node) };
    expect(effectOperatorGraph({ ...effect(watercolour()), operatorGraph: edited }, { inspectionOnly: true }).nodes.some(node => node.id === 'density')).toBe(true);
  });

  it('skips the watercolour at Mix 0 but never the smoke recipe, whose history keeps running', () => {
    expect(isNeutralEffect(effect(watercolour({ opacity: 0 })), 1920, 1080)).toBe(true);
    expect(isNeutralEffect(effect(watercolour({ opacity: 0.01 })), 1920, 1080)).toBe(false);
    expect(isNeutralEffect(effect({ ...SMOKE, opacity: 0 }), 1920, 1080)).toBe(false);
  });
});
