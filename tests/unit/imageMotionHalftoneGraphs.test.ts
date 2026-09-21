import { describe, expect, it } from 'vitest';
import { createDefaultMotionHalftoneGraph, type EditableMotionHalftoneEffectType } from '../../src/services/operators/motionHalftoneEffectGraphs';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

type Rgba = [number, number, number, number];
const fract = (value: number) => value - Math.floor(value);
const hash = ([u, v]: [number, number]) => fract(Math.sin((u * 127.1 + v * 311.7) * 12.9898 + (u * 269.5 + v * 183.3) * 78.233) * 43758.5453);
const clamp = (value: number) => Math.max(.001, Math.min(.999, value));
const sample = ([u, v]: [number, number]): Rgba => { const x = clamp(u), y = clamp(v); return [x, y, x * .3 + y * .2, .2 + x * .6]; };

function reference(type: EditableMotionHalftoneEffectType, uv: [number, number], resolution: [number, number], time: number,
  params: { scale: number; amount: number; speed: number }): Rgba {
  const grid = Math.max(params.scale, type === 'scatter-mosaic' ? 3 : 2);
  if (type === 'glitch-grid') {
    const cell: [number, number] = [Math.floor(uv[0] * resolution[0] / grid), Math.floor(uv[1] * resolution[1] / grid)], tick = Math.floor(time * params.speed * 8);
    const jump = (hash([cell[0] + tick, cell[1] + tick]) - .5) * params.amount;
    const enabled = hash([cell[1], tick]) >= .82 ? 1 : 0;
    return sample([uv[0] + jump * enabled * .12, uv[1]]);
  }
  if (type === 'scatter-mosaic') {
    const cell: [number, number] = [Math.floor(uv[0] * resolution[0] / grid), Math.floor(uv[1] * resolution[1] / grid)];
    const jitter: [number, number] = [hash(cell) - .5, hash([cell[0] + 17, cell[1] + 17]) - .5];
    const drift = Math.sin(time * params.speed + hash(cell) * Math.PI * 2);
    return sample([(cell[0] + .5 + jitter[0] * params.amount * drift) * grid / resolution[0],
      (cell[1] + .5 + jitter[1] * params.amount * drift) * grid / resolution[1]]);
  }
  const row = Math.floor(uv[1] * resolution[1] / grid), shift = Math.sin(row * .71 + time * params.speed * 2) * params.amount * .06;
  const sampled = sample([uv[0] + shift, uv[1]]), line = .82 + .18 * Math.sin(uv[1] * resolution[1] * Math.PI / grid);
  return [sampled[0] * line, sampled[1] * line, sampled[2] * line, sampled[3]];
}

describe('motion halftone image graphs', () => {
  it.each(['glitch-grid', 'scatter-mosaic', 'drift-lines'] as const)('binds %s to the catalog parameter IDs', type => {
    const graph = createDefaultMotionHalftoneGraph(type);
    for (const id of ['scale', 'amount', 'speed']) expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
    expect(graph.nodes.find(node => node.id === 'sample')?.operator).toBe('image.sample');
  });

  it.each(['glitch-grid', 'scatter-mosaic', 'drift-lines'] as const)('matches the %s legacy operation order and sampled alpha', type => {
    const params = { scale: 9.5, amount: .83, speed: 1.35 }, uv: [number, number] = [.63, .41], resolution: [number, number] = [64, 37], time = 1.375;
    const plan = compileImageOperatorGraph(createDefaultMotionHalftoneGraph(type), params);
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution, timelineTimeSeconds: time, sampleImage: sample });
    const expected = reference(type, uv, resolution, time, params);
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
    expect(actual[3]).not.toBe(sample(uv)[3]);
  });
});
