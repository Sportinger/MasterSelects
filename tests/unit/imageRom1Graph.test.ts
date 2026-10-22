import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultRom1Graph, createRom1GraphBefore20261022 } from '../../src/services/operators/rom1EffectGraph';
import { upgradeRom1Graph } from '../../src/services/operators/rom1GraphUpgrade';
import { rom1ParamWarnings } from '../../src/effects/stylize/rom1/warnings';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { createSavedRom1GraphBeforeGainKnee } from '../fixtures/rom1GraphBeforeGainKnee';
import { createSavedRom1GraphBefore20261022 } from '../fixtures/rom1GraphBefore20261022';

type Rgba = [number, number, number, number];
const definition = getEffect('rom1')!;
const defaults = Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default]));
const planOf = (graph: EffectOperatorGraph, params: Record<string, unknown>) =>
  compileImageOperatorGraph(graph, { ...defaults, ...params }, { parameterSchema: definition.params, allowFrameHistory: true });
/** Renders `frames` frames of one pixel, each frame's output feeding the next as history. */
function run(graph: EffectOperatorGraph, params: Record<string, unknown>, source: Rgba, history: Rgba, frames = 1) {
  const plan = planOf(graph, params);
  let previous = history;
  for (let frame = 0; frame < frames; frame++) {
    previous = evaluateImageOperatorPlan(plan, source, { uv: [.5, .5], timelineTimeSeconds: 1 + frame / 30,
      sampleImage: () => source, sampleResource: () => previous }) as Rgba;
  }
  return previous;
}
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { IMAGE_EFFECT_GRAPH_LIMITS } from '../../src/services/operators/effectGraphLimits';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';

describe('ROM1 image operator graph', () => {
  it('keeps four explicit noise octaves and separates time from speed gain', () => {
    const graph = createDefaultRom1Graph();
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(graph.nodes.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.nodes);
    expect(graph.edges.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.edges);
    expect(graph.nodes.filter(node => /^octave-\d-time$/.test(node.id))).toHaveLength(4);
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'time', to: 'octave-0-time', input: 'a' }));
    expect(graph.edges.some(edge => edge.from === 'speed' && edge.to.includes('time'))).toBe(false);
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'noise-gain', to: 'gain-noise', input: 'b' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'gain-noise', to: 'offset', input: 'b' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'warped-uv', to: 'warped-parts', input: 'value' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'feedback-uv', to: 'feedback-sample', input: 'uv' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'feedback-alpha-masked', to: 'feedback-premultiplied', input: 'b' }));
  });

  it('masks the feedback alpha at the frame edge and keeps a trail raised above the source alpha', () => {
    const output = run(createDefaultRom1Graph(), { opacity: 1, gain: 0, strength: 0 }, [.2, .3, .4, .4], [.5, .1, .2, .9]);
    // Premultiplied: max(source × alpha, trail × alpha × 0.98), divided back by the larger alpha.
    expect(output[3]).toBeCloseTo(.9 * .98, 12);
    expect(output[0]).toBeCloseTo(.5, 12);
    expect(output[1]).toBeCloseTo(.3 * .4 / (.9 * .98), 12);
    expect(output[2]).toBeCloseTo(.2, 12);
  });

  it('keeps the colour of a trail outside a cut-out layer while its alpha fades', () => {
    const outside: Rgba = [0, 0, 0, 0], trail: Rgba = [.5, .8, .3, 1], params = { opacity: 1, gain: 0, strength: 0 };
    const current = run(createDefaultRom1Graph(), params, outside, trail, 30);
    expect(current[3]).toBeCloseTo(.98 ** 30, 9);
    current.slice(0, 3).forEach((channel, index) => expect(channel).toBeCloseTo(trail[index], 9));
    // The recipe saved before 2026-10-22 faded the straight colour too: the smoke turned dark.
    const before = run(createRom1GraphBefore20261022(), params, outside, trail, 30);
    expect(before[0]).toBeCloseTo(.5 * .98 ** 30, 9);
  });

  it('paints opaque layers exactly as the recipe saved before 2026-10-22', () => {
    for (const [index, params] of [{}, { gain: .4, opacity: .6 }, { strength: 1, speed: 40 }, { gain: 0, opacity: .25 }].entries()) {
      const source: Rgba = [.1 + .2 * index, .7 - .1 * index, .35, 1], history: Rgba = [.9 - .2 * index, .2 + .15 * index, .6, 1];
      const current = run(createDefaultRom1Graph(), params, source, history, 3), before = run(createRom1GraphBefore20261022(), params, source, history, 3);
      current.forEach((channel, channelIndex) => expect(channel).toBeCloseTo(before[channelIndex], 9));
    }
  });

  it('fades the trail by Trail per frame, keeps it below 1 and says so', () => {
    const outside: Rgba = [0, 0, 0, 0], trail: Rgba = [.5, .8, .3, 1], base = { opacity: 1, gain: 0, strength: 0 };
    expect(run(createDefaultRom1Graph(), { ...base, trail: .9 }, outside, trail, 10)[3]).toBeCloseTo(.9 ** 10, 9);
    expect(run(createDefaultRom1Graph(), { ...base, trail: 0 }, outside, trail)[3]).toBe(0);
    expect(run(createDefaultRom1Graph(), { ...base, trail: 1.5 }, outside, trail, 10)[3]).toBeCloseTo(.995 ** 10, 9);
    expect(rom1ParamWarnings({ trail: 1.5 })[0]).toMatch(/^trail: 1.5 is above 0.995; it renders as 0.995/);
    expect(definition.params.trail).toMatchObject({ default: .98, min: 0, max: .995 });
  });

  it('lets every trail fade to nothing on the 8-bit frame history (no grey ghost that never goes)', () => {
    // The history is stored in 8 bits: a fade below half a step rounded back to the same value, so
    // Trail 0.995 stopped at 100 of 255 and the fixed 0.98 of the earlier recipe at 24.
    const quantized = (graph: EffectOperatorGraph, params: Record<string, unknown>, source: Rgba, history: Rgba, frames: number) => {
      const plan = planOf(graph, params);
      let previous = history;
      for (let frame = 0; frame < frames; frame++) {
        const next = evaluateImageOperatorPlan(plan, source, { uv: [.5, .5], timelineTimeSeconds: 1 + frame / 30, sampleImage: () => source, sampleResource: () => previous }) as Rgba;
        previous = next.map(value => Math.round(Math.min(1, Math.max(0, value)) * 255) / 255) as Rgba;
      }
      return previous;
    };
    for (const trail of [.98, .99, .995]) {
      const transparent = quantized(createDefaultRom1Graph(), { trail, gain: 0 }, [0, 0, 0, 0], [1, 1, 1, 1], 1500);
      const opaque = quantized(createDefaultRom1Graph(), { trail, gain: 0 }, [0, 0, 0, 1], [1, 1, 1, 1], 1500);
      expect(transparent[3]).toBe(0);
      expect(opaque.slice(0, 3)).toEqual([0, 0, 0]);
    }
    // Above the floor the share kept per frame is exactly Trail (bright smoke keeps its length).
    expect(run(createDefaultRom1Graph(), { trail: .98, gain: 0, opacity: 1, strength: 0 }, [0, 0, 0, 0], [.5, .8, .3, 1], 5)[3]).toBeCloseTo(.98 ** 5, 9);
  });

  it('upgrades untouched saved graphs to the premultiplied recipe and keeps edited ones', () => {
    expect(matchesEffectRecipe(createSavedRom1GraphBefore20261022(), createRom1GraphBefore20261022())).toBe(true);
    for (const saved of [createSavedRom1GraphBefore20261022(), createSavedRom1GraphBeforeGainKnee()]) {
      expect(matchesEffectRecipe(upgradeRom1Graph(saved), createDefaultRom1Graph())).toBe(true);
    }
    const edited = createSavedRom1GraphBefore20261022();
    edited.nodes = edited.nodes.map(node => node.id === 'wet-factor' ? { ...node, constants: { value: .5 } } : node);
    const kept = upgradeRom1Graph(edited);
    expect(kept.nodes.some(node => node.id === 'feedback-masked')).toBe(true);
    expect(kept.nodes.find(node => node.id === 'wet-factor')?.constants?.value).toBe(.5);
  });

  it('opens the untouched recipe in stage folders', () => {
    const graph = effectOperatorGraph({ id: 'rom1-folders', type: 'rom1', params: { ...defaults } } as never, { inspectionOnly: true });
    const labels = (graph.groups ?? []).map(group => group.label);
    expect(labels).toEqual(expect.arrayContaining(['Noise Scale (Density, Detail)', 'Noise Octaves (4 layers)', 'Octave Sum (currents)',
      'Drift per Frame (Strength, Speed, Gain X/Y)', 'Frame Edge Fade', 'Premultiplied Reads', 'Wet Mix & Gain Lift',
      'Trail (fade, keep brighter)', 'Opacity Mix & Straight Alpha']));
  });
});
