import { describe, expect, it } from 'vitest';
import {
  MOTION_PARENT_ERROR_CODES,
  MOTION_PARENT_GRAPH_BUDGETS,
  MOTION_PARENT_STABLE_ID_POLICY,
  type MotionParentGraphEvaluation,
  type MotionParentGraphNode,
  type MotionParentGraphSnapshot,
} from '../../src/services/motionDesign/structure/contracts';
import {
  MD6_CONTRACT_FIXTURE_IDS,
  createMotionParentContractEvaluationFixture,
  createMotionParentContractGraphFixture,
  createMotionParentContractTransform,
} from '../../src/services/motionDesign/structure/contractFixtures';
import {
  createMotionParentGraphSnapshot,
  evaluateMotionParentGraphWorldTransforms,
  planMotionParentMutation,
  planMotionParentRemap,
  validateMotionParentGraph,
} from '../../src/services/motionDesign/structure/parentGraphPlanner';
import { deriveMotionParentLocalTransform2D } from '../../src/services/motionDesign/structure/parentTransformMath';
import { isValidMotionParentStableId } from '../../src/services/motionDesign/structure/stableId';

const ids = MD6_CONTRACT_FIXTURE_IDS;

function asGraph(value: unknown): MotionParentGraphSnapshot {
  return value as MotionParentGraphSnapshot;
}

function asEvaluation(value: unknown): MotionParentGraphEvaluation {
  return value as MotionParentGraphEvaluation;
}

function createAdversarialArray<T>(
  values: readonly T[],
  counter: { calls: number },
): readonly T[] {
  class AdversarialArray extends Array<T> {}
  const fail = (): never => {
    counter.calls += 1;
    throw new Error('Adversarial array method must not execute.');
  };
  Object.defineProperties(AdversarialArray.prototype, {
    [Symbol.iterator]: { configurable: true, value: fail },
    map: { configurable: true, value: fail },
    find: { configurable: true, value: fail },
    forEach: { configurable: true, value: fail },
  });
  const array = new AdversarialArray<T>();
  for (let index = 0; index < values.length; index += 1) {
    Array.prototype.push.call(array, values[index]);
  }
  return array;
}

function createChainGraph(nodeCount: number): MotionParentGraphSnapshot {
  const nodes: MotionParentGraphNode[] = Array.from({ length: nodeCount }, (_, index) => ({
    clipId: `node-${String(index).padStart(5, '0')}`,
    compositionId: 'comp',
    space: '2d',
    ...(index > 0
      ? { parentClipId: `node-${String(index - 1).padStart(5, '0')}` }
      : {}),
  }));
  return createMotionParentGraphSnapshot(nodes);
}

describe('MD6 structure envelope and budget freeze', () => {
  it('rejects unknown runtime fields on graph, node, and evaluation envelopes', () => {
    const graph = createMotionParentContractGraphFixture();
    const graphWithRuntime = { ...graph, runtimeHandle: {} };
    expect(validateMotionParentGraph(asGraph(graphWithRuntime))[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);

    const nodeWithRuntime = { ...graph.nodes[0], runtimeHandle: {} };
    const graphWithRuntimeNode = {
      ...graph,
      nodes: [nodeWithRuntime, ...graph.nodes.slice(1)],
    };
    expect(validateMotionParentGraph(asGraph(graphWithRuntimeNode))[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);

    const evaluation = createMotionParentContractEvaluationFixture(1);
    const evaluationWithRuntime = { ...evaluation, runtimeHandle: {} };
    expect(evaluateMotionParentGraphWorldTransforms(
      graph,
      asEvaluation(evaluationWithRuntime),
    ).failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID);

    const transformWithRuntime = {
      ...evaluation.localTransforms[0].transform,
      runtimeHandle: {},
    };
    const evaluationWithRuntimeTransform = {
      ...evaluation,
      localTransforms: [
        { ...evaluation.localTransforms[0], transform: transformWithRuntime },
        ...evaluation.localTransforms.slice(1),
      ],
    };
    expect(evaluateMotionParentGraphWorldTransforms(
      graph,
      asEvaluation(evaluationWithRuntimeTransform),
    ).failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID);
  });

  it('rejects symbol properties and sparse arrays deterministically', () => {
    const symbolNode = {
      clipId: 'symbol-node',
      compositionId: 'comp',
      space: '2d',
    };
    Object.defineProperty(symbolNode, Symbol('runtime'), {
      enumerable: true,
      value: {},
    });
    const symbolGraph = {
      version: 1,
      revision: 'invalid',
      nodes: [symbolNode],
    };
    expect(validateMotionParentGraph(asGraph(symbolGraph))[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);

    const sparseNodes = new Array<MotionParentGraphNode>(1);
    const sparseGraph = { version: 1, revision: 'invalid', nodes: sparseNodes };
    expect(validateMotionParentGraph(asGraph(sparseGraph))[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);

    const graph = createMotionParentContractGraphFixture();
    const sparseTransforms = new Array<MotionParentGraphEvaluation['localTransforms'][number]>(
      graph.nodes.length,
    );
    const sparseEvaluation = { timelineTime: 0, localTransforms: sparseTransforms };
    expect(evaluateMotionParentGraphWorldTransforms(
      graph,
      asEvaluation(sparseEvaluation),
    ).failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID);
  });

  it('never invokes accessors while rejecting graph and node envelopes', () => {
    let graphGetterCalls = 0;
    const graphWithGetter: Record<string, unknown> = {
      version: 1,
      revision: 'invalid',
    };
    Object.defineProperty(graphWithGetter, 'nodes', {
      enumerable: true,
      get: () => {
        graphGetterCalls += 1;
        return [];
      },
    });
    expect(() => validateMotionParentGraph(asGraph(graphWithGetter))).not.toThrow();
    expect(validateMotionParentGraph(asGraph(graphWithGetter))[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);
    expect(graphGetterCalls).toBe(0);

    let nodeGetterCalls = 0;
    const nodeWithGetter: Record<string, unknown> = {
      compositionId: 'comp',
      space: '2d',
    };
    Object.defineProperty(nodeWithGetter, 'clipId', {
      enumerable: true,
      get: () => {
        nodeGetterCalls += 1;
        return 'node';
      },
    });
    const graph = { version: 1, revision: 'invalid', nodes: [nodeWithGetter] };
    expect(() => validateMotionParentGraph(asGraph(graph))).not.toThrow();
    expect(validateMotionParentGraph(asGraph(graph))[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);
    expect(nodeGetterCalls).toBe(0);
  });

  it('never invokes nested evaluation accessors before failing closed', () => {
    const graph = createMotionParentContractGraphFixture();
    const evaluation = createMotionParentContractEvaluationFixture(0);
    let getterCalls = 0;
    const positionWithGetter: Record<string, unknown> = { y: 0 };
    Object.defineProperty(positionWithGetter, 'x', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 0;
      },
    });
    const malformedEvaluation = {
      ...evaluation,
      localTransforms: [
        {
          ...evaluation.localTransforms[0],
          transform: {
            ...evaluation.localTransforms[0].transform,
            position: positionWithGetter,
          },
        },
        ...evaluation.localTransforms.slice(1),
      ],
    };

    const result = evaluateMotionParentGraphWorldTransforms(
      graph,
      asEvaluation(malformedEvaluation),
    );
    expect(result.worlds).toBeUndefined();
    expect(result.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID);
    expect(getterCalls).toBe(0);
  });

  it('preflights mutation input without invoking its graph accessor', () => {
    let getterCalls = 0;
    const input: Record<string, unknown> = {
      evaluation: createMotionParentContractEvaluationFixture(0),
      childClipId: ids.child,
      parentClipId: ids.parentA,
    };
    Object.defineProperty(input, 'graph', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return createMotionParentContractGraphFixture();
      },
    });

    const result = planMotionParentMutation(input as unknown as Parameters<
      typeof planMotionParentMutation
    >[0]);
    expect(result.ok).toBe(false);
    expect(result.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID);
    expect(getterCalls).toBe(0);
  });

  it('emits canonical apply and undo snapshots without retaining input references', () => {
    const graph = createMotionParentContractGraphFixture();
    const evaluation = createMotionParentContractEvaluationFixture(2.5);
    const result = planMotionParentMutation({
      graph,
      evaluation,
      childClipId: ids.child,
      parentClipId: ids.parentA,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.undo.graph).not.toBe(graph);
    expect(result.plan.undo.graph.nodes).not.toBe(graph.nodes);
    expect(result.plan.apply.graph).not.toBe(graph);
    expect(result.plan.apply.graph.revision).toBe(result.plan.apply.nextRevision);
    expect(result.plan.undo.graph.revision).toBe(result.plan.undo.nextRevision);
    const frozenPlanJson = JSON.stringify(result.plan);

    const mutableGraph = graph as unknown as {
      revision: string;
      nodes: Array<{
        clipId: string;
        compositionId: string;
        space: '2d' | '3d';
        parentClipId?: string;
      }>;
    };
    mutableGraph.revision = 'mutated-after-planning';
    mutableGraph.nodes[0].parentClipId = ids.child;
    mutableGraph.nodes.push({ clipId: 'late-node', compositionId: ids.composition, space: '2d' });
    const mutableEvaluation = evaluation as unknown as {
      localTransforms: Array<{ transform: { opacity: number } }>;
    };
    mutableEvaluation.localTransforms[0].transform.opacity = 0.01;

    expect(JSON.stringify(result.plan)).toBe(frozenPlanJson);
    expect(JSON.parse(frozenPlanJson)).toEqual(result.plan);
    expect(structuredClone(result.plan)).toEqual(result.plan);
  });

  it('accepts the exact node budget and rejects one node over it', () => {
    const exactNodes: MotionParentGraphNode[] = Array.from(
      { length: MOTION_PARENT_GRAPH_BUDGETS.maxNodes },
      (_, index) => ({
        clipId: `node-${String(index).padStart(5, '0')}`,
        compositionId: 'comp',
        space: '2d',
      }),
    );
    const exactGraph = createMotionParentGraphSnapshot(exactNodes);
    expect(validateMotionParentGraph(exactGraph)).toEqual([]);

    const overGraph = asGraph({
      version: 1,
      revision: 'over-budget',
      nodes: [
        ...exactNodes,
        { clipId: 'node-over-budget', compositionId: 'comp', space: '2d' },
      ],
    });
    expect(validateMotionParentGraph(overGraph)[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_BUDGET_EXCEEDED);
  });

  it('accepts the exact depth budget and rejects deeper chains without recursion', () => {
    const exactDepthGraph = createChainGraph(MOTION_PARENT_GRAPH_BUDGETS.maxDepth);
    expect(validateMotionParentGraph(exactDepthGraph)).toEqual([]);

    const overDepthGraph = createChainGraph(MOTION_PARENT_GRAPH_BUDGETS.maxDepth + 1);
    expect(validateMotionParentGraph(overDepthGraph).map((item) => item.code))
      .toContain(MOTION_PARENT_ERROR_CODES.GRAPH_DEPTH_BUDGET_EXCEEDED);

    const deepGraph = createChainGraph(5_000);
    expect(() => validateMotionParentGraph(deepGraph)).not.toThrow();
    expect(validateMotionParentGraph(deepGraph).map((item) => item.code))
      .toContain(MOTION_PARENT_ERROR_CODES.GRAPH_DEPTH_BUDGET_EXCEEDED);
  });

  it('rejects cycles deterministically without recursive traversal', () => {
    const graph = createMotionParentGraphSnapshot([
      { clipId: 'a', compositionId: 'comp', space: '2d', parentClipId: 'b' },
      { clipId: 'b', compositionId: 'comp', space: '2d', parentClipId: 'c' },
      { clipId: 'c', compositionId: 'comp', space: '2d', parentClipId: 'a' },
    ]);
    expect(() => validateMotionParentGraph(graph)).not.toThrow();
    expect(validateMotionParentGraph(graph).map((item) => item.code))
      .toContain(MOTION_PARENT_ERROR_CODES.CYCLE);
  });

  it('requires canonical graph order and an exact canonical evaluation id set', () => {
    const graph = createMotionParentContractGraphFixture();
    const unsortedGraph = {
      ...graph,
      nodes: [...graph.nodes].reverse(),
    };
    expect(validateMotionParentGraph(asGraph(unsortedGraph)).map((item) => item.code))
      .toContain(MOTION_PARENT_ERROR_CODES.GRAPH_ORDER_INVALID);

    const evaluation = createMotionParentContractEvaluationFixture(0);
    const unsortedEvaluation = {
      ...evaluation,
      localTransforms: [...evaluation.localTransforms].reverse(),
    };
    const unsortedResult = evaluateMotionParentGraphWorldTransforms(
      graph,
      unsortedEvaluation,
    );
    expect(unsortedResult.worlds).toBeUndefined();
    expect(unsortedResult.failures.map((item) => item.code))
      .toContain(MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID);

    const extraEvaluation = {
      ...evaluation,
      localTransforms: [
        ...evaluation.localTransforms,
        { clipId: 'zz-extra', transform: createMotionParentContractTransform() },
      ],
    };
    const extraResult = evaluateMotionParentGraphWorldTransforms(graph, extraEvaluation);
    expect(extraResult.worlds).toBeUndefined();
    expect(extraResult.failures.map((item) => item.code))
      .toContain(MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID);
  });

  it('rejects array subclasses before iterator, map, find, or forEach can execute', () => {
    const counter = { calls: 0 };
    const graph = createMotionParentContractGraphFixture();
    const subclassNodes = createAdversarialArray(graph.nodes, counter);
    const subclassGraph = asGraph({ ...graph, nodes: subclassNodes });
    expect(validateMotionParentGraph(subclassGraph)[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);
    expect(() => createMotionParentGraphSnapshot(
      subclassNodes as readonly MotionParentGraphNode[],
    )).toThrow(TypeError);

    const evaluation = createMotionParentContractEvaluationFixture(0);
    const subclassEvaluation = asEvaluation({
      ...evaluation,
      localTransforms: createAdversarialArray(evaluation.localTransforms, counter),
    });
    expect(evaluateMotionParentGraphWorldTransforms(graph, subclassEvaluation).failures[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID);

    const remap = planMotionParentRemap({
      sourceGraph: graph,
      copiedClipIds: createAdversarialArray([ids.child], counter),
      targetClipIdsBySourceId: { [ids.child]: 'copy-child' },
      destinationCompositionId: 'destination',
    });
    expect(remap.ok).toBe(false);

    const inverse = deriveMotionParentLocalTransform2D(
      createMotionParentContractTransform(),
      createMotionParentContractTransform(),
      createAdversarialArray([ids.child], counter),
    );
    expect(inverse.ok).toBe(false);
    expect(counter.calls).toBe(0);
  });

  it('applies one bounded control-free stable-id policy across every MD6 boundary', () => {
    const exactId = 'x'.repeat(MOTION_PARENT_STABLE_ID_POLICY.maxLength);
    const invalidIds = [
      `${exactId}x`,
      'nul\u0000id',
      'line\nid',
      'tab\tid',
      'c1\u0085id',
    ];
    expect(isValidMotionParentStableId(exactId)).toBe(true);
    expect(invalidIds.every((value) => !isValidMotionParentStableId(value))).toBe(true);
    const exactGraph = createMotionParentGraphSnapshot([
      { clipId: exactId, compositionId: exactId, space: '2d' },
    ]);
    expect(validateMotionParentGraph(exactGraph)).toEqual([]);

    for (const invalidId of invalidIds) {
      const invalidGraph = asGraph({
        version: 1,
        revision: 'invalid-stable-id',
        nodes: [{ clipId: invalidId, compositionId: 'comp', space: '2d' }],
      });
      expect(validateMotionParentGraph(invalidGraph)[0]?.code)
        .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);
    }
    const invalidComposition = asGraph({
      version: 1,
      revision: 'invalid-composition-id',
      nodes: [{ clipId: 'child', compositionId: 'bad\ncomposition', space: '2d' }],
    });
    const invalidParent = asGraph({
      version: 1,
      revision: 'invalid-parent-id',
      nodes: [{
        clipId: 'child',
        compositionId: 'comp',
        space: '2d',
        parentClipId: 'bad\u0000parent',
      }],
    });
    expect(validateMotionParentGraph(invalidComposition)[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);
    expect(validateMotionParentGraph(invalidParent)[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);

    const graph = createMotionParentContractGraphFixture();
    const evaluation = createMotionParentContractEvaluationFixture(0);
    const invalidEvaluation = {
      ...evaluation,
      localTransforms: [
        { clipId: 'bad\u0000evaluation', transform: createMotionParentContractTransform() },
        ...evaluation.localTransforms,
      ],
    };
    expect(evaluateMotionParentGraphWorldTransforms(graph, invalidEvaluation).failures[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID);
    expect(planMotionParentMutation({
      graph,
      evaluation,
      childClipId: 'bad\nchild',
      parentClipId: ids.parentA,
    }).failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID);
    expect(planMotionParentRemap({
      sourceGraph: graph,
      copiedClipIds: ['bad\u0000copy'],
      targetClipIdsBySourceId: { 'bad\u0000copy': 'copy' },
      destinationCompositionId: 'destination',
    }).failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID);
    expect(planMotionParentRemap({
      sourceGraph: graph,
      copiedClipIds: [ids.child],
      targetClipIdsBySourceId: { [ids.child]: 'copy-child' },
      destinationCompositionId: 'bad\ndestination',
    }).failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID);
    expect(planMotionParentRemap({
      sourceGraph: graph,
      copiedClipIds: [ids.child],
      targetClipIdsBySourceId: { [ids.child]: 'bad\tdestination-id' },
      destinationCompositionId: 'destination',
    }).failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID);
  });
});
