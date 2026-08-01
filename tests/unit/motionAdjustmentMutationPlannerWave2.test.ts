import { describe, expect, it } from 'vitest';

import { createTitleAdjustmentMontageFixture } from '../../src/services/motionDesign/adjustment/contractFixtures';
import {
  createDefaultMotionAdjustmentLayer,
  planConfigureMotionAdjustment,
  planCreateMotionAdjustment,
  planMoveMotionAdjustment,
  planRemoveMotionAdjustment,
  planTrimMotionAdjustment,
} from '../../src/services/motionDesign/adjustment/mutationPlanner';
import { planMotionAdjustmentOperations } from '../../src/services/motionDesign/adjustment/operationPlanner';
import { planMotionAdjustmentRenderGraph } from '../../src/services/motionDesign/adjustment/renderGraphExecutor';

describe('motion adjustment Wave 2 semantic mutation planners', () => {
  it('creates an atomic adjustment insertion with lower-layer ordering metadata', () => {
    const stack = createTitleAdjustmentMontageFixture();
    const before = structuredClone(stack);
    const layer = createDefaultMotionAdjustmentLayer(
      'adjustment:ai-created',
      { start: 2, end: 8 },
    );
    const plan = planCreateMotionAdjustment(stack, {
      expectedRevision: 0,
      insertIndex: 1,
      layer,
    });

    expect(stack).toEqual(before);
    expect(plan).toMatchObject({
      kind: 'create',
      layerId: 'adjustment:ai-created',
      ordering: {
        inputOrder: 'top-to-bottom',
        beforeIndex: null,
        afterIndex: 1,
        beforeLowerLayerIds: [],
        afterLowerLayerIds: ['grade', 'montage'],
      },
      apply: { expectedRevision: 0, nextRevision: 1 },
      undo: { expectedRevision: 1, nextRevision: 2 },
      history: { mode: 'single-entry', atomic: true },
    });
    expect(plan.apply.stack.layers[1]).toEqual(layer);
    expect(plan.apply.stack.layers[1]).not.toBe(layer);
    expect(plan.undo.stack.layers).toEqual(stack.layers);
    expect(plan.undo.stack.revision).toBe(2);
    expect(() => planMotionAdjustmentRenderGraph(
      planMotionAdjustmentOperations(plan.apply.stack),
      'preview',
    )).not.toThrow();
  });

  it('configures effects and mix through the same frozen effect contract', () => {
    const stack = createTitleAdjustmentMontageFixture();
    const before = structuredClone(stack);
    const plan = planConfigureMotionAdjustment(stack, {
      expectedRevision: 0,
      layerId: 'grade',
      enabled: true,
      effects: [{
        id: 'effect:configured-blur',
        effectType: 'gaussian-blur',
        enabled: true,
        parameters: { radius: 12, samples: 7 },
      }],
      mix: {
        opacity: 0.4,
        blendMode: 'screen',
        masks: [],
      },
    });

    expect(stack).toEqual(before);
    expect(plan.ordering).toMatchObject({
      beforeIndex: 1,
      afterIndex: 1,
      beforeLowerLayerIds: ['montage'],
      afterLowerLayerIds: ['montage'],
    });
    const configured = plan.apply.stack.layers[1];
    expect(configured).toMatchObject({
      kind: 'adjustment',
      mix: { opacity: 0.4, blendMode: 'screen' },
      effects: [{
        effectType: 'gaussian-blur',
        parameters: { radius: 12, samples: 7 },
      }],
    });
  });

  it('moves one adjustment in top-to-bottom order without mutating the input', () => {
    const stack = createTitleAdjustmentMontageFixture();
    const before = structuredClone(stack);
    const plan = planMoveMotionAdjustment(stack, {
      expectedRevision: 0,
      layerId: 'grade',
      toIndex: 0,
    });

    expect(stack).toEqual(before);
    expect(plan.apply.stack.layers.map((layer) => layer.layerId)).toEqual([
      'grade',
      'title',
      'montage',
    ]);
    expect(plan.ordering).toEqual({
      inputOrder: 'top-to-bottom',
      beforeIndex: 1,
      afterIndex: 0,
      beforeLowerLayerIds: ['montage'],
      afterLowerLayerIds: ['title', 'montage'],
    });
  });

  it('trims adjustment activity and removes it with reversible stack snapshots', () => {
    const stack = createTitleAdjustmentMontageFixture();
    const trimmed = planTrimMotionAdjustment(stack, {
      expectedRevision: 0,
      layerId: 'grade',
      activeRange: { start: 6, end: 9 },
    });
    expect(trimmed.apply.stack.layers[1]).toMatchObject({
      activeRange: { start: 6, end: 9 },
    });
    expect(planMotionAdjustmentOperations(trimmed.apply.stack).operations.some(
      (operation) => 'layerId' in operation && operation.layerId === 'grade',
    )).toBe(false);

    const removed = planRemoveMotionAdjustment(stack, {
      expectedRevision: 0,
      layerId: 'grade',
    });
    expect(removed.apply.stack.layers.map((layer) => layer.layerId)).toEqual([
      'title',
      'montage',
    ]);
    expect(removed.ordering).toMatchObject({
      beforeIndex: 1,
      afterIndex: null,
      beforeLowerLayerIds: ['montage'],
      afterLowerLayerIds: [],
    });
    expect(removed.undo.stack.layers).toEqual(stack.layers);
  });

  it('fails stale revisions and unsupported late effects before changing input', () => {
    const stack = createTitleAdjustmentMontageFixture();
    const before = structuredClone(stack);
    expect(() => planRemoveMotionAdjustment(stack, {
      expectedRevision: 1,
      layerId: 'grade',
    })).toThrowError('revision conflict');

    expect(() => planConfigureMotionAdjustment(stack, {
      expectedRevision: 0,
      layerId: 'grade',
      effects: [
        {
          id: 'effect:valid',
          effectType: 'brightness',
          enabled: true,
          parameters: { amount: 0.1 },
        },
        {
          id: 'effect:unsupported',
          effectType: 'runtime-plugin',
          enabled: true,
          parameters: {},
        },
      ],
    })).toThrowError('unsupported effect');
    expect(stack).toEqual(before);
  });

  it('preflights semantic inputs descriptor-safely', () => {
    const stack = createTitleAdjustmentMontageFixture();
    let getterCalls = 0;
    const input = {
      expectedRevision: 0,
      layerId: 'grade',
      toIndex: 0,
    };
    Object.defineProperty(input, 'toIndex', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 0;
      },
    });
    expect(() => planMoveMotionAdjustment(stack, input))
      .toThrowError('accessors are forbidden');
    expect(getterCalls).toBe(0);

    const layerWithRuntimeField = {
      ...createDefaultMotionAdjustmentLayer('adjustment:forged', {
        start: 0,
        end: 1,
      }),
      runtimeHandle: 'gpu-texture',
    };
    expect(() => planCreateMotionAdjustment(stack, {
      expectedRevision: 0,
      insertIndex: 0,
      layer: layerWithRuntimeField,
    })).toThrowError('adjustment stack layer');
  });
});
