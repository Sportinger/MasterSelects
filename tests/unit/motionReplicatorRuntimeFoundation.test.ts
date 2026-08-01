import { describe, expect, it } from 'vitest';
import {
  ReplicatorInstanceBufferState,
  createReplicatorRenderPacket,
  MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
  MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE,
  planReplicatorInstanceCapacity,
  planReplicatorSourceTexture,
} from '../../src/engine/motion/replicator';
import {
  createGridReplicatorContractFixture,
  createLinearReplicatorContractFixture,
  createRadialReplicatorContractFixture,
  createReplicatorUnitSourceBounds,
} from '../../src/services/motionDesign/replicator/contractFixtures';
import { evaluateMotionReplicatorReference } from '../../src/services/motionDesign/replicator/referenceEvaluator';
import {
  MOTION_MODIFIER_CONTRACT_ID,
  MOTION_MODIFIER_CONTRACT_VERSION,
} from '../../src/services/motionDesign/modifiers/contracts';
import { planMotionModifiers } from '../../src/services/motionDesign/modifiers/referencePlanner';

function successfulEvaluation(
  fixture: ReturnType<typeof createGridReplicatorContractFixture>,
  limit = 10_000,
) {
  const result = evaluateMotionReplicatorReference(
    fixture,
    { deviceMaxInstances: limit, renderTargetMaxInstances: limit },
    createReplicatorUnitSourceBounds(),
  );
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error('Expected successful Replicator evaluation');
  return result;
}

function unpackRecord(data: Float32Array, index: number) {
  const offset = index * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE;
  return {
    matrix: Array.from(data.subarray(offset, offset + 6)),
    opacity: data[offset + 6],
    normalizedIndex: data[offset + 7],
    bounds: Array.from(data.subarray(offset + 8, offset + 12)),
  };
}

describe('MD3 renderer/shader adapter', () => {
  it.each([
    ['grid', createGridReplicatorContractFixture],
    ['linear', createLinearReplicatorContractFixture],
    ['radial', createRadialReplicatorContractFixture],
  ] as const)('packs the %s CPU oracle fixture into deterministic affine records', (_name, createFixture) => {
    const evaluation = successfulEvaluation(createFixture());
    const first = createReplicatorRenderPacket(evaluation);
    const second = createReplicatorRenderPacket(structuredClone(evaluation));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('Expected successful packets');
    expect(first.cacheIdentity).toBe(second.cacheIdentity);
    expect(first.instanceData).toEqual(second.instanceData);
    expect(first.stableIndices).toEqual(second.stableIndices);
    expect(first.stableIndices).toEqual(
      new Uint32Array(evaluation.instances.map((instance) => instance.index)),
    );

    for (let index = 0; index < evaluation.instances.length; index += 1) {
      const expected = evaluation.instances[index];
      const record = unpackRecord(first.instanceData, index);
      const radians = expected.transform.rotationDegrees * Math.PI / 180;
      const expectedMatrix = [
        Math.cos(radians) * expected.transform.scale.x,
        -Math.sin(radians) * expected.transform.scale.y,
        Math.sin(radians) * expected.transform.scale.x,
        Math.cos(radians) * expected.transform.scale.y,
        expected.transform.position.x,
        expected.transform.position.y,
      ];
      for (let field = 0; field < expectedMatrix.length; field += 1) {
        expect(record.matrix[field]).toBeCloseTo(expectedMatrix[field], 5);
      }
      expect(record.opacity).toBeCloseTo(expected.transform.opacity, 5);
      expect(record.normalizedIndex).toBeCloseTo(expected.normalizedIndex, 5);
      expect(record.bounds).toEqual([
        expect.closeTo(expected.bounds.minX, 5),
        expect.closeTo(expected.bounds.minY, 5),
        expect.closeTo(expected.bounds.maxX, 5),
        expect.closeTo(expected.bounds.maxY, 5),
      ]);
    }
  });

  it('encodes exactly 10,000 instances without per-instance domain records', () => {
    const fixture = createLinearReplicatorContractFixture();
    fixture.revision = 10_000;
    fixture.layout = { mode: 'linear', count: 10_000, step: { x: 1, y: 0 } };
    fixture.terminalTransform = {
      mode: 'cumulative',
      position: { x: 0, y: 0 },
      rotationDegrees: 0,
      scale: { x: 1, y: 1 },
      opacity: 1,
    };
    const evaluation = successfulEvaluation(fixture);
    const packet = createReplicatorRenderPacket(evaluation);

    expect(packet.ok).toBe(true);
    if (!packet.ok) throw new Error('Expected successful packet');
    expect(packet.instanceData).toBeInstanceOf(Float32Array);
    expect(packet.stableIndices).toBeInstanceOf(Uint32Array);
    expect(packet.instanceData).toHaveLength(10_000 * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE);
    expect(packet.stats).toMatchObject({
      requestedInstances: 10_000,
      effectiveInstances: 10_000,
      submittedInstances: 10_000,
      visibleInstances: 10_000,
      truncatedInstances: 0,
      encodedBytes: 10_000 * MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
    });
  });

  it('prefix-truncates observably and culls against stroke-padded bounds', () => {
    const fixture = createLinearReplicatorContractFixture();
    fixture.layout = { mode: 'linear', count: 5, step: { x: 10, y: 0 } };
    fixture.terminalTransform = {
      mode: 'cumulative',
      position: { x: 0, y: 0 },
      rotationDegrees: 0,
      scale: { x: 1, y: 1 },
      opacity: 1,
    };
    const evaluation = successfulEvaluation(fixture);
    const packet = createReplicatorRenderPacket(evaluation, {
      maxDrawInstances: 4,
      viewport: { minX: 9, minY: -2, maxX: 19, maxY: 2 },
      strokePadding: 1,
    });

    expect(packet.ok).toBe(true);
    if (!packet.ok) throw new Error('Expected successful packet');
    expect(packet.stableIndices).toEqual(new Uint32Array([1, 2]));
    expect(packet.stats).toMatchObject({
      effectiveInstances: 5,
      submittedInstances: 4,
      visibleInstances: 2,
      culledInstances: 2,
      truncatedInstances: 1,
    });
    expect(packet.diagnostics).toContainEqual(expect.objectContaining({
      code: 'MOTION_REPLICATOR_RENDERER_TRUNCATED',
      severity: 'warning',
      limit: 4,
      actual: 5,
    }));
    expect(packet.contentBounds).toEqual({ minX: 8, minY: -2, maxX: 22, maxY: 2 });
  });

  it('fails closed for a mismatched instance vector', () => {
    const evaluation = successfulEvaluation(createGridReplicatorContractFixture());
    evaluation.instances.pop();
    const packet = createReplicatorRenderPacket(evaluation);
    expect(packet).toMatchObject({
      ok: false,
      cacheIdentity: null,
      diagnostics: [{ code: 'MOTION_REPLICATOR_INVALID_RENDER_INPUT', severity: 'error' }],
    });
  });

  it('uses the frozen modifier plan and omits falloff-clipped instances', () => {
    const fixture = createLinearReplicatorContractFixture();
    fixture.layout = { mode: 'linear', count: 3, step: { x: 10, y: 0 } };
    fixture.terminalTransform = {
      mode: 'cumulative',
      position: { x: 0, y: 0 },
      rotationDegrees: 0,
      scale: { x: 1, y: 1 },
      opacity: 1,
    };
    const evaluation = successfulEvaluation(fixture);
    const modifierPlan = planMotionModifiers({
      contract: MOTION_MODIFIER_CONTRACT_ID,
      version: MOTION_MODIFIER_CONTRACT_VERSION,
      revision: 1,
      timeBasis: 'clip-local-seconds',
      ticksPerSecond: 1_000,
      modifiers: [],
      falloff: {
        shapeClipId: 'clip-zone',
        shapeRevision: 2,
        feather: 0,
        invert: false,
        clip: true,
      },
    }, {
      requestedCount: evaluation.requestedCount,
      effectiveCount: evaluation.effectiveCount,
      clipLocalTimeSeconds: 0,
      instances: evaluation.instances.map((instance) => ({
        index: instance.index,
        layoutTransform: instance.layoutTransform,
        offsetTransform: instance.offsetTransform,
      })),
      shapeReferences: [{
        shapeClipId: 'clip-zone',
        revision: 2,
        kind: 'rectangle',
        center: { x: 0, y: 0 },
        size: { x: 4, y: 4 },
      }],
    });
    expect(modifierPlan.ok).toBe(true);
    const packet = createReplicatorRenderPacket(evaluation, {
      modifierPlan,
      modifierPlanReplicatorCacheKey: evaluation.cacheKey,
    });

    expect(packet.ok).toBe(true);
    if (!packet.ok) throw new Error('Expected successful packet');
    expect(packet.stableIndices).toEqual(new Uint32Array([0]));
    expect(packet.stats).toMatchObject({
      submittedInstances: 3,
      visibleInstances: 1,
      culledInstances: 2,
    });
  });

  it('rejects a stale modifier plan from a different Replicator layout with equal counts', () => {
    const fixtureA = createLinearReplicatorContractFixture();
    fixtureA.layout = { mode: 'linear', count: 3, step: { x: 10, y: 0 } };
    const evaluationA = successfulEvaluation(fixtureA);
    const modifierPlan = planMotionModifiers({
      contract: MOTION_MODIFIER_CONTRACT_ID,
      version: MOTION_MODIFIER_CONTRACT_VERSION,
      revision: 2,
      timeBasis: 'clip-local-seconds',
      ticksPerSecond: 1_000,
      modifiers: [],
    }, {
      requestedCount: evaluationA.requestedCount,
      effectiveCount: evaluationA.effectiveCount,
      clipLocalTimeSeconds: 0,
      instances: evaluationA.instances.map((instance) => ({
        index: instance.index,
        layoutTransform: instance.layoutTransform,
        offsetTransform: instance.offsetTransform,
      })),
      shapeReferences: [],
    });
    expect(modifierPlan.ok).toBe(true);

    const fixtureB = structuredClone(fixtureA);
    fixtureB.revision += 1;
    fixtureB.layout.step = { x: -25, y: 4 };
    const evaluationB = successfulEvaluation(fixtureB);
    const staleProvenance = createReplicatorRenderPacket(evaluationB, {
      modifierPlan,
      modifierPlanReplicatorCacheKey: evaluationA.cacheKey,
    });
    expect(staleProvenance).toMatchObject({
      ok: false,
      cacheIdentity: null,
      instanceData: { length: 0 },
      diagnostics: [{ code: 'MOTION_REPLICATOR_INVALID_RENDER_INPUT' }],
    });

    const forgedProvenance = createReplicatorRenderPacket(evaluationB, {
      modifierPlan,
      modifierPlanReplicatorCacheKey: evaluationB.cacheKey,
    });
    expect(forgedProvenance).toMatchObject({
      ok: false,
      cacheIdentity: null,
      instanceData: { length: 0 },
      diagnostics: [{ code: 'MOTION_REPLICATOR_INVALID_RENDER_INPUT' }],
    });
  });

  it('rejects forged modifier layout, offset, and final-transform fields', () => {
    const evaluation = successfulEvaluation(createLinearReplicatorContractFixture());
    const createPlan = () => planMotionModifiers({
      contract: MOTION_MODIFIER_CONTRACT_ID,
      version: MOTION_MODIFIER_CONTRACT_VERSION,
      revision: 3,
      timeBasis: 'clip-local-seconds' as const,
      ticksPerSecond: 1_000,
      modifiers: [],
    }, {
      requestedCount: evaluation.requestedCount,
      effectiveCount: evaluation.effectiveCount,
      clipLocalTimeSeconds: 0,
      instances: evaluation.instances.map((instance) => ({
        index: instance.index,
        layoutTransform: instance.layoutTransform,
        offsetTransform: instance.offsetTransform,
      })),
      shapeReferences: [],
    });

    for (const mutate of [
      (plan: Extract<ReturnType<typeof createPlan>, { ok: true }>) => {
        plan.instances[1].layoutTransform.position.x += 1;
      },
      (plan: Extract<ReturnType<typeof createPlan>, { ok: true }>) => {
        plan.instances[1].offsetTransform.opacity = 0.123;
      },
      (plan: Extract<ReturnType<typeof createPlan>, { ok: true }>) => {
        plan.instances[1].transform.position.y += 1;
      },
    ]) {
      const plan = createPlan();
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error('Expected successful modifier plan');
      mutate(plan);
      expect(createReplicatorRenderPacket(evaluation, {
        modifierPlan: plan,
        modifierPlanReplicatorCacheKey: evaluation.cacheKey,
      })).toMatchObject({
        ok: false,
        cacheIdentity: null,
        instanceData: { length: 0 },
        diagnostics: [{ code: 'MOTION_REPLICATOR_INVALID_RENDER_INPUT' }],
      });
    }
  });
});

describe('MD3 dynamic instance buffer and dirty uploads', () => {
  it('grows geometrically through the exact 10k requirement without truncation', () => {
    expect(planReplicatorInstanceCapacity({
      currentCapacity: 0,
      requiredInstances: 10_000,
      maxCapacity: 10_000,
    })).toEqual({
      ok: true,
      capacity: 10_000,
      reallocated: true,
      diagnostic: null,
    });

    const over = planReplicatorInstanceCapacity({
      currentCapacity: 10_000,
      requiredInstances: 10_001,
      maxCapacity: 10_000,
    });
    expect(over).toMatchObject({
      ok: false,
      capacity: 10_000,
      reallocated: false,
      diagnostic: {
        code: 'MOTION_REPLICATOR_BUFFER_CAPACITY_EXCEEDED',
        limit: 10_000,
        actual: 10_001,
      },
    });
  });

  it('uploads a full range on allocation, no range on cache hit, and exact dirty runs', () => {
    const state = new ReplicatorInstanceBufferState({ minimumCapacity: 2, maxCapacity: 10_000 });
    const initial = new Float32Array(4 * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE);
    for (let index = 0; index < initial.length; index += 1) initial[index] = index;

    const allocated = state.prepare('definition:v2:r1', initial, 4);
    expect(allocated.dirtyRanges).toEqual([{
      instanceStart: 0,
      instanceCount: 4,
      byteOffset: 0,
      byteLength: 4 * MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
    }]);
    expect(allocated.stats).toMatchObject({
      cacheHit: false,
      reallocated: true,
      previousCapacity: 0,
      capacity: 4,
      uploadedBytes: 4 * MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
    });

    const hit = state.prepare('definition:v2:r1', initial.slice(), 4);
    expect(hit.dirtyRanges).toEqual([]);
    expect(hit.stats.cacheHit).toBe(true);
    expect(hit.stats.uploadedBytes).toBe(0);

    const changed = initial.slice();
    changed[MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE + 4] = 999;
    changed[3 * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE + 6] = 0.5;
    const update = state.prepare('definition:v2:r2', changed, 4);
    expect(update.dirtyRanges).toEqual([
      {
        instanceStart: 1,
        instanceCount: 1,
        byteOffset: MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
        byteLength: MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
      },
      {
        instanceStart: 3,
        instanceCount: 1,
        byteOffset: 3 * MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
        byteLength: MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
      },
    ]);
    expect(update.stats).toMatchObject({
      cacheHit: false,
      reallocated: false,
      uploadRangeCount: 2,
      uploadedBytes: 2 * MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
      cumulativeCacheHits: 1,
      cumulativeCacheMisses: 2,
      cumulativeReallocations: 1,
    });
  });

  it('treats a new definition/revision identity as a miss even when bytes are reusable', () => {
    const state = new ReplicatorInstanceBufferState({ minimumCapacity: 1, maxCapacity: 10 });
    const data = new Float32Array(MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE);
    state.prepare('definition:v2:r1', data, 1);
    const revisionMiss = state.prepare('definition:v2:r2', data.slice(), 1);
    expect(revisionMiss.dirtyRanges).toEqual([]);
    expect(revisionMiss.stats).toMatchObject({ cacheHit: false, uploadedBytes: 0 });
  });

  it('forces a complete upload after runtime cache invalidation', () => {
    const state = new ReplicatorInstanceBufferState({ minimumCapacity: 1, maxCapacity: 10 });
    const data = new Float32Array(2 * MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE);
    state.prepare('definition:v2:r1', data, 2);
    state.invalidate();
    const restored = state.prepare('definition:v2:r1', data.slice(), 2);

    expect(restored.dirtyRanges).toEqual([{
      instanceStart: 0,
      instanceCount: 2,
      byteOffset: 0,
      byteLength: 2 * MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
    }]);
    expect(restored.stats).toMatchObject({
      cacheHit: false,
      reallocated: false,
      uploadedBytes: 2 * MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
    });
  });

  it('rejects typed-array subclasses before custom helpers can execute', () => {
    let trapCalls = 0;
    class TrappedFloat32Array extends Float32Array {}
    Object.defineProperties(TrappedFloat32Array.prototype, {
      set: { value: () => { trapCalls += 1; } },
      [Symbol.iterator]: {
        value: () => {
          trapCalls += 1;
          return [][Symbol.iterator]();
        },
      },
    });
    const hostile = new TrappedFloat32Array(MOTION_REPLICATOR_INSTANCE_FLOAT_STRIDE);
    const state = new ReplicatorInstanceBufferState({ minimumCapacity: 1, maxCapacity: 10 });

    expect(() => state.prepare('definition:v2:r1', hostile, 1)).toThrow(
      /standard Float32Array prototype/,
    );
    expect(trapCalls).toBe(0);
  });
});

describe('MD3 safe source texture planning', () => {
  it('includes fractional stroke padding and accepts exact dimension/pixel limits', () => {
    expect(planReplicatorSourceTexture({
      sourceWidth: 4_094.5,
      sourceHeight: 4_094.5,
      strokePadding: 0.75,
      maxTextureDimension2D: 4_096,
      maxTexturePixels: 4_096 * 4_096,
    })).toEqual({
      ok: true,
      width: 4_096,
      height: 4_096,
      strokePadding: 0.75,
      pixelCount: 4_096 * 4_096,
      diagnostics: [],
    });
  });

  it('reports both dimension and pixel overages without silently scaling', () => {
    const plan = planReplicatorSourceTexture({
      sourceWidth: 4_096,
      sourceHeight: 4_096,
      strokePadding: 1,
      maxTextureDimension2D: 4_096,
      maxTexturePixels: 4_096 * 4_096,
    });
    expect(plan).toMatchObject({
      ok: false,
      width: 4_098,
      height: 4_098,
      diagnostics: [
        { code: 'MOTION_REPLICATOR_TEXTURE_DIMENSION_EXCEEDED' },
        { code: 'MOTION_REPLICATOR_TEXTURE_PIXEL_BUDGET_EXCEEDED' },
      ],
    });
  });
});
