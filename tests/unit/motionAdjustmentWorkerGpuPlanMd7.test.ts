import { describe, expect, it } from 'vitest';

import {
  createTitleAdjustmentMontageFixture,
  createTwoAdjustmentFixture,
} from '../../src/services/motionDesign/adjustment/contractFixtures';
import type { MotionAdjustmentOperationPacket } from '../../src/services/motionDesign/adjustment/contracts';
import { planMotionAdjustmentOperations } from '../../src/services/motionDesign/adjustment/operationPlanner';
import {
  MOTION_ADJUSTMENT_WORKER_GPU_PARITY_VERSION,
  assertMotionAdjustmentWorkerGpuExecutionPlan,
  parseMotionAdjustmentWorkerGpuExecutionPlan,
  planMotionAdjustmentWorkerGpuExecution,
  serializeMotionAdjustmentWorkerGpuExecutionPlan,
  type MotionAdjustmentWorkerGpuPlanInput,
} from '../../src/services/motionDesign/adjustment/workerGpuAdjustmentPlan';

describe('MD7 worker GPU adjustment execution plan', () => {
  it('preserves the complete bottom-to-top source and adjustment interleaving', () => {
    const packet = planMotionAdjustmentOperations(createTwoAdjustmentFixture());
    const before = structuredClone(packet);
    const input = frameInput(packet);

    const first = planMotionAdjustmentWorkerGpuExecution(packet, 'preview', input);
    const second = planMotionAdjustmentWorkerGpuExecution(packet, 'preview', input);

    expect(second).toEqual(first);
    expect(packet).toEqual(before);
    expect(structuredClone(first)).toEqual(first);
    expect(first.renderPlan.operationOrder).toBe('bottom-to-top');
    expect(first.passes.map((pass) => pass.passIndex)).toEqual(
      first.passes.map((_, index) => index),
    );
    expect(new Set(first.passes.map((pass) => pass.passId)).size)
      .toBe(first.passes.length);

    expect(first.passes.flatMap((pass) =>
      pass.kind === 'mix-adjustment-result' ? [pass.layerId] : []))
      .toEqual(['lower-adjustment', 'upper-adjustment']);
    expect(first.passes.flatMap((pass) =>
      pass.kind === 'apply-adjustment-effect'
        ? [`${pass.effectType}:${pass.primitive === 'separable-gaussian-blur'
          ? pass.direction
          : 'single'}`]
        : []))
      .toEqual([
        'saturation:single',
        'gaussian-blur:horizontal',
        'gaussian-blur:vertical',
        'invert:single',
      ]);

    const sourceCompositeIndex = first.passes.findIndex(
      (pass) => pass.kind === 'composite-source' && pass.layerId === 'montage',
    );
    const lowerAdjustmentIndex = first.passes.findIndex(
      (pass) => pass.kind === 'mix-adjustment-result'
        && pass.layerId === 'lower-adjustment',
    );
    const upperAdjustmentIndex = first.passes.findIndex(
      (pass) => pass.kind === 'mix-adjustment-result'
        && pass.layerId === 'upper-adjustment',
    );
    expect(sourceCompositeIndex).toBeGreaterThan(-1);
    expect(sourceCompositeIndex).toBeLessThan(lowerAdjustmentIndex);
    expect(lowerAdjustmentIndex).toBeLessThan(upperAdjustmentIndex);
    expect(first.resources.every((resource) =>
      resource.resourceId.includes('nested-occurrence:A'))).toBe(true);
    expect(first.finalAccumulatorResourceId).toBe(
      first.resources.find((resource) =>
        resource.semanticRef === first.finalAccumulatorRef)?.resourceId,
    );
  });

  it('carries frozen opacity, blend, and vector-mask state into its mix pass', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const plan = planMotionAdjustmentWorkerGpuExecution(
      packet,
      'target-preview',
      frameInput(packet),
    );
    const gradeMix = plan.passes.find(
      (pass) => pass.kind === 'mix-adjustment-result'
        && pass.layerId === 'grade',
    );

    expect(gradeMix).toMatchObject({
      mix: {
        opacity: 0.65,
        blendMode: 'overlay',
        masks: [{
          id: 'mask:grade-window',
          mode: 'add',
          inverted: false,
          opacity: 0.8,
          feather: 16,
        }],
      },
      maskResources: [{ maskId: 'mask:grade-window' }],
    });
    if (!gradeMix || gradeMix.kind !== 'mix-adjustment-result') {
      throw new Error('Expected grade adjustment mix');
    }
    expect(gradeMix.maskResources[0]?.resourceId)
      .toContain('nested-occurrence:A');

    const gradeIndex = plan.passes.indexOf(gradeMix);
    const titleIndex = plan.passes.findIndex(
      (pass) => pass.kind === 'resolve-source' && pass.layerId === 'title',
    );
    expect(gradeIndex).toBeLessThan(titleIndex);
  });

  it('requires exact frame identity and an exact composition/time match', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const valid = frameInput(packet);

    expect(() => planMotionAdjustmentWorkerGpuExecution(packet, 'preview', {
      ...valid,
      deadline: { ...valid.deadline, exact: false },
    })).toThrowError('Invalid exact worker GPU adjustment frame identity');
    expect(() => planMotionAdjustmentWorkerGpuExecution(packet, 'preview', {
      ...valid,
      deadline: { ...valid.deadline, compositionId: 'composition:other' },
    })).toThrowError('does not match the render plan');
    expect(() => planMotionAdjustmentWorkerGpuExecution(packet, 'preview', {
      ...valid,
      deadline: { ...valid.deadline, timelineTime: packet.evaluationTime + 0.001 },
    })).toThrowError('does not match the render plan');
  });

  it('fails closed on unsupported or forged effect state', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const unsupported = structuredClone(packet);
    const effect = unsupported.operations.find(
      (operation) => operation.type === 'apply-adjustment-effect',
    );
    if (!effect || effect.type !== 'apply-adjustment-effect') {
      throw new Error('Expected adjustment effect operation');
    }
    effect.effectType = 'glow';

    expect(() => planMotionAdjustmentWorkerGpuExecution(
      unsupported,
      'preview',
      frameInput(unsupported),
    )).toThrowError(/Invalid motion adjustment compositor|Unsupported adjustment effect/u);

    const valid = planMotionAdjustmentWorkerGpuExecution(
      packet,
      'preview',
      frameInput(packet),
    );
    const forged = structuredClone(valid);
    const workerEffect = forged.passes.find(
      (pass) => pass.kind === 'apply-adjustment-effect'
        && pass.primitive === 'color-matrix-4x5',
    );
    if (
      !workerEffect
      || workerEffect.kind !== 'apply-adjustment-effect'
      || workerEffect.primitive !== 'color-matrix-4x5'
    ) {
      throw new Error('Expected worker color-matrix pass');
    }
    (workerEffect.matrix as number[])[0] = 999;
    expect(() => assertMotionAdjustmentWorkerGpuExecutionPlan(forged))
      .toThrowError('diverges from admitted semantics');
  });

  it('isolates resource namespaces while keeping cross-surface parity comparable', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const preview = planMotionAdjustmentWorkerGpuExecution(
      packet,
      'preview',
      frameInput(packet, 'nested-occurrence:A', 'preview-target'),
    );
    const nested = planMotionAdjustmentWorkerGpuExecution(
      packet,
      'nested-preview',
      frameInput(packet, 'nested-occurrence:B', 'nested-target'),
    );

    expect(preview.resources.map((resource) => resource.resourceId))
      .not.toEqual(nested.resources.map((resource) => resource.resourceId));
    expect(preview.passes.map((pass) => pass.passId))
      .not.toEqual(nested.passes.map((pass) => pass.passId));
    expect(preview.paritySignature).toBe(nested.paritySignature);
    expect(preview.paritySignature)
      .toMatch(new RegExp(`^${MOTION_ADJUSTMENT_WORKER_GPU_PARITY_VERSION}:`, 'u'));

    const nextFrame = planMotionAdjustmentWorkerGpuExecution(
      packet,
      'preview',
      {
        ...frameInput(packet),
        deadline: { ...frameInput(packet).deadline, frameIndex: 301 },
      },
    );
    expect(nextFrame.paritySignature).not.toBe(preview.paritySignature);
  });

  it('round-trips as data-only JSON and rejects tampered pass identities', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const plan = planMotionAdjustmentWorkerGpuExecution(
      packet,
      'export',
      frameInput(packet),
    );
    const serialized = serializeMotionAdjustmentWorkerGpuExecutionPlan(plan);

    expect(parseMotionAdjustmentWorkerGpuExecutionPlan(serialized)).toEqual(plan);

    const tampered = JSON.parse(serialized) as {
      passes: Array<{ passId: string }>;
    };
    tampered.passes[0]!.passId = 'forged-pass-id';
    expect(() => parseMotionAdjustmentWorkerGpuExecutionPlan(
      JSON.stringify(tampered),
    )).toThrowError('diverges from admitted semantics');
  });
});

function frameInput(
  packet: MotionAdjustmentOperationPacket,
  resourceNamespace = 'nested-occurrence:A',
  targetId = 'preview-target',
): MotionAdjustmentWorkerGpuPlanInput {
  return {
    deadline: {
      requestId: 'request:adjustment-frame-300',
      targetId,
      compositionId: packet.compositionId,
      timelineTime: packet.evaluationTime,
      frameIndex: 300,
      intent: 'proof',
      submitByMs: 1_000,
      expireAfterMs: 1_100,
      exact: true,
    },
    graphVersion: 7,
    resourceNamespace,
  };
}
