import { describe, expect, it } from 'vitest';
import { createDefaultPaperPrintGraph } from '../../src/services/operators/paperPrintEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { IMAGE_EFFECT_GRAPH_LIMITS } from '../../src/services/operators/effectGraphLimits';

const fract = (value: number) => value - Math.floor(value);
const hash = ([u, v]: [number, number]) => fract(Math.sin((u * 127.1 + v * 311.7) * 12.9898 + (u * 269.5 + v * 183.3) * 78.233) * 43758.5453);
function noise([x, y]: [number, number]) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fract(x), fy = fract(y), ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const row0 = hash([ix, iy]) * (1 - ux) + hash([ix + 1, iy]) * ux;
  const row1 = hash([ix, iy + 1]) * (1 - ux) + hash([ix + 1, iy + 1]) * ux;
  return row0 * (1 - uy) + row1 * uy;
}
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const smoothstep = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };

describe('Paper Print image graph', () => {
  it('is a granular bounded graph with canonical catalog bindings', () => {
    const graph = createDefaultPaperPrintGraph();
    expect(graph.nodes.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.nodes);
    expect(graph.edges.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.edges);
    expect(graph.nodes.filter(node => node.operator === 'noise.hash2d.vec2')).toHaveLength(4);
    expect(graph.nodes.find(node => node.id === 'scale')?.bindings).toEqual({ value: 'scale' });
    expect(graph.nodes.find(node => node.id === 'color-a')?.bindings).toEqual({ value: 'colorA' });
    expect(graph.nodes.some(node => node.operator.includes('paper-print'))).toBe(false);
  });

  it('matches legacy grain, press, paper modulation, mix order and source alpha', () => {
    const params = { amount: .72, scale: 18, colorA: '#204060', colorB: '#e0c080' };
    const plan = compileImageOperatorGraph(createDefaultPaperPrintGraph(), params);
    const uv: [number, number] = [.37, .62], resolution: [number, number] = [47, 29], color: [number, number, number, number] = [.2, .6, .35, .43];
    const grain = noise([Math.floor(uv[0] * resolution[0]) / 18, Math.floor(uv[1] * resolution[1]) / 18]) - .5;
    const luma = color[0] * .2126 + color[1] * .7152 + color[2] * .0722, pressed = smoothstep(.15, .85, luma + grain * .3);
    const inkA = [0x20 / 255, 0x40 / 255, 0x60 / 255], inkB = [0xe0 / 255, 0xc0 / 255, 0x80 / 255];
    const factor = .92 + grain * .08;
    const expected = color.slice(0, 3).map((channel, index) => mix(channel, mix(inkA[index], inkB[index], pressed) * factor, params.amount));
    const actual = evaluateImageOperatorPlan(plan, color, { uv, resolution, sampleImage: () => color });
    expected.forEach((channel, index) => expect(actual[index]).toBeCloseTo(channel, 12));
    expect(actual[3]).toBe(color[3]);
  });

  it('clamps the legacy center source coordinates and preserves sampled alpha', () => {
    const plan = compileImageOperatorGraph(createDefaultPaperPrintGraph(), { amount: 0, scale: 18, colorA: '#000000', colorB: '#ffffff' });
    const coordinates: Array<[number, number]> = [];
    const result = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [0, 1], resolution: [800, 600],
      sampleImage: value => { coordinates.push(value); return [.2, .3, .4, .61]; } });
    expect(coordinates).toEqual([[.001, .999]]);
    expect(result).toEqual([.2, .3, .4, .61]);
  });
});
