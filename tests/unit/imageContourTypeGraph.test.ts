import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultContourTypeGraph } from '../../src/services/operators/asciiEffectGraph';
import { compileImageOperatorGraph, createImageOperatorEvaluator } from '../../src/services/operators/imageOperatorGraph';

type Rgba = [number, number, number, number];
const sourceAt = ([u, v]: [number, number]): Rgba => [u, v, .2, .55];
const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

describe('Contour Type image operator graph', () => {
  it('keeps current-UV index sampling separate from cell-center tone and atlas alpha', () => {
    const graph = createDefaultContourTypeGraph();
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'frame', to: 'contour-current-sample', input: 'image' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'uv', to: 'contour-current-sample', input: 'uv' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'contour-current-tone', to: 'contour-index-scaled', input: 'a' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'atlas-split', output: 'w', to: 'contour-alpha', input: 'a' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'tone', to: 'contour-derivative', input: 'value' }));
    expect(graph.nodes.find(node => node.id === 'atlas')?.bindings)
      .toEqual({ rampPreset: 'rampPreset', customRamp: 'customRamp', fontFamily: 'fontFamily', fontWeight: 'fontWeight' });
  });

  it('matches the zero-gradient band resolve while preserving sampled source alpha', () => {
    const definition = getEffect('contour-type')!, values = { ...Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])),
      cellSize: 10, amount: 1, colorMode: 'source' };
    const plan = compileImageOperatorGraph(createDefaultContourTypeGraph(), values, { parameterSchema: definition.params,
      resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset: '0123', cellSize: 64 }) });
    const resolution: [number, number] = [40, 20], pixelCoordinate: [number, number] = [11, 7], uv: [number, number] = [11.5 / 40, 7.5 / 20];
    const output = createImageOperatorEvaluator(plan)([0, 0, 0, 0], { uv, resolution, pixelCoordinate, derivativeAutoMode: 'coarse',
      sampleImage: sourceAt, sampleResource: () => [0, 0, 0, .6] });
    const sampled = sourceAt([1.5 * 10 / 40, .5 * 10 / 20]);
    const tone = sampled[0] * .2126 + sampled[1] * .7152 + sampled[2] * .0722;
    const band = 1 - smoothstep(.03, .12, Math.abs((tone * 8 - Math.floor(tone * 8)) - .5));
    const coverage = .6 * band;
    sampled.slice(0, 3).forEach((channel, index) => expect(output[index]).toBeCloseTo(channel * (.08 * (1 - coverage) + coverage), 12));
    expect(output[3]).toBe(.55);
  });
});
