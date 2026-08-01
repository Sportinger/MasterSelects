import { describe, expect, it } from 'vitest';
import {
  MOTION_MODIFIER_CONTRACT_ID,
  MOTION_MODIFIER_CONTRACT_VERSION,
  MOTION_MODIFIER_MAX_INSTANCES,
  MOTION_MODIFIER_MAX_MODIFIERS,
  MOTION_MODIFIER_MAX_TARGETS_PER_MODIFIER,
  MOTION_MODIFIER_MAX_TOTAL_TARGETS,
  MOTION_MODIFIER_MAX_WORK_ITEMS,
  MOTION_MODIFIER_TARGET_PATHS,
  parseMotionModifierStackContract,
  type FieldMotionModifier,
  type MotionModifier,
  type MotionModifierFalloff,
  type MotionModifierStackContractV1,
  type MotionModifierTarget,
  type MotionModifierTargetPath,
} from '../../src/services/motionDesign/modifiers/contracts';
import {
  createMotionModifierFalloffShapeFixture,
  createMotionModifierPlanContextFixture,
  createMotionModifierStackFixture,
} from '../../src/services/motionDesign/modifiers/contractFixtures';
import {
  createMotionModifierPlanCacheKey,
  planMotionModifiers,
  type MotionModifierPlanContext,
} from '../../src/services/motionDesign/modifiers/referencePlanner';

function requireSuccess(result: ReturnType<typeof planMotionModifiers>) {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error('Expected successful modifier plan');
  return result;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function fieldModifier(
  id: string,
  order: number,
  target: MotionModifierTarget,
): FieldMotionModifier {
  return {
    id,
    order,
    enabled: true,
    kind: 'field',
    field: 'radial-distance',
    center: { x: 0, y: 0 },
    radius: 100,
    exponent: 1,
    targets: [target],
  };
}

function stackWith(
  modifiers: MotionModifier[],
  falloff?: MotionModifierFalloff,
): MotionModifierStackContractV1 {
  return {
    contract: MOTION_MODIFIER_CONTRACT_ID,
    version: MOTION_MODIFIER_CONTRACT_VERSION,
    revision: 1,
    timeBasis: 'clip-local-seconds',
    ticksPerSecond: 1_000,
    modifiers,
    ...(falloff ? { falloff } : {}),
  };
}

function contextFor(
  positions: Array<{ x: number; y: number }>,
  offsetBase: Partial<Record<MotionModifierTargetPath, number>> = {},
): MotionModifierPlanContext {
  const createOffsetTransform = () => ({
    position: {
      x: offsetBase['replicator.offset.position.x'] ?? 0,
      y: offsetBase['replicator.offset.position.y'] ?? 0,
    },
    rotationDegrees: offsetBase['replicator.offset.rotation'] ?? 0,
    scale: {
      x: offsetBase['replicator.offset.scale.x'] ?? 1,
      y: offsetBase['replicator.offset.scale.y'] ?? 1,
    },
    opacity: offsetBase['replicator.offset.opacity'] ?? 1,
  });
  return {
    requestedCount: positions.length,
    effectiveCount: positions.length,
    clipLocalTimeSeconds: 0,
    instances: positions.map((position, index) => ({
      index,
      layoutTransform: {
        position,
        rotationDegrees: 0,
        scale: { x: 1, y: 1 },
        opacity: 1,
      },
      offsetTransform: createOffsetTransform(),
    })),
    shapeReferences: [],
  };
}

describe('MD4 modifier persisted contract', () => {
  it('rejects Array subclasses before inherited iteration helpers can execute', () => {
    const fixture = createMotionModifierStackFixture();
    let trapCalls = 0;
    fixture.modifiers = createTrappedArray(fixture.modifiers, () => { trapCalls += 1; });

    expect(() => parseMotionModifierStackContract(fixture)).toThrow(/plain Array prototype/);
    expect(trapCalls).toBe(0);

    const context = createMotionModifierPlanContextFixture();
    context.instances = createTrappedArray(context.instances, () => { trapCalls += 1; });
    expect(planMotionModifiers(createMotionModifierStackFixture(), context)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MOTION_MODIFIER_INVALID_CONTRACT' }],
    });
    expect(trapCalls).toBe(0);
  });

  it('round-trips a JSON-only ordered stack covering all four semantic kinds', () => {
    const fixture = createMotionModifierStackFixture();
    const parsed = parseMotionModifierStackContract(clone(fixture));

    expect(parsed).toEqual(fixture);
    expect(parsed).not.toBe(fixture);
    expect(parsed.modifiers.map((modifier) => ({
      id: modifier.id,
      order: modifier.order,
      enabled: modifier.enabled,
      kind: modifier.kind,
    }))).toEqual([
      { id: 'random-position', order: 0, enabled: true, kind: 'random' },
      { id: 'noise-scale', order: 1, enabled: true, kind: 'noise' },
      { id: 'oscillator-rotation', order: 2, enabled: true, kind: 'oscillator' },
      { id: 'radial-opacity-field', order: 3, enabled: true, kind: 'field' },
    ]);
    expect(parsed.timeBasis).toBe('clip-local-seconds');
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });

  it('freezes the exact numeric registry-compatible target paths', () => {
    expect([...MOTION_MODIFIER_TARGET_PATHS]).toEqual([
      'replicator.offset.position.x',
      'replicator.offset.position.y',
      'replicator.offset.rotation',
      'replicator.offset.scale.x',
      'replicator.offset.scale.y',
      'replicator.offset.opacity',
    ]);
  });

  it('rejects unknown runtime fields instead of dropping handles during normalization', () => {
    const fixture = createMotionModifierStackFixture() as unknown as {
      modifiers: Array<Record<string, unknown>>;
    };
    fixture.modifiers[0].runtimeHandle = () => undefined;

    expect(() => parseMotionModifierStackContract(fixture)).toThrow(/runtimeHandle/);
    const result = planMotionModifiers(fixture, createMotionModifierPlanContextFixture());
    expect(result).toMatchObject({
      ok: false,
      instances: [],
      diagnostics: [{ code: 'MOTION_MODIFIER_UNKNOWN_FIELD' }],
    });
  });

  it('rejects accessor envelopes without invoking a modifier getter', () => {
    const fixture = createMotionModifierStackFixture();
    let getterCalls = 0;
    Object.defineProperty(fixture.modifiers[0], 'id', {
      enumerable: true,
      configurable: true,
      get: () => {
        getterCalls += 1;
        return 'getter-id';
      },
    });

    const result = planMotionModifiers(fixture, createMotionModifierPlanContextFixture());
    expect(result).toMatchObject({
      ok: false,
      instances: [],
      diagnostics: [{ code: 'MOTION_MODIFIER_UNKNOWN_FIELD' }],
    });
    expect(getterCalls).toBe(0);
  });

  it('rejects non-enumerable known record fields and array indices', () => {
    const fieldFixture = createMotionModifierStackFixture();
    Object.defineProperty(fieldFixture.modifiers[0], 'enabled', {
      enumerable: false,
      configurable: true,
      value: true,
    });
    expect(() => parseMotionModifierStackContract(fieldFixture)).toThrow(/enumerable/);

    const indexFixture = createMotionModifierStackFixture();
    const firstModifier = indexFixture.modifiers[0];
    Object.defineProperty(indexFixture.modifiers, '0', {
      enumerable: false,
      configurable: true,
      writable: true,
      value: firstModifier,
    });
    expect(() => parseMotionModifierStackContract(indexFixture)).toThrow(/enumerable/);

    const context = createMotionModifierPlanContextFixture();
    Object.defineProperty(context.instances[0], 'index', {
      enumerable: false,
      configurable: true,
      value: 0,
    });
    expect(planMotionModifiers(createMotionModifierStackFixture(), context)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MOTION_MODIFIER_UNKNOWN_FIELD' }],
    });
  });
});

describe('MD4 deterministic modifier reference planning', () => {
  it('evaluates Random, Noise, Oscillator, and Field repeatably in persisted order', () => {
    const contract = createMotionModifierStackFixture();
    const context = createMotionModifierPlanContextFixture();
    const first = requireSuccess(planMotionModifiers(contract, context));
    const second = requireSuccess(planMotionModifiers(clone(contract), clone(context)));

    expect(second).toEqual(first);
    expect(first.instances.map((instance) => (
      instance.applications.map((application) => application.sample)
    ))).toEqual([
      [-0.27024916000664234, 0.6466091710275838, 1, 1],
      [-0.2980995452962816, 0.24440232132162368, 0.5000000000000003, 0.75],
      [-0.8628337276168168, -0.10516547957169158, -0.4999999999999994, 0.5],
      [0.18574094353243709, -0.25740540865808725, -1, 0],
    ]);
    expect(first.instances[0].applications.map((application) => application.modifierId)).toEqual([
      'random-position',
      'noise-scale',
      'oscillator-rotation',
      'radial-opacity-field',
    ]);
    expect(first.instances.map((instance) => (
      instance.applications.find((application) => (
        application.modifierId === 'radial-opacity-field'
      ))?.sample
    ))).toEqual([1, 0.75, 0.5, 0]);
    expect(first.instances.map((instance) => (
      instance.values.find((value) => value.path === 'replicator.offset.opacity')?.value
    ))).toEqual([0.5, 0.625, 0.75, 1]);
    expect(first.instances[0].applications.find((application) => (
      application.modifierId === 'oscillator-rotation'
    ))?.sample).toBe(1);
  });

  it('makes add/multiply evaluation sequential so reorder has defined visible semantics', () => {
    const add = fieldModifier('add-two', 0, {
      path: 'replicator.offset.rotation',
      operation: 'add',
      amount: 2,
    });
    const multiply = fieldModifier('multiply-half', 1, {
      path: 'replicator.offset.rotation',
      operation: 'multiply',
      amount: 0.5,
    });
    const context = contextFor(
      [{ x: 0, y: 0 }],
      { 'replicator.offset.rotation': 10 },
    );
    const addThenMultiply = requireSuccess(planMotionModifiers(
      stackWith([add, multiply]),
      context,
    ));
    const multiplyFirst = clone(multiply);
    const addSecond = clone(add);
    multiplyFirst.order = 0;
    addSecond.order = 1;
    const multiplyThenAdd = requireSuccess(planMotionModifiers(
      stackWith([multiplyFirst, addSecond]),
      context,
    ));

    expect(addThenMultiply.instances[0].values[0].value).toBe(18);
    expect(multiplyThenAdd.instances[0].values[0].value).toBe(17);
    expect(addThenMultiply.instances[0].applications.map((item) => item.modifierId)).toEqual([
      'add-two',
      'multiply-half',
    ]);
  });

  it('clamps opacity to 0..1 after every ordered application and in final composition', () => {
    const add = fieldModifier('opacity-add', 0, {
      path: 'replicator.offset.opacity',
      operation: 'add',
      amount: 0.5,
    });
    const multiply = fieldModifier('opacity-multiply', 1, {
      path: 'replicator.offset.opacity',
      operation: 'multiply',
      amount: -2,
    });
    const context = contextFor([{ x: 0, y: 0 }]);
    const addFirst = requireSuccess(planMotionModifiers(stackWith([add, multiply]), context));

    const multiplyFirst = clone(multiply);
    const addSecond = clone(add);
    multiplyFirst.order = 0;
    addSecond.order = 1;
    const multiplyFirstPlan = requireSuccess(planMotionModifiers(
      stackWith([multiplyFirst, addSecond]),
      context,
    ));

    expect(addFirst.instances[0].applications.map((application) => application.valueAfter)).toEqual([
      1,
      0,
    ]);
    expect(addFirst.instances[0].offsetTransform.opacity).toBe(0);
    expect(addFirst.instances[0].transform.opacity).toBe(0);
    expect(multiplyFirstPlan.instances[0].applications.map((application) => (
      application.valueAfter
    ))).toEqual([0, 0.5]);
    expect(multiplyFirstPlan.instances[0].transform.opacity).toBe(0.5);
  });

  it('preserves disabled modifier ids/order but skips their work exactly', () => {
    const contract = createMotionModifierStackFixture();
    contract.modifiers[1].enabled = false;
    const result = requireSuccess(planMotionModifiers(
      contract,
      createMotionModifierPlanContextFixture(),
    ));

    expect(result.instances[0].applications.map((item) => item.modifierId)).toEqual([
      'random-position',
      'oscillator-rotation',
      'radial-opacity-field',
    ]);
    expect(contract.modifiers[1]).toMatchObject({
      id: 'noise-scale',
      order: 1,
      enabled: false,
    });
  });

  it('is sensitive to seed, stable index, requested count, and quantized time', () => {
    const contract = createMotionModifierStackFixture();
    const context = createMotionModifierPlanContextFixture();
    const baseline = requireSuccess(planMotionModifiers(contract, context));
    const randomSamples = baseline.instances.map((instance) => (
      instance.applications[0].sample
    ));
    expect(new Set(randomSamples).size).toBe(randomSamples.length);

    const changedSeed = clone(contract);
    const random = changedSeed.modifiers[0];
    if (random.kind !== 'random') throw new Error('Expected Random fixture');
    random.seed += 1;
    const seeded = requireSuccess(planMotionModifiers(changedSeed, context));
    expect(seeded.instances[0].applications[0].sample).not.toBe(randomSamples[0]);

    const changedCount = clone(context);
    changedCount.requestedCount += 1;
    const counted = requireSuccess(planMotionModifiers(contract, changedCount));
    expect(counted.instances[0].applications[0].sample).not.toBe(randomSamples[0]);
    expect(counted.instances[1].normalizedIndex).not.toBe(baseline.instances[1].normalizedIndex);

    const sameTick = clone(context);
    sameTick.clipLocalTimeSeconds = 0.2504;
    const nextTick = clone(context);
    nextTick.clipLocalTimeSeconds = 0.2506;
    const quantizedSame = requireSuccess(planMotionModifiers(contract, sameTick));
    const quantizedNext = requireSuccess(planMotionModifiers(contract, nextTick));
    expect(quantizedSame.timeTicks).toBe(baseline.timeTicks);
    expect(quantizedSame.cacheKey).toBe(baseline.cacheKey);
    expect(quantizedNext.timeTicks).toBe(baseline.timeTicks + 1);
    expect(quantizedNext.cacheKey).not.toBe(baseline.cacheKey);
    expect(quantizedNext.instances[0].applications[1].sample).not.toBe(
      baseline.instances[0].applications[1].sample,
    );
    expect(baseline.timeBasis).toBe('clip-local-seconds');
  });
});

describe('MD4 normalized shape falloff', () => {
  const target: MotionModifierTarget = {
    path: 'replicator.offset.position.x',
    operation: 'add',
    amount: 10,
  };
  const falloff: MotionModifierFalloff = {
    shapeClipId: 'falloff-ellipse',
    shapeRevision: 3,
    feather: 1,
    invert: false,
    clip: true,
  };

  it('freezes inside/boundary/feather/outside weights and clip behavior', () => {
    const contract = stackWith([fieldModifier('field', 0, target)], falloff);
    const context = contextFor(
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 15, y: 0 }, { x: 20, y: 0 }],
    );
    context.shapeReferences = [createMotionModifierFalloffShapeFixture()];
    const result = requireSuccess(planMotionModifiers(contract, context));

    expect(result.instances.map((instance) => instance.falloffWeight)).toEqual([1, 1, 0.5, 0]);
    expect(result.instances.map((instance) => instance.clipped)).toEqual([false, false, false, true]);
    expect(result.instances.map((instance) => instance.values[0].value)).toEqual([10, 9, 4.25, 0]);
    expect(result.instances[3].applications).toEqual([]);
  });

  it('applies invert before clip and keeps zero-weight instances when clip is false', () => {
    const inverted = stackWith(
      [fieldModifier('field', 0, target)],
      { ...falloff, invert: true },
    );
    const context = contextFor(
      [{ x: 0, y: 0 }, { x: 20, y: 0 }],
    );
    context.shapeReferences = [createMotionModifierFalloffShapeFixture()];
    const invertedResult = requireSuccess(planMotionModifiers(inverted, context));
    expect(invertedResult.instances.map((instance) => ({
      weight: instance.falloffWeight,
      clipped: instance.clipped,
    }))).toEqual([
      { weight: 0, clipped: true },
      { weight: 1, clipped: false },
    ]);

    const notClipped = clone(inverted);
    if (!notClipped.falloff) throw new Error('Expected falloff fixture');
    notClipped.falloff.clip = false;
    const kept = requireSuccess(planMotionModifiers(notClipped, context));
    expect(kept.instances[0].clipped).toBe(false);
    expect(kept.instances[0].applications).toHaveLength(1);
    expect(kept.instances[0].applications[0].weightedSample).toBe(0);
  });

  it.each([
    {
      name: 'missing',
      shapes: [],
      code: 'MOTION_MODIFIER_MISSING_FALLOFF_REFERENCE',
    },
    {
      name: 'stale',
      shapes: [{ ...createMotionModifierFalloffShapeFixture(), revision: 2 }],
      code: 'MOTION_MODIFIER_STALE_FALLOFF_REFERENCE',
    },
    {
      name: 'duplicate',
      shapes: [
        createMotionModifierFalloffShapeFixture(),
        createMotionModifierFalloffShapeFixture(),
      ],
      code: 'MOTION_MODIFIER_DUPLICATE_FALLOFF_REFERENCE',
    },
  ])('fails closed for $name falloff references', ({ shapes, code }) => {
    const contract = stackWith([fieldModifier('field', 0, target)], falloff);
    const context = contextFor(
      [{ x: 0, y: 0 }],
    );
    context.shapeReferences = shapes;
    const result = planMotionModifiers(contract, context);

    expect(result).toMatchObject({
      ok: false,
      requestedCount: 0,
      effectiveCount: 0,
      instances: [],
      cacheKey: null,
      diagnostics: [{ code }],
    });
  });
});

describe('MD4 budgets, validation, and cache identity', () => {
  const allTargets = MOTION_MODIFIER_TARGET_PATHS.map((path) => ({
    path,
    operation: 'add' as const,
    amount: 1,
  }));

  it('fails closed with named modifier and target budget diagnostics', () => {
    const tooManyModifiers = Array.from(
      { length: MOTION_MODIFIER_MAX_MODIFIERS + 1 },
      (_, index) => fieldModifier(`field-${index}`, index, allTargets[0]),
    );
    const modifierBudget = planMotionModifiers(
      stackWith(tooManyModifiers),
      contextFor([{ x: 0, y: 0 }]),
    );

    const targetBudgetContract = stackWith([fieldModifier('field', 0, allTargets[0])]);
    targetBudgetContract.modifiers[0].targets = Array.from(
      { length: MOTION_MODIFIER_MAX_TARGETS_PER_MODIFIER + 1 },
      () => ({ ...allTargets[0] }),
    );
    const targetBudget = planMotionModifiers(
      targetBudgetContract,
      contextFor([{ x: 0, y: 0 }]),
    );

    const tooManyTotalTargets = Array.from({ length: 11 }, (_, index) => {
      const modifier = fieldModifier(`total-field-${index}`, index, allTargets[0]);
      modifier.targets = [...allTargets];
      return modifier;
    });
    const totalTargetBudget = planMotionModifiers(
      stackWith(tooManyTotalTargets),
      contextFor([{ x: 0, y: 0 }]),
    );

    expect(modifierBudget.diagnostics[0]).toMatchObject({
      code: 'MOTION_MODIFIER_MODIFIER_BUDGET_EXCEEDED',
      limit: MOTION_MODIFIER_MAX_MODIFIERS,
    });
    expect(targetBudget.diagnostics[0]).toMatchObject({
      code: 'MOTION_MODIFIER_TARGET_BUDGET_EXCEEDED',
      limit: MOTION_MODIFIER_MAX_TARGETS_PER_MODIFIER,
    });
    expect(totalTargetBudget.diagnostics[0]).toMatchObject({
      code: 'MOTION_MODIFIER_TARGET_BUDGET_EXCEEDED',
      limit: MOTION_MODIFIER_MAX_TOTAL_TARGETS,
    });
  });

  it('checks instance and work-product budgets before producing output', () => {
    const simple = stackWith([fieldModifier('field', 0, allTargets[0])]);
    const instanceBudget = planMotionModifiers(simple, {
      requestedCount: MOTION_MODIFIER_MAX_INSTANCES + 1,
      effectiveCount: MOTION_MODIFIER_MAX_INSTANCES + 1,
      clipLocalTimeSeconds: 0,
      instances: [],
      shapeReferences: [],
    });
    expect(instanceBudget.diagnostics[0]).toMatchObject({
      code: 'MOTION_MODIFIER_INSTANCE_BUDGET_EXCEEDED',
      limit: MOTION_MODIFIER_MAX_INSTANCES,
    });

    const modifiers = Array.from({ length: 11 }, (_, index) => {
      const targetCount = index === 10 ? 4 : allTargets.length;
      const modifier = fieldModifier(`field-${index}`, index, allTargets[0]);
      modifier.targets = allTargets.slice(0, targetCount);
      return modifier;
    });
    const effectiveCount = Math.floor(MOTION_MODIFIER_MAX_WORK_ITEMS / 64) + 1;
    const workContext = contextFor(
      Array.from({ length: effectiveCount }, () => ({ x: 0, y: 0 })),
    );
    const workBudget = planMotionModifiers(stackWith(modifiers), workContext);
    expect(workBudget.diagnostics[0]).toMatchObject({
      code: 'MOTION_MODIFIER_WORK_BUDGET_EXCEEDED',
      limit: MOTION_MODIFIER_MAX_WORK_ITEMS,
    });
    expect(workBudget.instances).toEqual([]);
  });

  it('fails closed for malformed order, duplicate ids/targets, invalid paths, and nonfinite values', () => {
    const cases: Array<{
      mutate: (contract: MotionModifierStackContractV1) => void;
      code: string;
    }> = [
      {
        mutate: (contract) => { contract.timeBasis = 'composition-seconds' as never; },
        code: 'MOTION_MODIFIER_INVALID_CONTRACT',
      },
      {
        mutate: (contract) => { contract.modifiers[0].order = 2; },
        code: 'MOTION_MODIFIER_INVALID_ORDER',
      },
      {
        mutate: (contract) => { contract.modifiers[1].id = contract.modifiers[0].id; },
        code: 'MOTION_MODIFIER_DUPLICATE_ID',
      },
      {
        mutate: (contract) => {
          contract.modifiers[0].targets.push({ ...contract.modifiers[0].targets[0] });
        },
        code: 'MOTION_MODIFIER_DUPLICATE_TARGET',
      },
      {
        mutate: (contract) => {
          contract.modifiers[0].targets[0].path = 'replicator.runtime.handle' as never;
        },
        code: 'MOTION_MODIFIER_INVALID_TARGET',
      },
      {
        mutate: (contract) => { contract.modifiers[0].targets[0].amount = Number.NaN; },
        code: 'MOTION_MODIFIER_NON_FINITE_VALUE',
      },
    ];

    for (const { mutate, code } of cases) {
      const contract = createMotionModifierStackFixture();
      mutate(contract);
      const result = planMotionModifiers(contract, createMotionModifierPlanContextFixture());
      expect(result).toMatchObject({
        ok: false,
        instances: [],
        diagnostics: [{ code }],
      });
    }
  });

  it('uses a stable cache key sensitive to revision, seed, ordering, counts, and falloff data', () => {
    const contract = createMotionModifierStackFixture();
    const context = createMotionModifierPlanContextFixture();
    const baseline = createMotionModifierPlanCacheKey(contract, context);
    expect(createMotionModifierPlanCacheKey(clone(contract), clone(context))).toBe(baseline);
    expect(baseline).toMatch(/^motion-modifiers:v1:r7:[0-9a-f]{16}$/);

    const revision = clone(contract);
    revision.revision += 1;
    expect(createMotionModifierPlanCacheKey(revision, context)).not.toBe(baseline);

    const seed = clone(contract);
    if (seed.modifiers[0].kind !== 'random') throw new Error('Expected Random fixture');
    seed.modifiers[0].seed += 1;
    expect(createMotionModifierPlanCacheKey(seed, context)).not.toBe(baseline);

    const reordered = clone(contract);
    const firstModifier = reordered.modifiers[0];
    const secondModifier = reordered.modifiers[1];
    reordered.modifiers[0] = secondModifier;
    reordered.modifiers[1] = firstModifier;
    reordered.modifiers[0].order = 0;
    reordered.modifiers[1].order = 1;
    expect(createMotionModifierPlanCacheKey(reordered, context)).not.toBe(baseline);

    const count = clone(context);
    count.requestedCount += 1;
    expect(createMotionModifierPlanCacheKey(contract, count)).not.toBe(baseline);

    const withFalloff = clone(contract);
    withFalloff.falloff = {
      shapeClipId: 'falloff-ellipse',
      shapeRevision: 3,
      feather: 0.25,
      invert: false,
      clip: false,
    };
    const falloffContext = clone(context);
    falloffContext.shapeReferences = [createMotionModifierFalloffShapeFixture()];
    expect(createMotionModifierPlanCacheKey(withFalloff, falloffContext)).not.toBe(baseline);
  });
});
