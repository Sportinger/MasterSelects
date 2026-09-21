import { describe, expect, it } from 'vitest';
import { createDefaultWaveLinesGraph } from '../../src/services/operators/waveLinesEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams } from '../../src/effects';
import type { Effect } from '../../src/types/effects';

type Rgba = [number, number, number, number];
const sample = ([u, v]: [number, number]): Rgba => [u, v, .25 + u * .5, .3 + v * .4];
const smoothstep = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
const rgb = (hex: string) => [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255];

function reference(uv: [number, number], time: number, params: { scale: number; amount: number; speed: number; colorA: string; colorB: string }): Rgba {
  const clamped: [number, number] = [Math.max(.001, Math.min(.999, uv[0])), Math.max(.001, Math.min(.999, uv[1]))], color = sample(clamped);
  const tone = color[0] * .2126 + color[1] * .7152 + color[2] * .0722, frequency = Math.max(params.scale, 3) * 3;
  const wave = Math.sin(uv[0] * frequency + time * params.speed * 3 + tone * (Math.PI * 2));
  const raw = uv[1] * frequency + wave * params.amount, fraction = raw - Math.floor(raw);
  const line = 1 - smoothstep(.05, .2, Math.abs(fraction - .5)), a = rgb(params.colorA), b = rgb(params.colorB);
  const spectrum = b.map((value, index) => value * (1 - line) + a[index] * line);
  return [color[0] * (1 - params.amount) + spectrum[0] * params.amount, color[1] * (1 - params.amount) + spectrum[1] * params.amount,
    color[2] * (1 - params.amount) + spectrum[2] * params.amount, color[3]];
}

describe('Wave Lines image graph', () => {
  it('uses the contextual owner and compiles normalized catalog color defaults', () => {
    const effect: Effect = { id: 'wave-lines', name: 'Wave Lines', type: 'wave-lines', enabled: true, params: {} };
    expect(isImageGraphEffectType(effect.type)).toBe(true);
    expect(isLocalImageEffectType(effect.type)).toBe(false);
    const params = effectOperatorParams(effect);
    expect(params).toMatchObject(getDefaultParams('wave-lines'));
    const graph = effectOperatorGraph(effect), plan = compileImageOperatorGraph(graph, params, effectOperatorCompileContext(effect));
    const colorA = plan.instructions.find(instruction => instruction.nodeId === 'color-a' && instruction.operation === 'parameter-color')!;
    const colorB = plan.instructions.find(instruction => instruction.nodeId === 'color-b' && instruction.operation === 'parameter-color')!;
    expect(plan.values.slice(colorA.value!, colorA.value! + 4)).toEqual([17 / 255, 24 / 255, 39 / 255, 1]);
    expect(plan.values.slice(colorB.value!, colorB.value! + 4)).toEqual([248 / 255, 250 / 255, 252 / 255, 1]);
  });

  it('uses explicit shared sampling and owner-bound numeric and color values', () => {
    const graph = createDefaultWaveLinesGraph();
    expect(graph.nodes.filter(node => node.operator === 'image.sample')).toHaveLength(1);
    for (const id of ['scale', 'amount', 'speed'] as const) expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
    expect(graph.nodes.find(node => node.id === 'color-a')?.bindings).toEqual({ value: 'colorA' });
    expect(graph.nodes.find(node => node.id === 'color-b')?.bindings).toEqual({ value: 'colorB' });
    expect(graph.nodes.some(node => node.operator.includes('wave-lines'))).toBe(false);
  });

  it('matches Rec.709 tone, phase order, source clamp, nested color mix and alpha', () => {
    const params = { scale: 7.5, amount: .65, speed: .3, colorA: '#22d3ee', colorB: '#f472b6' };
    const plan = compileImageOperatorGraph(createDefaultWaveLinesGraph(), params);
    expect(plan.capabilities).toEqual(expect.arrayContaining(['uv', 'time', 'sample']));
    for (const context of [{ uv: [.001, .2] as [number, number], timelineTimeSeconds: 0 },
      { uv: [.47, .68] as [number, number], timelineTimeSeconds: 1.25 }, { uv: [1, .99] as [number, number], timelineTimeSeconds: 3 }]) {
      expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { ...context, sampleImage: sample }))
        .toEqual(reference(context.uv, context.timelineTimeSeconds, params));
    }
  });

  it('keeps amount-zero and minimum-frequency boundaries', () => {
    const params = { scale: 1, amount: 0, speed: 1, colorA: '#111827', colorB: '#f8fafc' };
    const context = { uv: [.3, .4] as [number, number], timelineTimeSeconds: .75, sampleImage: sample };
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultWaveLinesGraph(), params), [0, 0, 0, 0], context))
      .toEqual(reference(context.uv, context.timelineTimeSeconds, params));
  });
});
