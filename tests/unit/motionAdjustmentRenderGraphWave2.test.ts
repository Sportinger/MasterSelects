import { describe, expect, it } from 'vitest';

import {
  createTimeRangeExclusionFixture,
  createTitleAdjustmentMontageFixture,
  createTwoAdjustmentFixture,
} from '../../src/services/motionDesign/adjustment/contractFixtures';
import { planMotionAdjustmentOperations } from '../../src/services/motionDesign/adjustment/operationPlanner';
import {
  assertMotionAdjustmentEvaluatedRenderPlan,
  executeMotionAdjustmentRenderGraph,
  planMotionAdjustmentRenderGraph,
  type MotionAdjustmentRenderBackend,
} from '../../src/services/motionDesign/adjustment/renderGraphExecutor';
import {
  decideMotionAdjustmentRenderGraphRollout,
} from '../../src/services/motionDesign/adjustment/renderGraphRollout';
import type { MotionAdjustmentRenderSurface } from '../../src/services/motionDesign/adjustment/supportedEffects';

const SURFACES: readonly MotionAdjustmentRenderSurface[] = [
  'preview',
  'nested-preview',
  'target-preview',
  'export',
];

describe('motion adjustment Wave 2 render graph leaf', () => {
  it('executes the timed montage bottom-to-top and keeps the upper title outside', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const plan = planMotionAdjustmentRenderGraph(packet, 'preview');
    const calls: string[] = [];
    const result = executeMotionAdjustmentRenderGraph(
      plan,
      symbolicBackend(calls),
    );

    expect(calls).toEqual(plan.operations.map((operation) => operation.kind));
    expect(result.executedOperationCount).toBe(packet.operations.length);
    expect(result.finalAccumulatorRef).toBe('accumulator:after:title');
    expect(result.finalValue).toMatch(/^composite\(title,/u);
    expect(result.finalValue).toContain('mix(grade');
    expect(result.finalValue.indexOf('mix(grade')).toBeLessThan(
      result.finalValue.indexOf('source(title)'),
    );

    const gradeMix = plan.operations.find(
      (operation) => operation.kind === 'mix-adjustment-result'
        && operation.layerId === 'grade',
    );
    expect(gradeMix).toMatchObject({
      mix: {
        opacity: 0.65,
        blendMode: 'overlay',
        masks: [{ id: 'mask:grade-window', feather: 16 }],
      },
    });
  });

  it('removes inactive adjustment work before evaluation and operation execution', () => {
    const fixture = createTimeRangeExclusionFixture();
    const grade = fixture.layers.find((layer) => layer.kind === 'adjustment');
    if (!grade || grade.kind !== 'adjustment') {
      throw new Error('Expected adjustment fixture');
    }
    grade.activeRange = { start: 6, end: 10 };

    const plan = planMotionAdjustmentRenderGraph(
      planMotionAdjustmentOperations(fixture),
      'preview',
    );
    expect(plan.operations.some(
      (operation) => 'layerId' in operation && operation.layerId === 'grade',
    )).toBe(false);
  });

  it('composes multiple adjustments deterministically over accumulated lower layers', () => {
    const packet = planMotionAdjustmentOperations(createTwoAdjustmentFixture());
    const first = planMotionAdjustmentRenderGraph(packet, 'preview');
    const second = planMotionAdjustmentRenderGraph(packet, 'preview');
    expect(second).toEqual(first);

    expect(first.operations.flatMap((operation) =>
      operation.kind === 'mix-adjustment-result' ? [operation.layerId] : []))
      .toEqual(['lower-adjustment', 'upper-adjustment']);
    expect(first.operations.flatMap((operation) =>
      operation.kind === 'apply-adjustment-effect'
        ? [operation.effect.effectType]
        : []))
      .toEqual(['saturation', 'gaussian-blur', 'invert']);
  });

  it('emits deterministic color matrices and separable blur primitives', () => {
    const plan = planMotionAdjustmentRenderGraph(
      planMotionAdjustmentOperations(createTitleAdjustmentMontageFixture()),
      'preview',
    );
    const effects = plan.operations.flatMap((operation) =>
      operation.kind === 'apply-adjustment-effect' ? [operation.effect] : []);

    expect(effects[0]).toMatchObject({
      primitive: 'color-matrix-4x5',
      effectType: 'brightness',
      parameters: { amount: 0.12 },
    });
    if (effects[0]?.primitive !== 'color-matrix-4x5') {
      throw new Error('Expected color matrix effect');
    }
    expect(effects[0].matrix).toHaveLength(20);

    const multi = planMotionAdjustmentRenderGraph(
      planMotionAdjustmentOperations(createTwoAdjustmentFixture()),
      'export',
    );
    const blur = multi.operations.find(
      (operation) => operation.kind === 'apply-adjustment-effect'
        && operation.effect.effectType === 'gaussian-blur',
    );
    expect(blur).toMatchObject({
      effect: {
        primitive: 'separable-gaussian-blur',
        parameters: { radius: 4, samples: 5 },
        passes: ['horizontal', 'vertical'],
      },
    });
  });

  it('keeps nested, target, preview, and export on one evaluated representation', () => {
    const fixture = createTitleAdjustmentMontageFixture();
    const montage = fixture.layers.find((layer) => layer.layerId === 'montage');
    if (!montage || montage.kind !== 'source') {
      throw new Error('Expected montage source fixture');
    }
    montage.source = {
      kind: 'nested-composition',
      sourceId: 'composition:nested-montage',
    };
    const packet = planMotionAdjustmentOperations(fixture);
    const plans = SURFACES.map((surface) =>
      planMotionAdjustmentRenderGraph(packet, surface));

    for (const plan of plans) {
      expect(plan.operations).toEqual(plans[0]!.operations);
      expect(plan.operations).toContainEqual(expect.objectContaining({
        kind: 'resolve-source',
        sourceKind: 'nested-composition',
        sourceId: 'composition:nested-montage',
      }));
    }
  });

  it('preflights the full evaluated graph before invoking any backend callback', () => {
    const plan = planMotionAdjustmentRenderGraph(
      planMotionAdjustmentOperations(createTitleAdjustmentMontageFixture()),
      'preview',
    );
    const forged = structuredClone(plan);
    const effect = forged.operations.find(
      (operation) => operation.kind === 'apply-adjustment-effect',
    );
    if (!effect || effect.kind !== 'apply-adjustment-effect') {
      throw new Error('Expected effect operation');
    }
    if (effect.effect.primitive !== 'color-matrix-4x5') {
      throw new Error('Expected color matrix effect');
    }
    (effect.effect.matrix as number[])[0] = 999;

    const calls: string[] = [];
    expect(() => executeMotionAdjustmentRenderGraph(
      forged,
      symbolicBackend(calls),
    )).toThrowError('diverges from packet semantics');
    expect(calls).toEqual([]);

    let getterCalls = 0;
    const accessorPlan = structuredClone(plan) as unknown as Record<string, unknown>;
    Object.defineProperty(accessorPlan, 'operations', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return [];
      },
    });
    expect(() => assertMotionAdjustmentEvaluatedRenderPlan(accessorPlan))
      .toThrowError('accessors are forbidden');
    expect(getterCalls).toBe(0);
  });

  it('turns useRenderGraph into a fail-closed leaf rollout decision', () => {
    expect(decideMotionAdjustmentRenderGraphRollout({
      useRenderGraphFlag: false,
      surface: 'preview',
      integrationState: 'dual-path-verified',
    })).toMatchObject({ useRenderGraph: false, reason: 'FLAG_DISABLED' });
    expect(decideMotionAdjustmentRenderGraphRollout({
      useRenderGraphFlag: true,
      surface: 'export',
      integrationState: 'legacy-only',
    })).toMatchObject({ useRenderGraph: false, reason: 'SURFACE_NOT_INTEGRATED' });
    expect(decideMotionAdjustmentRenderGraphRollout({
      useRenderGraphFlag: true,
      surface: 'target-preview',
      integrationState: 'dual-path-unverified',
    })).toMatchObject({ useRenderGraph: false, reason: 'PARITY_NOT_VERIFIED' });
    expect(decideMotionAdjustmentRenderGraphRollout({
      useRenderGraphFlag: true,
      surface: 'nested-preview',
      integrationState: 'dual-path-verified',
    })).toMatchObject({ useRenderGraph: true, reason: 'RENDER_GRAPH_ENABLED' });
  });
});

function symbolicBackend(
  calls: string[],
): MotionAdjustmentRenderBackend<string> {
  return {
    initializeAccumulator: (operation) => {
      calls.push(operation.kind);
      return 'transparent';
    },
    resolveSource: (operation) => {
      calls.push(operation.kind);
      return `source(${operation.layerId})`;
    },
    compositeSource: (operation, lower, source) => {
      calls.push(operation.kind);
      return `composite(${operation.layerId},${lower},${source})`;
    },
    snapshotAccumulator: (operation, accumulator) => {
      calls.push(operation.kind);
      return `snapshot(${operation.layerId},${accumulator})`;
    },
    applyAdjustmentEffect: (operation, accumulator) => {
      calls.push(operation.kind);
      return `effect(${operation.effectId},${accumulator})`;
    },
    mixAdjustmentResult: (operation, snapshot, processed) => {
      calls.push(operation.kind);
      return `mix(${operation.layerId},${snapshot},${processed})`;
    },
  };
}
