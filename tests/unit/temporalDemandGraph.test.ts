import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { temporalDemandGraph, temporalCurrentGraph, temporalGraphQueries } from '../../src/services/operators/temporalDemandGraph';
import { createDefaultSlitScanGraph } from '../../src/services/operators/slitScanEffectGraph';
import { effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

describe('full-resolution temporal demand', () => {
  it('preserves authored map, masks, delay and source coordinates without modifying the graph', () => {
    const graph = createDefaultSlitScanGraph();
    const before = structuredClone(graph);
    const demand = temporalDemandGraph(graph, 'history');
    const plan = compileImageOperatorGraph(demand, { ...getDefaultParams('slit-scan'), delay: 2, mapAmount: 1 },
      effectOperatorCompileContext({ type: 'slit-scan' }));
    const output = evaluateImageOperatorPlan(plan, [1, 0, 0, 1], { uv: [0.3, 0.7], resolution: [1920, 1080],
      timelineTimeSeconds: 4, sampleResource: id => id === 'slit-scan:time-map' ? [0.8, 0.8, 0.8, 1] : [0.25, 0, 0, 1] });
    expect(output[0]).toBeCloseTo(0.3); expect(output[1]).toBeCloseTo(0.7);
    expect(output[2]).toBeCloseTo(1.2); expect(output[3]).toBe(1);
    expect(plan.externalResources?.some(resource => resource.kind === 'input-history')).toBeFalsy();
    expect(graph).toEqual(before);
  });
  it('rejects ambiguous multiple temporal samplers rather than silently replacing their outputs', () => {
    const graph = createDefaultSlitScanGraph();
    graph.nodes.push({ ...graph.nodes.find(node => node.operator === 'image.sample-history')!, id: 'second-history' });
    expect(() => temporalDemandGraph(graph)).toThrow(/exactly one/);
  });
});


it('prepares distinct sampler coordinates, delays and current branches by explicit ID', () => {
  const graph = createDefaultSlitScanGraph();
  const original = graph.nodes.find(node => node.operator === 'image.sample-history')!;
  graph.nodes.push({ ...original, id: 'second-history' },
    { id: 'second-delay', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: .7 } },
    { id: 'second-x', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: .8 } },
    { id: 'second-y', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: .2 } },
    { id: 'second-uv', operator: 'vector.combine.vec2', operatorVersion: 1, bindings: {} },
    { id: 'second-color', operator: 'values.color', operatorVersion: 1, bindings: {}, constants: { value: [.2, .3, .4, .5] } },
    { id: 'second-current', operator: 'convert.vec4-to-image', operatorVersion: 1, bindings: {} });
  for (const [from, output, to, input] of [
    ['second-delay', 'value', 'second-history', 'delay'], ['second-x', 'value', 'second-uv', 'x'],
    ['second-y', 'value', 'second-uv', 'y'], ['second-uv', 'value', 'second-history', 'uv'],
    ['second-color', 'value', 'second-current', 'value'], ['second-current', 'image', 'second-history', 'current'],
  ]) graph.edges.push({ id: `${to}:${input}`, from, output, to, input });
  const before = structuredClone(graph), params = getDefaultParams('slit-scan');
  const context = effectOperatorCompileContext({ type: 'slit-scan' });
  expect(temporalGraphQueries(graph).map(query => query.id)).toContain('second-history');
  const demand = compileImageOperatorGraph(temporalDemandGraph(graph, 'second-history'), params, context);
  expect(evaluateImageOperatorPlan(demand, [1, 0, 0, 1])).toEqual([.8, .2, .7, 1]);
  const current = compileImageOperatorGraph(temporalCurrentGraph(graph, 'second-history'), params, context);
  expect(evaluateImageOperatorPlan(current, [1, 0, 0, 1])).toEqual([.2, .3, .4, .5]);
  expect(() => temporalDemandGraph(graph, 'missing')).toThrow('unavailable');
  expect(graph).toEqual(before);
});
