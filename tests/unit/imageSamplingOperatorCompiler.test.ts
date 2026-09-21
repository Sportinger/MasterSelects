import { describe, expect, it } from 'vitest';
import { createDefaultMirrorGraph, createDefaultPixelateGraph, createDefaultRgbSplitGraph } from '../../src/services/operators/samplingEffectGraphs';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const sample = ([u, v]: [number, number]): [number, number, number, number] => [u, v, u + v, .4];

describe('scoped image sampling compiler', () => {
  it('pixelates with source resolution and no intermediate pass', () => {
    const plan = compileImageOperatorGraph(createDefaultPixelateGraph(), { size: 8 });
    expect(plan.capabilities).toEqual(['uv', 'resolution', 'sample']);
    expect(plan.wgsl).toContain('sampleImageGraphSource(');
    expect(() => evaluateImageOperatorPlan(plan, [0, 0, 0, 1], { uv: [.12, .34], resolution: [100, 50] })).toThrow(/sampling callback/);
    const result = evaluateImageOperatorPlan(plan, [0, 0, 0, 1], { uv: [.12, .34], resolution: [100, 50], sampleImage: sample });
    expect(result).toEqual([.12, .4, .52, .4].map(value => expect.closeTo(value, 10)));
  });

  it('uses exact bound booleans for conditional mirror coordinates', () => {
    const graph = createDefaultMirrorGraph();
    const horizontal = compileImageOperatorGraph(graph, { horizontal: true, vertical: false });
    const vertical = compileImageOperatorGraph(graph, { horizontal: false, vertical: true });
    expect(horizontal.key).toBe(vertical.key);
    expect(evaluateImageOperatorPlan(horizontal, [0, 0, 0, 1], { uv: [.8, .7], sampleImage: sample }))
      .toEqual([.2, .7, .9, .4].map(value => expect.closeTo(value, 10)));
    expect(evaluateImageOperatorPlan(vertical, [0, 0, 0, 1], { uv: [.8, .7], sampleImage: sample }))
      .toEqual([.8, .3, 1.1, .4].map(value => expect.closeTo(value, 10)));
    const literalGraph = createDefaultMirrorGraph();
    for (const id of ['horizontal', 'vertical']) {
      const item = literalGraph.nodes.find(node => node.id === id)!; item.bindings = {}; item.constants = { value: false };
    }
    const literalPlan = compileImageOperatorGraph(literalGraph);
    expect(literalPlan.values).toEqual([]);
    expect(literalPlan.instructions.filter(item => item.type === 'boolean' && item.operation === 'constant').map(item => item.value)).toEqual([0, 0]);
  });

  it('shares one upstream coordinate scope across RGB split samples', () => {
    const plan = compileImageOperatorGraph(createDefaultRgbSplitGraph(), { amount: .1, angle: 0 });
    expect(plan.sampleScopes).toHaveLength(1);
    const result = evaluateImageOperatorPlan(plan, [0, 0, 0, 1], { uv: [.4, .25], sampleImage: sample });
    expect(result).toEqual([.5, .25, .55, .4].map(value => expect.closeTo(value, 10)));
  });

  it('rejects physical feedback cycles before expanding sample scopes', () => {
    const graph = createDefaultPixelateGraph();
    graph.edges = graph.edges.map(edge => edge.from === 'frame' && edge.to === 'sample' ? { ...edge, from: 'sample' } : edge);
    expect(() => compileImageOperatorGraph(graph, { size: 8 })).toThrow(/cycle/);
  });

  it('reserves distinct scopes for nested sampling', () => {
    const graph = createDefaultPixelateGraph();
    graph.nodes.push({ id: 'inner-sample', operator: 'image.sample', operatorVersion: 1, bindings: {} });
    graph.edges = graph.edges.map(edge => edge.from === 'frame' && edge.to === 'sample' ? { ...edge, from: 'inner-sample' } : edge);
    graph.edges.push({ id: 'frame-inner', from: 'frame', output: 'image', to: 'inner-sample', input: 'image' },
      { id: 'uv-inner', from: 'uv', output: 'uv', to: 'inner-sample', input: 'uv' });
    const plan = compileImageOperatorGraph(graph, { size: 8 });
    expect(plan.sampleScopes.map(scope => scope.id).toSorted()).toEqual([1, 2]);
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 1], { uv: [.12, .34], resolution: [100, 50], sampleImage: sample }))
      .toEqual([.12, .4, .52, .4].map(value => expect.closeTo(value, 10)));
  });
});
