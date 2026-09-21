import { describe, expect, it } from 'vitest';
import { createDefaultCrtScreenGraph } from '../../src/services/operators/crtScreenEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams } from '../../src/effects';
import type { Effect } from '../../src/types/effects';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u, v, u + v, .37];

function reference(uv: [number, number], resolution: [number, number], time: number, scale: number, amount: number, speed: number): Rgba {
  const p: [number, number] = [uv[0] * 2 - 1, uv[1] * 2 - 1];
  const distortion = (p[0] * p[0] + p[1] * p[1]) * .08 * amount;
  const curved: [number, number] = [p[0] * (1 + distortion) * .5 + .5, p[1] * (1 + distortion) * .5 + .5];
  const clamped: [number, number] = [Math.min(.999, Math.max(.001, curved[0])), Math.min(.999, Math.max(.001, curved[1]))];
  const color = sample(clamped);
  const scan = .78 + .22 * Math.sin(uv[1] * resolution[1] * Math.PI);
  const phase = Math.floor(uv[0] * resolution[0] / Math.max(scale, 1)) % 3;
  const mask = phase === 0 ? [.92, .75, .75] : phase === 2 ? [.75, .75, .92] : [.75, .92, .75];
  const flicker = .98 + .02 * Math.sin(time * speed * 50);
  const shaded = color.slice(0, 3).map((value, index) => value * mask[index] * scan * flicker);
  return [color[0] * (1 - amount) + shaded[0] * amount, color[1] * (1 - amount) + shaded[1] * amount,
    color[2] * (1 - amount) + shaded[2] * amount, color[3]];
}

describe('CRT Screen image graph', () => {
  it('uses the canonical contextual owner and catalog defaults', () => {
    const effect: Effect = { id: 'crt', name: 'CRT Screen', type: 'crt-screen', enabled: true, params: {} };
    expect(isImageGraphEffectType(effect.type)).toBe(true);
    expect(isLocalImageEffectType(effect.type)).toBe(false);
    expect(effectOperatorParams(effect)).toMatchObject(getDefaultParams('crt-screen'));
    expect(effectOperatorGraph(effect)).toEqual(createDefaultCrtScreenGraph());
  });

  it('uses owner-bound parameters and only shared granular operators', () => {
    const graph = createDefaultCrtScreenGraph();
    expect(graph.nodes.find(node => node.id === 'scale')?.bindings).toEqual({ value: 'scale' });
    expect(graph.nodes.find(node => node.id === 'amount')?.bindings).toEqual({ value: 'amount' });
    expect(graph.nodes.find(node => node.id === 'speed')?.bindings).toEqual({ value: 'speed' });
    expect(graph.nodes.some(node => node.operator.includes('crt'))).toBe(false);
    expect(graph.nodes.filter(node => node.operator === 'image.sample')).toHaveLength(1);
  });

  it('matches curvature, clamp, mask modulo, scanline, flicker and sampled alpha', () => {
    const graph = createDefaultCrtScreenGraph(), params = { scale: 3, amount: .72, speed: .25 };
    const plan = compileImageOperatorGraph(graph, params);
    expect(plan.capabilities).toEqual(expect.arrayContaining(['uv', 'resolution', 'time', 'sample']));
    for (const context of [
      { uv: [.02, .31] as [number, number], resolution: [64, 37] as [number, number], timelineTimeSeconds: 0 },
      { uv: [.42, .73] as [number, number], resolution: [64, 37] as [number, number], timelineTimeSeconds: 1.25 },
      { uv: [.99, .01] as [number, number], resolution: [31, 18] as [number, number], timelineTimeSeconds: 3 },
    ]) {
      expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { ...context, sampleImage: sample }))
        .toEqual(reference(context.uv, context.resolution, context.timelineTimeSeconds, params.scale, params.amount, params.speed));
    }
  });

  it('retains exact bypass and scale-floor boundaries', () => {
    const graph = createDefaultCrtScreenGraph(), context = { uv: [.2, .4] as [number, number], resolution: [17, 9] as [number, number], timelineTimeSeconds: .5, sampleImage: sample };
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(graph, { scale: .25, amount: 0, speed: 1 }), [0, 0, 0, 0], context))
      .toEqual(reference(context.uv, context.resolution, context.timelineTimeSeconds, .25, 0, 1));
    const full = evaluateImageOperatorPlan(compileImageOperatorGraph(graph, { scale: 1, amount: 1, speed: 1 }), [0, 0, 0, 0], context);
    expect(full).toEqual(reference(context.uv, context.resolution, context.timelineTimeSeconds, 1, 1, 1));
    expect(full[3]).toBe(.37);
  });
});
