import { afterEach, describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types';
import {
  clearMotionFrameRuntimeCache,
  createMotionFrameRuntimeAdmission,
} from '../../src/engine/motion/MotionFrameRuntime';
import {
  createDefaultMotionLayerDefinition,
  type MotionLayerDefinition,
} from '../../src/types/motionDesign';
import {
  MOTION_MODIFIER_CONTRACT_ID,
  MOTION_MODIFIER_CONTRACT_VERSION,
  MOTION_MODIFIER_MAX_MODIFIERS,
  type MotionModifierStackContractV1,
} from '../../src/services/motionDesign/modifiers/contracts';
import { createLinearReplicatorContractFixture } from '../../src/services/motionDesign/replicator/contractFixtures';

function layerFor(motion: MotionLayerDefinition): Layer {
  return {
    id: 'md4-runtime-layer',
    sourceClipId: 'md4-runtime-clip',
    visible: true,
    opacity: 1,
    source: { type: 'motion', motion },
  } as unknown as Layer;
}

function randomStack(revision = 1, seed = 123): MotionModifierStackContractV1 {
  return {
    contract: MOTION_MODIFIER_CONTRACT_ID,
    version: MOTION_MODIFIER_CONTRACT_VERSION,
    revision,
    timeBasis: 'clip-local-seconds',
    ticksPerSecond: 10,
    modifiers: [{
      id: 'random-x',
      order: 0,
      enabled: true,
      kind: 'random',
      seed,
      distribution: 'uniform-signed',
      targets: [{ path: 'replicator.offset.position.x', operation: 'add', amount: 10 }],
    }],
  };
}

function motionWith(stack: MotionModifierStackContractV1): MotionLayerDefinition {
  const motion = createDefaultMotionLayerDefinition('shape', { size: { w: 10, h: 10 } });
  motion.replicator = createLinearReplicatorContractFixture();
  motion.modifierStack = stack;
  return motion;
}

function admit(motion: MotionLayerDefinition, time = 0.25) {
  return createMotionFrameRuntimeAdmission({
    consumer: 'preview',
    compositionId: 'md4-runtime-composition',
    timelineTimeSeconds: time,
    layers: [layerFor(motion)],
  });
}

function successfulFrame(motion: MotionLayerDefinition, time = 0.25) {
  const admission = admit(motion, time);
  expect(admission.ok).toBe(true);
  if (!admission.ok) throw new Error(JSON.stringify(admission.failures));
  return admission.consumerInput.frameState;
}

afterEach(() => {
  clearMotionFrameRuntimeCache();
});

describe('MD4 runtime modifier wiring', () => {
  it('places a Random modifier plan in the evaluated frame', () => {
    const frame = successfulFrame(motionWith(randomStack()));

    expect(frame.modifiers).toHaveLength(1);
    expect(frame.modifiers[0]?.plan.instances).toHaveLength(3);
    expect(frame.modifiers[0]?.plan.instances[0]?.applications).toHaveLength(1);
  });

  it('is byte-deterministic and honors Random seeds', () => {
    const first = successfulFrame(motionWith(randomStack(1, 123)));
    const second = successfulFrame(motionWith(randomStack(1, 123)));
    const changedSeed = successfulFrame(motionWith(randomStack(1, 124)));

    expect(JSON.stringify(second.modifiers[0]?.plan)).toBe(JSON.stringify(first.modifiers[0]?.plan));
    expect(changedSeed.modifiers[0]?.plan.instances).not.toEqual(first.modifiers[0]?.plan.instances);
  });

  it('quantizes modifier time to the persisted ticksPerSecond grid', () => {
    const early = successfulFrame(motionWith(randomStack()), 0.241);
    const late = successfulFrame(motionWith(randomStack()), 0.249);

    expect(late.modifiers[0]?.context.clipLocalTimeSeconds).toBe(early.modifiers[0]?.context.clipLocalTimeSeconds);
    expect(late.modifiers[0]?.plan).toEqual(early.modifiers[0]?.plan);
  });

  it('uses the documented radial Field weight formula', () => {
    const stack = randomStack();
    stack.modifiers = [{
      id: 'radial',
      order: 0,
      enabled: true,
      kind: 'field',
      field: 'radial-distance',
      center: { x: 0, y: 0 },
      radius: 100,
      exponent: 2,
      targets: [{ path: 'replicator.offset.opacity', operation: 'multiply', amount: -1 }],
    }];
    const plan = successfulFrame(motionWith(stack)).modifiers[0]!.plan;

    // sampleField uses composeReplicatorTransforms(layout, offset).position, not the
    // raw layout step. For the linear fixture (step 10/-5, cumulative terminal
    // transform 20/10) the composed positions are (0,0), (20,0), (40,0).
    expect(plan.instances[0]!.transform.position).toEqual({ x: 0, y: 0 });
    expect(plan.instances[1]!.transform.position).toEqual({ x: 20, y: 0 });
    expect(plan.instances[2]!.transform.position).toEqual({ x: 40, y: 0 });

    // pow(clamp(1 - distance / radius, 0, 1), exponent) with radius 100, exponent 2.
    expect(plan.instances[0]!.applications[0]!.sample).toBeCloseTo(1);
    expect(plan.instances[1]!.applications[0]!.sample).toBeCloseTo(0.64);
    expect(plan.instances[2]!.applications[0]!.sample).toBeCloseTo(0.36);
  });

  it('clamps the radial Field weight to zero at and beyond the radius', () => {
    const stack = randomStack();
    stack.modifiers = [{
      id: 'radial-edge',
      order: 0,
      enabled: true,
      kind: 'field',
      field: 'radial-distance',
      center: { x: 0, y: 0 },
      radius: 20,
      exponent: 2,
      targets: [{ path: 'replicator.offset.opacity', operation: 'multiply', amount: -1 }],
    }];
    const plan = successfulFrame(motionWith(stack)).modifiers[0]!.plan;

    // Composed distances are 0, 20, 40 against radius 20: inside, exactly on the
    // edge, and outside. The clamp keeps the outside sample at zero, never negative.
    expect(plan.instances[0]!.applications[0]!.sample).toBeCloseTo(1);
    expect(plan.instances[1]!.applications[0]!.sample).toBe(0);
    expect(plan.instances[2]!.applications[0]!.sample).toBe(0);
  });

  it('surfaces modifier budget failures instead of dropping modifier state', () => {
    const stack = randomStack();
    stack.modifiers = Array.from({ length: MOTION_MODIFIER_MAX_MODIFIERS + 1 }, (_, index) => ({
      ...randomStack().modifiers[0]!,
      id: `random-${index}`,
      order: index,
    }));
    const admission = admit(motionWith(stack));

    expect(admission).toMatchObject({
      ok: false,
      failures: [{ code: 'MOTION_MODIFIER_MODIFIER_BUDGET_EXCEEDED' }],
    });
  });

  it('includes modifier revision in the evaluated frame cache identity', () => {
    const first = successfulFrame(motionWith(randomStack(1)));
    const second = successfulFrame(motionWith(randomStack(2)));

    expect(second.evaluationRevision).not.toBe(first.evaluationRevision);
    expect(second.entityRevisions).toContainEqual({
      kind: 'modifier-stack',
      entityId: 'md4-runtime-layer',
      revision: 'modifier:2',
    });
  });
});