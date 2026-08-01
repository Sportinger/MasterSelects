import {
  MOTION_MODIFIER_CONTRACT_ID,
  MOTION_MODIFIER_CONTRACT_VERSION,
  type MotionModifierStackContractV1,
} from './contracts';
import type {
  MotionModifierPlanContext,
  MotionModifierShapeReference,
} from './referencePlanner';

export function createMotionModifierStackFixture(): MotionModifierStackContractV1 {
  return {
    contract: MOTION_MODIFIER_CONTRACT_ID,
    version: MOTION_MODIFIER_CONTRACT_VERSION,
    revision: 7,
    timeBasis: 'clip-local-seconds',
    ticksPerSecond: 1_000,
    modifiers: [
      {
        id: 'random-position',
        order: 0,
        enabled: true,
        kind: 'random',
        seed: 0x1234_5678,
        distribution: 'uniform-signed',
        targets: [{
          path: 'replicator.offset.position.x',
          operation: 'add',
          amount: 20,
        }],
      },
      {
        id: 'noise-scale',
        order: 1,
        enabled: true,
        kind: 'noise',
        seed: 0x8765_4321,
        indexFrequency: 3,
        timeFrequencyHz: 2,
        octaves: 3,
        lacunarity: 2,
        persistence: 0.5,
        targets: [{
          path: 'replicator.offset.scale.x',
          operation: 'multiply',
          amount: 0.35,
        }],
      },
      {
        id: 'oscillator-rotation',
        order: 2,
        enabled: true,
        kind: 'oscillator',
        waveform: 'sine',
        frequencyHz: 1,
        cyclesAcrossInstances: 0.5,
        phaseDegrees: 0,
        targets: [{
          path: 'replicator.offset.rotation',
          operation: 'add',
          amount: 45,
        }],
      },
      {
        id: 'radial-opacity-field',
        order: 3,
        enabled: true,
        kind: 'field',
        field: 'radial-distance',
        center: { x: 0, y: 0 },
        radius: 20,
        exponent: 1,
        targets: [{
          path: 'replicator.offset.opacity',
          operation: 'multiply',
          amount: -0.5,
        }],
      },
    ],
  };
}

export function createMotionModifierFalloffShapeFixture(): MotionModifierShapeReference {
  return {
    shapeClipId: 'falloff-ellipse',
    revision: 3,
    kind: 'ellipse',
    center: { x: 0, y: 0 },
    size: { x: 20, y: 20 },
  };
}

export function createMotionModifierPlanContextFixture(): MotionModifierPlanContext {
  return {
    requestedCount: 4,
    effectiveCount: 4,
    clipLocalTimeSeconds: 0.25,
    instances: [
      { index: 0, layoutTransform: layoutTransform(0), offsetTransform: offsetTransform() },
      { index: 1, layoutTransform: layoutTransform(5), offsetTransform: offsetTransform() },
      { index: 2, layoutTransform: layoutTransform(10), offsetTransform: offsetTransform() },
      { index: 3, layoutTransform: layoutTransform(20), offsetTransform: offsetTransform() },
    ],
    shapeReferences: [],
  };
}

function layoutTransform(x: number) {
  return {
    position: { x, y: 0 },
    rotationDegrees: 0,
    scale: { x: 1, y: 1 },
    opacity: 1,
  };
}

function offsetTransform() {
  return {
    position: { x: 0, y: 0 },
    rotationDegrees: 0,
    scale: { x: 1, y: 1 },
    opacity: 1,
  };
}
