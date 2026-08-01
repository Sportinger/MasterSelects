import { describe, expect, it } from 'vitest';

import {
  createTimeRangeExclusionFixture,
  createTitleAdjustmentMontageFixture,
  createTwoAdjustmentFixture,
} from '../../src/services/motionDesign/adjustment/contractFixtures';
import {
  assertMotionAdjustmentOperationPacket,
  parseMotionAdjustmentOperationPacket,
  serializeMotionAdjustmentOperationPacket,
  type MotionAdjustmentCompositorOperation,
  type MotionAdjustmentEffectContract,
  type MotionAdjustmentStackContract,
} from '../../src/services/motionDesign/adjustment/contracts';
import {
  MotionAdjustmentContractError,
  planMotionAdjustmentOperations,
} from '../../src/services/motionDesign/adjustment/operationPlanner';
import {
  MOTION_ADJUSTMENT_DEFAULT_REVISION,
  migrateMotionAdjustmentRevision,
} from '../../src/services/motionDesign/adjustment/revisionContract';
import {
  ADJUSTMENT_EFFECT_COMPATIBILITY_MATRIX,
  InvalidAdjustmentEffectParametersError,
  SUPPORTED_ADJUSTMENT_EFFECT_TYPES,
  UnsupportedAdjustmentEffectError,
  normalizeAdjustmentEffectParameters,
  type SupportedAdjustmentEffectType,
} from '../../src/services/motionDesign/adjustment/supportedEffects';

describe('motion adjustment contract freeze', () => {
  it('plans the exact title / adjustment / montage compositor order', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );

    expect(packet.inputOrder).toBe('top-to-bottom');
    expect(packet.operationOrder).toBe('bottom-to-top');
    expect(packet.operations.map(operationLabel)).toEqual([
      'initialize-accumulator',
      'resolve-source:montage',
      'composite-source:montage',
      'snapshot-accumulator:grade',
      'apply-adjustment-effect:grade:effect:brightness',
      'apply-adjustment-effect:grade:effect:contrast',
      'mix-adjustment-result:grade',
      'resolve-source:title',
      'composite-source:title',
    ]);

    const titleComposite = packet.operations.at(-1);
    expect(titleComposite).toMatchObject({
      type: 'composite-source',
      layerId: 'title',
      lowerAccumulatorRef: 'accumulator:after:grade',
      outputRef: 'accumulator:after:title',
    });
    expect(packet.finalAccumulatorRef).toBe('accumulator:after:title');
  });

  it('persists exact revision provenance and migrates legacy absence explicitly', () => {
    const fixture = createTitleAdjustmentMontageFixture();
    expect(fixture.revision).toBe(MOTION_ADJUSTMENT_DEFAULT_REVISION);
    fixture.revision = 7;

    const packet = planMotionAdjustmentOperations(fixture);
    expect(packet.revision).toBe(7);
    expect(parseMotionAdjustmentOperationPacket(
      serializeMotionAdjustmentOperationPacket(packet),
    ).revision).toBe(7);
    expect(migrateMotionAdjustmentRevision(undefined)).toBe(
      MOTION_ADJUSTMENT_DEFAULT_REVISION,
    );
    expect(migrateMotionAdjustmentRevision(7)).toBe(7);

    for (const revision of [-1, 1.5]) {
      fixture.revision = revision;
      expect(() => planMotionAdjustmentOperations(fixture)).toThrowError(
        'non-negative safe integer',
      );
    }
    fixture.revision = Number.POSITIVE_INFINITY;
    expect(() => planMotionAdjustmentOperations(fixture)).toThrowError(
      'finite JSON numbers',
    );

    const missingRevision = JSON.parse(
      serializeMotionAdjustmentOperationPacket(packet),
    ) as Record<string, unknown>;
    delete missingRevision.revision;
    expect(() => parseMotionAdjustmentOperationPacket(
      JSON.stringify(missingRevision),
    )).toThrow();
  });

  it('rejects forged ref-valid packets outside the canonical layer state machine', () => {
    const canonical = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );

    const deferredComposite = structuredClone(canonical);
    const montageResolve = deferredComposite.operations[1]!;
    const montageComposite = deferredComposite.operations[2]!;
    deferredComposite.operations.splice(1, 2, montageResolve);
    deferredComposite.operations.splice(3, 0, montageComposite);
    expect(() => assertMotionAdjustmentOperationPacket(deferredComposite))
      .toThrowError('source transition');

    const arbitraryRefs = structuredClone(canonical);
    const init = arbitraryRefs.operations[0]!;
    const resolve = arbitraryRefs.operations[1]!;
    const composite = arbitraryRefs.operations[2]!;
    if (
      init.type !== 'initialize-accumulator'
      || resolve.type !== 'resolve-source'
      || composite.type !== 'composite-source'
    ) {
      throw new Error('Expected canonical source prefix');
    }
    init.outputRef = 'accumulator:arbitrary';
    composite.lowerAccumulatorRef = init.outputRef;
    expect(() => assertMotionAdjustmentOperationPacket(arbitraryRefs))
      .toThrowError('non-canonical initialization');

    const crossedEffect = structuredClone(canonical);
    const effectOperation = crossedEffect.operations.find(
      (operation) => operation.type === 'apply-adjustment-effect',
    );
    if (!effectOperation || effectOperation.type !== 'apply-adjustment-effect') {
      throw new Error('Expected adjustment effect operation');
    }
    effectOperation.layerId = 'another-layer';
    expect(() => assertMotionAdjustmentOperationPacket(crossedEffect))
      .toThrowError('effect transition');

    const duplicateEffect = structuredClone(canonical);
    const firstEffectIndex = duplicateEffect.operations.findIndex(
      (operation) => operation.type === 'apply-adjustment-effect',
    );
    const firstEffect = duplicateEffect.operations[firstEffectIndex];
    if (!firstEffect || firstEffect.type !== 'apply-adjustment-effect') {
      throw new Error('Expected adjustment effect operation');
    }
    duplicateEffect.operations.splice(firstEffectIndex + 1, 0, {
      ...firstEffect,
      inputRef: firstEffect.outputRef,
      outputRef: 'adjustment:grade:effect:forged-duplicate-output',
    });
    expect(() => assertMotionAdjustmentOperationPacket(duplicateEffect))
      .toThrowError('effect transition');

    const duplicateLayer = structuredClone(canonical);
    const sourceTransition = duplicateLayer.operations.slice(1, 3);
    duplicateLayer.operations.splice(-2, 0, ...sourceTransition);
    expect(() => assertMotionAdjustmentOperationPacket(duplicateLayer))
      .toThrowError('Duplicate motion adjustment layer transition');

    const wrongFinal = structuredClone(canonical);
    wrongFinal.finalAccumulatorRef = 'accumulator:transparent';
    expect(() => assertMotionAdjustmentOperationPacket(wrongFinal))
      .toThrowError('final accumulator');
  });

  it('treats a nested composition as one resolved parent-level source', () => {
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
    const nestedOperations = packet.operations.filter(
      (operation) => operation.type === 'resolve-source'
        && operation.sourceKind === 'nested-composition',
    );
    expect(nestedOperations).toEqual([
      {
        type: 'resolve-source',
        layerId: 'montage',
        sourceKind: 'nested-composition',
        sourceId: 'composition:nested-montage',
        outputRef: 'source:montage',
      },
    ]);
  });

  it('orders two adjustments deterministically from lower to higher', () => {
    const fixture = createTwoAdjustmentFixture();
    const first = planMotionAdjustmentOperations(fixture);
    const second = planMotionAdjustmentOperations(fixture);

    expect(second).toEqual(first);
    expect(
      first.operations
        .filter((operation) => operation.type === 'mix-adjustment-result')
        .map((operation) => operation.layerId),
    ).toEqual(['lower-adjustment', 'upper-adjustment']);
    expect(
      first.operations
        .filter((operation) => operation.type === 'apply-adjustment-effect')
        .map((operation) => operation.effectType),
    ).toEqual(['saturation', 'gaussian-blur', 'invert']);
  });

  it('excludes disabled and out-of-range layers using an end-exclusive range', () => {
    const packet = planMotionAdjustmentOperations(
      createTimeRangeExclusionFixture(),
    );
    const referencedLayerIds = packet.operations.flatMap((operation) =>
      'layerId' in operation ? [operation.layerId] : []);

    expect(referencedLayerIds).not.toContain('future-title');
    expect(referencedLayerIds).not.toContain('ended-source');
    expect(referencedLayerIds).not.toContain('disabled-source');
    expect(referencedLayerIds).toContain('montage');
    expect(referencedLayerIds).toContain('grade');
    expect(referencedLayerIds).toContain('title');
  });

  it('retains masks, opacity, and blend mode on the processed/snapshot mix', () => {
    const fixture = createTitleAdjustmentMontageFixture();
    const grade = fixture.layers.find((layer) => layer.layerId === 'grade');
    if (!grade || grade.kind !== 'adjustment') {
      throw new Error('Expected adjustment fixture');
    }

    const packet = planMotionAdjustmentOperations(fixture);
    const mix = packet.operations.find(
      (operation) => operation.type === 'mix-adjustment-result'
        && operation.layerId === 'grade',
    );
    expect(mix).toEqual({
      type: 'mix-adjustment-result',
      layerId: 'grade',
      preEffectSnapshotRef: 'accumulator:before-adjustment:grade',
      processedAccumulatorRef: 'adjustment:grade:effect:effect:contrast',
      mix: grade.mix,
      outputRef: 'accumulator:after:grade',
    });
    expect(mix?.mix).not.toBe(grade.mix);
    expect(mix?.mix.masks).not.toBe(grade.mix.masks);
  });

  it('rejects unsupported effects in preflight without mutating input', () => {
    const fixture = createTitleAdjustmentMontageFixture();
    const grade = fixture.layers.find((layer) => layer.layerId === 'grade');
    if (!grade || grade.kind !== 'adjustment') {
      throw new Error('Expected adjustment fixture');
    }
    grade.effects.push({
      id: 'effect:unsupported',
      effectType: 'glow',
      enabled: true,
      parameters: { radius: 12 },
    });
    const before = JSON.stringify(fixture);

    expect(() => planMotionAdjustmentOperations(fixture)).toThrowError(
      UnsupportedAdjustmentEffectError,
    );
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it('rejects non-identity adjustment transforms in v1', () => {
    const fixture = createTitleAdjustmentMontageFixture();
    const grade = fixture.layers.find((layer) => layer.layerId === 'grade');
    if (!grade || grade.kind !== 'adjustment') {
      throw new Error('Expected adjustment fixture');
    }
    grade.transform.x = 1;

    try {
      planMotionAdjustmentOperations(fixture);
      throw new Error('Expected planner to reject a non-identity transform');
    } catch (error) {
      expect(error).toBeInstanceOf(MotionAdjustmentContractError);
      expect((error as MotionAdjustmentContractError).code).toBe(
        'NON_IDENTITY_ADJUSTMENT_TRANSFORM',
      );
    }
  });

  it('freezes the initial explicit effect allowlist', () => {
    expect(SUPPORTED_ADJUSTMENT_EFFECT_TYPES).toEqual([
      'brightness',
      'contrast',
      'saturation',
      'invert',
      'gaussian-blur',
    ]);
  });

  it('freezes the readonly four-surface Wave-2 target compatibility matrix', () => {
    const surfaceTarget = {
      required: true,
      supported: true,
      integrationStatus: 'pending-wave-2-executor-parity',
    };
    const allSurfaces = {
      preview: surfaceTarget,
      'nested-preview': surfaceTarget,
      'target-preview': surfaceTarget,
      export: surfaceTarget,
    };
    const numberPolicy = (
      defaultValue: number,
      minimum: number,
      maximum: number,
      integer: boolean,
    ) => ({
      type: 'number',
      optional: true,
      defaultValue,
      minimum,
      maximum,
      integer,
    });

    expect(ADJUSTMENT_EFFECT_COMPATIBILITY_MATRIX).toEqual({
      brightness: {
        effectType: 'brightness',
        surfaces: allSurfaces,
        parameters: { amount: numberPolicy(0, -1, 1, false) },
      },
      contrast: {
        effectType: 'contrast',
        surfaces: allSurfaces,
        parameters: { amount: numberPolicy(1, 0, 3, false) },
      },
      saturation: {
        effectType: 'saturation',
        surfaces: allSurfaces,
        parameters: { amount: numberPolicy(1, 0, 3, false) },
      },
      invert: {
        effectType: 'invert',
        surfaces: allSurfaces,
        parameters: {},
      },
      'gaussian-blur': {
        effectType: 'gaussian-blur',
        surfaces: allSurfaces,
        parameters: {
          radius: numberPolicy(10, 0, 50, false),
          samples: numberPolicy(5, 1, 64, true),
        },
      },
    });
    expect(Object.isFrozen(ADJUSTMENT_EFFECT_COMPATIBILITY_MATRIX)).toBe(true);
    for (const entry of Object.values(ADJUSTMENT_EFFECT_COMPATIBILITY_MATRIX)) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.surfaces)).toBe(true);
      expect(Object.isFrozen(entry.parameters)).toBe(true);
    }
  });

  it('normalizes optional and partial effect parameters to registry defaults', () => {
    expect(normalizeAdjustmentEffectParameters('brightness', {})).toEqual({
      amount: 0,
    });
    expect(normalizeAdjustmentEffectParameters('contrast', {})).toEqual({
      amount: 1,
    });
    expect(normalizeAdjustmentEffectParameters('saturation', {})).toEqual({
      amount: 1,
    });
    expect(normalizeAdjustmentEffectParameters('invert', {})).toEqual({});
    expect(normalizeAdjustmentEffectParameters('gaussian-blur', {
      radius: 4,
    })).toEqual({ radius: 4, samples: 5 });

    const fixture = createTitleAdjustmentMontageFixture();
    const grade = fixture.layers.find((layer) => layer.layerId === 'grade');
    if (!grade || grade.kind !== 'adjustment') {
      throw new Error('Expected adjustment fixture');
    }
    grade.effects = [
      effect('brightness', {}),
      effect('contrast', { amount: 2 }),
      effect('saturation', {}),
      effect('invert', {}),
      effect('gaussian-blur', { radius: 4 }),
    ];
    const packet = planMotionAdjustmentOperations(fixture);
    expect(packet.operations.flatMap((operation) =>
      operation.type === 'apply-adjustment-effect'
        ? [{ effectType: operation.effectType, parameters: operation.parameters }]
        : [])).toEqual([
      { effectType: 'brightness', parameters: { amount: 0 } },
      { effectType: 'contrast', parameters: { amount: 2 } },
      { effectType: 'saturation', parameters: { amount: 1 } },
      { effectType: 'invert', parameters: {} },
      { effectType: 'gaussian-blur', parameters: { radius: 4, samples: 5 } },
    ]);
  });

  it.each([
    ['brightness', { amount: -1.01 }],
    ['brightness', { amount: 1.01 }],
    ['brightness', { amount: Number.NaN }],
    ['brightness', { amount: '1' }],
    ['brightness', { extra: 0 }],
    ['contrast', { amount: -0.01 }],
    ['contrast', { amount: 3.01 }],
    ['saturation', { amount: -0.01 }],
    ['saturation', { amount: 3.01 }],
    ['invert', { amount: 1 }],
    ['gaussian-blur', { radius: -0.01 }],
    ['gaussian-blur', { radius: 50.01 }],
    ['gaussian-blur', { samples: 0 }],
    ['gaussian-blur', { samples: 65 }],
    ['gaussian-blur', { samples: 1.5 }],
    ['gaussian-blur', { quality: 1 }],
  ] as const)(
    'rejects invalid %s planner parameters before building operations: %j',
    (effectType, parameters) => {
      const fixture = fixtureWithEffect(effectType, parameters);
      const before = structuredClone(fixture);
      expect(() => planMotionAdjustmentOperations(fixture)).toThrow();
      expect(fixture).toEqual(before);
    },
  );

  it('round-trips as versioned JSON without runtime handles', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const serialized = serializeMotionAdjustmentOperationPacket(packet);
    const restored = parseMotionAdjustmentOperationPacket(serialized);

    expect(restored).toEqual(packet);
    expect(restored).not.toBe(packet);
    expect(restored.contractVersion).toBe(
      'motion-adjustment-operation-packet/v1',
    );
    expect(serialized).not.toMatch(
      /runtimeHandle|canvas|renderingContext|gpuTexture|videoFrame/,
    );
  });

  it('rejects a JSON-safe operation with a missing required field', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const malformed = JSON.parse(
      serializeMotionAdjustmentOperationPacket(packet),
    ) as { operations: Array<Record<string, unknown>> };
    delete malformed.operations[1]?.sourceId;

    expect(() =>
      parseMotionAdjustmentOperationPacket(JSON.stringify(malformed)),
    ).toThrowError('Invalid motion adjustment compositor operation');
  });

  it('rejects wrong nested field types and extra JSON-safe runtime fields', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const wrongMix = JSON.parse(
      serializeMotionAdjustmentOperationPacket(packet),
    ) as { operations: Array<Record<string, unknown>> };
    const composite = wrongMix.operations.find(
      (operation) => operation.type === 'composite-source',
    );
    if (!composite) throw new Error('Expected composite operation fixture');
    (composite.mix as Record<string, unknown>).opacity = 'opaque';

    expect(() =>
      parseMotionAdjustmentOperationPacket(JSON.stringify(wrongMix)),
    ).toThrowError('Invalid motion adjustment compositor operation');

    const extraField = JSON.parse(
      serializeMotionAdjustmentOperationPacket(packet),
    ) as { operations: Array<Record<string, unknown>> };
    extraField.operations[0]!.runtimeHandle = 'gpu-resource-1';
    expect(() =>
      parseMotionAdjustmentOperationPacket(JSON.stringify(extraField)),
    ).toThrowError('Invalid motion adjustment compositor operation');
  });

  it('rejects non-finite direct packet values before serialization', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    packet.evaluationTime = Number.POSITIVE_INFINITY;

    expect(() => assertMotionAdjustmentOperationPacket(packet)).toThrowError(
      'finite JSON numbers',
    );
    expect(() => serializeMotionAdjustmentOperationPacket(packet)).toThrow();
  });

  it.each([
    ['brightness', { amount: 1.1 }],
    ['contrast', { amount: 'wide' }],
    ['saturation', { extra: 1 }],
    ['invert', { amount: 1 }],
    ['gaussian-blur', { samples: 1.5 }],
  ] as const)(
    'rejects malformed %s packet parameters during JSON parsing',
    (effectType, parameters) => {
      const packet = planMotionAdjustmentOperations(
        createTitleAdjustmentMontageFixture(),
      );
      const serialized = JSON.parse(
        serializeMotionAdjustmentOperationPacket(packet),
      ) as { operations: Array<Record<string, unknown>> };
      const operation = serialized.operations.find(
        (candidate) => candidate.type === 'apply-adjustment-effect',
      );
      if (!operation) throw new Error('Expected effect operation fixture');
      operation.effectType = effectType;
      operation.parameters = parameters;

      expect(() => parseMotionAdjustmentOperationPacket(JSON.stringify(serialized)))
        .toThrowError(InvalidAdjustmentEffectParametersError);
    },
  );

  it('accepts optional partial packet parameters and rejects non-finite direct ones', () => {
    const packet = planMotionAdjustmentOperations(
      createTitleAdjustmentMontageFixture(),
    );
    const operation = packet.operations.find(
      (candidate) => candidate.type === 'apply-adjustment-effect',
    );
    if (!operation || operation.type !== 'apply-adjustment-effect') {
      throw new Error('Expected effect operation fixture');
    }
    operation.parameters = {};
    expect(parseMotionAdjustmentOperationPacket(JSON.stringify(packet)))
      .toEqual(packet);

    operation.parameters = { amount: Number.POSITIVE_INFINITY };
    expect(() => assertMotionAdjustmentOperationPacket(packet)).toThrow();
    expect(() => serializeMotionAdjustmentOperationPacket(packet)).toThrow();
  });
});

function operationLabel(operation: MotionAdjustmentCompositorOperation): string {
  if (operation.type === 'initialize-accumulator') return operation.type;
  if (operation.type === 'apply-adjustment-effect') {
    return `${operation.type}:${operation.layerId}:${operation.effectId}`;
  }
  return `${operation.type}:${operation.layerId}`;
}

function effect(
  effectType: SupportedAdjustmentEffectType,
  parameters: MotionAdjustmentEffectContract['parameters'],
): MotionAdjustmentEffectContract {
  return {
    id: `effect:${effectType}`,
    effectType,
    enabled: true,
    parameters,
  };
}

function fixtureWithEffect(
  effectType: SupportedAdjustmentEffectType,
  parameters: unknown,
): MotionAdjustmentStackContract {
  const fixture = createTitleAdjustmentMontageFixture();
  const grade = fixture.layers.find((layer) => layer.layerId === 'grade');
  if (!grade || grade.kind !== 'adjustment') {
    throw new Error('Expected adjustment fixture');
  }
  grade.effects = [effect(
    effectType,
    parameters as MotionAdjustmentEffectContract['parameters'],
  )];
  return fixture;
}
