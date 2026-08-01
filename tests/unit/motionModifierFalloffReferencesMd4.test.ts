import { afterEach, describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types';
import {
  clearMotionFrameRuntimeCache,
  createMotionFrameRuntimeAdmission,
} from '../../src/engine/motion/MotionFrameRuntime';
import {
  createDefaultMotionLayerDefinition,
  type MotionLayerDefinition,
  type ShapePrimitive,
} from '../../src/types/motionDesign';
import {
  MOTION_MODIFIER_CONTRACT_ID,
  MOTION_MODIFIER_CONTRACT_VERSION,
  type MotionModifierStackContractV1,
} from '../../src/services/motionDesign/modifiers/contracts';
import { createLinearReplicatorContractFixture } from '../../src/services/motionDesign/replicator/contractFixtures';

function layer(
  clipId: string,
  motion: MotionLayerDefinition,
  position = { x: 0, y: 0 },
): Layer {
  return {
    id: `runtime:${clipId}`,
    sourceClipId: clipId,
    name: clipId,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    effects: [],
    position: { ...position, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    source: { type: 'motion', motion },
  } as Layer;
}

function shape(
  primitive: ShapePrimitive,
  size = { w: 20, h: 20 },
  revision = 0,
): MotionLayerDefinition {
  const motion = createDefaultMotionLayerDefinition('shape', { primitive, size });
  motion.replicator = { ...createLinearReplicatorContractFixture(), revision };
  return motion;
}

function stack(shapeClipId: string, shapeRevision: number): MotionModifierStackContractV1 {
  return {
    contract: MOTION_MODIFIER_CONTRACT_ID,
    version: MOTION_MODIFIER_CONTRACT_VERSION,
    revision: 1,
    timeBasis: 'clip-local-seconds',
    ticksPerSecond: 60,
    falloff: { shapeClipId, shapeRevision, feather: 0, invert: false, clip: false },
    modifiers: [{
      id: 'random-x',
      order: 0,
      enabled: true,
      kind: 'random',
      seed: 123,
      distribution: 'uniform-signed',
      targets: [{ path: 'replicator.offset.position.x', operation: 'add', amount: 10 }],
    }],
  };
}

function motionWithFalloff(shapeClipId: string, shapeRevision: number): MotionLayerDefinition {
  const motion = shape('rectangle');
  motion.modifierStack = stack(shapeClipId, shapeRevision);
  return motion;
}

function admit(layers: readonly Layer[]) {
  return createMotionFrameRuntimeAdmission({
    consumer: 'preview',
    compositionId: 'md4-falloff-references',
    timelineTimeSeconds: 0,
    layers,
  });
}

function frame(layers: readonly Layer[]) {
  const result = admit(layers);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.failures));
  return result.consumerInput.frameState;
}

afterEach(clearMotionFrameRuntimeCache);

describe('MD4 falloff reference provisioning', () => {
  it('plans a falloff stack against an ellipse and weights inside and outside instances differently', () => {
    const target = layer('target', motionWithFalloff('ellipse', 4));
    const ellipse = layer('ellipse', shape('ellipse', { w: 20, h: 20 }, 4));
    const planned = frame([target, ellipse]).modifiers[0]!.plan;

    expect(planned.ok).toBe(true);
    expect(planned.instances[0]!.falloffWeight).toBe(1);
    expect(planned.instances[1]!.falloffWeight).toBe(0);
  });

  it('offers rectangles but omits star and polygon references', () => {
    const rectangleTarget = layer('target', motionWithFalloff('rectangle', 3));
    const rectangle = layer('rectangle', shape('rectangle', { w: 20, h: 20 }, 3));
    expect(frame([rectangleTarget, rectangle]).modifiers[0]!.plan.ok).toBe(true);

    const starTarget = layer('target', motionWithFalloff('star', 3));
    const star = layer('star', shape('star', { w: 20, h: 20 }, 3));
    const polygon = layer('polygon', shape('polygon', { w: 20, h: 20 }, 3));
    const rejected = admit([starTarget, star, polygon]);
    expect(rejected).toMatchObject({
      ok: false,
      failures: [{ code: 'MOTION_MODIFIER_MISSING_FALLOFF_REFERENCE' }],
    });
  });

  it('fails closed when an authored reference revision becomes stale', () => {
    const target = layer('target', motionWithFalloff('ellipse', 1));
    const ellipseMotion = shape('ellipse', { w: 20, h: 20 }, 1);
    const ellipse = layer('ellipse', ellipseMotion);
    expect(frame([target, ellipse]).evaluationRevision).toBeTruthy();

    ellipseMotion.replicator = { ...ellipseMotion.replicator!, revision: 2 };
    const stale = admit([target, ellipse]);
    expect(stale).toMatchObject({
      ok: false,
      failures: [{ code: 'MOTION_MODIFIER_STALE_FALLOFF_REFERENCE' }],
    });
  });

  it('does not provision references for frames without falloffs', () => {
    const targetMotion = shape('rectangle');
    const { falloff: _falloff, ...stackWithoutFalloff } = stack('unused', 0);
    targetMotion.modifierStack = stackWithoutFalloff;
    const target = layer('target', targetMotion);
    const ellipse = layer('ellipse', shape('ellipse', { w: 20, h: 20 }, 8));
    const planned = frame([target, ellipse]);

    expect(planned.modifiers[0]!.context.shapeReferences).toEqual([]);
    expect(planned.modifiers[0]!.plan.ok).toBe(true);
  });

  it('invalidates a cached frame when a referenced shape revision changes', () => {
    const target = layer('target', motionWithFalloff('ellipse', 1));
    const ellipseMotion = shape('ellipse', { w: 20, h: 20 }, 1);
    const ellipse = layer('ellipse', ellipseMotion);
    const first = frame([target, ellipse]);

    ellipseMotion.replicator = { ...ellipseMotion.replicator!, revision: 2 };
    const afterRevisionBump = admit([target, ellipse]);
    expect(afterRevisionBump.ok).toBe(false);
    if (!afterRevisionBump.ok) {
      expect(afterRevisionBump.failures[0]!.code).toBe('MOTION_MODIFIER_STALE_FALLOFF_REFERENCE');
    }
    expect(first.evaluationRevision).toBeTruthy();
  });
});
