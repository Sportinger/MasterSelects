import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultAsciiGhostGraph } from '../../src/services/operators/asciiEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { IMAGE_FRAME_HISTORY_RESOURCE_ID } from '../../src/services/operators/imageOperatorResources';

type Rgba = [number, number, number, number];
const sourceAt = ([u, v]: [number, number]): Rgba => [u, v, .2, .55];
const atlasAt = ([u, v]: [number, number]): Rgba => [0, 0, 0, u * .4 + v * .3];

describe('ASCII Ghost image operator graph', () => {
  it('uses explicit frame history and matches the component-wise decayed maximum including alpha', () => {
    const definition = getEffect('ascii-ghost')!;
    expect(definition.usesFeedback).toBe(true);
    const values = { ...Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])),
      cellSize: 10, amount: .72, speed: 1.3, colorMode: 'source' };
    const graph = createDefaultAsciiGhostGraph();
    expect(graph.nodes.filter(node => node.operator === 'image.frame-history')).toHaveLength(1);
    const plan = compileImageOperatorGraph(graph, values, { allowFrameHistory: true, parameterSchema: definition.params,
      resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset: ' .#@', cellSize: 64 }) });
    expect(plan.frameHistoryResource).toBe(IMAGE_FRAME_HISTORY_RESOURCE_ID);

    const uv: [number, number] = [.8, .7], resolution: [number, number] = [40, 20], timelineTimeSeconds = .43;
    const evaluate = (history: Rgba) => evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution, timelineTimeSeconds,
      sampleImage: sourceAt, sampleResource: (id, coords) => id === IMAGE_FRAME_HISTORY_RESOURCE_ID ? history : atlasAt(coords) });
    const current = evaluate([0, 0, 0, 0]), history: Rgba = [.9, .1, .7, .8], output = evaluate(history);
    current.forEach((channel, index) => expect(output[index]).toBeCloseTo(Math.max(channel, history[index] * .88), 12));
  });

  it('fails closed unless the compile context explicitly enables feedback', () => {
    const definition = getEffect('ascii-ghost')!, values = Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default]));
    expect(() => compileImageOperatorGraph(createDefaultAsciiGhostGraph(), values, { parameterSchema: definition.params,
      resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset: ' .#@', cellSize: 64 }) })).toThrow(/frame history/i);
  });
});
