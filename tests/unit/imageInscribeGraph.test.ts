import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultInscribeGraph } from '../../src/services/operators/asciiEffectGraph';
import { compileImageOperatorGraph, createImageOperatorEvaluator } from '../../src/services/operators/imageOperatorGraph';

type Rgba = [number, number, number, number];
const sourceAt = ([u, v]: [number, number]): Rgba => [u, v, .2, .55];
const luma = ([r, g, b]: Rgba) => r * .2126 + g * .7152 + b * .0722;
const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

describe('Inscribe image operator graph', () => {
  it.each(['fine', 'coarse'] as const)('matches the sampled-cell derivative resolve with explicit %s CPU policy', derivativeAutoMode => {
    const definition = getEffect('inscribe')!, values = { ...Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default])),
      cellSize: 9, amount: 1, colorMode: 'source' };
    const plan = compileImageOperatorGraph(createDefaultInscribeGraph(), values, { parameterSchema: definition.params,
      resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset: ' .#@', cellSize: 64 }) });
    expect(plan.capabilities).toContain('derivative');
    const resolution: [number, number] = [40, 20], pixelCoordinate: [number, number] = [9, 9], uv: [number, number] = [9.5 / 40, 9.5 / 20];
    const output = createImageOperatorEvaluator(plan)([0, 0, 0, 0], { uv, resolution, pixelCoordinate, derivativeAutoMode,
      sampleImage: sourceAt, sampleResource: () => [0, 0, 0, .6] });

    const cellTone = (x: number, y: number) => luma(sourceAt([(Math.floor((x + .5) / 9) + .5) * 9 / 40,
      (Math.floor((y + .5) / 9) + .5) * 9 / 20]));
    const topLeft = cellTone(8, 8), topRight = cellTone(9, 8), bottomLeft = cellTone(8, 9), bottomRight = cellTone(9, 9);
    const gradient = derivativeAutoMode === 'coarse' ? [topRight - topLeft, bottomLeft - topLeft]
      : [bottomRight - bottomLeft, bottomRight - topRight];
    const edge = Math.hypot(...gradient) * 9 * 2.5, coverage = .6 * smoothstep(.02, .35, edge);
    const sampled = sourceAt([1.5 * 9 / 40, 1.5 * 9 / 20]);
    const expected = sampled.slice(0, 3).map(channel => channel * .18 * (1 - coverage) + channel * coverage);
    expected.forEach((channel, index) => expect(output[index]).toBeCloseTo(channel, 12));
    expect(output[3]).toBe(.55);
  });

  it('does not guess an automatic derivative policy on CPU', () => {
    const definition = getEffect('inscribe')!, values = Object.fromEntries(Object.entries(definition.params).map(([id, spec]) => [id, spec.default]));
    const plan = compileImageOperatorGraph(createDefaultInscribeGraph(), values, { parameterSchema: definition.params,
      resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset: ' .#@', cellSize: 64 }) });
    expect(() => createImageOperatorEvaluator(plan)([0, 0, 0, 0], { uv: [.25, .475], resolution: [40, 20], pixelCoordinate: [9, 9],
      sampleImage: sourceAt, sampleResource: () => [0, 0, 0, .6] })).toThrow(/explicit fine or coarse CPU policy/);
  });
});
