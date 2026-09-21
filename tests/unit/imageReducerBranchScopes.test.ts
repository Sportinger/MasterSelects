import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, compileImageOperatorPreview, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { createIllegalRootReducerIndexGraph, createKernelReducerBranchGraph, createNestedReducerGraph,
  createRootPureImageSelectGraph, createSequenceReducerBranchGraph } from '../helpers/imageReducerBranchGraphs';

const pixel: [number, number, number, number] = [1, 1, 1, 1];
const rounded = (values: readonly number[]) => values.map(value => Number(value.toFixed(6)));

describe('lexical image reducer branch scopes', () => {
  it.each(['root-first', 'scope-first'] as const)('keeps sequence indices lexical with nested lazy selection (%s)', order => {
    const calls: number[][] = [], plan = compileImageOperatorGraph(createSequenceReducerBranchGraph(order));
    evaluateImageOperatorPlan(plan, pixel, { uv: [.5, .5], sampleImage: uv => { calls.push(rounded(uv)); return pixel; } });
    const loop = [[0, 0], [.333333, 0], [.666667, 1], [1, 1]], root = [.25, .75];
    expect(calls).toEqual(order === 'root-first' ? [root, ...loop] : [...loop, root]);
    expect(plan.wgsl).toContain('fn evaluateImageGraph(');
    expect(plan.wgsl).not.toContain('undefined');
    const branchScopes = plan.instructions.filter(item => item.operation === 'select-image').flatMap(item => item.inputs.slice(1));
    expect(branchScopes).toHaveLength(4);
    branchScopes.forEach(scope => expect(plan.wgsl).not.toContain(`fn evaluateImageScope${scope}`));
    expect(plan.wgsl).toMatch(/fn evaluateSequenceTerm\d+[^]*if \(v\d+\)/);
    const reducerScope = plan.sequenceScopes![0].id;
    expect(plan.instructions.filter(item => item.nodeId === 'uv-high')).not.toContainEqual(expect.objectContaining({ scope: reducerScope }));
  });

  it('forwards sequence progress into the sampled image expression', () => {
    const graph = createSequenceReducerBranchGraph('root-first');
    graph.nodes.push({ id: 'loop-source', operator: 'math.multiply.image-scalar', operatorVersion: 1, bindings: {} });
    graph.edges.push({ id: 'source-loop-source-a', from: 'source', output: 'value', to: 'loop-source', input: 'a' },
      { id: 'index-loop-source-b', from: 'index', output: 't', to: 'loop-source', input: 'b' });
    for (const edge of graph.edges) if ((edge.to === 'sample-low' || edge.to === 'sample-high') && edge.input === 'image') {
      edge.from = 'loop-source'; edge.output = 'value';
    }
    const calls: number[][] = [], plan = compileImageOperatorGraph(graph);
    const result = evaluateImageOperatorPlan(plan, pixel, { uv: [.5, .5], sampleImage: uv => {
      calls.push(rounded(uv)); return [uv[0], uv[1], 1, 1];
    } });
    expect(calls).toEqual([[.25, .75], [0, 0], [.333333, 0], [.666667, 1], [1, 1]]);
    const terms = [0, 1 / 3, 2 / 3, 1], mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(result[0]).toBeCloseTo(mean(terms.map(t => t * t * .5)), 12);
    expect(result[1]).toBeCloseTo(mean(terms.map(t => (t > .5 ? 1 : 0) * t * .5)), 12);
    expect(result[2]).toBeCloseTo(mean(terms.map(t => t * .5)), 12);
    expect(result[3]).toBeCloseTo(mean(terms.map(t => t * .5)), 12);
  });

  it.each([{ kind: 'grid' as const, order: 'root-first' as const, count: 10 },
    { kind: 'grid' as const, order: 'scope-first' as const, count: 10 },
    { kind: 'rect' as const, order: 'root-first' as const, count: 5 }])('evaluates only the chosen kernel branch for $kind/$order', ({ kind, order, count }) => {
    const calls: number[][] = [], plan = compileImageOperatorGraph(createKernelReducerBranchGraph(kind, order));
    evaluateImageOperatorPlan(plan, pixel, { uv: [.5, .5], sampleImage: uv => { calls.push(rounded(uv)); return pixel; } });
    expect(calls).toHaveLength(count);
    const root = [.25, .75], loop = kind === 'grid'
      ? [[.4, .4], [.4, .5], [.4, .6], [.5, .4], [.5, .5], [.5, .6], [.8, .4], [.8, .5], [.8, .6]]
      : [[.5, .5], [.5, .6], [.8, .5], [.8, .6]];
    expect(calls).toEqual(order === 'root-first' ? [root, ...loop] : [...loop, root]);
    expect(plan.wgsl).not.toContain('undefined');
    if (kind === 'grid') {
      const shared = plan.instructions.filter(item => item.nodeId === 'x-base');
      expect(shared).toHaveLength(1);
      expect(shared[0].scope).toBe(plan.kernelScopes![0].id);
    }
  });

  it('compiles a root lazy image select without inventing UV context', () => {
    const plan = compileImageOperatorGraph(createRootPureImageSelectGraph());
    expect(plan.capabilities).not.toContain('uv');
    expect(plan.wgsl).not.toContain('undefined');
    expect(plan.wgsl).toMatch(/fn evaluateImageGraph\([^]*if \(v\d+\)/);
    expect(plan.wgsl).not.toContain('fn evaluateImageScope');
    expect(evaluateImageOperatorPlan(plan, [.1, .2, .3, .4])).toEqual([.1, .2, .3, .4]);
  });

  it('rejects root indices and nested materialization that captures an outer reducer index', () => {
    expect(() => compileImageOperatorPreview(createIllegalRootReducerIndexGraph('sequence'), {},
      { nodeId: 'index', direction: 'output', portId: 't' })).toThrow(/sequence reduction scope/);
    expect(() => compileImageOperatorPreview(createIllegalRootReducerIndexGraph('kernel'), {},
      { nodeId: 'index', direction: 'output', portId: 'value' })).toThrow(/kernel reduction scope/);
    // The staged inner producer cannot import the outer sequence loop's lexical index.
    expect(() => compileImageOperatorGraph(createNestedReducerGraph())).toThrow(/sequence reduction scope/);
  });
});
