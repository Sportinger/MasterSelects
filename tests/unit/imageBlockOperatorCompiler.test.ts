import { describe, expect, it } from 'vitest';
import { colorToRgba } from '../../src/effects/_shared/catalogColor';
import { createDefaultBlockifyGraph, createDefaultBlockMosaicGraph } from '../../src/services/operators/blockEffectGraphs';
import { effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const source = ([u, v]: [number, number]): [number, number, number, number] => [u, v, .8, .2 + u * .5];
const close = (values: number[]) => values.map(value => expect.closeTo(value, 8));

describe('block sampling image graphs', () => {
  it('matches Blockify snapped color, posterization, clamp and sampled alpha', () => {
    const graph = createDefaultBlockifyGraph();
    expect(graph.nodes.length).toBeLessThanOrEqual(64);
    const plan = compileImageOperatorGraph(graph, { scale: 16, amount: .75 });
    const uv: [number, number] = [0, .37], resolution: [number, number] = [100, 50];
    const snapped: [number, number] = [.08, .48];
    const sampled = source(snapped), current = source([.001, .37]);
    const poster = sampled.slice(0, 3).map(value => Math.floor(value * 8) / 7);
    const expectedRgb = current.slice(0, 3).map((value, index) => value * .25 + poster[index] * .75);
    const result = evaluateImageOperatorPlan(plan, source(uv), { uv, resolution, sampleImage: source });
    expect(result).toEqual(close([...expectedRgb, sampled[3]]));
  });

  it('matches deterministic Mosaic hash/border/color and keeps time out of the key', () => {
    const graph = createDefaultBlockMosaicGraph();
    expect(graph.nodes.length).toBeLessThanOrEqual(64);
    const params = { scale: 22, amount: .75, speed: 1, colorA: '#111827' };
    const plan = compileImageOperatorGraph(graph, params);
    expect(plan.capabilities).toEqual(['uv', 'resolution', 'time', 'sample']);
    expect(plan.wgsl).toContain('fn imageGraphHash2d(');
    const context = { uv: [.31, .63] as [number, number], resolution: [192, 108] as [number, number], timelineTimeSeconds: 2, sampleImage: source };
    const first = evaluateImageOperatorPlan(plan, source(context.uv), context);
    const second = evaluateImageOperatorPlan(compileImageOperatorGraph(graph, params), source(context.uv), context);
    expect(second).toEqual(first);
    const coarse = context.uv.map((value, index) => Math.floor(value * context.resolution[index] / 22));
    const hashInput = coarse.map(value => value + 2);
    const p2 = [hashInput[0] * 127.1 + hashInput[1] * 311.7, hashInput[0] * 269.5 + hashInput[1] * 183.3];
    const sineHash = Math.sin(p2[0] * 12.9898 + p2[1] * 78.233) * 43758.5453;
    const block = 22 * ((sineHash - Math.floor(sineHash)) > .68 ? 2 : 1);
    const snapped = context.uv.map((value, index) => Math.max(.001, Math.min(.999,
      (Math.floor(value * context.resolution[index] / block) + .5) * block / context.resolution[index]))) as [number, number];
    const sampled = source(snapped), current = source(context.uv);
    const borderCell = context.uv.map((value, index) => value * context.resolution[index] / block);
    const border = Math.min(...borderCell.map(value => value - Math.floor(value))) < .04 ? 0 : 1;
    const ink = colorToRgba('#111827', '#111827').slice(0, 3).map(value => value * .35);
    const mosaic = ink.map((value, index) => value * (1 - border) + sampled[index] * border);
    const expected = current.slice(0, 3).map((value, index) => value * .25 + mosaic[index] * .75);
    expect(first).toEqual(close([...expected, sampled[3]]));
  });

  it('uses the shared catalog parser for dynamic and invalid bound colors', () => {
    const graph = createDefaultBlockMosaicGraph();
    const colorNode = graph.nodes.find(node => node.id === 'color-a');
    expect(colorNode?.constants).toBeUndefined();
    const ownerParams = effectOperatorParams({
      type: 'block-mosaic', params: { scale: 22, amount: .75, speed: 1, colorA: '11223380' },
    });
    expect(typeof ownerParams.colorA).toBe('string');
    expect(ownerParams.colorA).toBe('#11223380');
    const valid = compileImageOperatorGraph(graph, ownerParams);
    if (!colorNode?.bindings) throw new Error('Default Mosaic graph is missing its bound color node');
    colorNode.bindings.value = 'colorB';
    const invalid = compileImageOperatorGraph(graph, effectOperatorParams({
      type: 'block-mosaic',
      params: { scale: 22, amount: .75, speed: 1, colorB: 'bad' },
    }));
    expect(valid.key).toBe(invalid.key);
    expect(valid.values).toEqual(expect.arrayContaining(colorToRgba('#11223380', '#111827')));
    expect(invalid.values).toEqual(expect.arrayContaining(colorToRgba('bad', '#f8fafc')));
  });
});
