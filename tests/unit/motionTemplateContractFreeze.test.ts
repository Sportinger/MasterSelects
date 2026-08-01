import { describe, expect, it } from 'vitest';
import {
  MOTION_TEMPLATE_CODEC_ERROR_CODES,
  MOTION_TEMPLATE_FORMAT,
  MOTION_TEMPLATE_MAX_OCCUPIED_TARGET_IDS,
  MOTION_TEMPLATE_PLAN_ERROR_CODES,
  MOTION_TEMPLATE_PLAN_BUDGETS,
  MOTION_TEMPLATE_VERSION,
  type MotionTemplateEnvelopeV1,
} from '../../src/services/motionDesign/templates/contracts';
import {
  decodeMotionTemplateEnvelope,
  encodeMotionTemplateEnvelope,
} from '../../src/services/motionDesign/templates/codec';
import { inventoryMotionTemplateDependencies } from '../../src/services/motionDesign/templates/dependencyInventory';
import { planMotionTemplateIdRemap } from '../../src/services/motionDesign/templates/idRemapPlanner';
import { planMotionTemplateInstantiation } from '../../src/services/motionDesign/templates/instantiatePlanner';

function createAdversarialArray<T>(
  values: readonly T[],
  counter: { calls: number },
): readonly T[] {
  class AdversarialArray extends Array<T> {}
  const fail = (): never => {
    counter.calls += 1;
    throw new Error('Adversarial array method must not execute.');
  };
  Object.defineProperties(AdversarialArray.prototype, {
    [Symbol.iterator]: { configurable: true, value: fail },
    map: { configurable: true, value: fail },
    find: { configurable: true, value: fail },
    forEach: { configurable: true, value: fail },
  });
  const array = new AdversarialArray<T>();
  for (let index = 0; index < values.length; index += 1) {
    Array.prototype.push.call(array, values[index]);
  }
  return array;
}

function createTemplate(): MotionTemplateEnvelopeV1 {
  return {
    format: MOTION_TEMPLATE_FORMAT,
    version: MOTION_TEMPLATE_VERSION,
    scope: 'project-local',
    templateId: 'lower-third-v1',
    name: 'Editable Lower Third',
    category: 'lower-third',
    duration: 5,
    entities: [
      {
        id: 'plate',
        kind: 'motion-shape',
        startOffset: 0,
        duration: 5,
        payload: { primitive: 'rectangle', width: 640 },
        dependencyIds: [],
      },
      {
        id: 'title',
        kind: 'text-clip',
        startOffset: 0.25,
        duration: 4.5,
        payload: { text: 'Name', fontSize: 64 },
        dependencyIds: ['brand-font'],
      },
    ],
    relationships: [{
      id: 'title-parent',
      kind: 'parent',
      fromEntityId: 'title',
      toEntityId: 'plate',
      payload: {},
    }],
    dependencies: [{
      id: 'brand-font',
      kind: 'font',
      sourceProjectId: 'font-source-inter',
      label: 'Brand font',
    }],
  };
}

const resolution = [{ dependencyId: 'brand-font', resolvedProjectId: 'font-destination-inter' }] as const;

describe('MD8 .msmotion template contract freeze', () => {
  it('round-trips versioned template timing, relationships, and dependencies', () => {
    const template = createTemplate();
    const encoded = encodeMotionTemplateEnvelope(template);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok || !encoded.json) return;
    const decoded = decodeMotionTemplateEnvelope(encoded.json);
    expect(decoded).toEqual({ ok: true, envelope: template });
    expect(structuredClone(decoded)).toEqual(decoded);
  });

  it('reports resolved and missing dependency inventory deterministically', () => {
    const missing = inventoryMotionTemplateDependencies(createTemplate(), []);
    const resolved = inventoryMotionTemplateDependencies(createTemplate(), resolution);
    expect(missing.ok).toBe(true);
    expect(resolved.ok).toBe(true);
    if (!missing.ok || !resolved.ok) return;
    expect(missing.plan).toEqual({
      complete: false,
      entries: [{
        dependencyId: 'brand-font',
        kind: 'font',
        sourceProjectId: 'font-source-inter',
        status: 'missing',
      }],
      missingDependencyIds: ['brand-font'],
    });
    expect(resolved.plan.complete).toBe(true);
    expect(resolved.plan.entries[0]?.resolvedProjectId).toBe('font-destination-inter');
  });

  it('fails dependency inventory for duplicate and unknown resolutions', () => {
    const duplicate = inventoryMotionTemplateDependencies(createTemplate(), [...resolution, ...resolution]);
    const unknown = inventoryMotionTemplateDependencies(createTemplate(), [
      { dependencyId: 'not-declared', resolvedProjectId: 'anything' },
    ]);
    expect(duplicate.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (!duplicate.ok && !unknown.ok) {
      expect(duplicate.failures[0]?.code).toBe(MOTION_TEMPLATE_PLAN_ERROR_CODES.DUPLICATE_RESOLUTION);
      expect(unknown.failures[0]?.code).toBe(MOTION_TEMPLATE_PLAN_ERROR_CODES.UNKNOWN_RESOLUTION);
    }
  });

  it('fails closed for malformed planner inputs and insertion-time overflow', () => {
    const template = createTemplate();
    const malformedInventory = inventoryMotionTemplateDependencies(
      template,
      null as unknown as typeof resolution,
    );
    expect(malformedInventory.ok).toBe(false);
    expect(() => planMotionTemplateInstantiation(
      null as unknown as Parameters<typeof planMotionTemplateInstantiation>[0],
    )).not.toThrow();
    const malformedInstantiation = planMotionTemplateInstantiation(
      null as unknown as Parameters<typeof planMotionTemplateInstantiation>[0],
    );
    const overflow = planMotionTemplateInstantiation({
      envelope: { ...template, duration: Number.MAX_VALUE },
      destinationCompositionId: 'destination-comp',
      insertionTime: Number.MAX_VALUE,
      instanceKey: 'overflow',
      dependencyResolutions: resolution,
      occupiedTargetIds: [],
    });
    expect(malformedInstantiation.ok).toBe(false);
    expect(overflow.ok).toBe(false);
    expect('plan' in malformedInstantiation).toBe(false);
    expect('plan' in overflow).toBe(false);
  });

  it('produces stable deterministic id remaps independent of envelope array order', () => {
    const template = createTemplate();
    const reversed = {
      ...template,
      entities: [...template.entities].reverse(),
      relationships: [...template.relationships].reverse(),
    };
    const first = planMotionTemplateIdRemap(template, 'comp-a\0instance-7', []);
    const second = planMotionTemplateIdRemap(reversed, 'comp-a\0instance-7', []);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.plan.map((entry) => entry.targetId)).toEqual([
      expect.stringMatching(/^msm_e_[0-9a-f]{16}$/),
      expect.stringMatching(/^msm_e_[0-9a-f]{16}$/),
      expect.stringMatching(/^msm_r_[0-9a-f]{16}$/),
    ]);
  });

  it('creates one deterministic atomic undo batch with entities before relationships', () => {
    const input = {
      envelope: createTemplate(),
      destinationCompositionId: 'destination-comp',
      insertionTime: 12.5,
      instanceKey: 'instance-7',
      dependencyResolutions: resolution,
      occupiedTargetIds: [],
    } as const;
    const first = planMotionTemplateInstantiation(input);
    const second = planMotionTemplateInstantiation(input);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.plan.batch.mode).toBe('single-undo-batch');
    expect(first.plan.batch.atomic).toBe(true);
    expect(first.plan.batch.batchId).toMatch(/^msm_batch_[0-9a-f]{16}$/);
    expect(first.plan.batch.operations.map((operation) => operation.type)).toEqual([
      'create-entity', 'create-entity', 'create-relationship',
    ]);
    const title = first.plan.batch.operations.find(
      (operation) => operation.type === 'create-entity' && operation.entityKind === 'text-clip',
    );
    expect(title).toMatchObject({
      type: 'create-entity',
      startTime: 12.75,
      dependencyBindings: [{
        dependencyId: 'brand-font',
        resolvedProjectId: 'font-destination-inter',
      }],
    });
    expect(JSON.parse(JSON.stringify(first.plan))).toEqual(first.plan);
  });

  it('emits no partial batch when a dependency is missing', () => {
    const result = planMotionTemplateInstantiation({
      envelope: createTemplate(),
      destinationCompositionId: 'destination-comp',
      insertionTime: 0,
      instanceKey: 'instance-missing-dependency',
      dependencyResolutions: [],
      occupiedTargetIds: [],
    });
    expect(result.ok).toBe(false);
    expect('plan' in result).toBe(false);
    if (!result.ok) {
      expect(result.failures[0]).toMatchObject({
        code: MOTION_TEMPLATE_PLAN_ERROR_CODES.MISSING_DEPENDENCY,
        ids: ['brand-font'],
      });
    }
  });

  it.each([
    {
      name: 'unknown version',
      mutate: (template: MotionTemplateEnvelopeV1) => ({ ...template, version: 9 }),
      code: MOTION_TEMPLATE_CODEC_ERROR_CODES.UNKNOWN_VERSION,
    },
    {
      name: 'empty entity list',
      mutate: (template: MotionTemplateEnvelopeV1) => ({ ...template, entities: [] }),
      code: MOTION_TEMPLATE_CODEC_ERROR_CODES.MALFORMED_ENVELOPE,
    },
    {
      name: 'duplicate entity',
      mutate: (template: MotionTemplateEnvelopeV1) => ({
        ...template,
        entities: [...template.entities, template.entities[0]],
      }),
      code: MOTION_TEMPLATE_CODEC_ERROR_CODES.DUPLICATE_ENTITY,
    },
    {
      name: 'duplicate dependency',
      mutate: (template: MotionTemplateEnvelopeV1) => ({
        ...template,
        dependencies: [...template.dependencies, template.dependencies[0]],
      }),
      code: MOTION_TEMPLATE_CODEC_ERROR_CODES.DUPLICATE_DEPENDENCY,
    },
    {
      name: 'missing relationship entity',
      mutate: (template: MotionTemplateEnvelopeV1) => ({
        ...template,
        relationships: [{ ...template.relationships[0], toEntityId: 'missing' }],
      }),
      code: MOTION_TEMPLATE_CODEC_ERROR_CODES.MISSING_ENTITY,
    },
    {
      name: 'missing dependency declaration',
      mutate: (template: MotionTemplateEnvelopeV1) => ({
        ...template,
        dependencies: [],
      }),
      code: MOTION_TEMPLATE_CODEC_ERROR_CODES.MISSING_DEPENDENCY_DECLARATION,
    },
  ])('fails closed for $name', ({ mutate, code }) => {
    const result = decodeMotionTemplateEnvelope(mutate(createTemplate()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.map((item) => item.code)).toContain(code);
  });

  it('rejects malformed, non-finite, runtime-handle, and embedded-binary payloads', () => {
    const template = createTemplate();
    const payloads = [
      { value: Number.NaN },
      { controller: new AbortController() },
      { callback: () => 1 },
      { bytes: 'data:application/octet-stream;base64,AAAA' },
    ];
    for (const payload of payloads) {
      const result = decodeMotionTemplateEnvelope({
        ...template,
        entities: [{ ...template.entities[0], payload }, template.entities[1]],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures.map((item) => item.code))
          .toContain(MOTION_TEMPLATE_CODEC_ERROR_CODES.JSON_UNSAFE);
      }
    }
  });

  it('inspects the full template envelope without executing top-level or dependency getters', () => {
    let getterCalls = 0;
    const topLevel = { ...createTemplate() } as Record<string, unknown>;
    Object.defineProperty(topLevel, 'version', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return MOTION_TEMPLATE_VERSION;
      },
    });
    const dependency = { ...createTemplate().dependencies[0] } as Record<string, unknown>;
    Object.defineProperty(dependency, 'sourceProjectId', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'must-not-run';
      },
    });

    const topResult = decodeMotionTemplateEnvelope(topLevel);
    const dependencyResult = decodeMotionTemplateEnvelope({
      ...createTemplate(),
      dependencies: [dependency],
    });
    expect(getterCalls).toBe(0);
    expect(topResult.ok).toBe(false);
    expect(dependencyResult.ok).toBe(false);
    if (!topResult.ok && !dependencyResult.ok) {
      expect(topResult.failures[0]?.code).toBe(MOTION_TEMPLATE_CODEC_ERROR_CODES.JSON_UNSAFE);
      expect(dependencyResult.failures[0]?.code).toBe(MOTION_TEMPLATE_CODEC_ERROR_CODES.JSON_UNSAFE);
    }
  });

  it('rejects deeply persisted runtime fields and global dependency string-budget violations', () => {
    const template = createTemplate();
    const runtimeFields = [
      { videoFrame: 'frame-id' },
      { decoder: { state: 'runtime-only' } },
    ].map((runtimeField) => decodeMotionTemplateEnvelope({
        ...template,
        entities: [
          { ...template.entities[0], payload: { safe: { nested: runtimeField } } },
          template.entities[1],
        ],
      }));
    const oversizedDependency = decodeMotionTemplateEnvelope({
      ...template,
      dependencies: [{ ...template.dependencies[0], label: 'x'.repeat(65_537) }],
    });
    expect(runtimeFields.every((result) => !result.ok)).toBe(true);
    expect(oversizedDependency.ok).toBe(false);
    if (!runtimeFields[0].ok && !runtimeFields[1].ok && !oversizedDependency.ok) {
      expect(runtimeFields[0].failures[0]?.code).toBe(MOTION_TEMPLATE_CODEC_ERROR_CODES.JSON_UNSAFE);
      expect(runtimeFields[1].failures[0]?.code).toBe(MOTION_TEMPLATE_CODEC_ERROR_CODES.JSON_UNSAFE);
      expect(oversizedDependency.failures[0]?.code).toBe(MOTION_TEMPLATE_CODEC_ERROR_CODES.JSON_UNSAFE);
    }
  });

  it('rejects occupied target collisions without emitting a remap or partial batch', () => {
    const template = createTemplate();
    const namespaceKey = JSON.stringify(['destination-comp', 'collision-instance']);
    const initialRemap = planMotionTemplateIdRemap(template, namespaceKey, []);
    expect(initialRemap.ok).toBe(true);
    if (!initialRemap.ok) return;
    const occupiedId = initialRemap.plan[0].targetId;

    const remapCollision = planMotionTemplateIdRemap(template, namespaceKey, [occupiedId]);
    const instantiateCollision = planMotionTemplateInstantiation({
      envelope: template,
      destinationCompositionId: 'destination-comp',
      insertionTime: 0,
      instanceKey: 'collision-instance',
      dependencyResolutions: resolution,
      occupiedTargetIds: [occupiedId],
    });
    expect(remapCollision.ok).toBe(false);
    expect(instantiateCollision.ok).toBe(false);
    expect('plan' in remapCollision).toBe(false);
    expect('plan' in instantiateCollision).toBe(false);
    if (!remapCollision.ok && !instantiateCollision.ok) {
      expect(remapCollision.failures[0]?.code).toBe(MOTION_TEMPLATE_PLAN_ERROR_CODES.ID_COLLISION);
      expect(instantiateCollision.failures[0]?.code).toBe(MOTION_TEMPLATE_PLAN_ERROR_CODES.ID_COLLISION);
    }
  });

  it('does not execute accessors in resolution, occupied-id, or instantiation inputs', () => {
    let getterCalls = 0;
    const resolutionWithGetter = {} as Record<string, unknown>;
    Object.defineProperty(resolutionWithGetter, 'dependencyId', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'brand-font';
      },
    });
    Object.defineProperty(resolutionWithGetter, 'resolvedProjectId', {
      enumerable: true,
      value: 'font-destination-inter',
    });
    const occupiedWithGetter: string[] = [];
    Object.defineProperty(occupiedWithGetter, 'runtimeHandle', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'must-not-run';
      },
    });
    const instantiationWithGetter: Record<string, unknown> = {
      destinationCompositionId: 'destination-comp',
      insertionTime: 0,
      instanceKey: 'getter',
      dependencyResolutions: resolution,
      occupiedTargetIds: [],
    };
    Object.defineProperty(instantiationWithGetter, 'envelope', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return createTemplate();
      },
    });

    const inventory = inventoryMotionTemplateDependencies(
      createTemplate(),
      [resolutionWithGetter] as unknown as typeof resolution,
    );
    const remap = planMotionTemplateIdRemap(createTemplate(), 'getter', occupiedWithGetter);
    const instantiation = planMotionTemplateInstantiation(
      instantiationWithGetter as unknown as Parameters<typeof planMotionTemplateInstantiation>[0],
    );
    expect(getterCalls).toBe(0);
    expect(inventory.ok).toBe(false);
    expect(remap.ok).toBe(false);
    expect(instantiation.ok).toBe(false);
  });

  it('accepts exactly 10,000 occupied ids through remap and the combined instantiation input', () => {
    const occupiedTargetIds = Array.from(
      { length: MOTION_TEMPLATE_MAX_OCCUPIED_TARGET_IDS },
      (_, index) => `occupied-${index}`,
    );
    const remap = planMotionTemplateIdRemap(createTemplate(), 'exact-occupied-limit', occupiedTargetIds);
    const instantiation = planMotionTemplateInstantiation({
      envelope: createTemplate(),
      destinationCompositionId: 'destination-comp',
      insertionTime: 0,
      instanceKey: 'exact-occupied-limit',
      dependencyResolutions: resolution,
      occupiedTargetIds,
    });

    expect(MOTION_TEMPLATE_PLAN_BUDGETS.maxCombinedCollectionEntries)
      .toBeGreaterThan(MOTION_TEMPLATE_MAX_OCCUPIED_TARGET_IDS);
    expect(remap.ok).toBe(true);
    expect(instantiation.ok).toBe(true);
  });

  it('rejects over-limit, sparse, and accessor-bearing occupied-id collections getter-free', () => {
    const over = Array.from(
      { length: MOTION_TEMPLATE_MAX_OCCUPIED_TARGET_IDS + 1 },
      (_, index) => `occupied-${index}`,
    );
    const sparse = new Array<string>(2);
    sparse[1] = 'occupied';
    let getterCalls = 0;
    const accessorArray = ['occupied'];
    Object.defineProperty(accessorArray, 'runtimeHandle', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'must-not-run';
      },
    });

    for (const occupiedTargetIds of [over, sparse, accessorArray]) {
      const result = planMotionTemplateIdRemap(
        createTemplate(),
        'invalid-occupied-collection',
        occupiedTargetIds,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures[0]?.code).toBe(MOTION_TEMPLATE_PLAN_ERROR_CODES.INVALID_INSTANCE);
      }
    }
    expect(getterCalls).toBe(0);
  });

  it('applies the independent exact and over-limit dependency-resolution budget', () => {
    const exact = Array.from(
      { length: MOTION_TEMPLATE_PLAN_BUDGETS.maxDependencyResolutions },
      () => ({ dependencyId: 'brand-font', resolvedProjectId: 'font-destination-inter' }),
    );
    const exactResult = inventoryMotionTemplateDependencies(createTemplate(), exact);
    expect(exactResult.ok).toBe(false);
    if (!exactResult.ok) {
      expect(exactResult.failures[0]?.code)
        .toBe(MOTION_TEMPLATE_PLAN_ERROR_CODES.DUPLICATE_RESOLUTION);
      expect(exactResult.failures.length)
        .toBeLessThanOrEqual(MOTION_TEMPLATE_PLAN_BUDGETS.maxFailures);
    }

    const overResult = inventoryMotionTemplateDependencies(createTemplate(), [
      ...exact,
      { dependencyId: 'brand-font', resolvedProjectId: 'over-limit' },
    ]);
    expect(overResult.ok).toBe(false);
    if (!overResult.ok) {
      expect(overResult.failures[0]?.code).toBe(MOTION_TEMPLATE_PLAN_ERROR_CODES.INVALID_INSTANCE);
    }
  });

  it('rejects array subclasses at every template collection boundary without method calls', () => {
    const counter = { calls: 0 };
    const template = createTemplate();
    const subclassEntities = createAdversarialArray(template.entities, counter);
    expect(decodeMotionTemplateEnvelope({ ...template, entities: subclassEntities }).ok)
      .toBe(false);

    const subclassResolutions = createAdversarialArray(resolution, counter);
    expect(inventoryMotionTemplateDependencies(template, subclassResolutions).ok).toBe(false);

    const subclassOccupied = createAdversarialArray(['occupied'], counter);
    expect(planMotionTemplateIdRemap(template, 'subclass', subclassOccupied).ok).toBe(false);
    expect(planMotionTemplateInstantiation({
      envelope: template,
      destinationCompositionId: 'destination',
      insertionTime: 0,
      instanceKey: 'subclass',
      dependencyResolutions: resolution,
      occupiedTargetIds: subclassOccupied,
    }).ok).toBe(false);
    expect(counter.calls).toBe(0);
  });
});
