import { describe, expect, it } from 'vitest';

import { createTitleAdjustmentMontageFixture } from '../../src/services/motionDesign/adjustment/contractFixtures';
import {
  MOTION_ADJUSTMENT_MAX_EFFECTS_PER_LAYER,
  MOTION_ADJUSTMENT_MAX_ID_LENGTH,
  MOTION_ADJUSTMENT_MAX_JSON_DEPTH,
  MOTION_ADJUSTMENT_MAX_JSON_NODES,
  MOTION_ADJUSTMENT_MAX_JSON_STRING_LENGTH,
  MOTION_ADJUSTMENT_MAX_LAYERS,
  MOTION_ADJUSTMENT_MAX_MASKS_PER_LAYER,
  MOTION_ADJUSTMENT_MAX_OPERATIONS,
  MOTION_ADJUSTMENT_MAX_POINTS_PER_MASK,
  MOTION_ADJUSTMENT_MAX_REFERENCE_LENGTH,
  assertMotionAdjustmentJsonData,
  isMotionAdjustmentStableId,
  isMotionAdjustmentStableReference,
} from '../../src/services/motionDesign/adjustment/contractLimits';
import {
  assertMotionAdjustmentOperationPacket,
  parseMotionAdjustmentOperationPacket,
  serializeMotionAdjustmentOperationPacket,
  type MotionAdjustmentLayerContract,
  type MotionAdjustmentMaskContract,
  type MotionAdjustmentSourceLayerContract,
  type MotionAdjustmentStackContract,
} from '../../src/services/motionDesign/adjustment/contracts';
import { planMotionAdjustmentOperations } from '../../src/services/motionDesign/adjustment/operationPlanner';
import { createMotionMediaSourceReference } from '../../src/services/motionDesign/media/sourceReferencePlanner';

describe('motion adjustment/media cross-contract freeze', () => {
  it('keeps timeline media opaque and accepts canonical MD5 motion-media ids', () => {
    const timelineFixture = createTitleAdjustmentMontageFixture();
    const timelinePacket = planMotionAdjustmentOperations(timelineFixture);
    expect(timelinePacket.operations).toContainEqual({
      type: 'resolve-source',
      layerId: 'montage',
      sourceKind: 'timeline-media',
      sourceId: 'timeline-media:montage',
      outputRef: 'source:montage',
    });

    const motionFixture = createTitleAdjustmentMontageFixture();
    const montage = motionFixture.layers.find((layer) => layer.layerId === 'montage');
    if (!montage || montage.kind !== 'source') {
      throw new Error('Expected montage source fixture');
    }
    const source = createMotionMediaSourceReference('video', 'wall-video-1', 20);
    montage.source = { kind: 'motion-media', sourceId: source.sourceId };
    const motionPacket = planMotionAdjustmentOperations(motionFixture);
    expect(motionPacket.operations).toContainEqual({
      type: 'resolve-source',
      layerId: 'montage',
      sourceKind: 'motion-media',
      sourceId: source.sourceId,
      outputRef: 'source:montage',
    });
  });

  it.each([
    'arbitrary-media-id',
    'C:\\media\\clip.mp4',
    '/media/clip.mp4',
  ])('rejects non-canonical motion-media source id %s in planner and parser', (sourceId) => {
    const fixture = createTitleAdjustmentMontageFixture();
    const montage = fixture.layers.find((layer) => layer.layerId === 'montage');
    if (!montage || montage.kind !== 'source') {
      throw new Error('Expected montage source fixture');
    }
    montage.source = { kind: 'motion-media', sourceId };
    expect(() => planMotionAdjustmentOperations(fixture)).toThrow();

    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const serialized = JSON.parse(
      serializeMotionAdjustmentOperationPacket(packet),
    ) as { operations: Array<Record<string, unknown>> };
    const resolution = serialized.operations.find(
      (operation) => operation.type === 'resolve-source'
        && operation.layerId === 'montage',
    );
    if (!resolution) throw new Error('Expected source resolution operation');
    resolution.sourceKind = 'motion-media';
    resolution.sourceId = sourceId;
    expect(() => parseMotionAdjustmentOperationPacket(JSON.stringify(serialized)))
      .toThrow();
  });

  it('accepts the exact layer budget and rejects one over before mutation', () => {
    const exact = stackWithLayers(Array.from(
      { length: MOTION_ADJUSTMENT_MAX_LAYERS },
      (_, index) => sourceLayer(index, false),
    ));
    expect(planMotionAdjustmentOperations(exact).operations).toHaveLength(1);

    const over = structuredClone(exact);
    over.layers.push(sourceLayer(MOTION_ADJUSTMENT_MAX_LAYERS, false));
    const before = structuredClone(over);
    expect(() => planMotionAdjustmentOperations(over)).toThrowError(
      'layer count exceeds its hard budget',
    );
    expect(over).toEqual(before);
  });

  it('accepts the exact per-layer effect budget and rejects one over', () => {
    const exact = stackWithLayers([
      adjustmentLayer(0, MOTION_ADJUSTMENT_MAX_EFFECTS_PER_LAYER, false),
    ]);
    expect(planMotionAdjustmentOperations(exact).operations).toHaveLength(3);

    const over = stackWithLayers([
      adjustmentLayer(0, MOTION_ADJUSTMENT_MAX_EFFECTS_PER_LAYER + 1, false),
    ]);
    expect(() => planMotionAdjustmentOperations(over)).toThrowError(
      'Invalid effects',
    );
  });

  it('accepts exact mask and mask-point budgets and rejects each over', () => {
    const exactMasks = adjustmentLayer(0, 0, false);
    exactMasks.mix.masks = Array.from(
      { length: MOTION_ADJUSTMENT_MAX_MASKS_PER_LAYER },
      (_, index) => mask(index, 0),
    );
    expect(planMotionAdjustmentOperations(stackWithLayers([exactMasks])).operations)
      .toHaveLength(3);

    const overMasks = structuredClone(exactMasks);
    overMasks.mix.masks.push(mask(MOTION_ADJUSTMENT_MAX_MASKS_PER_LAYER, 0));
    expect(() => planMotionAdjustmentOperations(stackWithLayers([overMasks])))
      .toThrowError('Invalid mix controls');

    const exactPoints = adjustmentLayer(0, 0, false);
    exactPoints.mix.masks = [mask(0, MOTION_ADJUSTMENT_MAX_POINTS_PER_MASK)];
    expect(planMotionAdjustmentOperations(stackWithLayers([exactPoints])).operations)
      .toHaveLength(3);

    const overPoints = adjustmentLayer(0, 0, false);
    overPoints.mix.masks = [mask(0, MOTION_ADJUSTMENT_MAX_POINTS_PER_MASK + 1)];
    expect(() => planMotionAdjustmentOperations(stackWithLayers([overPoints])))
      .toThrowError('Invalid mask');
  });

  it('accepts the exact operation budget and rejects one over in full preflight', () => {
    const exactLayers = [
      ...Array.from({ length: 30 }, (_, index) =>
        adjustmentLayer(index, MOTION_ADJUSTMENT_MAX_EFFECTS_PER_LAYER, true)),
      adjustmentLayer(30, 1, true),
    ];
    const exactPacket = planMotionAdjustmentOperations(stackWithLayers(exactLayers));
    expect(exactPacket.operations).toHaveLength(MOTION_ADJUSTMENT_MAX_OPERATIONS);
    expect(() => assertMotionAdjustmentOperationPacket(exactPacket)).not.toThrow();

    const overLayers = [
      ...exactLayers.slice(0, -1),
      adjustmentLayer(30, 2, true),
    ];
    const over = stackWithLayers(overLayers);
    const before = structuredClone(over);
    expect(() => planMotionAdjustmentOperations(over)).toThrowError(
      'operation count exceeds its hard budget',
    );
    expect(over).toEqual(before);

    const overPacket = {
      ...exactPacket,
      operations: [...exactPacket.operations, exactPacket.operations[0]!],
    };
    expect(() => assertMotionAdjustmentOperationPacket(overPacket)).toThrowError(
      'operation count exceeds its hard budget',
    );
  });

  it('accepts exact JSON depth, rejects one over, and never executes getters', () => {
    expect(() => assertMotionAdjustmentJsonData(
      nestedJsonArray(MOTION_ADJUSTMENT_MAX_JSON_DEPTH),
    )).not.toThrow();
    expect(() => assertMotionAdjustmentJsonData(
      nestedJsonArray(MOTION_ADJUSTMENT_MAX_JSON_DEPTH + 1),
    )).toThrowError('JSON depth exceeds its hard budget');

    let getterCalls = 0;
    const malicious = createTitleAdjustmentMontageFixture() as unknown as Record<
      string,
      unknown
    >;
    Object.defineProperty(malicious, 'contractVersion', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'motion-adjustment-stack/v1';
      },
    });
    expect(() => planMotionAdjustmentOperations(
      malicious as unknown as MotionAdjustmentStackContract,
    )).toThrowError('accessors are forbidden');
    expect(getterCalls).toBe(0);

    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    ) as unknown as Record<string, unknown>;
    Object.defineProperty(packet, 'evaluationTime', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 1;
      },
    });
    expect(() => assertMotionAdjustmentOperationPacket(packet))
      .toThrowError('accessors are forbidden');
    expect(getterCalls).toBe(0);
  });

  it('enforces exact global JSON node and string budgets before planning', () => {
    expect(() => assertMotionAdjustmentJsonData(Array.from(
      { length: MOTION_ADJUSTMENT_MAX_JSON_NODES - 1 },
      () => null,
    ))).not.toThrow();
    expect(() => assertMotionAdjustmentJsonData(Array.from(
      { length: MOTION_ADJUSTMENT_MAX_JSON_NODES },
      () => null,
    ))).toThrowError('JSON node count exceeds its hard budget');

    expect(() => assertMotionAdjustmentJsonData(
      's'.repeat(MOTION_ADJUSTMENT_MAX_JSON_STRING_LENGTH),
    )).not.toThrow();
    expect(() => assertMotionAdjustmentJsonData(
      's'.repeat(MOTION_ADJUSTMENT_MAX_JSON_STRING_LENGTH + 1),
    )).toThrowError('JSON string length exceeds its hard budget');
    expect(() => assertMotionAdjustmentJsonData({
      ['k'.repeat(MOTION_ADJUSTMENT_MAX_JSON_STRING_LENGTH + 1)]: null,
    })).toThrowError('JSON string length exceeds its hard budget');
  });

  it('requires standard array prototypes and bounded control-free ids and refs', () => {
    const customPrototypeArray = [null];
    Object.setPrototypeOf(customPrototypeArray, {});
    expect(() => assertMotionAdjustmentJsonData(customPrototypeArray))
      .toThrowError('plain JSON containers');

    expect(isMotionAdjustmentStableId(
      'i'.repeat(MOTION_ADJUSTMENT_MAX_ID_LENGTH),
    )).toBe(true);
    expect(isMotionAdjustmentStableId(
      'i'.repeat(MOTION_ADJUSTMENT_MAX_ID_LENGTH + 1),
    )).toBe(false);
    expect(isMotionAdjustmentStableId('layer\u0000collision')).toBe(false);
    expect(isMotionAdjustmentStableId('effect\ncollision')).toBe(false);
    expect(isMotionAdjustmentStableReference(
      'r'.repeat(MOTION_ADJUSTMENT_MAX_REFERENCE_LENGTH),
    )).toBe(true);
    expect(isMotionAdjustmentStableReference(
      'r'.repeat(MOTION_ADJUSTMENT_MAX_REFERENCE_LENGTH + 1),
    )).toBe(false);

    const exactIds = createTitleAdjustmentMontageFixture();
    exactIds.compositionId = 'c'.repeat(MOTION_ADJUSTMENT_MAX_ID_LENGTH);
    const exactAdjustment = exactIds.layers.find(
      (layer) => layer.kind === 'adjustment',
    );
    if (!exactAdjustment || exactAdjustment.kind !== 'adjustment') {
      throw new Error('Expected adjustment fixture');
    }
    exactAdjustment.layerId = 'l'.repeat(MOTION_ADJUSTMENT_MAX_ID_LENGTH);
    exactAdjustment.effects[0]!.id = 'e'.repeat(
      MOTION_ADJUSTMENT_MAX_ID_LENGTH,
    );
    exactAdjustment.mix.masks[0]!.id = 'm'.repeat(
      MOTION_ADJUSTMENT_MAX_ID_LENGTH,
    );
    expect(() => planMotionAdjustmentOperations(exactIds)).not.toThrow();

    const badComposition = createTitleAdjustmentMontageFixture();
    badComposition.compositionId = 'composition\u0000forged';
    expect(() => planMotionAdjustmentOperations(badComposition)).toThrow();

    const badLayer = createTitleAdjustmentMontageFixture();
    badLayer.layers[0]!.layerId = 'title\u007Fforged';
    expect(() => planMotionAdjustmentOperations(badLayer)).toThrow();

    const badEffect = createTitleAdjustmentMontageFixture();
    const adjustment = badEffect.layers.find((layer) => layer.kind === 'adjustment');
    if (!adjustment || adjustment.kind !== 'adjustment') {
      throw new Error('Expected adjustment fixture');
    }
    adjustment.effects[0]!.id = 'effect\u0000forged';
    expect(() => planMotionAdjustmentOperations(badEffect)).toThrow();

    const badMask = createTitleAdjustmentMontageFixture();
    const maskedAdjustment = badMask.layers.find(
      (layer) => layer.kind === 'adjustment',
    );
    if (!maskedAdjustment || maskedAdjustment.kind !== 'adjustment') {
      throw new Error('Expected adjustment fixture');
    }
    maskedAdjustment.mix.masks[0]!.id = 'mask\nforged';
    expect(() => planMotionAdjustmentOperations(badMask)).toThrow();

    const badRef = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    badRef.finalAccumulatorRef = 'accumulator\u0000forged';
    expect(() => assertMotionAdjustmentOperationPacket(badRef)).toThrow();
  });

  it('keeps planned output JSON-serializable and runtime-handle-free', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const serialized = serializeMotionAdjustmentOperationPacket(packet);
    expect(parseMotionAdjustmentOperationPacket(serialized)).toEqual(packet);
    expect(serialized).not.toMatch(
      /runtimeHandle|decoder|videoFrame|gpuTexture|canvas|localPath/,
    );
  });
});

function stackWithLayers(
  layers: MotionAdjustmentStackContract['layers'],
): MotionAdjustmentStackContract {
  return {
    contractVersion: 'motion-adjustment-stack/v1',
    revision: 0,
    compositionId: 'composition:budget-fixture',
    evaluationTime: 1,
    inputOrder: 'top-to-bottom',
    layers,
  };
}

function sourceLayer(
  index: number,
  enabled: boolean,
): MotionAdjustmentSourceLayerContract {
  return {
    kind: 'source',
    layerId: `source-${index}`,
    enabled,
    activeRange: { start: 0, end: 10 },
    source: {
      kind: 'timeline-media',
      sourceId: `timeline-media:${index}`,
    },
    mix: { opacity: 1, blendMode: 'normal', masks: [] },
  };
}

function adjustmentLayer(
  index: number,
  effectCount: number,
  effectsEnabled: boolean,
): MotionAdjustmentLayerContract {
  return {
    kind: 'adjustment',
    layerId: `adjustment-${index}`,
    enabled: true,
    activeRange: { start: 0, end: 10 },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
    },
    mix: { opacity: 1, blendMode: 'normal', masks: [] },
    effects: Array.from({ length: effectCount }, (_, effectIndex) => ({
      id: `effect-${index}-${effectIndex}`,
      effectType: 'brightness',
      enabled: effectsEnabled,
      parameters: {},
    })),
  };
}

function mask(index: number, pointCount: number): MotionAdjustmentMaskContract {
  return {
    id: `mask-${index}`,
    mode: 'add',
    inverted: false,
    opacity: 1,
    feather: 0,
    points: Array.from({ length: pointCount }, (_, pointIndex) => ({
      x: pointIndex / Math.max(1, pointCount),
      y: 0.5,
    })),
  };
}

function nestedJsonArray(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}
