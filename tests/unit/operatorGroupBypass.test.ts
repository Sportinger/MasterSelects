import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, createDefaultInvertImageGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { applyOperatorGroupBypasses, operatorGroupBypassRoutes } from '../../src/services/operators/operatorGroupBypass';
import { packOperatorCompositions, expandOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { effectOperatorGraph, effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams } from '../../src/effects';
import { evaluateMaterializedImage } from '../helpers/evaluateMaterializedImage';
import { createInitialSlitScanGraph } from '../../src/services/operators/slitScanGraphUpgrade';

const input: [number, number, number, number] = [.2, .7, 1, .35];
function grouped() {
  const graph = createDefaultInvertImageGraph();
  graph.groups = [
    { id: 'parent', label: 'Color', color: '#ffffff', nodeIds: [] },
    { id: 'invert', label: 'Invert', color: '#ffffff', parentId: 'parent',
      nodeIds: graph.nodes.filter(node => !['frame', 'output'].includes(node.id)).map(node => node.id) },
  ];
  return graph;
}
describe('operator group bypass', () => {
  it('starts new Slit Scan optional sections bypassed without changing the core scan', () => {
    const graph = createInitialSlitScanGraph();
    const optional = ['scan-protection', 'subject-protection', 'time-map', 'rgb-time',
      'field-shaping', 'field-combination', 'field-noise', 'field-motion'];
    for (const id of optional) {
      const group = graph.groups?.find(group => group.id === id);
      expect(group?.bypassed, id).toBe(true);
      expect(operatorGroupBypassRoutes(graph, group!)?.size, id).toBeGreaterThan(0);
    }
    expect(graph.groups?.find(group => group.id === 'scan-history')?.bypassed).not.toBe(true);
    const effect = { type: 'slit-scan', params: getDefaultParams('slit-scan'), operatorGraph: graph };
    expect(() => effectOperatorGraph(effect)).not.toThrow();
  });
  it('removes mask protection from the rendered Slit Scan result, not just its UI state', () => {
    const effect = { type: 'slit-scan', params: getDefaultParams('slit-scan') };
    const graph = effectOperatorGraph(effect);
    const evaluate = () => evaluateMaterializedImage(compileImageOperatorGraph(graph, effect.params, effectOperatorCompileContext(effect)), [0, 0, 0, 1], {
      uv: [1, .5], resolution: [100, 100], timelineTimeSeconds: 0,
      sampleResource: id => id === 'slit-scan:protection' ? [1, 0, 0, 1] : [0, 0, 0, 1],
      sampleInputHistory: (_uv, delay) => [delay, delay, delay, 1],
    });
    expect(evaluate()[0]).toBe(0);
    graph.groups!.find(group => group.id === 'subject-protection')!.bypassed = true;
    expect(evaluate()[0]).toBeCloseTo(1);
  });
  it.each(['time-map', 'subject-protection', 'scan-protection'])('retains the Slit Scan %s bypass through owner normalization', id => {
    const effect = { type: 'slit-scan', params: getDefaultParams('slit-scan') };
    const graph = effectOperatorGraph(effect);
    const group = graph.groups!.find(group => group.id === id)!;
    expect(group).toBeDefined();
    expect(operatorGroupBypassRoutes(graph, group)?.size).toBeGreaterThan(0);
    group.bypassed = true;
    const restored = effectOperatorGraph({ ...effect, operatorGraph: packOperatorCompositions(graph) });
    expect(restored.groups!.find(group => group.id === id)?.bypassed).toBe(true);
    expect(() => compileImageOperatorGraph(restored, effect.params, effectOperatorCompileContext(effect))).not.toThrow();
  });
  it('skips the entire group in the real image compiler and restores its exact output', () => {
    const graph = grouped(), original = structuredClone(graph);
    const before = evaluateImageOperatorPlan(compileImageOperatorGraph(graph), input);
    expect(before[0]).toBe(.8);
    graph.groups![1].bypassed = true;
    const plan = compileImageOperatorGraph(graph);
    expect(evaluateImageOperatorPlan(plan, input)).toEqual(input);
    expect(plan.instructions.some(instruction => instruction.operation === 'subtract')).toBe(false);
    expect(graph.edges).toEqual(original.edges);
    expect(graph.nodes).toEqual(original.nodes);
    graph.groups![1].bypassed = false;
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(graph), input)).toEqual(before);
  });

  it('preserves child states through parent toggles and serialized composition round trips', () => {
    const graph = grouped();
    graph.groups![1].bypassed = true;
    graph.groups![0].bypassed = true;
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(graph), input)).toEqual(input);
    const restored = expandOperatorCompositions(JSON.parse(JSON.stringify(packOperatorCompositions(graph))));
    restored.groups![0].bypassed = false;
    expect(restored.groups![1].bypassed).toBe(true);
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(restored), input)).toEqual(input);
  });

  it('does not guess between multiple inputs of the same signal type', () => {
    const graph = grouped();
    graph.groups = [{ id: 'red', label: 'Red', color: '#ffffff', nodeIds: ['invert-r'] }];
    expect(operatorGroupBypassRoutes(graph, graph.groups[0])).toBeUndefined();
    graph.groups[0].bypassed = true;
    expect(() => applyOperatorGroupBypasses(graph)).toThrow('unambiguous bypass boundary');
  });

  it('does not offer a bypass to an external input downstream of the group', () => {
    const graph = grouped();
    graph.groups = [{ id: 'interleaved', label: 'Interleaved', color: '#ffffff', nodeIds: ['rgba', 'image'] }];
    expect(operatorGroupBypassRoutes(graph, graph.groups[0])).toBeUndefined();
  });
});
