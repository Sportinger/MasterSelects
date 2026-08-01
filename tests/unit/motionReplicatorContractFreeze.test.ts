import { describe, expect, it } from 'vitest';
import {
  MOTION_REPLICATOR_CONTRACT_VERSION,
  migrateLegacyMotionReplicatorDefinition,
  migrateMotionReplicatorContract,
} from '../../src/services/motionDesign/replicator/contracts';
import {
  createFortyByTwentyFiveGridContractFixture,
  createGridReplicatorContractFixture,
  createLegacyReplicatorContractFixture,
  createLinearReplicatorContractFixture,
  createRadialReplicatorContractFixture,
  createReplicatorReferenceRuntimeLimits,
  createReplicatorUnitSourceBounds,
  createTwentyThousandLinearContractFixture,
} from '../../src/services/motionDesign/replicator/contractFixtures';
import {
  createMotionReplicatorCacheKey,
  evaluateMotionReplicatorReference,
  MOTION_REPLICATOR_REFERENCE_MAX_INSTANCES,
  validateReplicatorBounds,
} from '../../src/services/motionDesign/replicator/referenceEvaluator';

function requireSuccess(result: ReturnType<typeof evaluateMotionReplicatorReference>) {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error('Expected successful Replicator evaluation');
  return result;
}

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

describe('MD3 Replicator persisted contract', () => {
  it('rejects Array subclasses before inherited iteration helpers can execute', () => {
    const legacy = createLegacyReplicatorContractFixture();
    let trapCalls = 0;
    legacy.modifiers = createTrappedArray([], () => { trapCalls += 1; });

    expect(() => migrateLegacyMotionReplicatorDefinition(legacy)).toThrow(/plain Array prototype/);
    expect(trapCalls).toBe(0);
  });

  it('migrates legacy maxInstances and preserves the normalized V2 JSON round trip', () => {
    const migrated = migrateMotionReplicatorContract(
      JSON.parse(JSON.stringify(createLegacyReplicatorContractFixture(750))),
    );

    expect(migrated.version).toBe(MOTION_REPLICATOR_CONTRACT_VERSION);
    expect(migrated.enabled).toBe(true);
    expect(migrated.revision).toBe(0);
    expect(migrated.userLimit).toBe(750);
    expect(migrated).not.toHaveProperty('maxInstances');
    expect(migrated.layout).toEqual({
      mode: 'grid',
      count: { columns: 3, rows: 2 },
      spacing: { x: 10, y: 20 },
      patternOffset: { x: 3, y: -2 },
    });
    expect(migrated.terminalTransform).toEqual({
      mode: 'cumulative',
      position: { x: 12, y: -4 },
      rotationDegrees: 45,
      scale: { x: 1.5, y: 0.75 },
      opacity: 0.6,
    });
    expect(migrateMotionReplicatorContract(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  it('migrates a missing legacy maxInstances field to no persisted user cap', () => {
    const migrated = migrateMotionReplicatorContract(createLegacyReplicatorContractFixture());

    expect(migrated).not.toHaveProperty('userLimit');
    expect(JSON.parse(JSON.stringify(migrated))).not.toHaveProperty('userLimit');
  });

  it('maps every MD3-relevant legacy Linear field without normalization loss', () => {
    const migrated = migrateMotionReplicatorContract({
      enabled: false,
      layout: {
        mode: 'linear',
        count: 4,
        spacing: 5,
        direction: { x: 2, y: -1 },
      },
      offset: {
        mode: 'absolute',
        position: { x: 7, y: 8 },
        rotation: 30,
        scale: { x: -1, y: 2 },
        opacity: 0.4,
      },
      modifiers: [],
    });

    expect(migrated).toMatchObject({
      enabled: false,
      revision: 0,
      layout: { mode: 'linear', count: 4, step: { x: 10, y: -5 } },
      terminalTransform: {
        mode: 'absolute',
        position: { x: 7, y: 8 },
        rotationDegrees: 30,
        scale: { x: -1, y: 2 },
        opacity: 0.4,
      },
    });
  });

  it('maps every MD3-relevant legacy Radial field with an explicit zero center', () => {
    const migrated = migrateMotionReplicatorContract({
      enabled: true,
      layout: {
        mode: 'radial',
        count: 8,
        radius: 120,
        startAngle: -45,
        endAngle: 270,
        autoOrient: true,
      },
      offset: {
        mode: 'cumulative',
        position: { x: 1, y: 2 },
        rotation: 15,
        scale: { x: 0.8, y: 1.2 },
        opacity: 0.2,
      },
      modifiers: [],
    });

    expect(migrated.layout).toEqual({
      mode: 'radial',
      count: 8,
      center: { x: 0, y: 0 },
      radius: 120,
      startAngleDegrees: -45,
      endAngleDegrees: 270,
      angleSampling: 'inclusive-end',
      autoOrient: true,
    });
  });

  it('migrates nonzero full revolutions to exclusive-end sampling without duplicates', () => {
    const migrated = migrateMotionReplicatorContract({
      enabled: true,
      layout: {
        mode: 'radial',
        count: 4,
        radius: 10,
        startAngle: 0,
        endAngle: 360,
        autoOrient: true,
      },
      offset: {
        mode: 'cumulative',
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        opacity: 1,
      },
      modifiers: [],
    });
    expect(migrated.layout).toMatchObject({
      mode: 'radial',
      angleSampling: 'exclusive-end',
    });
    expect(migrateMotionReplicatorContract(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);

    const result = requireSuccess(evaluateMotionReplicatorReference(
      migrated,
      createReplicatorReferenceRuntimeLimits(),
      createReplicatorUnitSourceBounds(),
    ));
    expect(result.instances.map((instance) => instance.layoutIndex)).toEqual([
      { mode: 'radial', item: 0, angleDegrees: 0 },
      { mode: 'radial', item: 1, angleDegrees: 90 },
      { mode: 'radial', item: 2, angleDegrees: 180 },
      { mode: 'radial', item: 3, angleDegrees: 270 },
    ]);
    expect(result.instances.map((instance) => instance.transform.position)).toEqual([
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 0 },
      { x: 0, y: -10 },
    ]);
    expect(new Set(result.instances.map((instance) => (
      `${instance.transform.position.x},${instance.transform.position.y}`
    ))).size).toBe(4);
  });

  it('fails closed instead of dropping legacy modifier, falloff, or distribution data', () => {
    for (const mutate of [
      (value: ReturnType<typeof createLegacyReplicatorContractFixture>) => {
        value.modifiers.push({ kind: 'random' });
      },
      (value: ReturnType<typeof createLegacyReplicatorContractFixture>) => {
        value.falloff = { shapeClipId: 'shape-a' };
      },
      (value: ReturnType<typeof createLegacyReplicatorContractFixture>) => {
        value.distribution = { seed: 42 };
      },
    ]) {
      const legacy = createLegacyReplicatorContractFixture();
      mutate(legacy);
      const result = evaluateMotionReplicatorReference(
        legacy,
        createReplicatorReferenceRuntimeLimits(),
        createReplicatorUnitSourceBounds(),
      );
      expect(result).toMatchObject({
        ok: false,
        instances: [],
        diagnostics: [{ code: 'MOTION_REPLICATOR_UNSUPPORTED_LEGACY_DATA' }],
      });
    }
  });
});

describe('MD3 Replicator limits and stable ordering', () => {
  it('retains requested intent but emits no instances or cap warnings when disabled', () => {
    const definition = createFortyByTwentyFiveGridContractFixture();
    definition.enabled = false;
    definition.userLimit = 10;
    const result = requireSuccess(evaluateMotionReplicatorReference(
      definition,
      { deviceMaxInstances: 5, renderTargetMaxInstances: 3 },
      createReplicatorUnitSourceBounds(),
    ));

    expect(result).toMatchObject({
      enabled: false,
      requestedCount: 1_000,
      effectiveCount: 0,
      contentBounds: null,
      instances: [],
      diagnostics: [],
    });
  });

  it('evaluates the required 40 by 25 grid as exactly 1,000 row-major instances', () => {
    const result = requireSuccess(evaluateMotionReplicatorReference(
      createFortyByTwentyFiveGridContractFixture(),
      createReplicatorReferenceRuntimeLimits(),
      createReplicatorUnitSourceBounds(),
    ));

    expect(result.requestedCount).toBe(1_000);
    expect(result.effectiveCount).toBe(1_000);
    expect(result.diagnostics).toEqual([]);
    expect(result.instances[0]).toMatchObject({
      index: 0,
      normalizedIndex: 0,
      layoutIndex: { mode: 'grid', row: 0, column: 0 },
    });
    expect(result.instances[999]).toMatchObject({
      index: 999,
      normalizedIndex: 1,
      layoutIndex: { mode: 'grid', row: 24, column: 39 },
    });
  });

  it('prefix-truncates 20,000 requested instances with ordered named cap diagnostics', () => {
    const definition = createTwentyThousandLinearContractFixture();
    definition.userLimit = 12_000;
    definition.layout.step = { x: 0, y: 0 };
    definition.terminalTransform.position.x = 19_999;
    const runtime = {
      deviceMaxInstances: 10_000,
      renderTargetMaxInstances: 8_000,
    };

    const first = requireSuccess(evaluateMotionReplicatorReference(
      definition,
      runtime,
      createReplicatorUnitSourceBounds(),
    ));
    const second = requireSuccess(evaluateMotionReplicatorReference(
      JSON.parse(JSON.stringify(definition)),
      { ...runtime },
      { ...createReplicatorUnitSourceBounds() },
    ));

    expect(first.requestedCount).toBe(20_000);
    expect(first.effectiveCount).toBe(8_000);
    expect(first.instances).toHaveLength(8_000);
    expect(first.instances.at(-1)).toMatchObject({
      index: 7_999,
      normalizedIndex: 7_999 / 19_999,
      transform: { position: { x: 7_999, y: 0 } },
    });
    expect(first.instances.map((instance) => instance.index)).toEqual(
      Array.from({ length: 8_000 }, (_, index) => index),
    );
    expect(first.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'MOTION_REPLICATOR_CAPPED_BY_USER_LIMIT',
      'MOTION_REPLICATOR_CAPPED_BY_DEVICE_LIMIT',
      'MOTION_REPLICATOR_CAPPED_BY_RENDER_TARGET_LIMIT',
    ]);
    expect(first.diagnostics.map((diagnostic) => diagnostic.binding)).toEqual([
      false,
      false,
      true,
    ]);
    expect(second.instances).toEqual(first.instances);
    expect(second.cacheKey).toBe(first.cacheKey);
  });
});

describe('MD3 Replicator reference layouts, transforms, and bounds', () => {
  it('freezes centered row-major Grid positions, odd-row pattern offset, and content bounds', () => {
    const result = requireSuccess(evaluateMotionReplicatorReference(
      createGridReplicatorContractFixture(),
      createReplicatorReferenceRuntimeLimits(),
      createReplicatorUnitSourceBounds(),
    ));

    expect(result.instances.map((instance) => ({
      layoutIndex: instance.layoutIndex,
      position: instance.transform.position,
    }))).toEqual([
      { layoutIndex: { mode: 'grid', row: 0, column: 0 }, position: { x: -10, y: -10 } },
      { layoutIndex: { mode: 'grid', row: 0, column: 1 }, position: { x: 0, y: -10 } },
      { layoutIndex: { mode: 'grid', row: 0, column: 2 }, position: { x: 10, y: -10 } },
      { layoutIndex: { mode: 'grid', row: 1, column: 0 }, position: { x: -7, y: 8 } },
      { layoutIndex: { mode: 'grid', row: 1, column: 1 }, position: { x: 3, y: 8 } },
      { layoutIndex: { mode: 'grid', row: 1, column: 2 }, position: { x: 13, y: 8 } },
    ]);
    expect(result.sourceBounds).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
    expect(result.contentBounds).toEqual({ minX: -11, minY: -11, maxX: 14, maxY: 9 });
  });

  it('freezes indexed Linear layout and cumulative terminal scale/opacity deltas', () => {
    const result = requireSuccess(evaluateMotionReplicatorReference(
      createLinearReplicatorContractFixture(),
      createReplicatorReferenceRuntimeLimits(),
      createReplicatorUnitSourceBounds(),
    ));

    expect(result.instances.map((instance) => instance.layoutIndex)).toEqual([
      { mode: 'linear', item: 0 },
      { mode: 'linear', item: 1 },
      { mode: 'linear', item: 2 },
    ]);
    expect(result.instances.map((instance) => instance.transform)).toEqual([
      {
        position: { x: 0, y: 0 },
        rotationDegrees: 0,
        scale: { x: 1, y: 1 },
        opacity: 1,
      },
      {
        position: { x: 20, y: 0 },
        rotationDegrees: 45,
        scale: { x: 1.5, y: 0.75 },
        opacity: 0.625,
      },
      {
        position: { x: 40, y: 0 },
        rotationDegrees: 90,
        scale: { x: 2, y: 0.5 },
        opacity: 0.25,
      },
    ]);
    expect(result.instances[1]).toMatchObject({
      layoutTransform: {
        position: { x: 10, y: -5 },
        rotationDegrees: 0,
        scale: { x: 1, y: 1 },
        opacity: 1,
      },
      offsetTransform: {
        position: { x: 10, y: 5 },
        rotationDegrees: 45,
        scale: { x: 1.5, y: 0.75 },
        opacity: 0.625,
      },
      transform: {
        position: { x: 20, y: 0 },
        rotationDegrees: 45,
        scale: { x: 1.5, y: 0.75 },
        opacity: 0.625,
      },
    });
    expect(result.instances[2].bounds.minX).toBeCloseTo(39.5, 10);
    expect(result.instances[2].bounds.maxX).toBeCloseTo(40.5, 10);
    expect(result.instances[2].bounds.minY).toBeCloseTo(-2, 10);
    expect(result.instances[2].bounds.maxY).toBeCloseTo(2, 10);
  });

  it('freezes absolute mode as the same full transform on every stable instance', () => {
    const definition = createLinearReplicatorContractFixture();
    definition.terminalTransform.mode = 'absolute';
    const result = requireSuccess(evaluateMotionReplicatorReference(
      definition,
      createReplicatorReferenceRuntimeLimits(),
      createReplicatorUnitSourceBounds(),
    ));

    expect(result.instances.map((instance) => instance.transform)).toEqual([
      {
        position: { x: 20, y: 10 },
        rotationDegrees: 90,
        scale: { x: 2, y: 0.5 },
        opacity: 0.25,
      },
      {
        position: { x: 30, y: 5 },
        rotationDegrees: 90,
        scale: { x: 2, y: 0.5 },
        opacity: 0.25,
      },
      {
        position: { x: 40, y: 0 },
        rotationDegrees: 90,
        scale: { x: 2, y: 0.5 },
        opacity: 0.25,
      },
    ]);
    expect(result.instances[1]).toMatchObject({
      layoutTransform: {
        position: { x: 10, y: -5 },
        rotationDegrees: 0,
        scale: { x: 1, y: 1 },
        opacity: 1,
      },
      offsetTransform: {
        position: { x: 20, y: 10 },
        rotationDegrees: 90,
        scale: { x: 2, y: 0.5 },
        opacity: 0.25,
      },
    });
  });

  it('freezes deterministic Radial angles, outward auto-orient, transforms, and bounds', () => {
    const result = requireSuccess(evaluateMotionReplicatorReference(
      createRadialReplicatorContractFixture(),
      createReplicatorReferenceRuntimeLimits(),
      createReplicatorUnitSourceBounds(),
    ));

    expect(result.instances.map((instance) => ({
      layoutIndex: instance.layoutIndex,
      transform: instance.transform,
      bounds: instance.bounds,
    }))).toEqual([
      {
        layoutIndex: { mode: 'radial', item: 0, angleDegrees: 0 },
        transform: {
          position: { x: 15, y: -5 },
          rotationDegrees: 0,
          scale: { x: 1, y: 1 },
          opacity: 1,
        },
        bounds: { minX: 14, minY: -6, maxX: 16, maxY: -4 },
      },
      {
        layoutIndex: { mode: 'radial', item: 1, angleDegrees: 90 },
        transform: {
          position: { x: 5, y: 5 },
          rotationDegrees: 90,
          scale: { x: 1, y: 1 },
          opacity: 1,
        },
        bounds: { minX: 4, minY: 4, maxX: 6, maxY: 6 },
      },
      {
        layoutIndex: { mode: 'radial', item: 2, angleDegrees: 180 },
        transform: {
          position: { x: -5, y: -5 },
          rotationDegrees: 180,
          scale: { x: 1, y: 1 },
          opacity: 1,
        },
        bounds: { minX: -6, minY: -6, maxX: -4, maxY: -4 },
      },
    ]);
    expect(result.contentBounds).toEqual({ minX: -6, minY: -6, maxX: 16, maxY: 6 });
  });

  it('keeps a single exclusive-end Radial instance exactly at the start angle', () => {
    const definition = createRadialReplicatorContractFixture();
    definition.layout.count = 1;
    definition.layout.startAngleDegrees = 30;
    definition.layout.endAngleDegrees = 390;
    definition.layout.angleSampling = 'exclusive-end';
    const result = requireSuccess(evaluateMotionReplicatorReference(
      definition,
      createReplicatorReferenceRuntimeLimits(),
      createReplicatorUnitSourceBounds(),
    ));

    expect(result.instances[0].layoutIndex).toEqual({
      mode: 'radial',
      item: 0,
      angleDegrees: 30,
    });
  });
});

describe('MD3 Replicator validation and cache identity', () => {
  it('rejects root, discriminator, nested-count, runtime, and bounds accessors inertly', () => {
    const cases: Array<{
      name: string;
      run: (increment: () => void) => unknown;
    }> = [
      {
        name: 'legacy root',
        run: (increment) => {
          const value = createLegacyReplicatorContractFixture();
          Object.defineProperty(value, 'enabled', {
            enumerable: true,
            configurable: true,
            get: () => {
              increment();
              return true;
            },
          });
          return migrateLegacyMotionReplicatorDefinition(value);
        },
      },
      {
        name: 'layout mode',
        run: (increment) => {
          const value = createGridReplicatorContractFixture();
          Object.defineProperty(value.layout, 'mode', {
            enumerable: true,
            configurable: true,
            get: () => {
              increment();
              return 'grid';
            },
          });
          return migrateMotionReplicatorContract(value);
        },
      },
      {
        name: 'grid count',
        run: (increment) => {
          const value = createGridReplicatorContractFixture();
          const count = value.layout.count;
          Object.defineProperty(value.layout, 'count', {
            enumerable: true,
            configurable: true,
            get: () => {
              increment();
              return count;
            },
          });
          return migrateMotionReplicatorContract(value);
        },
      },
      {
        name: 'runtime limit',
        run: (increment) => {
          const runtime = createReplicatorReferenceRuntimeLimits();
          Object.defineProperty(runtime, 'deviceMaxInstances', {
            enumerable: true,
            configurable: true,
            get: () => {
              increment();
              return 10_000;
            },
          });
          return createMotionReplicatorCacheKey(
            createGridReplicatorContractFixture(),
            runtime,
            createReplicatorUnitSourceBounds(),
          );
        },
      },
      {
        name: 'source bounds',
        run: (increment) => {
          const bounds = createReplicatorUnitSourceBounds();
          Object.defineProperty(bounds, 'minX', {
            enumerable: true,
            configurable: true,
            get: () => {
              increment();
              return -1;
            },
          });
          return validateReplicatorBounds(bounds);
        },
      },
    ];

    for (const testCase of cases) {
      let getterCalls = 0;
      expect(
        () => testCase.run(() => { getterCalls += 1; }),
        testCase.name,
      ).toThrow(/enumerable own data property/);
      expect(getterCalls, testCase.name).toBe(0);
    }
  });

  it('rejects class instances, non-enumerable fields, extras, and explicit undefined', () => {
    class ReplicatorLike {
      contract = 'masterselects.motion-replicator';
      version = 2;
      enabled = true;
      revision = 0;
      layout = createGridReplicatorContractFixture().layout;
      terminalTransform = createGridReplicatorContractFixture().terminalTransform;
    }
    expect(() => migrateMotionReplicatorContract(new ReplicatorLike())).toThrow(/plain object/);

    const nonEnumerable = createGridReplicatorContractFixture();
    Object.defineProperty(nonEnumerable, 'enabled', {
      enumerable: false,
      configurable: true,
      value: true,
    });
    expect(() => migrateMotionReplicatorContract(nonEnumerable)).toThrow(/enumerable/);

    const extra = createGridReplicatorContractFixture() as unknown as Record<string, unknown>;
    extra.runtimeHandle = 'must-not-be-dropped';
    expect(() => migrateMotionReplicatorContract(extra)).toThrow(/runtimeHandle/);

    const explicitUndefined = createGridReplicatorContractFixture() as unknown as Record<string, unknown>;
    explicitUndefined.userLimit = undefined;
    expect(() => migrateMotionReplicatorContract(explicitUndefined)).toThrow(/omitted/);
  });

  it('rejects cache extras instead of canonicalizing them into a colliding key', () => {
    const definition = createGridReplicatorContractFixture();
    const runtime = createReplicatorReferenceRuntimeLimits();
    const bounds = createReplicatorUnitSourceBounds();
    const baseline = createMotionReplicatorCacheKey(definition, runtime, bounds);
    expect(baseline).toMatch(/^motion-replicator:/);

    const withExtra = structuredClone(definition) as unknown as Record<string, unknown>;
    withExtra.runtimeHandle = baseline;
    expect(() => createMotionReplicatorCacheKey(
      withExtra as never,
      runtime,
      bounds,
    )).toThrow(/runtimeHandle/);
  });

  it.each([
    {
      name: 'non-finite layout value',
      mutate: (value: ReturnType<typeof createGridReplicatorContractFixture>) => {
        value.layout.spacing.x = Number.NaN;
      },
      code: 'MOTION_REPLICATOR_NON_FINITE_VALUE',
    },
    {
      name: 'zero count',
      mutate: (value: ReturnType<typeof createGridReplicatorContractFixture>) => {
        value.layout.count.columns = 0;
      },
      code: 'MOTION_REPLICATOR_INVALID_COUNT',
    },
  ])('fails closed for $name', ({ mutate, code }) => {
    const value = createGridReplicatorContractFixture();
    mutate(value);
    const result = evaluateMotionReplicatorReference(
      value,
      createReplicatorReferenceRuntimeLimits(),
      createReplicatorUnitSourceBounds(),
    );

    expect(result).toMatchObject({
      ok: false,
      requestedCount: 0,
      effectiveCount: 0,
      sourceBounds: null,
      contentBounds: null,
      instances: [],
      cacheKey: null,
      diagnostics: [{ code, severity: 'error' }],
    });
  });

  it('fails closed for invalid runtime limits and inverted source bounds', () => {
    const definition = createGridReplicatorContractFixture();
    const badLimit = evaluateMotionReplicatorReference(
      definition,
      { deviceMaxInstances: Number.POSITIVE_INFINITY, renderTargetMaxInstances: 1_000 },
      createReplicatorUnitSourceBounds(),
    );
    const badBounds = evaluateMotionReplicatorReference(
      definition,
      createReplicatorReferenceRuntimeLimits(),
      { minX: 2, minY: -1, maxX: 1, maxY: 1 },
    );

    expect(badLimit.ok).toBe(false);
    expect(badLimit.diagnostics[0].code).toBe('MOTION_REPLICATOR_NON_FINITE_VALUE');
    expect(badBounds.ok).toBe(false);
    expect(badBounds.diagnostics[0].code).toBe('MOTION_REPLICATOR_INVALID_BOUNDS');
  });

  it('requires explicit angleSampling in persisted V2 Radial layouts', () => {
    const definition = createRadialReplicatorContractFixture();
    const rawLayout = definition.layout as unknown as Record<string, unknown>;
    delete rawLayout.angleSampling;
    const result = evaluateMotionReplicatorReference(
      definition,
      createReplicatorReferenceRuntimeLimits(),
      createReplicatorUnitSourceBounds(),
    );

    expect(result).toMatchObject({
      ok: false,
      instances: [],
      diagnostics: [{
        code: 'MOTION_REPLICATOR_INVALID_CONTRACT',
        path: 'layout.angleSampling',
      }],
    });
  });

  it('fails closed before allocation when the CPU reference safety maximum is exceeded', () => {
    const definition = createTwentyThousandLinearContractFixture();
    definition.layout.count = MOTION_REPLICATOR_REFERENCE_MAX_INSTANCES + 1;
    const aboveSafetyMaximum = MOTION_REPLICATOR_REFERENCE_MAX_INSTANCES + 10;
    const result = evaluateMotionReplicatorReference(
      definition,
      {
        deviceMaxInstances: aboveSafetyMaximum,
        renderTargetMaxInstances: aboveSafetyMaximum,
      },
      createReplicatorUnitSourceBounds(),
    );

    expect(result).toMatchObject({
      ok: false,
      effectiveCount: 0,
      instances: [],
      diagnostics: [{
        code: 'MOTION_REPLICATOR_REFERENCE_CAPACITY_EXCEEDED',
        path: 'effectiveCount',
      }],
    });
  });

  it('keeps cache keys stable across JSON clones and sensitive to revision and limits', () => {
    const definition = createGridReplicatorContractFixture();
    const runtime = createReplicatorReferenceRuntimeLimits();
    const bounds = createReplicatorUnitSourceBounds();
    const normalizedClone = migrateMotionReplicatorContract(
      JSON.parse(JSON.stringify(definition)),
    );

    const first = createMotionReplicatorCacheKey(definition, runtime, bounds);
    const clone = createMotionReplicatorCacheKey(normalizedClone, { ...runtime }, { ...bounds });
    expect(clone).toBe(first);
    expect(first).toMatch(/^motion-replicator:v2:r3:[0-9a-f]{16}$/);

    const nextRevision = migrateMotionReplicatorContract(definition);
    nextRevision.revision += 1;
    expect(createMotionReplicatorCacheKey(nextRevision, runtime, bounds)).not.toBe(first);
    expect(createMotionReplicatorCacheKey(
      definition,
      { ...runtime, renderTargetMaxInstances: runtime.renderTargetMaxInstances - 1 },
      bounds,
    )).not.toBe(first);

    const radial = createRadialReplicatorContractFixture();
    const inclusiveKey = createMotionReplicatorCacheKey(radial, runtime, bounds);
    radial.layout.angleSampling = 'exclusive-end';
    expect(createMotionReplicatorCacheKey(radial, runtime, bounds)).not.toBe(inclusiveKey);
  });

  it('validates cache-key inputs and explicitly canonicalizes negative zero', () => {
    const definition = createGridReplicatorContractFixture();
    definition.layout.spacing.x = 0;
    const runtime = createReplicatorReferenceRuntimeLimits();
    const bounds = createReplicatorUnitSourceBounds();
    const zeroKey = createMotionReplicatorCacheKey(definition, runtime, bounds);

    const negativeZeroDefinition = createGridReplicatorContractFixture();
    negativeZeroDefinition.layout.spacing.x = -0;
    expect(createMotionReplicatorCacheKey(negativeZeroDefinition, runtime, bounds)).toBe(zeroKey);

    const nonFiniteDefinition = createGridReplicatorContractFixture();
    nonFiniteDefinition.terminalTransform.rotationDegrees = Number.NaN;
    expect(() => createMotionReplicatorCacheKey(
      nonFiniteDefinition,
      runtime,
      bounds,
    )).toThrow(/finite number/);
    expect(() => createMotionReplicatorCacheKey(
      definition,
      { ...runtime, deviceMaxInstances: Number.NaN },
      bounds,
    )).toThrow(/finite/);
  });
});
