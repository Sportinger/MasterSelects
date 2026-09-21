import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultToneGeometryGraph } from '../../src/services/operators/toneGeometryEffectGraph';
import { IMAGE_EFFECT_GRAPH_LIMITS } from '../../src/services/operators/effectGraphLimits';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u, v, .3 + u * .2, .25 + v * .5];
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const smoothstep = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = (value: number) => value - Math.floor(value);

describe('Tone Geometry image graph', () => {
  it('is bounded, granular and uses canonical catalog bindings', () => {
    const graph = createDefaultToneGeometryGraph();
    expect(graph.nodes.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.nodes);
    expect(graph.edges.length).toBeLessThanOrEqual(IMAGE_EFFECT_GRAPH_LIMITS.edges);
    for (const id of ['amount', 'scale', 'speed', 'angle', 'shape']) expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
    expect(graph.nodes.some(node => node.operator.includes('tone-geometry'))).toBe(false);
  });

  it.each([['square', 0], ['circle', 1], ['triangle', 2]] as const)('matches legacy %s geometry, time, rotation, clamp and alpha', (shape, variant) => {
    const params = { amount: .7, scale: 9, speed: .8, angle: 23, shape, colorA: '#204060', colorB: '#e0c080' };
    const uv: [number, number] = [0, .72], resolution: [number, number] = [47, 29], time = 1.3;
    const drift = Math.sin(time * params.speed) * .002, radians = params.angle * Math.PI / 180, px = uv[0] + drift - .5, py = uv[1] - .5;
    const rotated: [number, number] = [px * Math.cos(radians) - py * Math.sin(radians) + .5, px * Math.sin(radians) + py * Math.cos(radians) + .5];
    const cell: [number, number] = [fract(rotated[0] * resolution[0] / Math.max(params.scale, 3)) - .5, fract(rotated[1] * resolution[1] / Math.max(params.scale, 3)) - .5];
    const sampled = sample([.001, uv[1]]), tone = sampled[0] * .2126 + sampled[1] * .7152 + sampled[2] * .0722, size = (1 - tone) * .65;
    const distance = variant === 0 ? Math.max(Math.abs(cell[0]), Math.abs(cell[1])) : variant === 1 ? Math.hypot(...cell) : Math.max(Math.abs(cell[0]), cell[1] * .75 - .15);
    const mark = 1 - smoothstep(size - .04, size + .04, distance), a = [0x20 / 255, 0x40 / 255, 0x60 / 255], b = [0xe0 / 255, 0xc0 / 255, 0x80 / 255];
    const expected: Rgba = [0, 1, 2].map(index => mix(sampled[index], mix(b[index], a[index], mark), params.amount)) as unknown as Rgba; expected[3] = sampled[3];
    const plan = compileImageOperatorGraph(createDefaultToneGeometryGraph(), params, { parameterSchema: getEffect('tone-geometry')!.params });
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution, timelineTimeSeconds: time, sampleImage: sample });
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 12));
  });
});
