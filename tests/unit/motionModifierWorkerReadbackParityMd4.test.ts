import { afterEach, describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types';
import {
  clearMotionFrameRuntimeCache,
  createMotionFrameRuntimeAdmission,
  getMotionRenderSizeForAdmission,
} from '../../src/engine/motion/MotionFrameRuntime';
import {
  createDefaultMotionLayerDefinition,
  type MotionLayerDefinition,
} from '../../src/types/motionDesign';
import {
  MOTION_MODIFIER_CONTRACT_ID,
  MOTION_MODIFIER_CONTRACT_VERSION,
  type MotionModifierStackContractV1,
} from '../../src/services/motionDesign/modifiers/contracts';

const INSTANCE_STRIDE = 12;
const OPACITY_OFFSET = 6;

function createModifierStack(): MotionModifierStackContractV1 {
  return {
    contract: MOTION_MODIFIER_CONTRACT_ID,
    version: MOTION_MODIFIER_CONTRACT_VERSION,
    revision: 1,
    timeBasis: 'clip-local-seconds',
    ticksPerSecond: 60,
    modifiers: [{
      id: 'worker-field',
      order: 0,
      enabled: true,
      kind: 'field',
      field: 'radial-distance',
      center: { x: 0, y: 0 },
      radius: 750,
      exponent: 2,
      targets: [{ path: 'replicator.offset.opacity', operation: 'multiply', amount: -1 }],
    }],
  };
}

function createMotion(): MotionLayerDefinition {
  const motion = createDefaultMotionLayerDefinition('shape', { size: { w: 46, h: 46 } });
  motion.replicator = {
    contract: 'masterselects.motion-replicator',
    version: 2,
    enabled: true,
    revision: 2,
    layout: {
      mode: 'grid',
      count: { columns: 21, rows: 13 },
      spacing: { x: 88, y: 80 },
      patternOffset: { x: 0, y: 0 },
    },
    terminalTransform: {
      mode: 'cumulative',
      position: { x: 0, y: 0 },
      rotationDegrees: 0,
      scale: { x: 1, y: 1 },
      opacity: 1,
    },
    userLimit: 10_000,
  } as MotionLayerDefinition['replicator'];
  motion.modifierStack = createModifierStack();
  return motion;
}

function packedOpacity(instanceData: ArrayLike<number>, index: number): number {
  return instanceData[index * INSTANCE_STRIDE + OPACITY_OFFSET];
}

afterEach(() => {
  clearMotionFrameRuntimeCache();
});

describe('MD4 worker readback modifier parity', () => {
  it('keeps an admitted plan paired with its evaluation after worker payload reconstruction', () => {
    const mainLayer = {
      id: 'worker-readback-layer',
      sourceClipId: 'worker-readback-clip',
      visible: true,
      opacity: 1,
      source: { type: 'motion', motion: createMotion() },
    } as unknown as Layer;
    const admission = createMotionFrameRuntimeAdmission({
      consumer: 'export',
      compositionId: 'worker-readback-composition',
      timelineTimeSeconds: 1,
      layers: [mainLayer],
    });
    expect(admission.ok).toBe(true);
    if (!admission.ok) throw new Error(JSON.stringify(admission.failures));

    // Frame-stack transport structured-clones the Motion definition and then
    // materializes a new Layer object in the Worker before readback.
    const workerLayer = structuredClone(mainLayer);
    const state = getMotionRenderSizeForAdmission(workerLayer, admission).replicator;

    expect(state.enabled).toBe(true);
    expect(state.instanceCount).toBe(273);
    expect(packedOpacity(state.instanceData, 136)).toBeCloseTo(0, 4);
    expect(packedOpacity(state.instanceData, 0)).toBeCloseTo(1, 4);
  });
});
