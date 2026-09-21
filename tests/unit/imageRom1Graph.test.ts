import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultRom1Graph } from '../../src/services/operators/rom1EffectGraph';
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
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'feedback-masked', to: 'feedback-split', input: 'image' }));
  });

  it('masks full feedback RGBA and preserves feedback-raised alpha', () => {
    const definition = getEffect('rom1')!, params = {
      ...Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])),
      opacity: 1, gain: 0, strength: 0,
    };
    const plan = compileImageOperatorGraph(createDefaultRom1Graph(), params, { parameterSchema: definition.params, allowFrameHistory: true });
    const source: [number, number, number, number] = [.2, .3, .4, .4], history: [number, number, number, number] = [.5, .1, .2, .9];
    const output = evaluateImageOperatorPlan(plan, source, { uv: [.5, .5], timelineTimeSeconds: 2,
      sampleImage: () => source, sampleResource: () => history });
    expect(output[0]).toBeCloseTo(.5 * .98, 12);
    expect(output[1]).toBeCloseTo(.3, 12);
    expect(output[2]).toBeCloseTo(.4, 12);
    expect(output[3]).toBeCloseTo(.9 * .98, 12);
  });
});
