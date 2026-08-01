import { describe, expect, it } from 'vitest';

import {
  IDENTITY_ADJUSTMENT_TRANSFORM,
  type MotionAdjustmentMixContract,
} from '../../src/services/motionDesign/adjustment/contracts';
import { planMotionAdjustmentOperations } from '../../src/services/motionDesign/adjustment/operationPlanner';
import {
  adaptMotionAdjustmentTimelineStack,
  type EvaluatedTimelineAdjustmentLayer,
  type EvaluatedTimelineSourceLayer,
  type MotionAdjustmentTimelineStackInput,
} from '../../src/services/motionDesign/adjustment/timelineStackAdapter';

describe('MD7 motion adjustment timeline stack adapter', () => {
  it('keeps a title above an adjustment unaffected while applying it to sources below', () => {
    const result = adaptMotionAdjustmentTimelineStack(input([
      source('clip:background', 'timeline-media', 'timeline-media:background'),
      source('clip:montage', 'timeline-media', 'timeline-media:montage'),
      adjustment('clip:grade', 'effect:grade'),
      source('clip:title', 'title', 'title:hero'),
    ]));

    expect(result.stack.layers.map((layer) => layer.layerId)).toEqual([
      'clip:title',
      'clip:grade',
      'clip:montage',
      'clip:background',
    ]);
    expect(result.sourceBindings).toEqual([
      {
        sourceClipId: 'clip:background',
        layerId: 'clip:background',
        sourceKind: 'timeline-media',
        sourceId: 'timeline-media:background',
        bottomToTopIndex: 0,
      },
      {
        sourceClipId: 'clip:montage',
        layerId: 'clip:montage',
        sourceKind: 'timeline-media',
        sourceId: 'timeline-media:montage',
        bottomToTopIndex: 1,
      },
      {
        sourceClipId: 'clip:title',
        layerId: 'clip:title',
        sourceKind: 'title',
        sourceId: 'title:hero',
        bottomToTopIndex: 3,
      },
    ]);

    const packet = planMotionAdjustmentOperations(result.stack);
    expect(packet.operations.map((operation) =>
      operation.type === 'initialize-accumulator'
        ? operation.type
        : `${operation.type}:${operation.layerId}`)).toEqual([
      'initialize-accumulator',
      'resolve-source:clip:background',
      'composite-source:clip:background',
      'resolve-source:clip:montage',
      'composite-source:clip:montage',
      'snapshot-accumulator:clip:grade',
      'apply-adjustment-effect:clip:grade',
      'mix-adjustment-result:clip:grade',
      'resolve-source:clip:title',
      'composite-source:clip:title',
    ]);
    expect(packet.operations).toContainEqual({
      type: 'snapshot-accumulator',
      layerId: 'clip:grade',
      inputRef: 'accumulator:after:clip:montage',
      outputRef: 'accumulator:before-adjustment:clip:grade',
    });
    expect(packet.operations).toContainEqual(expect.objectContaining({
      type: 'composite-source',
      layerId: 'clip:title',
      lowerAccumulatorRef: 'accumulator:after:clip:grade',
    }));
    expect(packet.finalAccumulatorRef).toBe('accumulator:after:clip:title');
  });

  it('preserves deterministic bottom-to-top ordering across multiple adjustments', () => {
    const adapterInput = input([
      source('clip:base', 'timeline-media', 'timeline-media:base'),
      adjustment('clip:lower-adjustment', 'effect:lower'),
      source('clip:middle', 'timeline-media', 'timeline-media:middle'),
      adjustment('clip:upper-adjustment', 'effect:upper'),
      source('clip:title', 'title', 'title:top'),
    ]);
    const before = structuredClone(adapterInput);

    const first = adaptMotionAdjustmentTimelineStack(adapterInput);
    const second = adaptMotionAdjustmentTimelineStack(adapterInput);
    const packet = planMotionAdjustmentOperations(first.stack);

    expect(first).toEqual(second);
    expect(adapterInput).toEqual(before);
    expect(first.stack.layers.map((layer) => layer.layerId)).toEqual([
      'clip:title',
      'clip:upper-adjustment',
      'clip:middle',
      'clip:lower-adjustment',
      'clip:base',
    ]);
    expect(packet.operations.filter((operation) =>
      operation.type === 'mix-adjustment-result').map((operation) => operation.layerId))
      .toEqual(['clip:lower-adjustment', 'clip:upper-adjustment']);
    expect(packet.operations).toContainEqual(expect.objectContaining({
      type: 'snapshot-accumulator',
      layerId: 'clip:lower-adjustment',
      inputRef: 'accumulator:after:clip:base',
    }));
    expect(packet.operations).toContainEqual(expect.objectContaining({
      type: 'snapshot-accumulator',
      layerId: 'clip:upper-adjustment',
      inputRef: 'accumulator:after:clip:middle',
    }));
  });

  it('fails closed for missing and duplicate stable sourceClipId values', () => {
    const missingId = input([
      {
        ...source('clip:base', 'timeline-media', 'timeline-media:base'),
        sourceClipId: '',
      },
    ]);
    expect(() => adaptMotionAdjustmentTimelineStack(missingId)).toThrowError(
      expect.objectContaining({
        code: 'MISSING_STABLE_SOURCE_CLIP_ID',
      }),
    );

    const duplicateId = input([
      source('clip:shared', 'timeline-media', 'timeline-media:base'),
      adjustment('clip:shared', 'effect:duplicate'),
    ]);
    expect(() => adaptMotionAdjustmentTimelineStack(duplicateId)).toThrowError(
      expect.objectContaining({
        code: 'DUPLICATE_SOURCE_CLIP_ID',
        sourceClipId: 'clip:shared',
      }),
    );
  });

  it('rejects non-JSON adapter inputs before invoking getters', () => {
    let getterCalls = 0;
    const malicious = input([
      source('clip:base', 'timeline-media', 'timeline-media:base'),
    ]) as unknown as Record<string, unknown>;
    Object.defineProperty(malicious.layers as object, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return source('clip:forged', 'timeline-media', 'timeline-media:forged');
      },
    });

    expect(() => adaptMotionAdjustmentTimelineStack(
      malicious as unknown as MotionAdjustmentTimelineStackInput,
    )).toThrowError('accessors are forbidden');
    expect(getterCalls).toBe(0);
  });
});

function input(
  layers: MotionAdjustmentTimelineStackInput['layers'],
): MotionAdjustmentTimelineStackInput {
  return {
    revision: 3,
    compositionId: 'composition:md7-timeline-adapter',
    evaluationTime: 5,
    inputOrder: 'bottom-to-top',
    layers,
  };
}

function source(
  sourceClipId: string,
  kind: EvaluatedTimelineSourceLayer['source']['kind'],
  sourceId: string,
): EvaluatedTimelineSourceLayer {
  return {
    kind: 'source',
    sourceClipId,
    enabled: true,
    activeRange: { start: 0, end: 10 },
    source: { kind, sourceId },
    mix: mix(),
  };
}

function adjustment(
  sourceClipId: string,
  effectId: string,
): EvaluatedTimelineAdjustmentLayer {
  return {
    kind: 'adjustment',
    sourceClipId,
    enabled: true,
    activeRange: { start: 0, end: 10 },
    transform: { ...IDENTITY_ADJUSTMENT_TRANSFORM },
    mix: mix(),
    effects: [{
      id: effectId,
      effectType: 'brightness',
      enabled: true,
      parameters: { amount: 0.1 },
    }],
  };
}

function mix(): MotionAdjustmentMixContract {
  return { opacity: 1, blendMode: 'normal', masks: [] };
}
