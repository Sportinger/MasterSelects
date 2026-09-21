import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const node = (id: string, operator: string, bindings: Record<string, string> = {}): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings });
const edge = (from: string, output: string, to: string, input: string) =>
  ({ id: `${from}-${to}-${input}`, from, output, to, input });
const graph = (nodes: BoundOperatorNode[], edges: EffectOperatorGraph['edges']): EffectOperatorGraph =>
  ({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: {} });

function twoInputGraph(): EffectOperatorGraph {
  return graph([
    node('source', 'image.named-input', { resource: 'source' }), node('decoded', 'image.named-input', { resource: 'decoded' }),
    node('uv', 'image.normalized-uv'), node('source-sample', 'image.sample'), node('decoded-sample', 'image.sample'),
    node('source-vec', 'convert.image-to-vec4'), node('decoded-vec', 'convert.image-to-vec4'),
    { ...node('amount', 'values.number'), constants: { value: .5 } }, node('mix', 'math.mix.vec4'),
    node('image', 'convert.vec4-to-image'), node('output', 'image.output'),
  ], [
    edge('source', 'image', 'source-sample', 'image'), edge('uv', 'uv', 'source-sample', 'uv'),
    edge('decoded', 'image', 'decoded-sample', 'image'), edge('uv', 'uv', 'decoded-sample', 'uv'),
    edge('source-sample', 'image', 'source-vec', 'image'), edge('decoded-sample', 'image', 'decoded-vec', 'image'),
    edge('source-vec', 'value', 'mix', 'a'), edge('decoded-vec', 'value', 'mix', 'b'), edge('amount', 'value', 'mix', 't'),
    edge('mix', 'value', 'image', 'value'), edge('image', 'image', 'output', 'image'),
  ]);
}

describe('named image compiler inputs', () => {
  it('keeps two named sources distinct through coordinate-scoped sampling', () => {
    const plan = compileImageOperatorGraph(twoInputGraph(), {}, { namedImages: [
      { id: 'source', sampling: 'manual-bilinear-clamp' }, { id: 'decoded', sampling: 'hardware-linear-clamp' },
    ] });
    expect(Object.fromEntries(plan.resourceInputs!.map((id, index) => [id, plan.resourceSampling![index]]))).toEqual({
      source: 'manual-bilinear-clamp', decoded: 'hardware-linear-clamp',
    });
    const calls: Array<[string, number, number]> = [];
    const result = evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.25, .75], sampleImage: () => [0, 0, 0, 0], sampleResource: (id, uv) => {
      calls.push([id, ...uv]); return id === 'source' ? [uv[0], uv[1], 0, 1] : [1, 0, uv[0] + uv[1], .5];
    } });
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining([['source', .25, .75], ['decoded', .25, .75]]));
    expect(result).toEqual([.625, .375, .5, .75]);
  });

  it('rejects missing, unknown, and duplicate named declarations', () => {
    const source = twoInputGraph();
    expect(() => compileImageOperatorGraph(source)).toThrow(/source is not declared/);
    expect(() => compileImageOperatorGraph(source, {}, { namedImages: [{ id: 'other', sampling: 'hardware-linear-clamp' }] }))
      .toThrow(/source is not declared/);
    expect(() => compileImageOperatorGraph(source, {}, { namedImages: [
      { id: 'source', sampling: 'hardware-linear-clamp' }, { id: 'source', sampling: 'manual-bilinear-clamp' },
    ] })).toThrow(/Duplicate image named input declaration/);
    expect(() => compileImageOperatorGraph(source, {}, { namedImages: [
      { id: 'image-resource:store:image', sampling: 'hardware-linear-clamp' },
    ] })).toThrow(/reserved compiler resource namespace/);
    expect(() => compileImageOperatorGraph(source, {}, { namedImages: [
      { id: 'glyph-atlas:atlas', sampling: 'hardware-linear-clamp' },
    ] })).toThrow(/reserved compiler resource namespace/);
    expect(() => compileImageOperatorGraph(source, {}, { namedImages: [
      { id: 7, sampling: 'hardware-linear-clamp' },
    ] as never })).toThrow(/non-empty string id/);
  });

  it('includes the sampling contract in the structural key', () => {
    const source = graph([node('named', 'image.named-input', { resource: 'source' }), node('output', 'image.output')],
      [edge('named', 'image', 'output', 'image')]);
    const compile = (sampling: 'hardware-linear-clamp' | 'manual-bilinear-clamp') =>
      compileImageOperatorGraph(source, {}, { namedImages: [{ id: 'source', sampling }] });
    expect(compile('hardware-linear-clamp').key).not.toBe(compile('manual-bilinear-clamp').key);
  });

  it('keeps compiler materializations hardware-linear compatible', () => {
    const source = graph([node('frame', 'image.frame'), node('store', 'image.materialize'), node('output', 'image.output')],
      [edge('frame', 'image', 'store', 'image'), edge('store', 'image', 'output', 'image')]);
    const plan = compileImageOperatorGraph(source);
    expect(plan.resourceSampling).toEqual(['hardware-linear-clamp']);
    expect(plan.passes?.at(-1)?.program.resourceSampling).toEqual(['hardware-linear-clamp']);
  });
});
