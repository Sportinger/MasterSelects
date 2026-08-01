import { describe, expect, it } from 'vitest';
import {
  MOTION_PARENT_DIAGNOSTIC_CODES,
  MOTION_PARENT_ERROR_CODES,
  type MotionParentGraphEvaluation,
  type MotionParentGraphNode,
  type MotionParentTransform2D,
} from '../../src/services/motionDesign/structure/contracts';
import {
  MD6_CONTRACT_FIXTURE_IDS,
  createMotionParentContractEvaluationFixture,
  createMotionParentContractGraphFixture,
  createMotionParentContractTransform,
} from '../../src/services/motionDesign/structure/contractFixtures';
import {
  MOTION_STRUCTURE_LEAF_BUDGETS,
  type MotionStructureNullEntity2D,
} from '../../src/services/motionDesign/structure/leafContracts';
import {
  planMotionClearParent,
  planMotionCreateNull,
  planMotionCreateNullAndParentSelected,
  planMotionSetParent,
  planMotionStructureSemanticIntent,
} from '../../src/services/motionDesign/structure/leafOperationPlanner';
import { createMotionParentGraphSnapshot } from '../../src/services/motionDesign/structure/parentGraphPlanner';
import { composeMotionParentTransforms2D } from '../../src/services/motionDesign/structure/parentTransformMath';

const ids = MD6_CONTRACT_FIXTURE_IDS;

function createNullEntity(
  clipId = 'md6-null',
  transform: MotionParentTransform2D = createMotionParentContractTransform({
    x: 100,
    y: 50,
    rotationZ: 15,
    scaleAll: 1.1,
    scaleX: 0.8,
    scaleY: 1.2,
    opacity: 0.9,
  }),
): MotionStructureNullEntity2D {
  return {
    kind: 'null',
    clipId,
    compositionId: ids.composition,
    space: '2d',
    localTransform: transform,
  };
}

function expectTransformClose(
  actual: MotionParentTransform2D,
  expected: MotionParentTransform2D,
): void {
  expect(actual.position.x).toBeCloseTo(expected.position.x, 10);
  expect(actual.position.y).toBeCloseTo(expected.position.y, 10);
  expect(actual.scale.all).toBeCloseTo(expected.scale.all, 10);
  expect(actual.scale.x).toBeCloseTo(expected.scale.x, 10);
  expect(actual.scale.y).toBeCloseTo(expected.scale.y, 10);
  expect(actual.rotationZ).toBeCloseTo(expected.rotationZ, 10);
  expect(actual.opacity).toBeCloseTo(expected.opacity, 10);
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

describe('MD6 Structure leaf foundation', () => {
  it('plans deterministic create-null apply and undo snapshots as one history entry', () => {
    const graph = createMotionParentContractGraphFixture();
    const nullEntity = createNullEntity();
    const input = { graph, timelineTime: 3.25, nullEntity } as const;
    const first = planMotionCreateNull(input);
    const second = planMotionCreateNull(input);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.plan.kind).toBe('create-null');
    expect(first.plan.timelineTime).toBe(3.25);
    expect(first.plan.apply.expectedRevision).toBe(graph.revision);
    expect(first.plan.apply.nextRevision).toBe(first.plan.apply.graph.revision);
    expect(first.plan.undo.expectedRevision).toBe(first.plan.apply.nextRevision);
    expect(first.plan.undo.nextRevision).toBe(graph.revision);
    expect(first.plan.undo.graph).toEqual(graph);
    expect(first.plan.undo.graph).not.toBe(graph);
    expect(first.plan.apply.nullChanges).toEqual([{ action: 'create', entity: nullEntity }]);
    expect(first.plan.undo.nullChanges).toEqual([{ action: 'delete', entity: nullEntity }]);
    expect(first.plan.apply.executionOrder).toEqual(['null-changes']);
    expect(first.plan.undo.executionOrder).toEqual(['null-changes']);
    expect(first.plan.history).toEqual({
      mode: 'single-entry',
      label: 'Create Null',
      atomic: true,
    });
    expect(JSON.parse(JSON.stringify(first.plan))).toEqual(first.plan);
    expect(structuredClone(first.plan)).toEqual(first.plan);
  });

  it('exposes named set-parent and clear-parent leaf operations with exact revisions', () => {
    const graph = createMotionParentContractGraphFixture();
    const evaluation = createMotionParentContractEvaluationFixture(2);
    const set = planMotionSetParent({
      graph,
      evaluation,
      childClipId: ids.child,
      parentClipId: ids.parentA,
    });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.plan.kind).toBe('set-parent');
    expect(set.plan.apply.expectedRevision).toBe(graph.revision);
    expect(set.plan.apply.relationshipChanges).toHaveLength(1);
    expect(set.plan.apply.nullChanges).toEqual([]);
    expect(set.plan.preservedWorldTransformsAtOperationTime[0]?.clipId).toBe(ids.child);

    const parentedGraph = set.plan.apply.graph;
    const clearEvaluation: MotionParentGraphEvaluation = {
      timelineTime: evaluation.timelineTime,
      localTransforms: evaluation.localTransforms.map((entry) => (
        entry.clipId === ids.child
          ? {
              clipId: entry.clipId,
              transform: set.plan.apply.relationshipChanges[0].toLocalTransform,
            }
          : entry
      )),
    };
    const clear = planMotionClearParent({
      graph: parentedGraph,
      evaluation: clearEvaluation,
      childClipId: ids.child,
    });
    expect(clear.ok).toBe(true);
    if (!clear.ok) return;
    expect(clear.plan.kind).toBe('clear-parent');
    expect(clear.plan.apply.expectedRevision).toBe(parentedGraph.revision);
    expect(clear.plan.undo.nextRevision).toBe(parentedGraph.revision);
    expect(clear.plan.history.label).toBe('Clear Parent');
  });

  it('atomically creates one null and parents a canonicalized selection while preserving worlds', () => {
    const graph = createMotionParentContractGraphFixture({
      childParentId: ids.parentA,
      includeGrandchild: true,
    });
    const evaluation = createMotionParentContractEvaluationFixture(4, { includeGrandchild: true });
    const nullEntity = createNullEntity();
    const result = planMotionCreateNullAndParentSelected({
      graph,
      evaluation,
      nullEntity,
      selectedClipIds: [ids.parentB, ids.child],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.apply.relationshipChanges.map((change) => change.clipId))
      .toEqual([ids.child, ids.parentB].sort());
    expect(result.plan.apply.nullChanges).toHaveLength(1);
    expect(result.plan.apply.executionOrder)
      .toEqual(['null-changes', 'relationship-changes']);
    expect(result.plan.undo.executionOrder)
      .toEqual(['relationship-changes', 'null-changes']);
    expect(result.plan.undo.nullChanges).toEqual([{
      action: 'delete',
      entity: nullEntity,
    }]);
    expect(result.plan.apply.graph.nodes.find((node) => node.clipId === ids.child)?.parentClipId)
      .toBe(nullEntity.clipId);
    expect(result.plan.apply.graph.nodes.find((node) => node.clipId === ids.parentB)?.parentClipId)
      .toBe(nullEntity.clipId);
    expect(result.plan.undo.graph).toEqual(graph);
    expect(result.plan.affectedClipIds).toEqual([
      ids.child,
      ids.grandchild,
      ids.parentB,
      nullEntity.clipId,
    ].sort());
    for (const change of result.plan.apply.relationshipChanges) {
      const preserved = result.plan.preservedWorldTransformsAtOperationTime.find(
        (entry) => entry.clipId === change.clipId,
      )!;
      expectTransformClose(
        composeMotionParentTransforms2D(nullEntity.localTransform, change.toLocalTransform),
        preserved.transform,
      );
    }
    expect(result.plan.apply.expectedRevision).toBe(graph.revision);
    expect(result.plan.apply.nextRevision).toBe(result.plan.apply.graph.revision);
    expect(result.plan.undo.expectedRevision).toBe(result.plan.apply.nextRevision);
    expect(result.plan.undo.nextRevision).toBe(graph.revision);
    expect(result.plan.history).toEqual({
      mode: 'single-entry',
      label: 'Create Null and Parent Selection',
      atomic: true,
    });
    expect(JSON.parse(JSON.stringify(result.plan))).toEqual(result.plan);
    expect(structuredClone(result.plan)).toEqual(result.plan);
  });

  it('emits blocked-relationship diagnostics and no partial atomic plan', () => {
    const graph = createMotionParentContractGraphFixture({ includeThreeD: true });
    const evaluation = createMotionParentContractEvaluationFixture(0, { includeThreeD: true });
    const blocked = planMotionCreateNullAndParentSelected({
      graph,
      evaluation,
      nullEntity: createNullEntity(),
      selectedClipIds: [ids.threeD, 'missing-child'],
    });
    expect(blocked.ok).toBe(false);
    expect('plan' in blocked).toBe(false);
    expect(blocked.diagnostics).toHaveLength(2);
    expect(blocked.diagnostics.every(
      (item) => item.code === MOTION_PARENT_DIAGNOSTIC_CODES.RELATIONSHIP_BLOCKED,
    )).toBe(true);
    expect(blocked.diagnostics.map((item) => item.blockedBy).sort()).toEqual([
      MOTION_PARENT_ERROR_CODES.CHILD_MISSING,
      MOTION_PARENT_ERROR_CODES.MIXED_3D_UNSUPPORTED,
    ].sort());

    const singular = planMotionCreateNullAndParentSelected({
      graph: createMotionParentContractGraphFixture(),
      evaluation: createMotionParentContractEvaluationFixture(0),
      nullEntity: createNullEntity('singular-null', createMotionParentContractTransform({
        scaleX: 0,
      })),
      selectedClipIds: [ids.child],
    });
    expect(singular.ok).toBe(false);
    expect('plan' in singular).toBe(false);
    expect(singular.diagnostics[0]?.blockedBy)
      .toBe(MOTION_PARENT_ERROR_CODES.NON_INVERTIBLE_TRANSFORM);
  });

  it('enforces exact and over-limit atomic relationship batch sizes', () => {
    const count = MOTION_STRUCTURE_LEAF_BUDGETS.maxSelectedClipIds;
    const nodes: MotionParentGraphNode[] = Array.from({ length: count }, (_, index) => ({
      clipId: `selected-${String(index).padStart(3, '0')}`,
      compositionId: ids.composition,
      space: '2d',
    }));
    const graph = createMotionParentGraphSnapshot(nodes);
    const evaluation: MotionParentGraphEvaluation = {
      timelineTime: 0,
      localTransforms: nodes.map((node) => ({
        clipId: node.clipId,
        transform: createMotionParentContractTransform(),
      })),
    };
    const selectedClipIds = nodes.map((node) => node.clipId);
    const exact = planMotionCreateNullAndParentSelected({
      graph,
      evaluation,
      nullEntity: createNullEntity(),
      selectedClipIds,
    });
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(exact.plan.apply.relationshipChanges).toHaveLength(count);

    const over = planMotionCreateNullAndParentSelected({
      graph,
      evaluation,
      nullEntity: createNullEntity(),
      selectedClipIds: [...selectedClipIds, 'selected-over-limit'],
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.BATCH_BUDGET_EXCEEDED);
    }
  });

  it('preflights leaf inputs and selection array prototypes without invoking accessors or methods', () => {
    let getterCalls = 0;
    const input: Record<string, unknown> = {
      timelineTime: 0,
      nullEntity: createNullEntity(),
    };
    Object.defineProperty(input, 'graph', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return createMotionParentContractGraphFixture();
      },
    });
    const create = planMotionCreateNull(
      input as unknown as Parameters<typeof planMotionCreateNull>[0],
    );
    expect(create.ok).toBe(false);

    const counter = { calls: 0 };
    const subclassSelection = createAdversarialArray([ids.child], counter);
    const atomic = planMotionCreateNullAndParentSelected({
      graph: createMotionParentContractGraphFixture(),
      evaluation: createMotionParentContractEvaluationFixture(0),
      nullEntity: createNullEntity(),
      selectedClipIds: subclassSelection,
    });
    expect(atomic.ok).toBe(false);
    expect(getterCalls).toBe(0);
    expect(counter.calls).toBe(0);
  });

  it('rejects duplicate null ids without emitting an operation plan', () => {
    const graph = createMotionParentContractGraphFixture();
    const result = planMotionCreateNull({
      graph,
      timelineTime: 0,
      nullEntity: createNullEntity(ids.child),
    });
    expect(result.ok).toBe(false);
    expect('plan' in result).toBe(false);
    if (!result.ok) {
      expect(result.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.NULL_ID_EXISTS);
    }
  });

  it('dispatches pure semantic intents and explicitly freezes group intent out of scope', () => {
    const graph = createMotionParentContractGraphFixture();
    const evaluation = createMotionParentContractEvaluationFixture(1);
    const nullEntity = createNullEntity();
    const directCreate = planMotionCreateNull({ graph, timelineTime: 1, nullEntity });
    const intentCreate = planMotionStructureSemanticIntent({
      graph,
      intent: { type: 'create-null', timelineTime: 1, nullEntity },
    });
    expect(intentCreate).toEqual(directCreate);

    const directSet = planMotionSetParent({
      graph,
      evaluation,
      childClipId: ids.child,
      parentClipId: ids.parentA,
    });
    const intentSet = planMotionStructureSemanticIntent({
      graph,
      intent: {
        type: 'set-parent',
        evaluation,
        childClipId: ids.child,
        parentClipId: ids.parentA,
      },
    });
    expect(intentSet).toEqual(directSet);

    expect(directSet.ok).toBe(true);
    if (!directSet.ok) return;
    const clearGraph = directSet.plan.apply.graph;
    const clearEvaluation: MotionParentGraphEvaluation = {
      timelineTime: evaluation.timelineTime,
      localTransforms: evaluation.localTransforms.map((entry) => (
        entry.clipId === ids.child
          ? {
              clipId: entry.clipId,
              transform: directSet.plan.apply.relationshipChanges[0].toLocalTransform,
            }
          : entry
      )),
    };
    const directClear = planMotionClearParent({
      graph: clearGraph,
      evaluation: clearEvaluation,
      childClipId: ids.child,
    });
    const intentClear = planMotionStructureSemanticIntent({
      graph: clearGraph,
      intent: {
        type: 'clear-parent',
        evaluation: clearEvaluation,
        childClipId: ids.child,
      },
    });
    expect(intentClear).toEqual(directClear);

    const directAtomic = planMotionCreateNullAndParentSelected({
      graph,
      evaluation,
      nullEntity,
      selectedClipIds: [ids.child],
    });
    const intentAtomic = planMotionStructureSemanticIntent({
      graph,
      intent: {
        type: 'create-null-and-parent-selected',
        evaluation,
        nullEntity,
        selectedClipIds: [ids.child],
      },
    });
    expect(intentAtomic).toEqual(directAtomic);

    const group = planMotionStructureSemanticIntent({
      graph,
      intent: { type: 'group', selectedClipIds: [ids.child, ids.parentA] },
    });
    expect(group.ok).toBe(false);
    expect('plan' in group).toBe(false);
    if (!group.ok) {
      expect(group.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.GROUP_INTENT_UNSUPPORTED);
      expect(group.diagnostics).toEqual([expect.objectContaining({
        code: MOTION_PARENT_DIAGNOSTIC_CODES.GROUPS_OUT_OF_SCOPE,
        blockedBy: MOTION_PARENT_ERROR_CODES.GROUP_INTENT_UNSUPPORTED,
      })]);
    }
  });

  it('keeps semantic intent discriminators descriptor-safe', () => {
    let getterCalls = 0;
    const intent: Record<string, unknown> = {
      timelineTime: 0,
      nullEntity: createNullEntity(),
    };
    Object.defineProperty(intent, 'type', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'create-null';
      },
    });
    const result = planMotionStructureSemanticIntent({
      graph: createMotionParentContractGraphFixture(),
      intent: intent as never,
    });
    expect(result.ok).toBe(false);
    expect(getterCalls).toBe(0);
  });
});
