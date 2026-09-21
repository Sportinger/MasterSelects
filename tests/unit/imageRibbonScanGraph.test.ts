import { describe, expect, it } from 'vitest';
import { createDefaultRibbonScanGraph } from '../../src/services/operators/ribbonScanEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams } from '../../src/effects';
import type { Effect } from '../../src/types/effects';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u, v, u + v, .2 + u * .5];
const clampUv = ([u, v]: [number, number]): [number, number] => [Math.max(.001, Math.min(.999, u)), Math.max(.001, Math.min(.999, v))];
const smoothstep = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };

function reference(uv: [number, number], time: number, scale: number, amount: number, speed: number): Rgba {
  const raw = uv[1] * Math.max(scale, 3) - time * speed, phase = raw - Math.floor(raw);
  const ribbon = smoothstep(0, .18, phase) * (1 - smoothstep(.62, 1, phase));
  const shift = Math.sin(phase * (Math.PI * 2)) * amount * .08 * ribbon;
  const original = sample(clampUv(uv)), color = sample(clampUv([uv[0] + shift, uv[1]]));
  return [original[0] * (1 - ribbon) + color[0] * ribbon, original[1] * (1 - ribbon) + color[1] * ribbon,
    original[2] * (1 - ribbon) + color[2] * ribbon, color[3]];
}

describe('Ribbon Scan image graph', () => {
  it('uses the contextual owner with authoritative catalog defaults', () => {
    const effect: Effect = { id: 'ribbon', name: 'Ribbon Scan', type: 'ribbon-scan', enabled: true, params: {} };
    expect(isImageGraphEffectType(effect.type)).toBe(true);
    expect(isLocalImageEffectType(effect.type)).toBe(false);
    expect(effectOperatorParams(effect)).toMatchObject(getDefaultParams('ribbon-scan'));
    expect(effectOperatorGraph(effect)).toEqual({ ...createDefaultRibbonScanGraph(), compositionRules: 2 });
  });

  it('uses two explicit shared samples and catalog-owned bindings', () => {
    const graph = createDefaultRibbonScanGraph();
    expect(graph.nodes.filter(node => node.operator === 'image.sample').map(node => node.id)).toEqual(['original-sample', 'shifted-sample']);
    expect(graph.nodes.find(node => node.id === 'scale')?.bindings).toEqual({ value: 'scale' });
    expect(graph.nodes.find(node => node.id === 'amount')?.bindings).toEqual({ value: 'amount' });
    expect(graph.nodes.find(node => node.id === 'speed')?.bindings).toEqual({ value: 'speed' });
    expect(graph.nodes.some(node => node.operator.includes('ribbon'))).toBe(false);
  });

  it('matches legacy phase, clamp, mixing order and shifted alpha', () => {
    const params = { scale: 4.5, amount: .8, speed: .35 }, plan = compileImageOperatorGraph(createDefaultRibbonScanGraph(), params);
    expect(plan.capabilities).toEqual(expect.arrayContaining(['uv', 'time', 'sample']));
    for (const context of [{ uv: [.02, .12] as [number, number], timelineTimeSeconds: 0 },
      { uv: [.53, .71] as [number, number], timelineTimeSeconds: 1.25 }, { uv: [.998, .97] as [number, number], timelineTimeSeconds: 4 }]) {
      expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { ...context, sampleImage: sample }))
        .toEqual(reference(context.uv, context.timelineTimeSeconds, params.scale, params.amount, params.speed));
    }
  });

  it('retains amount-zero and minimum-scale behavior without changing shifted alpha semantics', () => {
    const params = { scale: 1, amount: 0, speed: 1 }, context = { uv: [.4, .33] as [number, number], timelineTimeSeconds: .75, sampleImage: sample };
    const actual = evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultRibbonScanGraph(), params), [0, 0, 0, 0], context);
    expect(actual).toEqual(reference(context.uv, context.timelineTimeSeconds, params.scale, params.amount, params.speed));
    expect(actual[3]).toBe(sample(clampUv(context.uv))[3]);
  });
});
