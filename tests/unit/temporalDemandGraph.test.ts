import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { temporalDemandGraph } from '../../src/services/operators/temporalDemandGraph';
import { createDefaultSlitScanGraph } from '../../src/services/operators/slitScanEffectGraph';
import { effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

describe('full-resolution temporal demand', () => {
  it('preserves authored map, masks, delay and source coordinates without modifying the graph', () => {
    const graph = createDefaultSlitScanGraph();
    const before = structuredClone(graph);
    const demand = temporalDemandGraph(graph);
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
