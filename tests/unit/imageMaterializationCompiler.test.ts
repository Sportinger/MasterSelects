import { describe, expect, it } from 'vitest';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {},
  ...(value === undefined ? {} : { constants: { value } }) });
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const graph = (nodes: BoundOperatorNode[], edges: EffectOperatorGraph['edges']): EffectOperatorGraph => ({
  version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: {},
});

describe('image graph materialization planning', () => {
  it('creates one rgba16float producer and a typed resource lookup for an explicit barrier', () => {
    const source = graph([node('frame', 'image.frame'), node('store', 'image.materialize'), node('output', 'image.output')],
      [edge('frame', 'image', 'store', 'image'), edge('store', 'image', 'output', 'image')]);
    const plan = compileImageOperatorGraph(source);
    expect(plan.resources).toEqual([{ id: 'image-resource:store:image', producerPassId: 'image-pass:store', format: 'rgba16float' }]);
    expect(plan.passes).toHaveLength(2);
    expect(plan.passes?.[0].program.passes).toBeUndefined();
    expect(plan.resourceInputs).toEqual(['image-resource:store:image']);
    expect(plan.wgsl).toContain('sampleImageGraphResource0(inputUv)');
    expect(getEffectOperator('image.materialize')?.fusion).toBe('pass-boundary');
    expect(compileImageOperatorPreview(source, {}, { nodeId: 'store', direction: 'output', portId: 'image' }).previewResourceId)
      .toBe('image-resource:store:image');
    expect(() => evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: [.2, .3] })).toThrow(/resource sampling callback/);
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0], {
      uv: [.2, .3], sampleResource: (id, uv) => [id.length, uv[0], uv[1], 1],
    })).toEqual([26, .2, .3, 1]);
  });

  it('memoizes one producer when a materialized image fans out', () => {
    const source = graph([node('frame', 'image.frame'), node('store', 'image.materialize'),
      { ...node('condition', 'values.boolean'), constants: { value: true } }, node('select', 'control.select.image'), node('output', 'image.output')], [
      edge('frame', 'image', 'store', 'image'), edge('condition', 'value', 'select', 'condition'),
      edge('store', 'image', 'select', 'falseValue'), edge('store', 'image', 'select', 'trueValue'), edge('select', 'image', 'output', 'image'),
    ]);
    const plan = compileImageOperatorGraph(source);
    expect(plan.resources).toHaveLength(1);
    expect(plan.passes?.filter(item => item.outputResource)).toHaveLength(1);
    expect(plan.resourceInputs).toEqual(['image-resource:store:image']);
  });

  it('automatically cuts a kernel-dependent image before a consuming kernel', () => {
    const nodes = [node('frame', 'image.frame'), node('weight', 'values.number', 1), node('extent', 'values.number', 0),
      node('inner', 'image.kernel-grid-reduce'), node('inner-image', 'convert.vec4-to-image'), node('outer', 'image.kernel-grid-reduce'),
      node('final-image', 'convert.vec4-to-image'), node('output', 'image.output')];
    const source = graph(nodes, [edge('frame', 'image', 'inner', 'sample'), edge('weight', 'value', 'inner', 'weight'), edge('extent', 'value', 'inner', 'extent'),
      edge('inner', 'sum', 'inner-image', 'value'), edge('inner-image', 'image', 'outer', 'sample'), edge('weight', 'value', 'outer', 'weight'),
      edge('extent', 'value', 'outer', 'extent'), edge('outer', 'sum', 'final-image', 'value'), edge('final-image', 'image', 'output', 'image')]);
    const plan = compileImageOperatorGraph(source);
    expect(plan.resources).toEqual([{ id: 'image-resource:inner-image:image', producerPassId: 'image-pass:inner-image:image', format: 'rgba16float' }]);
    expect(plan.passes).toHaveLength(2);
  });

  it('uses an explicit horizontal-to-vertical barrier without adding a second automatic cut', () => {
    const nodes = [node('frame', 'image.frame'), node('weight', 'values.number', 1), node('extent', 'values.number', 0),
      node('horizontal', 'image.kernel-grid-reduce'), node('horizontal-image', 'convert.vec4-to-image'), node('store', 'image.materialize'),
      node('vertical', 'image.kernel-grid-reduce'), node('final-image', 'convert.vec4-to-image'), node('output', 'image.output')];
    const source = graph(nodes, [edge('frame', 'image', 'horizontal', 'sample'), edge('weight', 'value', 'horizontal', 'weight'),
      edge('extent', 'value', 'horizontal', 'extent'), edge('horizontal', 'sum', 'horizontal-image', 'value'),
      edge('horizontal-image', 'image', 'store', 'image'), edge('store', 'image', 'vertical', 'sample'),
      edge('weight', 'value', 'vertical', 'weight'), edge('extent', 'value', 'vertical', 'extent'),
      edge('vertical', 'sum', 'final-image', 'value'), edge('final-image', 'image', 'output', 'image')]);
    const plan = compileImageOperatorGraph(source);
    expect(plan.resources).toHaveLength(1);
    expect(plan.passes).toHaveLength(2);
  });

  it('plans a three-kernel chain with one memoized producer per boundary', () => {
    const nodes = [node('frame', 'image.frame'), node('weight', 'values.number', 1), node('extent', 'values.number', 0),
      node('a', 'image.kernel-grid-reduce'), node('a-image', 'convert.vec4-to-image'),
      node('b', 'image.kernel-grid-reduce'), node('b-image', 'convert.vec4-to-image'),
      node('c', 'image.kernel-grid-reduce'), node('c-image', 'convert.vec4-to-image'), node('output', 'image.output')];
    const edges = [edge('frame', 'image', 'a', 'sample'), edge('a', 'sum', 'a-image', 'value'),
      edge('a-image', 'image', 'b', 'sample'), edge('b', 'sum', 'b-image', 'value'),
      edge('b-image', 'image', 'c', 'sample'), edge('c', 'sum', 'c-image', 'value'), edge('c-image', 'image', 'output', 'image')];
    for (const id of ['a', 'b', 'c']) edges.push(edge('weight', 'value', id, 'weight'), edge('extent', 'value', id, 'extent'));
    const plan = compileImageOperatorGraph(graph(nodes, edges));
    expect(plan.resources?.map(item => item.id)).toEqual(['image-resource:a-image:image', 'image-resource:b-image:image']);
    expect(plan.passes).toHaveLength(3);
    expect(plan.passes?.[1].inputResources).toEqual(['image-resource:a-image:image']);
  });

  it('keeps structural keys stable across bound values and rejects cycles before planning', () => {
    const source = graph([node('frame', 'image.frame'), { ...node('amount', 'values.number'), bindings: { value: 'amount' } },
      node('store', 'image.materialize'), node('output', 'image.output')],
    [edge('frame', 'image', 'store', 'image'), edge('store', 'image', 'output', 'image')]);
    expect(compileImageOperatorGraph(source, { amount: 1 }).key).toBe(compileImageOperatorGraph(source, { amount: 2 }).key);
    source.edges.push(edge('store', 'image', 'store', 'image'));
    expect(() => compileImageOperatorGraph(source)).toThrow(/connected more than once|cycle/);
  });

  it('rejects a forged persisted compiler resource input', () => {
    const source = graph([{ ...node('resource', 'image.resource-input'), bindings: { resource: 'forged' } }, node('output', 'image.output')],
      [edge('resource', 'image', 'output', 'image')]);
    expect(() => compileImageOperatorGraph(source)).toThrow('image.resource-input is compiler-internal and cannot be persisted.');
  });
});
