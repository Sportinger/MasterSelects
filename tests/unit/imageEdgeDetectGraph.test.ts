import { describe, expect, it } from 'vitest';
import { createDefaultEdgeDetectGraph } from '../../src/services/operators/edgeDetectEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const luma = (rgb: readonly number[]) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
const sample = ([u, v]: [number, number]): [number, number, number, number] => [u * u, v * v, u * v, 0.13];

describe('edge detect image graph', () => {
  it('uses exactly eight shared samples and stays below the graph limit', () => {
    const graph = createDefaultEdgeDetectGraph();
    expect(graph.nodes.length).toBeLessThanOrEqual(64);
    expect(graph.nodes.filter(node => node.operator === 'image.sample')).toHaveLength(8);
    expect(graph.nodes.filter(node => node.operator === 'color.luminance-rec709.image')).toHaveLength(8);
    expect(graph.nodes.some(node => node.operator === 'image.kernel-grid-reduce')).toBe(false);
    const plan = compileImageOperatorGraph(graph, { strength: 1, invert: false });
    expect(plan.passes).toBeUndefined();
    expect(plan.kernelScopes ?? []).toHaveLength(0);
  });

  it('matches the independent scalar Sobel order, samples the expected lattice, and forces alpha one', () => {
    const graph = createDefaultEdgeDetectGraph(), coordinates: Array<[number, number]> = [];
    const uv: [number, number] = [0.5, 0.5], dx = 0.1, dy = 0.05, strength = 2.3;
    const context = { uv, resolution: [10, 20] as [number, number], sampleImage: (at: [number, number]) => { coordinates.push(at); return sample(at); } };
    const result = evaluateImageOperatorPlan(compileImageOperatorGraph(graph, { strength, invert: false }), sample(uv), context);
    const values = {
      tl: luma(sample([uv[0] - dx, uv[1] - dy])), t: luma(sample([uv[0], uv[1] - dy])), tr: luma(sample([uv[0] + dx, uv[1] - dy])),
      l: luma(sample([uv[0] - dx, uv[1]])), r: luma(sample([uv[0] + dx, uv[1]])),
      bl: luma(sample([uv[0] - dx, uv[1] + dy])), b: luma(sample([uv[0], uv[1] + dy])), br: luma(sample([uv[0] + dx, uv[1] + dy])),
    };
    const gx = -values.tl - 2 * values.l - values.bl + values.tr + 2 * values.r + values.br;
    const gy = -values.tl - 2 * values.t - values.tr + values.bl + 2 * values.b + values.br;
    const expected = Math.min(1, Math.max(0, Math.sqrt(gx * gx + gy * gy) * strength));
    expect(result[0]).toBeCloseTo(expected, 14); expect(result[1]).toBeCloseTo(expected, 14); expect(result[2]).toBeCloseTo(expected, 14);
    expect(result[3]).toBe(1);
    expect(coordinates).toHaveLength(8);
    const expectedCoordinates = [
      [uv[0] - dx, uv[1] - dy], [uv[0], uv[1] - dy], [uv[0] + dx, uv[1] - dy], [uv[0] - dx, uv[1]],
      [uv[0] + dx, uv[1]], [uv[0] - dx, uv[1] + dy], [uv[0], uv[1] + dy], [uv[0] + dx, uv[1] + dy],
    ].map(at => at.map(value => value.toFixed(8)).join(','));
    expect(new Set(coordinates.map(at => at.map(value => value.toFixed(8)).join(',')))).toEqual(new Set(expectedCoordinates));
    const inverted = evaluateImageOperatorPlan(compileImageOperatorGraph(graph, { strength: 1e6, invert: true }), sample(uv), context);
    expect(inverted).toEqual([0, 0, 0, 1]);
  });
});
