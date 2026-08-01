import { describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types';
import {
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

// Packed instance layout (rendererAdapter.ts writeInstance): 12 floats per
// instance, opacity at offset 6.
const STRIDE = 12;
const OPACITY_OFFSET = 6;

function fieldStack(amount: number): MotionModifierStackContractV1 {
  return {
    contract: MOTION_MODIFIER_CONTRACT_ID,
    version: MOTION_MODIFIER_CONTRACT_VERSION,
    revision: 1,
    timeBasis: 'clip-local-seconds',
    ticksPerSecond: 60,
    modifiers: [{
      id: 'modifier-field',
      order: 0,
      enabled: true,
      kind: 'field',
      field: 'radial-distance',
      center: { x: 0, y: 0 },
      radius: 750,
      exponent: 2,
      targets: [{ path: 'replicator.offset.opacity', operation: 'multiply', amount }],
    }],
  };
}

function gridMotion(stack?: MotionModifierStackContractV1): MotionLayerDefinition {
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
    userLimit: 10000,
  } as MotionLayerDefinition['replicator'];
  if (stack) motion.modifierStack = stack;
  return motion;
}

function renderState(motion: MotionLayerDefinition) {
  const layer = {
    id: 'consumption-layer',
    sourceClipId: 'consumption-clip',
    visible: true,
    opacity: 1,
    source: { type: 'motion', motion },
  } as unknown as Layer;
  const admission = createMotionFrameRuntimeAdmission({
    consumer: 'preview',
    compositionId: 'consumption-composition',
    timelineTimeSeconds: 1,
    layers: [layer],
  });
  expect(admission.ok).toBe(true);
  if (!admission.ok) throw new Error(JSON.stringify(admission.failures));
  return getMotionRenderSizeForAdmission(layer, admission).replicator;
}

function packedOpacity(instanceData: ArrayLike<number>, index: number): number {
  return instanceData[index * STRIDE + OPACITY_OFFSET];
}

describe('MD4 modifier plan consumption in packed instance data', () => {
  it('varies packed per-instance opacity with a radial field (multiply amount -1)', () => {
    const replicator = renderState(gridMotion(fieldStack(-1)));
    expect(replicator.enabled).toBe(true);
    expect(replicator.instanceCount).toBe(273);
    // 21x13 grid, spacing 88x80, centered: index 136 is the center (d=0,
    // sample 1 -> 1*(1-1) = 0), index 0 is the corner (d~1002 > radius,
    // sample 0 -> 1*(1-0) = 1). Index 10 is top-center (d=480,
    // sample (1-480/750)^2 = 0.1296 -> 0.8704).
    expect(packedOpacity(replicator.instanceData, 136)).toBeCloseTo(0, 4);
    expect(packedOpacity(replicator.instanceData, 0)).toBeCloseTo(1, 4);
    expect(packedOpacity(replicator.instanceData, 10)).toBeCloseTo(0.8704, 3);
  });

  it('is deterministic across two builds', () => {
    const first = renderState(gridMotion(fieldStack(-1)));
    const second = renderState(gridMotion(fieldStack(-1)));
    expect(Array.from(second.instanceData)).toEqual(Array.from(first.instanceData));
  });

  it('keeps the no-stack path unchanged and fully opaque', () => {
    const replicator = renderState(gridMotion());
    expect(replicator.enabled).toBe(true);
    expect(replicator.instanceCount).toBe(273);
    for (const index of [0, 10, 136, 272]) {
      expect(packedOpacity(replicator.instanceData, index)).toBe(1);
    }
  });

  it('a modifier value change changes the packed data', () => {
    const strong = renderState(gridMotion(fieldStack(-1)));
    const weak = renderState(gridMotion(fieldStack(-0.5)));
    expect(packedOpacity(weak.instanceData, 136)).toBeCloseTo(0.5, 4);
    expect(packedOpacity(strong.instanceData, 136)).toBeCloseTo(0, 4);
  });
});
