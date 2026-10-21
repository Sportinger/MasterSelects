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
  return driftReference(uv, resolution, time, { ...params, angle: 0 });
}

/** Drift Lines: bands of Band Size px of a 1080p frame (at least 1 px) at Angle, shifted along themselves. */
function driftReference(uv: [number, number], resolution: [number, number], time: number,
  params: { scale: number; amount: number; speed: number; angle: number }): Rgba {
  const center = [resolution[0] * .5, resolution[1] * .5], radians = params.angle * Math.PI / 180;
  const relative = [uv[0] * resolution[0] - center[0], uv[1] * resolution[1] - center[1]];
  const across = relative[0] * Math.sin(radians) + relative[1] * Math.cos(radians) + center[1];
  const height = Math.max(Math.max(params.scale, 2) * Math.min(...resolution) / 1080, 1);
  const shift = Math.sin(Math.floor(across / height) * .71 + time * params.speed * 2) * params.amount * resolution[0] * .06;
  const sampled = sample([uv[0] + shift * Math.cos(radians) / resolution[0], uv[1] - shift * Math.sin(radians) / resolution[1]]);
  const line = .82 + .18 * Math.sin(across * Math.PI / height);
  return [sampled[0] * line, sampled[1] * line, sampled[2] * line, sampled[3]];
}
const evaluateDrift = (params: Record<string, number>, uv: [number, number], resolution: [number, number], time: number) =>
  evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultMotionHalftoneGraph('drift-lines'), params), [0, 0, 0, 0],
    { uv, resolution, timelineTimeSeconds: time, sampleImage: sample });

describe('motion halftone image graphs', () => {
  it.each(['glitch-grid', 'scatter-mosaic', 'drift-lines'] as const)('binds %s to the catalog parameter IDs', type => {
    const graph = createDefaultMotionHalftoneGraph(type);
    for (const id of ['scale', 'amount', 'speed']) expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
    expect(graph.nodes.find(node => node.id === 'sample')?.operator).toBe('image.sample');
  });

  it.each(['glitch-grid', 'scatter-mosaic', 'drift-lines'] as const)('matches the %s legacy operation order and sampled alpha', type => {
    const params = { scale: 9.5, amount: .83, speed: 1.35, angle: 0 }, uv: [number, number] = [.63, .41], resolution: [number, number] = [64, 37], time = 1.375;
    const plan = compileImageOperatorGraph(createDefaultMotionHalftoneGraph(type), params);
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution, timelineTimeSeconds: time, sampleImage: sample });
    const expected = reference(type, uv, resolution, time, params);
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
    expect(actual[3]).not.toBe(sample(uv)[3]);
  });

  it('draws Drift Lines at Angle 0 on a 1080p frame exactly as the original horizontal recipe', () => {
    const uv: [number, number] = [.4137, .5523], resolution: [number, number] = [1920, 1080], time = 2.25, params = { scale: 14, amount: .75, speed: 1 };
    const row = Math.floor(uv[1] * 1080 / 14), shift = Math.sin(row * .71 + time * 2) * .75 * .06;
    const sampled = sample([uv[0] + shift, uv[1]]), line = .82 + .18 * Math.sin(uv[1] * 1080 * Math.PI / 14);
    const actual = evaluateDrift({ ...params, angle: 0 }, uv, resolution, time);
    [sampled[0] * line, sampled[1] * line, sampled[2] * line, sampled[3]].forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9));
  });

  it('turns Drift Lines by Angle and measures Band Size on a 1080p frame (4K shows the same bands)', () => {
    for (const [uv, angle] of [[[.31, .72], 90], [[.66, .18], -30], [[.52, .47], 135]] as Array<[[number, number], number]>) {
      const params = { scale: 9, amount: .6, speed: 1.4, angle };
      const actual = evaluateDrift(params, uv, [1280, 720], 1.1), expected = driftReference(uv, [1280, 720], 1.1, params);
      expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9));
    }
    // Upright bands slide up and down: the sampled point keeps its x (alpha = .2 + .6 x in this sample image).
    const upright = evaluateDrift({ scale: 20, amount: 1, speed: 1, angle: 90 }, [.3, .6], [1920, 1080], .7);
    expect((upright[3] - .2) / .6).toBeCloseTo(.3, 9);
    // The same picture position on 1080p and 4K falls into the same band (Band Size scales with the frame).
    const band = (resolution: [number, number]) => evaluateDrift({ scale: 14, amount: 1, speed: 0, angle: 0 }, [.37, .4321], resolution, 0);
    band([3840, 2160]).forEach((value, index) => expect(value).toBeCloseTo(band([1920, 1080])[index], 6));
  });

  it('names the Band Size clamp and keeps bands at least one pixel tall', () => {
    const graph = createDefaultMotionHalftoneGraph('drift-lines');
    expect(graph.nodes.find(node => node.id === 'scale-clamped')?.operator).toBe('math.max.scalar');
    expect(graph.nodes.find(node => node.id === 'angle')?.bindings).toEqual({ value: 'angle' });
    // Band Size 2 on a 144 px thumbnail would be 0.27 px: it renders 1 px tall, like the reference.
    const params = { scale: 2, amount: .5, speed: 1, angle: 0 }, uv: [number, number] = [.5, .503];
    driftReference(uv, [256, 144], .4, params).forEach((value, index) => expect(evaluateDrift(params, uv, [256, 144], .4)[index]).toBeCloseTo(value, 9));
  });
});
