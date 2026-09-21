import { describe, expect, it } from 'vitest';
import type { ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createImageOperatorEvaluator, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorEvaluation';
import { createSequenceReducerBranchGraph } from '../helpers/imageReducerBranchGraphs';

describe('prepared image operator evaluator', () => {
  it('reads portable parameter values freshly on every invocation', () => {
    const plan: ImageOperatorPlan = { fusion: 'inline', capabilities: [], instructions: [
      { nodeId: 'parameter', operation: 'parameter', type: 'scalar', inputs: [], value: 0, scope: 0 },
    ], output: 0, sampleScopes: [], values: [.2], key: 'prepared-parameter', wgsl: '' };
    const evaluate = createImageOperatorEvaluator(plan);
    expect(evaluate([0, 0, 0, 0])).toEqual([.2, .2, .2, 1]);
    (plan.values as number[])[0] = .75;
    expect(evaluate([1, 1, 1, 1])).toEqual([.75, .75, .75, 1]);
  });

  it('reuses indexed nested scopes with fresh pixels and sampling contexts', () => {
    const plan = compileImageOperatorGraph(createSequenceReducerBranchGraph('scope-first'));
    const evaluate = createImageOperatorEvaluator(plan), firstCalls: number[][] = [], secondCalls: number[][] = [];
    const first = evaluate([.1, .2, .3, .4], { uv: [.5, .5], sampleImage: uv => {
      firstCalls.push(uv); return [uv[0], uv[1], .25, .5];
    } });
    const second = evaluate([.9, .8, .7, .6], { uv: [.25, .75], sampleImage: uv => {
      secondCalls.push(uv); return [1 - uv[0], 1 - uv[1], .75, .25];
    } });
    expect(firstCalls).toHaveLength(5);
    expect(secondCalls).toHaveLength(5);
    expect(second).not.toEqual(first);
    expect(first).toEqual(evaluateImageOperatorPlan(plan, [.1, .2, .3, .4], { uv: [.5, .5], sampleImage: uv => [uv[0], uv[1], .25, .5] }));
  });
});
