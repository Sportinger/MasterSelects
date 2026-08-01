import { describe, expect, it } from 'vitest';

import {
  MOTION_MUTATION_BATCH_VERSION,
  assertMotionAtomicMutationBatch,
  assertMotionCapabilityDescriptor,
  assertMotionLimitDescriptor,
  createMotionAtomicMutationBatch,
  type MotionAtomicMutationBatch,
} from '../../src/services/motionDesign/contracts/envelopes';
import {
  MOTION_FRAME_STATE_CONSUMERS,
  bindMotionFrameStateConsumer,
  createMotionFrameState,
  parseMotionFrameState,
  serializeMotionFrameState,
  type MotionFrameStateBuildInput,
} from '../../src/services/motionDesign/contracts/evaluatedMotionFrame';
import {
  adaptMotionParentMutationBatch,
  adaptMotionTemplateInstantiationBatch,
} from '../../src/services/motionDesign/contracts/leafMutationAdapters';
import { createTitleAdjustmentMontageFixture } from '../../src/services/motionDesign/adjustment/contractFixtures';
import { planMotionAdjustmentOperations } from '../../src/services/motionDesign/adjustment/operationPlanner';
import { createMotionMediaRequestFixture } from '../../src/services/motionDesign/media/contractFixtures';
import { evaluateMotionMediaFrame } from '../../src/services/motionDesign/media/evaluationPlanner';
import { createMotionModifierStackFixture } from '../../src/services/motionDesign/modifiers/contractFixtures';
import { planMotionModifiers } from '../../src/services/motionDesign/modifiers/referencePlanner';
import {
  createGridReplicatorContractFixture,
  createReplicatorReferenceRuntimeLimits,
  createReplicatorUnitSourceBounds,
} from '../../src/services/motionDesign/replicator/contractFixtures';
import { evaluateMotionReplicatorReference } from '../../src/services/motionDesign/replicator/referenceEvaluator';
import {
  MD6_CONTRACT_FIXTURE_IDS,
  createMotionParentContractEvaluationFixture,
  createMotionParentContractGraphFixture,
  createMotionParentContractTransform,
} from '../../src/services/motionDesign/structure/contractFixtures';
import { MOTION_PARENT_GRAPH_BUDGETS } from '../../src/services/motionDesign/structure/contracts';
import {
  createMotionParentGraphSnapshot,
  planMotionParentMutation,
} from '../../src/services/motionDesign/structure/parentGraphPlanner';
import {
  MOTION_TEMPLATE_FORMAT,
  MOTION_TEMPLATE_VERSION,
  type MotionTemplateEnvelopeV1,
} from '../../src/services/motionDesign/templates/contracts';
import { planMotionTemplateInstantiation } from '../../src/services/motionDesign/templates/instantiatePlanner';

function createAtomicBatchFixture(): MotionAtomicMutationBatch {
  return {
    contractVersion: MOTION_MUTATION_BATCH_VERSION,
    batchId: 'batch:motion-template:1',
    label: 'Instantiate Motion template',
    atomic: true,
    expectedRevisions: [{
      kind: 'composition',
      entityId: 'composition:main',
      revision: 'revision:7',
    }],
    operations: [{
      kind: 'update',
      entity: {
        kind: 'composition',
        entityId: 'composition:main',
        revision: 'revision:7',
      },
      nextRevision: 'revision:8',
      payload: {
        templateId: 'template:kinetic-title',
        instanceCount: 3,
      },
    }],
    history: {
      mode: 'single-entry',
      undoable: true,
    },
  };
}

function createFrameBuildInput(): MotionFrameStateBuildInput {
  const timelineTimeSeconds = 5;
  const replicatorContract = createGridReplicatorContractFixture();
  const replicatorRuntimeLimits = createReplicatorReferenceRuntimeLimits();
  const replicatorSourceBounds = createReplicatorUnitSourceBounds();
  const replicator = evaluateMotionReplicatorReference(
    replicatorContract,
    replicatorRuntimeLimits,
    replicatorSourceBounds,
  );
  if (!replicator.ok) throw new Error('Replicator fixture failed');
  const modifierContract = createMotionModifierStackFixture();
  const modifierContext = {
    requestedCount: replicator.requestedCount,
    effectiveCount: replicator.effectiveCount,
    clipLocalTimeSeconds: 1.25,
    instances: replicator.instances.map((instance) => ({
      index: instance.index,
      layoutTransform: instance.layoutTransform,
      offsetTransform: instance.offsetTransform,
    })),
    shapeReferences: [],
  };
  const modifier = planMotionModifiers(modifierContract, modifierContext);
  if (!modifier.ok) throw new Error('Modifier fixture failed');
  const adjustmentStack = {
    ...createTitleAdjustmentMontageFixture(),
    compositionId: MD6_CONTRACT_FIXTURE_IDS.composition,
    evaluationTime: timelineTimeSeconds,
  };
  const mediaRequest = createMotionMediaRequestFixture({ clipLocalTimeSeconds: 1.25 });
  const mediaEvaluation = evaluateMotionMediaFrame(mediaRequest);
  const adjustmentPacket = planMotionAdjustmentOperations(adjustmentStack);
  return {
    frameId: 'frame:mdx2:5.000',
    compositionId: MD6_CONTRACT_FIXTURE_IDS.composition,
    timelineTimeSeconds,
    evaluationRevision: 'evaluation:19',
    capabilities: [{
      id: 'replicator.max-instances',
      supported: true,
      source: 'render-target',
      numericLimit: 10_000,
    }],
    limits: [{
      id: 'replicator.instances',
      unit: 'count',
      requested: replicator.requestedCount,
      effective: replicator.effectiveCount,
      hardLimit: 10_000,
      binding: false,
    }],
    entityRevisions: [{
      kind: 'composition',
      entityId: MD6_CONTRACT_FIXTURE_IDS.composition,
      revision: 'revision:19',
    }, {
      kind: 'layer',
      entityId: 'layer:replicator',
      revision: 'layer-revision:7',
    }, {
      kind: 'replicator',
      entityId: 'layer:replicator',
      revision: `replicator:${replicatorContract.revision}`,
    }, {
      kind: 'modifier-stack',
      entityId: 'layer:replicator',
      revision: `modifier:${modifierContract.revision}`,
    }, {
      kind: 'media-binding',
      entityId: 'layer:motion-media',
      revision: `media:${mediaEvaluation.bindingRevision ?? 'missing'}`,
    }, {
      kind: 'adjustment-stack',
      entityId: MD6_CONTRACT_FIXTURE_IDS.composition,
      revision: `adjustment:${adjustmentStack.revision}`,
    }, ...adjustmentStack.layers.map((layer) => ({
      kind: 'adjustment-layer',
      entityId: layer.layerId,
      revision: `adjustment:${adjustmentStack.revision}:${layer.layerId}`,
    }))],
    replicators: [{
      layerId: 'layer:replicator',
      contract: replicatorContract,
      runtimeLimits: replicatorRuntimeLimits,
      sourceBounds: replicatorSourceBounds,
      evaluation: replicator,
    }],
    modifiers: [{
      layerId: 'layer:replicator',
      contract: modifierContract,
      context: modifierContext,
      plan: modifier,
    }],
    structure: {
      graph: createMotionParentContractGraphFixture({
        childParentId: MD6_CONTRACT_FIXTURE_IDS.parentA,
      }),
      evaluation: createMotionParentContractEvaluationFixture(timelineTimeSeconds),
    },
    adjustment: { stack: adjustmentStack, packet: adjustmentPacket },
    mediaEntries: [{
      layerId: 'layer:motion-media',
      request: mediaRequest,
      evaluation: mediaEvaluation,
    }],
    expressions: replicator.instances.map((instance) => ({
      entityId: 'layer:replicator',
      propertyPath: 'transform.rotation.z',
      contractRevision: 'layer-revision:7',
      clipLocalTimeSeconds: 1.25,
      instanceIndex: instance.index,
      effectiveCount: replicator.effectiveCount,
      resolved: {
        value: 12.5 + instance.index,
        source: 'expression' as const,
        precedence: 'expression-over-keyframe' as const,
      },
    })),
    diagnostics: [],
  };
}

function createAggregateTemplateFixture(): MotionTemplateEnvelopeV1 {
  return {
    format: MOTION_TEMPLATE_FORMAT,
    version: MOTION_TEMPLATE_VERSION,
    scope: 'project-local',
    templateId: 'aggregate-template',
    name: 'Aggregate Contract Template',
    category: 'test',
    duration: 2,
    entities: [{
      id: 'shape',
      kind: 'motion-shape',
      startOffset: 0,
      duration: 2,
      payload: { primitive: 'rectangle' },
      dependencyIds: [],
    }],
    relationships: [],
    dependencies: [],
  };
}

describe('Motion shared contract envelopes', () => {
  it('freezes capability and binding-limit semantics', () => {
    expect(() => assertMotionCapabilityDescriptor({
      id: 'replicator.max-instances',
      supported: true,
      source: 'device',
      numericLimit: 10_000,
    })).not.toThrow();
    expect(() => assertMotionLimitDescriptor({
      id: 'replicator.instances',
      unit: 'count',
      requested: 20_000,
      effective: 10_000,
      hardLimit: 10_000,
      binding: true,
    })).not.toThrow();
    expect(() => assertMotionLimitDescriptor({
      id: 'replicator.instances',
      unit: 'count',
      requested: 20_000,
      effective: 10_000,
      hardLimit: 10_000,
      binding: false,
    })).toThrow(/invalid/i);
  });

  it('creates a detached JSON-safe atomic single-history batch', () => {
    const fixture = createAtomicBatchFixture();
    const batch = createMotionAtomicMutationBatch(fixture);
    expect(batch).toEqual(fixture);
    expect(batch).not.toBe(fixture);
    expect(batch.operations[0]).not.toBe(fixture.operations[0]);
    expect(structuredClone(batch)).toEqual(batch);
    expect(JSON.parse(JSON.stringify(batch))).toEqual(batch);
  });

  it('requires an expected revision for every non-create operation', () => {
    const fixture = createAtomicBatchFixture();
    expect(() => assertMotionAtomicMutationBatch({
      ...fixture,
      expectedRevisions: [],
    })).toThrow(/expected revision/i);
  });

  it('requires exact revision equality and one operation per entity', () => {
    const fixture = createAtomicBatchFixture();
    expect(() => assertMotionAtomicMutationBatch({
      ...fixture,
      operations: [{
        ...fixture.operations[0],
        entity: { ...fixture.operations[0].entity, revision: 'revision:wrong' },
      }],
    })).toThrow(/exact expected revision/i);
    expect(() => assertMotionAtomicMutationBatch({
      ...fixture,
      operations: [fixture.operations[0], {
        ...fixture.operations[0],
        nextRevision: 'revision:9',
      }],
    })).toThrow(/one operation per entity/i);
  });

  it('rejects NUL-delimited ids so composite revision keys cannot collide', () => {
    const fixture = createAtomicBatchFixture();
    expect(() => assertMotionAtomicMutationBatch({
      ...fixture,
      expectedRevisions: [{ kind: 'a', entityId: 'b\u0000c', revision: 'revision:7' }],
      operations: [{
        ...fixture.operations[0],
        entity: { kind: 'a\u0000b', entityId: 'c', revision: 'revision:7' },
      }],
    })).toThrow(/bounded non-empty strings/i);
  });

  it('rejects Array subclasses without invoking inherited iteration code', () => {
    let iteratorCalls = 0;
    class ExecutableArray<T> extends Array<T> {
      override [Symbol.iterator](): ArrayIterator<T> {
        iteratorCalls += 1;
        return super[Symbol.iterator]();
      }
    }
    const revisions = new ExecutableArray<MotionAtomicMutationBatch['expectedRevisions'][number]>();
    revisions.push(createAtomicBatchFixture().expectedRevisions[0]);
    expect(() => assertMotionAtomicMutationBatch({
      ...createAtomicBatchFixture(),
      expectedRevisions: revisions,
    })).toThrow(/bounded dense array|standard Array prototype/i);
    expect(iteratorCalls).toBe(0);

    const frameInput = createFrameBuildInput();
    const capabilities = new ExecutableArray<MotionFrameStateBuildInput['capabilities'][number]>();
    capabilities.push(...frameInput.capabilities);
    const frame = createMotionFrameState({ ...frameInput, capabilities });
    expect(frame.ok).toBe(false);
    expect(iteratorCalls).toBe(0);
  });

  it('applies the mutation payload budget across the whole atomic batch', () => {
    const fixture = createAtomicBatchFixture();
    expect(() => assertMotionAtomicMutationBatch({
      ...fixture,
      expectedRevisions: [],
      operations: Array.from({ length: 60 }, (_, index) => ({
        kind: 'create' as const,
        entity: {
          kind: 'motion-layer',
          entityId: `layer:${index}`,
          revision: 'absent',
        },
        nextRevision: 'created:1',
        payload: { values: Array.from({ length: 8_500 }, () => 0) },
      })),
    })).toThrow(/aggregate payload budget/i);
  });

  it('rejects mutation payloads deeper than the shared clone-safe boundary', () => {
    const fixture = createAtomicBatchFixture();
    let payload: Record<string, unknown> = { value: true };
    for (let depth = 0; depth < 65; depth += 1) payload = { child: payload };
    expect(() => assertMotionAtomicMutationBatch({
      ...fixture,
      operations: [{ ...fixture.operations[0], payload }],
    } as unknown as MotionAtomicMutationBatch)).toThrow(/depth budget/i);
  });

  it('maps MD6 apply/undo and MD8 template batches losslessly into the shared envelope', () => {
    const graph = createMotionParentContractGraphFixture();
    const parentPlannerInput = {
      graph,
      evaluation: createMotionParentContractEvaluationFixture(2.5),
      childClipId: MD6_CONTRACT_FIXTURE_IDS.child,
      parentClipId: MD6_CONTRACT_FIXTURE_IDS.parentA,
    };
    const parentResult = planMotionParentMutation(parentPlannerInput);
    expect(parentResult.ok).toBe(true);
    if (!parentResult.ok) throw new Error(parentResult.failures[0]?.message);
    const apply = adaptMotionParentMutationBatch({
      plan: parentResult.plan,
      plannerInput: parentPlannerInput,
      direction: 'apply',
    });
    const undo = adaptMotionParentMutationBatch({
      plan: parentResult.plan,
      plannerInput: parentPlannerInput,
      direction: 'undo',
    });
    expect(apply.operations[0].entity.revision).toBe(parentResult.plan.apply.expectedRevision);
    expect(apply.operations[0].nextRevision).toBe(parentResult.plan.apply.nextRevision);
    expect(undo.operations[0].entity.revision).toBe(parentResult.plan.undo.expectedRevision);
    expect(undo.operations[0].nextRevision).toBe(parentResult.plan.undo.nextRevision);
    expect((apply.operations[0].payload?.leafPlan as unknown as { apply: { graph: unknown } }).apply.graph)
      .toEqual(parentResult.plan.apply.graph);

    const templatePlannerInput = {
      envelope: createAggregateTemplateFixture(),
      destinationCompositionId: 'composition:template-target',
      insertionTime: 4,
      instanceKey: 'aggregate-instance',
      dependencyResolutions: [],
      occupiedTargetIds: [],
    } as const;
    const templateResult = planMotionTemplateInstantiation(templatePlannerInput);
    expect(templateResult.ok).toBe(true);
    if (!templateResult.ok) throw new Error(templateResult.failures[0]?.message);
    const templateBatch = adaptMotionTemplateInstantiationBatch({
      plan: templateResult.plan,
      plannerInput: templatePlannerInput,
      destinationExpectedRevision: 'composition-revision:4',
      destinationNextRevision: 'composition-revision:5',
    });
    expect(templateBatch.operations).toHaveLength(templateResult.plan.batch.operations.length + 1);
    expect(templateBatch.operations[0].payload?.leafPlan).toEqual(templateResult.plan);
    expect(structuredClone(templateBatch)).toEqual(templateBatch);
  });

  it('rejects forged but runtime-safe MD6 and MD8 leaf plans before adapting', () => {
    const parentPlannerInput = {
      graph: createMotionParentContractGraphFixture(),
      evaluation: createMotionParentContractEvaluationFixture(2.5),
      childClipId: MD6_CONTRACT_FIXTURE_IDS.child,
      parentClipId: MD6_CONTRACT_FIXTURE_IDS.parentA,
    };
    const parentResult = planMotionParentMutation(parentPlannerInput);
    expect(parentResult.ok).toBe(true);
    if (!parentResult.ok) throw new Error(parentResult.failures[0]?.message);
    expect(() => adaptMotionParentMutationBatch({
      plan: {
        ...parentResult.plan,
        history: { ...parentResult.plan.history, label: 'Forged but structurally valid' },
      },
      plannerInput: parentPlannerInput,
    })).toThrow(/exact planner provenance/i);

    const templatePlannerInput = {
      envelope: createAggregateTemplateFixture(),
      destinationCompositionId: 'composition:template-target',
      insertionTime: 4,
      instanceKey: 'aggregate-instance',
      dependencyResolutions: [],
      occupiedTargetIds: [],
    } as const;
    const templateResult = planMotionTemplateInstantiation(templatePlannerInput);
    expect(templateResult.ok).toBe(true);
    if (!templateResult.ok) throw new Error(templateResult.failures[0]?.message);
    expect(() => adaptMotionTemplateInstantiationBatch({
      plan: {
        ...templateResult.plan,
        batch: {
          ...templateResult.plan.batch,
          operations: templateResult.plan.batch.operations.map((operation, index) => (
            index === 0 ? { ...operation, runtimeSafeButUnknown: true } : operation
          )),
        },
      } as unknown as typeof templateResult.plan,
      plannerInput: templatePlannerInput,
      destinationExpectedRevision: 'composition-revision:4',
      destinationNextRevision: 'composition-revision:5',
    })).toThrow(/create-entity operation/i);
    expect(() => adaptMotionTemplateInstantiationBatch({
      plan: { ...templateResult.plan, templateId: 'forged-template-id' },
      plannerInput: templatePlannerInput,
      destinationExpectedRevision: 'composition-revision:4',
      destinationNextRevision: 'composition-revision:5',
    })).toThrow(/exact planner provenance/i);
  });

  it('adapts a legal MD6 graph at the exact 10k-node leaf budget', () => {
    const nodes = Array.from(
      { length: MOTION_PARENT_GRAPH_BUDGETS.maxNodes },
      (_, index) => ({
        clipId: `budget-node:${String(index).padStart(5, '0')}`,
        compositionId: 'composition:budget',
        space: '2d' as const,
      }),
    );
    const graph = createMotionParentGraphSnapshot(nodes);
    const plannerInput = {
      graph,
      evaluation: {
        timelineTime: 0,
        localTransforms: graph.nodes.map((node) => ({
          clipId: node.clipId,
          transform: createMotionParentContractTransform(),
        })),
      },
      childClipId: nodes[nodes.length - 1].clipId,
      parentClipId: nodes[0].clipId,
    };
    const result = planMotionParentMutation(plannerInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failures[0]?.message);
    const batch = adaptMotionParentMutationBatch({
      plan: result.plan,
      plannerInput,
    });
    expect(batch.operations[0].payload?.leafPlan).toEqual(result.plan);
    expect(structuredClone(batch)).toEqual(batch);
  });

  it('rejects runtime fields and accessors without invoking them', () => {
    let getterReads = 0;
    const payload = {
      templateId: 'template:kinetic-title',
      runtimeHandle: 'gpu:7',
    };
    expect(() => assertMotionAtomicMutationBatch({
      ...createAtomicBatchFixture(),
      operations: [{
        ...createAtomicBatchFixture().operations[0],
        payload,
      }],
    })).toThrow(/runtime-only fields/i);

    const accessorBatch = createAtomicBatchFixture() as unknown as Record<string, unknown>;
    Object.defineProperty(accessorBatch, 'operations', {
      enumerable: true,
      get() {
        getterReads += 1;
        return [];
      },
    });
    expect(() => assertMotionAtomicMutationBatch(accessorBatch)).toThrow(/exact inert/i);
    expect(getterReads).toBe(0);
  });
});

describe('MotionFrameState aggregate contract', () => {
  it('builds one serializable state for all four render consumers', () => {
    const result = createMotionFrameState(createFrameBuildInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failures[0]?.message);

    expect(result.state.structure?.worldTransforms).toHaveLength(3);
    expect(result.state.structure?.worldTransforms).not.toBeInstanceOf(Map);
    expect(result.state.media.poolPlan.requests).toHaveLength(1);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.media.poolPlan)).toBe(true);
    const originalPoolVersion = result.state.media.poolPlan.contractVersion;
    expect(Reflect.set(result.state.media.poolPlan, 'contractVersion', 'forged')).toBe(false);
    expect(result.state.media.poolPlan.contractVersion).toBe(originalPoolVersion);
    expect(structuredClone(result.state)).toEqual(result.state);
    expect(parseMotionFrameState(serializeMotionFrameState(result.state))).toEqual(result.state);

    const bindings = MOTION_FRAME_STATE_CONSUMERS.map((consumer) =>
      bindMotionFrameStateConsumer(result.state, consumer));
    expect(bindings.map((binding) => binding.consumer)).toEqual(MOTION_FRAME_STATE_CONSUMERS);
    expect(bindings.every((binding) => binding.frameState === result.state)).toBe(true);
    expect(() => bindMotionFrameStateConsumer(
      structuredClone(result.state),
      'preview',
    )).toThrow(/created or parsed/i);
  });

  it('fails closed for a failed Replicator leaf without emitting partial state', () => {
    const input = createFrameBuildInput();
    const result = createMotionFrameState({
      ...input,
      replicators: [{
        layerId: 'layer:replicator',
        evaluation: {
          ok: false,
          requestedCount: 0,
          effectiveCount: 0,
          sourceBounds: null,
          contentBounds: null,
          instances: [],
          diagnostics: [],
          cacheKey: null,
        },
      }],
    } as unknown as MotionFrameStateBuildInput);
    expect(result).toMatchObject({
      ok: false,
      state: null,
      failures: [{ code: 'MOTION_FRAME_STATE_INVALID' }],
    });
  });

  it('fails closed when MD3 and MD4 stable indexes or layout contributions diverge', () => {
    const input = createFrameBuildInput();
    const firstPlan = input.modifiers[0].plan;
    const firstInstance = firstPlan.instances[0];
    const divergentLayout = {
      ...firstInstance.layoutTransform,
      position: { x: 999, y: 0 },
    };
    const divergentContext = {
      ...input.modifiers[0].context,
      instances: [{
        ...input.modifiers[0].context.instances[0],
        layoutTransform: divergentLayout,
      }, ...input.modifiers[0].context.instances.slice(1)],
    };
    const divergentPlan = planMotionModifiers(input.modifiers[0].contract, divergentContext);
    if (!divergentPlan.ok) throw new Error('Divergent modifier fixture unexpectedly failed');
    const result = createMotionFrameState({
      ...input,
      modifiers: [{
        ...input.modifiers[0],
        context: divergentContext,
        plan: divergentPlan,
      }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected cross-contract failure');
    expect(result.failures[0].message).toMatch(/exact Replicator instance/i);
  });

  it('rejects a final transform that is not layout plus offset', () => {
    const input = createFrameBuildInput();
    const evaluation = input.replicators[0].evaluation;
    const firstInstance = evaluation.instances[0];
    const result = createMotionFrameState({
      ...input,
      replicators: [{
        ...input.replicators[0],
        evaluation: {
          ...evaluation,
          instances: [{
            ...firstInstance,
            transform: {
              ...firstInstance.transform,
              position: { x: firstInstance.transform.position.x + 1, y: 0 },
            },
          }, ...evaluation.instances.slice(1)],
        },
      }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected transform-composition failure');
    expect(result.failures[0].message).toMatch(/exact contract provenance/i);
  });

  it('supports per-instance expressions and binds their count, time, and revision provenance', () => {
    const input = createFrameBuildInput();
    const valid = createMotionFrameState({
      ...input,
      expressions: [...input.expressions].reverse(),
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error(valid.failures[0]?.message);
    expect(valid.state.expressions.map((expression) => expression.instanceIndex))
      .toEqual([0, 1, 2, 3, 4, 5]);
    expect(() => serializeMotionFrameState({
      ...valid.state,
      expressions: [...valid.state.expressions].reverse(),
    })).toThrow(/canonical order/i);

    const invalid = createMotionFrameState({
      ...input,
      expressions: input.expressions.map((expression, index) => (
        index === 1 ? { ...expression, effectiveCount: 999 } : expression
      )),
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error('Expected expression provenance failure');
    expect(invalid.failures[0].message).toMatch(/index\/count provenance/i);
  });

  it('rejects duplicate or mixed-provenance media evaluations on one layer', () => {
    const input = createFrameBuildInput();
    const duplicate = createMotionFrameState({
      ...input,
      mediaEntries: [input.mediaEntries[0], input.mediaEntries[0]],
    });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error('Expected duplicate media failure');
    expect(duplicate.failures[0].message).toMatch(/unique stable ids/i);

    const otherRequest = createMotionMediaRequestFixture({
      stableAssetId: 'asset-other',
      clipLocalTimeSeconds: 1.25,
      instanceIndex: 1,
    });
    const mixed = createMotionFrameState({
      ...input,
      mediaEntries: [input.mediaEntries[0], {
        layerId: input.mediaEntries[0].layerId,
        request: otherRequest,
        evaluation: evaluateMotionMediaFrame(otherRequest),
      }],
    });
    expect(mixed.ok).toBe(false);
    if (mixed.ok) throw new Error('Expected mixed media provenance failure');
    expect(mixed.failures[0].message).toMatch(/identical source provenance/i);
  });

  it('requires media, modifiers, and expressions on one layer to share canonical clip time', () => {
    const input = createFrameBuildInput();
    const mediaEntries = input.replicators[0].evaluation.instances.map((instance) => {
      const request = createMotionMediaRequestFixture({
        clipLocalTimeSeconds: 9,
        instanceIndex: instance.index,
      });
      return {
        layerId: 'layer:replicator',
        request,
        evaluation: evaluateMotionMediaFrame(request),
      };
    });
    const result = createMotionFrameState({
      ...input,
      entityRevisions: input.entityRevisions.map((revision) => (
        revision.kind === 'media-binding'
          ? { ...revision, entityId: 'layer:replicator' }
          : revision
      )),
      mediaEntries,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected layer-time provenance failure');
    expect(result.failures[0].message).toMatch(/canonical clip-local time/i);
  });

  it('binds adjustment packets to their exact stack and aggregate revision', () => {
    const input = createFrameBuildInput();
    const result = createMotionFrameState({
      ...input,
      adjustment: {
        ...input.adjustment!,
        packet: {
          ...input.adjustment!.packet,
          revision: input.adjustment!.packet.revision + 1,
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected adjustment revision failure');
    expect(result.failures[0].message).toMatch(/exact stack, revision/i);
  });

  it('fails closed when structure time differs from the aggregate timeline time', () => {
    const input = createFrameBuildInput();
    const result = createMotionFrameState({
      ...input,
      structure: {
        ...input.structure!,
        evaluation: createMotionParentContractEvaluationFixture(6),
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected structure-time failure');
    expect(result.failures[0].message).toMatch(/timeline time/i);
  });

  it('inspects nested accessors before any leaf field read', () => {
    const input = createFrameBuildInput();
    let getterReads = 0;
    const unsafeReplicator = { ...input.replicators[0] } as Record<string, unknown>;
    Object.defineProperty(unsafeReplicator, 'evaluation', {
      enumerable: true,
      get() {
        getterReads += 1;
        return input.replicators[0].evaluation;
      },
    });
    const result = createMotionFrameState({
      ...input,
      replicators: [unsafeReplicator],
    } as unknown as MotionFrameStateBuildInput);
    expect(result.ok).toBe(false);
    expect(getterReads).toBe(0);
  });
});
