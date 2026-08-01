import { describe, expect, it } from 'vitest';
import type { ReplicatorDefinition, ReplicatorModifier } from '../../src/types/motionDesign';
import {
  MOTION_MODIFIER_CONTRACT_ID,
  MOTION_MODIFIER_CONTRACT_VERSION,
  type MotionModifierStackContractV1,
} from '../../src/services/motionDesign/modifiers/contracts';
import { planMotionModifiers } from '../../src/services/motionDesign/modifiers/referencePlanner';
import {
  MOTION_LEGACY_BUNDLE_FALLOFF_SHAPE_REVISION,
  MOTION_LEGACY_BUNDLE_MAX_DEPTH,
  MOTION_LEGACY_BUNDLE_MAX_NODES,
  MOTION_LEGACY_BUNDLE_MAX_STRING_LENGTH,
  MOTION_LEGACY_BUNDLE_MODIFIER_REVISION,
  MOTION_LEGACY_BUNDLE_REPLICATOR_REVISION,
  MOTION_LEGACY_BUNDLE_TICKS_PER_SECOND,
  migrateLegacyMotionDesignBundle,
} from '../../src/services/motionDesign/replicator/legacyBundleAdapter';
import { createLinearReplicatorContractFixture } from '../../src/services/motionDesign/replicator/contractFixtures';
import { evaluateMotionReplicatorReference } from '../../src/services/motionDesign/replicator/referenceEvaluator';

const runtimeLimits = {
  deviceMaxInstances: 10_000,
  renderTargetMaxInstances: 10_000,
};
const sourceBounds = { minX: -1, minY: -1, maxX: 1, maxY: 1 };

function createTrappedArray<T>(values: readonly T[], onTrap: () => void): T[] {
  class TrappedArray extends Array<T> {}
  Object.defineProperties(TrappedArray.prototype, {
    map: { value: () => { onTrap(); return []; } },
    forEach: { value: () => { onTrap(); } },
    [Symbol.iterator]: { value: () => { onTrap(); return [][Symbol.iterator](); } },
  });
  const trapped = new TrappedArray();
  for (let index = 0; index < values.length; index += 1) {
    Array.prototype.push.call(trapped, values[index]);
  }
  return trapped;
}

function modifierStack(): MotionModifierStackContractV1 {
  return {
    contract: MOTION_MODIFIER_CONTRACT_ID,
    version: MOTION_MODIFIER_CONTRACT_VERSION,
    revision: 9,
    timeBasis: 'clip-local-seconds',
    ticksPerSecond: 1_000,
    modifiers: [{
      id: 'offset-x-field',
      order: 0,
      enabled: true,
      kind: 'field',
      field: 'radial-distance',
      center: { x: 0, y: 0 },
      radius: 100,
      exponent: 1,
      targets: [{
        path: 'replicator.offset.position.x',
        operation: 'add',
        amount: 5,
      }],
    }],
  };
}

function evaluateAndModify(mode: 'cumulative' | 'absolute') {
  const replicator = createLinearReplicatorContractFixture();
  replicator.terminalTransform.mode = mode;
  if (replicator.layout.mode !== 'linear') throw new Error('Expected linear fixture');
  replicator.layout.step.y = 0;
  replicator.terminalTransform.position.y = 0;
  const evaluated = evaluateMotionReplicatorReference(replicator, runtimeLimits, sourceBounds);
  expect(evaluated.ok, JSON.stringify(evaluated.diagnostics)).toBe(true);
  if (!evaluated.ok) throw new Error('Expected successful MD3 evaluation');

  const planned = planMotionModifiers(modifierStack(), {
    requestedCount: evaluated.requestedCount,
    effectiveCount: evaluated.effectiveCount,
    clipLocalTimeSeconds: 0,
    instances: evaluated.instances.map(({ index, layoutTransform, offsetTransform }) => ({
      index,
      layoutTransform,
      offsetTransform,
    })),
    shapeReferences: [],
  });
  expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true);
  if (!planned.ok) throw new Error('Expected successful MD4 plan');
  return { evaluated, planned };
}

function createRealisticLegacyBundle(): ReplicatorDefinition {
  return {
    enabled: true,
    layout: {
      mode: 'linear',
      count: 4,
      spacing: 5,
      direction: { x: 2, y: -1 },
    },
    offset: {
      mode: 'cumulative',
      position: { x: 12, y: -4 },
      rotation: 45,
      scale: { x: 1.5, y: 0.75 },
      opacity: 0.6,
    },
    distribution: { seed: 123_456, randomizeOrder: false },
    modifiers: [
      {
        id: 'legacy-random',
        kind: 'random',
        enabled: true,
        targetProperties: ['replicator.offset.position.x'],
        params: { operation: 'add', amount: 12 },
      },
      {
        id: 'legacy-noise',
        kind: 'noise',
        enabled: true,
        seed: 99,
        targetProperties: ['replicator.offset.scale.x'],
        params: {
          operation: 'multiply',
          amount: 0.25,
          indexFrequency: 2,
          timeFrequencyHz: 0.5,
          octaves: 3,
          lacunarity: 2,
          persistence: 0.5,
        },
      },
      {
        id: 'legacy-oscillator',
        kind: 'oscillator',
        enabled: false,
        targetProperties: ['replicator.offset.rotation'],
        params: {
          operation: 'add',
          amount: 15,
          waveform: 'triangle',
          frequencyHz: 1.25,
          cyclesAcrossInstances: 2,
          phaseDegrees: 90,
        },
      },
      {
        id: 'legacy-field',
        kind: 'field',
        enabled: true,
        targetProperties: ['replicator.offset.opacity'],
        params: {
          operation: 'multiply',
          amount: -0.5,
          field: 'radial-distance',
          centerX: 10,
          centerY: -5,
          radius: 100,
          exponent: 2,
        },
      },
    ],
    falloff: {
      shapeClipId: 'shape-falloff-1',
      feather: 0.4,
      invert: true,
      clip: false,
    },
    maxInstances: 250,
  };
}

const allLegacyTargets = [
  'replicator.offset.position.x',
  'replicator.offset.position.y',
  'replicator.offset.rotation',
  'replicator.offset.scale.x',
  'replicator.offset.scale.y',
  'replicator.offset.opacity',
] as const;

function legacyFieldModifier(
  index: number,
  targetProperties: string[],
): ReplicatorModifier {
  return {
    id: `legacy-field-${index}`,
    kind: 'field',
    enabled: true,
    targetProperties,
    params: {
      operation: 'add',
      amount: 1,
      field: 'radial-distance',
      centerX: 0,
      centerY: 0,
      radius: 100,
      exponent: 1,
    },
  };
}

function bundleWithFieldModifiers(modifiers: ReplicatorModifier[]): ReplicatorDefinition {
  const legacy = createRealisticLegacyBundle();
  delete legacy.distribution;
  legacy.modifiers = modifiers;
  return legacy;
}

describe('MD3/MD4 Replicator composition seam', () => {
  it('uses every cumulative per-instance MD3 offset as the MD4 base', () => {
    const { evaluated, planned } = evaluateAndModify('cumulative');

    expect(evaluated.instances.map((instance) => instance.layoutTransform.position.x)).toEqual([
      0, 10, 20,
    ]);
    expect(evaluated.instances.map((instance) => instance.offsetTransform.position.x)).toEqual([
      0, 10, 20,
    ]);
    expect(planned.instances.map((instance) => instance.applications[0].valueBefore)).toEqual([
      0, 10, 20,
    ]);
    expect(planned.instances.map((instance) => instance.offsetTransform.position.x)).toEqual([
      5, 14, 23,
    ]);
    expect(planned.instances.map((instance) => instance.transform.position.x)).toEqual([
      5, 24, 43,
    ]);
  });

  it('preserves absolute offset semantics while composing each layout independently', () => {
    const { evaluated, planned } = evaluateAndModify('absolute');

    expect(evaluated.instances.map((instance) => instance.offsetTransform.position.x)).toEqual([
      20, 20, 20,
    ]);
    expect(planned.instances.map((instance) => instance.applications[0].valueBefore)).toEqual([
      20, 20, 20,
    ]);
    expect(planned.instances.map((instance) => instance.offsetTransform.position.x)).toEqual([
      24, 23.5, 23,
    ]);
    expect(planned.instances.map((instance) => instance.transform.position.x)).toEqual([
      24, 33.5, 43,
    ]);
  });
});

describe('legacy ReplicatorDefinition bundle migration', () => {
  it('rejects Array subclasses before custom iterators or helpers can execute', () => {
    const legacy = createRealisticLegacyBundle();
    let trapCalls = 0;
    legacy.modifiers[0].targetProperties = createTrappedArray(
      legacy.modifiers[0].targetProperties,
      () => { trapCalls += 1; },
    );

    expect(migrateLegacyMotionDesignBundle(legacy)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MOTION_LEGACY_BUNDLE_INVALID_DATA' }],
    });
    expect(trapCalls).toBe(0);
  });

  it('splits every supported persisted field into lossless MD3 and MD4 contracts', () => {
    const legacy = createRealisticLegacyBundle();
    const result = migrateLegacyMotionDesignBundle(JSON.parse(JSON.stringify(legacy)));

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error('Expected successful legacy bundle migration');
    expect(result.replicator).toMatchObject({
      revision: MOTION_LEGACY_BUNDLE_REPLICATOR_REVISION,
      enabled: legacy.enabled,
      userLimit: legacy.maxInstances,
      layout: { mode: 'linear', count: 4, step: { x: 10, y: -5 } },
      terminalTransform: {
        mode: 'cumulative',
        position: { x: 12, y: -4 },
        rotationDegrees: 45,
        scale: { x: 1.5, y: 0.75 },
        opacity: 0.6,
      },
    });
    expect(result.modifierStack).toMatchObject({
      revision: MOTION_LEGACY_BUNDLE_MODIFIER_REVISION,
      timeBasis: 'clip-local-seconds',
      ticksPerSecond: MOTION_LEGACY_BUNDLE_TICKS_PER_SECOND,
      falloff: {
        shapeClipId: 'shape-falloff-1',
        shapeRevision: MOTION_LEGACY_BUNDLE_FALLOFF_SHAPE_REVISION,
        feather: 0.4,
        invert: true,
        clip: false,
      },
    });
    expect(result.modifierStack.modifiers).toEqual([
      {
        id: 'legacy-random', order: 0, enabled: true, kind: 'random',
        seed: 123_456, distribution: 'uniform-signed',
        targets: [{ path: 'replicator.offset.position.x', operation: 'add', amount: 12 }],
      },
      {
        id: 'legacy-noise', order: 1, enabled: true, kind: 'noise', seed: 99,
        indexFrequency: 2, timeFrequencyHz: 0.5, octaves: 3, lacunarity: 2,
        persistence: 0.5,
        targets: [{ path: 'replicator.offset.scale.x', operation: 'multiply', amount: 0.25 }],
      },
      {
        id: 'legacy-oscillator', order: 2, enabled: false, kind: 'oscillator',
        waveform: 'triangle', frequencyHz: 1.25, cyclesAcrossInstances: 2,
        phaseDegrees: 90,
        targets: [{ path: 'replicator.offset.rotation', operation: 'add', amount: 15 }],
      },
      {
        id: 'legacy-field', order: 3, enabled: true, kind: 'field',
        field: 'radial-distance', center: { x: 10, y: -5 }, radius: 100, exponent: 2,
        targets: [{ path: 'replicator.offset.opacity', operation: 'multiply', amount: -0.5 }],
      },
    ]);
    expect(structuredClone(result.replicator)).toEqual(result.replicator);
    expect(structuredClone(result.modifierStack)).toEqual(result.modifierStack);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it.each([
    {
      name: 'unstable random ordering',
      mutate: (legacy: ReplicatorDefinition) => {
        if (!legacy.distribution) throw new Error('Expected distribution');
        legacy.distribution.randomizeOrder = true;
      },
      code: 'MOTION_LEGACY_BUNDLE_UNSUPPORTED_DISTRIBUTION',
    },
    {
      name: 'unknown modifier parameters',
      mutate: (legacy: ReplicatorDefinition) => {
        legacy.modifiers[0].params.runtimeFrequency = 3;
      },
      code: 'MOTION_LEGACY_BUNDLE_INVALID_DATA',
    },
    {
      name: 'an unconsumed distribution seed',
      mutate: (legacy: ReplicatorDefinition) => {
        legacy.modifiers = legacy.modifiers.filter((modifier) => (
          modifier.kind !== 'random' && modifier.kind !== 'noise'
        ));
      },
      code: 'MOTION_LEGACY_BUNDLE_UNSUPPORTED_DISTRIBUTION',
    },
  ])('fails closed for $name', ({ mutate, code }) => {
    const legacy = createRealisticLegacyBundle();
    mutate(legacy);
    const result = migrateLegacyMotionDesignBundle(legacy);

    expect(result).toMatchObject({
      ok: false,
      replicator: null,
      modifierStack: null,
      diagnostics: [{ code }],
    });
  });

  it('rejects an accessor before invoking its getter', () => {
    const legacy = createRealisticLegacyBundle();
    let getterCalls = 0;
    Object.defineProperty(legacy.modifiers[0], 'id', {
      enumerable: true,
      configurable: true,
      get: () => {
        getterCalls += 1;
        return 'getter-id';
      },
    });

    const result = migrateLegacyMotionDesignBundle(legacy);
    expect(result).toMatchObject({
      ok: false,
      replicator: null,
      modifierStack: null,
      diagnostics: [{ code: 'MOTION_LEGACY_BUNDLE_INVALID_DATA' }],
    });
    expect(getterCalls).toBe(0);
  });

  it('rejects non-index array properties that JSON serialization would silently drop', () => {
    const legacy = createRealisticLegacyBundle();
    Object.defineProperty(legacy.modifiers[0].targetProperties, '4294967295', {
      enumerable: true,
      configurable: true,
      value: 'replicator.offset.position.y',
    });

    expect(migrateLegacyMotionDesignBundle(legacy)).toMatchObject({
      ok: false,
      replicator: null,
      modifierStack: null,
      diagnostics: [{ code: 'MOTION_LEGACY_BUNDLE_INVALID_DATA' }],
    });
  });

  it('accepts exact modifier/target budgets and rejects overages before transformation', () => {
    const exactModifierCount = bundleWithFieldModifiers(Array.from(
      { length: 16 },
      (_, index) => legacyFieldModifier(index, [allLegacyTargets[0]]),
    ));
    expect(migrateLegacyMotionDesignBundle(exactModifierCount).ok).toBe(true);
    const overModifierCount = structuredClone(exactModifierCount);
    overModifierCount.modifiers.push(legacyFieldModifier(16, [allLegacyTargets[0]]));
    overModifierCount.modifiers[0].params.operation = 'unsupported-before-map';
    expect(migrateLegacyMotionDesignBundle(overModifierCount)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MOTION_LEGACY_BUNDLE_BUDGET_EXCEEDED' }],
    });

    const exactPerModifier = bundleWithFieldModifiers([
      legacyFieldModifier(0, [...allLegacyTargets]),
    ]);
    expect(migrateLegacyMotionDesignBundle(exactPerModifier).ok).toBe(true);
    const overPerModifier = structuredClone(exactPerModifier);
    overPerModifier.modifiers[0].targetProperties.push(allLegacyTargets[0]);
    overPerModifier.modifiers[0].params.operation = 'unsupported-before-map';
    expect(migrateLegacyMotionDesignBundle(overPerModifier)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MOTION_LEGACY_BUNDLE_BUDGET_EXCEEDED' }],
    });

    const exactTotal = bundleWithFieldModifiers(Array.from(
      { length: 16 },
      (_, index) => legacyFieldModifier(index, allLegacyTargets.slice(0, 4)),
    ));
    expect(migrateLegacyMotionDesignBundle(exactTotal).ok).toBe(true);
    const overTotal = structuredClone(exactTotal);
    overTotal.modifiers[15].targetProperties.push(allLegacyTargets[4]);
    overTotal.modifiers[0].params.operation = 'unsupported-before-map';
    expect(migrateLegacyMotionDesignBundle(overTotal)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MOTION_LEGACY_BUNDLE_BUDGET_EXCEEDED' }],
    });
  });

  it('enforces exact/over total-node, depth, and string budgets iteratively', () => {
    const nodeProbe = (elementCount: number) => ({
      padding: Array.from({ length: elementCount }, () => null),
    });
    expect(migrateLegacyMotionDesignBundle(
      nodeProbe(MOTION_LEGACY_BUNDLE_MAX_NODES - 2),
    ).diagnostics[0].code).toBe('MOTION_LEGACY_BUNDLE_INVALID_DATA');
    expect(migrateLegacyMotionDesignBundle(
      nodeProbe(MOTION_LEGACY_BUNDLE_MAX_NODES - 1),
    ).diagnostics[0].code).toBe('MOTION_LEGACY_BUNDLE_BUDGET_EXCEEDED');

    const depthProbe = (arrayCount: number) => {
      let nested: unknown = null;
      for (let index = 0; index < arrayCount; index += 1) nested = [nested];
      return { padding: nested };
    };
    expect(migrateLegacyMotionDesignBundle(
      depthProbe(MOTION_LEGACY_BUNDLE_MAX_DEPTH - 1),
    ).diagnostics[0].code).toBe('MOTION_LEGACY_BUNDLE_INVALID_DATA');
    expect(migrateLegacyMotionDesignBundle(
      depthProbe(MOTION_LEGACY_BUNDLE_MAX_DEPTH),
    ).diagnostics[0].code).toBe('MOTION_LEGACY_BUNDLE_BUDGET_EXCEEDED');

    expect(migrateLegacyMotionDesignBundle({
      padding: 'x'.repeat(MOTION_LEGACY_BUNDLE_MAX_STRING_LENGTH),
    }).diagnostics[0].code).toBe('MOTION_LEGACY_BUNDLE_INVALID_DATA');
    expect(migrateLegacyMotionDesignBundle({
      padding: 'x'.repeat(MOTION_LEGACY_BUNDLE_MAX_STRING_LENGTH + 1),
    }).diagnostics[0].code).toBe('MOTION_LEGACY_BUNDLE_BUDGET_EXCEEDED');
  });
});
