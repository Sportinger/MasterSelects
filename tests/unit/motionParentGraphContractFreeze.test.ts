import { describe, expect, it } from 'vitest';
import {
  MOTION_PARENT_DIAGNOSTIC_CODES,
  MOTION_PARENT_ERROR_CODES,
  MOTION_PARENT_GROUPS_SUPPORTED,
  MOTION_PARENT_WORLD_PRESERVATION,
  type MotionParentGraphNode,
  type MotionParentGraphSnapshot,
  type MotionParentTransform2D,
} from '../../src/services/motionDesign/structure/contracts';
import {
  MD6_CONTRACT_FIXTURE_IDS,
  createMotionParentContractEvaluationFixture,
  createMotionParentContractGraphFixture,
  createMotionParentContractTransform,
} from '../../src/services/motionDesign/structure/contractFixtures';
import {
  calculateMotionParentGraphRevision,
  createMotionParentGraphSnapshot,
  evaluateMotionParentGraphWorldTransforms,
  planMotionParentMutation,
  planMotionParentRemap,
  validateMotionParentGraph,
} from '../../src/services/motionDesign/structure/parentGraphPlanner';
import {
  composeMotionParentTransforms2D,
  deriveMotionParentLocalTransform2D,
} from '../../src/services/motionDesign/structure/parentTransformMath';

const ids = MD6_CONTRACT_FIXTURE_IDS;

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

function graphWith(nodes: readonly MotionParentGraphNode[]): MotionParentGraphSnapshot {
  return createMotionParentGraphSnapshot(nodes);
}

describe('MD6 parent graph contract freeze', () => {
  it('freezes operation-time-only world preservation and leaves groups out of 1.0', () => {
    expect(MOTION_PARENT_WORLD_PRESERVATION).toBe('operation-time-only');
    expect(MOTION_PARENT_GROUPS_SUPPORTED).toBe(false);
    expect(MOTION_PARENT_DIAGNOSTIC_CODES.GROUPS_OUT_OF_SCOPE)
      .toBe('MD6_PARENT_GROUPS_OUT_OF_1_0');
  });

  it('canonicalizes nodes and derives deterministic graph revisions', () => {
    const forward = graphWith([
      { clipId: 'b', compositionId: 'comp', space: '2d', parentClipId: 'a' },
      { clipId: 'a', compositionId: 'comp', space: '2d' },
    ]);
    const reverse = graphWith([...forward.nodes].reverse());

    expect(forward).toEqual(reverse);
    expect(forward.nodes.map((node) => node.clipId)).toEqual(['a', 'b']);
    expect(forward.revision).toBe(calculateMotionParentGraphRevision(forward.nodes));
    expect(forward.revision).toMatch(/^md6pg1-[0-9a-f]{16}$/);
  });

  it.each([
    {
      name: 'self-parent',
      nodes: [{ clipId: 'a', compositionId: 'comp', space: '2d', parentClipId: 'a' }] satisfies MotionParentGraphNode[],
      code: MOTION_PARENT_ERROR_CODES.SELF_PARENT,
    },
    {
      name: 'missing parent',
      nodes: [{ clipId: 'a', compositionId: 'comp', space: '2d', parentClipId: 'missing' }] satisfies MotionParentGraphNode[],
      code: MOTION_PARENT_ERROR_CODES.PARENT_MISSING,
    },
    {
      name: 'cycle',
      nodes: [
        { clipId: 'a', compositionId: 'comp', space: '2d', parentClipId: 'b' },
        { clipId: 'b', compositionId: 'comp', space: '2d', parentClipId: 'a' },
      ] satisfies MotionParentGraphNode[],
      code: MOTION_PARENT_ERROR_CODES.CYCLE,
    },
    {
      name: 'mixed 3D',
      nodes: [
        { clipId: 'a', compositionId: 'comp', space: '2d', parentClipId: 'b' },
        { clipId: 'b', compositionId: 'comp', space: '3d' },
      ] satisfies MotionParentGraphNode[],
      code: MOTION_PARENT_ERROR_CODES.MIXED_3D_UNSUPPORTED,
    },
    {
      name: 'cross-composition',
      nodes: [
        { clipId: 'a', compositionId: 'comp-a', space: '2d', parentClipId: 'b' },
        { clipId: 'b', compositionId: 'comp-b', space: '2d' },
      ] satisfies MotionParentGraphNode[],
      code: MOTION_PARENT_ERROR_CODES.COMPOSITION_MISMATCH,
    },
  ])('returns the stable $name validation code', ({ nodes, code }) => {
    expect(validateMotionParentGraph(graphWith(nodes)).map((item) => item.code)).toContain(code);
  });

  it('fails invalid mutations without emitting any partial plan', () => {
    const graph = createMotionParentContractGraphFixture({ includeThreeD: true });
    const evaluation = createMotionParentContractEvaluationFixture(2, { includeThreeD: true });
    const invalidResults = [
      planMotionParentMutation({ graph, evaluation, childClipId: ids.child, parentClipId: ids.child }),
      planMotionParentMutation({ graph, evaluation, childClipId: 'missing', parentClipId: ids.parentA }),
      planMotionParentMutation({ graph, evaluation, childClipId: ids.child, parentClipId: 'missing' }),
      planMotionParentMutation({ graph, evaluation, childClipId: ids.child, parentClipId: ids.threeD }),
    ];

    for (const result of invalidResults) {
      expect(result.ok).toBe(false);
      expect('plan' in result).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
    }
    expect(invalidResults.map((result) => result.failures[0]?.code)).toEqual([
      MOTION_PARENT_ERROR_CODES.SELF_PARENT,
      MOTION_PARENT_ERROR_CODES.CHILD_MISSING,
      MOTION_PARENT_ERROR_CODES.PARENT_MISSING,
      MOTION_PARENT_ERROR_CODES.MIXED_3D_UNSUPPORTED,
    ]);
  });

  it('evaluates an animated parent at the supplied timeline time without live playhead state', () => {
    const graph = createMotionParentContractGraphFixture();
    const atTwo = planMotionParentMutation({
      graph,
      evaluation: createMotionParentContractEvaluationFixture(2),
      childClipId: ids.child,
      parentClipId: ids.parentA,
    });
    const atEight = planMotionParentMutation({
      graph,
      evaluation: createMotionParentContractEvaluationFixture(8),
      childClipId: ids.child,
      parentClipId: ids.parentA,
    });
    expect(atTwo.ok).toBe(true);
    expect(atEight.ok).toBe(true);
    if (!atTwo.ok || !atEight.ok) return;

    expect(atTwo.plan.timelineTime).toBe(2);
    expect(atEight.plan.timelineTime).toBe(8);
    expect(atTwo.plan.apply.changes[0].toLocalTransform).not.toEqual(
      atEight.plan.apply.changes[0].toLocalTransform,
    );
    expect(atTwo.plan.apply.changes).toHaveLength(1);
    expect(atTwo.plan.preservation).toBe('operation-time-only');
  });

  it('rejects a non-finite timeline time without emitting a plan', () => {
    const graph = createMotionParentContractGraphFixture();
    const evaluation = createMotionParentContractEvaluationFixture(Number.NaN);
    const result = planMotionParentMutation({
      graph,
      evaluation,
      childClipId: ids.child,
      parentClipId: ids.parentA,
    });

    expect(result.ok).toBe(false);
    expect('plan' in result).toBe(false);
    expect(result.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.INVALID_TIMELINE_TIME);
  });

  it('rejects duplicate explicit-time transforms instead of using input order', () => {
    const graph = createMotionParentContractGraphFixture();
    const evaluation = createMotionParentContractEvaluationFixture(2);
    const duplicateEvaluation = {
      ...evaluation,
      localTransforms: [
        ...evaluation.localTransforms,
        {
          clipId: ids.child,
          transform: createMotionParentContractTransform({ x: 999 }),
        },
      ],
    };

    const worldResult = evaluateMotionParentGraphWorldTransforms(graph, duplicateEvaluation);
    expect(worldResult.worlds).toBeUndefined();
    expect(worldResult.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.DUPLICATE_EVALUATION);

    const planResult = planMotionParentMutation({
      graph,
      evaluation: duplicateEvaluation,
      childClipId: ids.child,
      parentClipId: ids.parentA,
    });
    expect(planResult.ok).toBe(false);
    expect('plan' in planResult).toBe(false);
    expect(planResult.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.DUPLICATE_EVALUATION);
  });

  it('returns no worlds when finite local values overflow during composition', () => {
    const graph = createMotionParentContractGraphFixture({ childParentId: ids.parentA });
    const evaluation = createMotionParentContractEvaluationFixture(0);
    const localTransforms = evaluation.localTransforms.map((entry) => {
      if (entry.clipId === ids.parentA) {
        return { ...entry, transform: createMotionParentContractTransform({ x: 1e308 }) };
      }
      if (entry.clipId === ids.child) {
        return { ...entry, transform: createMotionParentContractTransform({ x: 1e308 }) };
      }
      return entry;
    });

    const result = evaluateMotionParentGraphWorldTransforms(graph, {
      timelineTime: 0,
      localTransforms,
    });
    expect(result.worlds).toBeUndefined();
    expect(result.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.NON_FINITE_TRANSFORM);
  });

  it('returns no plan when inverse division overflows from finite inputs', () => {
    const graph = createMotionParentContractGraphFixture();
    const evaluation = createMotionParentContractEvaluationFixture(0);
    const localTransforms = evaluation.localTransforms.map((entry) => {
      if (entry.clipId === ids.parentA) {
        return { ...entry, transform: createMotionParentContractTransform({ scaleX: 1e-11 }) };
      }
      if (entry.clipId === ids.child) {
        return { ...entry, transform: createMotionParentContractTransform({ scaleX: 1e308 }) };
      }
      return entry;
    });

    const result = planMotionParentMutation({
      graph,
      evaluation: { timelineTime: 0, localTransforms },
      childClipId: ids.child,
      parentClipId: ids.parentA,
    });
    expect(result.ok).toBe(false);
    expect('plan' in result).toBe(false);
    expect(result.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.NON_FINITE_TRANSFORM);
  });

  it('fails closed instead of throwing for structurally malformed graph and evaluation data', () => {
    const malformedGraph = null as unknown as MotionParentGraphSnapshot;
    expect(() => validateMotionParentGraph(malformedGraph)).not.toThrow();
    expect(validateMotionParentGraph(malformedGraph)[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);

    const graphWithMalformedNode = {
      version: 1,
      revision: 'invalid',
      nodes: [null],
    } as unknown as MotionParentGraphSnapshot;
    expect(() => validateMotionParentGraph(graphWithMalformedNode)).not.toThrow();
    expect(validateMotionParentGraph(graphWithMalformedNode)[0]?.code)
      .toBe(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID);

    const graph = createMotionParentContractGraphFixture();
    const malformedEvaluation = {
      timelineTime: 0,
      localTransforms: null,
    } as unknown as ReturnType<typeof createMotionParentContractEvaluationFixture>;
    expect(() => evaluateMotionParentGraphWorldTransforms(graph, malformedEvaluation)).not.toThrow();
    const evaluationResult = evaluateMotionParentGraphWorldTransforms(graph, malformedEvaluation);
    expect(evaluationResult.worlds).toBeUndefined();
    expect(evaluationResult.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID);
  });

  it('set preserves the exact child world transform at the operation time', () => {
    const graph = createMotionParentContractGraphFixture();
    const evaluation = createMotionParentContractEvaluationFixture(3.5);
    const result = planMotionParentMutation({
      graph,
      evaluation,
      childClipId: ids.child,
      parentClipId: ids.parentA,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parentWorld = evaluation.localTransforms.find((entry) => entry.clipId === ids.parentA)!.transform;
    const nextLocal = result.plan.apply.changes[0].toLocalTransform;
    expectTransformClose(
      composeMotionParentTransforms2D(parentWorld, nextLocal),
      result.plan.childWorldTransformAtOperationTime,
    );
    expect(result.plan.kind).toBe('set');
  });

  it('clear and reparent preserve world exactly and include descendants as affected ids', () => {
    const graph = createMotionParentContractGraphFixture({
      childParentId: ids.parentA,
      includeGrandchild: true,
    });
    const evaluation = createMotionParentContractEvaluationFixture(4, { includeGrandchild: true });
    const before = evaluateMotionParentGraphWorldTransforms(graph, evaluation);
    expect(before.worlds).toBeDefined();

    const clear = planMotionParentMutation({ graph, evaluation, childClipId: ids.child });
    const reparent = planMotionParentMutation({
      graph,
      evaluation,
      childClipId: ids.child,
      parentClipId: ids.parentB,
    });
    expect(clear.ok).toBe(true);
    expect(reparent.ok).toBe(true);
    if (!clear.ok || !reparent.ok || !before.worlds) return;

    expectTransformClose(
      clear.plan.apply.changes[0].toLocalTransform,
      before.worlds.get(ids.child)!,
    );
    const parentBWorld = before.worlds.get(ids.parentB)!;
    expectTransformClose(
      composeMotionParentTransforms2D(
        parentBWorld,
        reparent.plan.apply.changes[0].toLocalTransform,
      ),
      before.worlds.get(ids.child)!,
    );
    expect(clear.plan.kind).toBe('clear');
    expect(reparent.plan.kind).toBe('reparent');
    expect(reparent.plan.affectedClipIds).toEqual([ids.child, ids.grandchild].sort());
  });

  it('emits deterministic forward/inverse revisions as one atomic undo entry', () => {
    const graph = createMotionParentContractGraphFixture();
    const input = {
      graph,
      evaluation: createMotionParentContractEvaluationFixture(5),
      childClipId: ids.child,
      parentClipId: ids.parentA,
    } as const;
    const first = planMotionParentMutation(input);
    const second = planMotionParentMutation(input);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.plan.apply.expectedRevision).toBe(graph.revision);
    expect(first.plan.undo.expectedRevision).toBe(first.plan.apply.nextRevision);
    expect(first.plan.undo.nextRevision).toBe(graph.revision);
    expect(first.plan.undo.graph).toEqual(graph);
    expect(first.plan.undo.changes[0].toLocalTransform).toEqual(
      first.plan.apply.changes[0].fromLocalTransform,
    );
    expect(first.plan.history).toEqual({ mode: 'single-entry', label: 'Set Parent', atomic: true });
  });

  it('matches the established scale-independent-position algebra and its inverse', () => {
    const parent = createMotionParentContractTransform({
      x: 100,
      y: 50,
      rotationZ: 90,
      scaleAll: 2,
      scaleX: 3,
      scaleY: 4,
      opacity: 0.5,
    });
    const local = createMotionParentContractTransform({
      x: 10,
      y: 5,
      rotationZ: 20,
      scaleAll: 0.25,
      scaleX: 2,
      scaleY: 0.5,
      opacity: 0.8,
    });
    const world = composeMotionParentTransforms2D(parent, local);

    expect(world.position.x).toBeCloseTo(95);
    expect(world.position.y).toBeCloseTo(60);
    expect(world.scale).toEqual({ all: 0.5, x: 6, y: 2 });
    expect(world.rotationZ).toBe(110);
    expect(world.opacity).toBeCloseTo(0.4);
    const inverse = deriveMotionParentLocalTransform2D(parent, world);
    expect(inverse.ok).toBe(true);
    if (inverse.ok) expectTransformClose(inverse.transform, local);
  });

  it('fails closed when exact world preservation would require a singular inverse', () => {
    const graph = createMotionParentContractGraphFixture();
    const evaluation = createMotionParentContractEvaluationFixture(1);
    const localTransforms = evaluation.localTransforms.map((entry) => (
      entry.clipId === ids.parentA
        ? { ...entry, transform: createMotionParentContractTransform({ scaleX: 0 }) }
        : entry
    ));
    const result = planMotionParentMutation({
      graph,
      evaluation: { timelineTime: 1, localTransforms },
      childClipId: ids.child,
      parentClipId: ids.parentA,
    });

    expect(result.ok).toBe(false);
    expect('plan' in result).toBe(false);
    expect(result.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.NON_INVERTIBLE_TRANSFORM);
  });

  it('keeps copied internal edges and clears external edges with diagnostics', () => {
    const source = graphWith([
      { clipId: 'outside', compositionId: 'source', space: '2d' },
      { clipId: 'root', compositionId: 'source', space: '2d' },
      { clipId: 'internal-child', compositionId: 'source', space: '2d', parentClipId: 'root' },
      { clipId: 'external-child', compositionId: 'source', space: '2d', parentClipId: 'outside' },
    ]);
    const result = planMotionParentRemap({
      sourceGraph: source,
      copiedClipIds: ['external-child', 'internal-child', 'root'],
      targetClipIdsBySourceId: {
        root: 'copy-root',
        'internal-child': 'copy-internal',
        'external-child': 'copy-external',
      },
      destinationCompositionId: 'destination',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.assignments).toEqual([
      { sourceClipId: 'external-child', targetClipId: 'copy-external' },
      { sourceClipId: 'internal-child', targetClipId: 'copy-internal', parentClipId: 'copy-root' },
      { sourceClipId: 'root', targetClipId: 'copy-root' },
    ]);
    expect(result.plan.diagnostics).toEqual([{
      code: MOTION_PARENT_DIAGNOSTIC_CODES.EXTERNAL_EDGE_CLEARED,
      message: 'The copied child had an external parent; the target edge was cleared.',
      clipIds: ['external-child', 'outside'],
    }]);
    expect(result.plan.graph.nodes.find((node) => node.clipId === 'copy-external')?.parentClipId)
      .toBeUndefined();
    expect(result.plan.graph.nodes.find((node) => node.clipId === 'copy-internal')?.parentClipId)
      .toBe('copy-root');
  });

  it('remap preflight is atomic when a target id is missing', () => {
    const source = graphWith([
      { clipId: 'root', compositionId: 'source', space: '2d' },
      { clipId: 'child', compositionId: 'source', space: '2d', parentClipId: 'root' },
    ]);
    const result = planMotionParentRemap({
      sourceGraph: source,
      copiedClipIds: ['root', 'child'],
      targetClipIdsBySourceId: { root: 'copy-root' },
      destinationCompositionId: 'destination',
    });

    expect(result.ok).toBe(false);
    expect('plan' in result).toBe(false);
    expect(result.failures[0]?.code).toBe(MOTION_PARENT_ERROR_CODES.REMAP_TARGET_MISSING);
  });

  it('produces runtime-handle-free plans that round-trip through JSON and structuredClone', () => {
    const graph = createMotionParentContractGraphFixture();
    const result = planMotionParentMutation({
      graph,
      evaluation: createMotionParentContractEvaluationFixture(2.25),
      childClipId: ids.child,
      parentClipId: ids.parentA,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(JSON.parse(JSON.stringify(result.plan))).toEqual(result.plan);
    expect(structuredClone(result.plan)).toEqual(result.plan);
  });
});
