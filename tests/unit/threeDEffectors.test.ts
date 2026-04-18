import { describe, expect, it } from 'vitest';

import {
  applyThreeDEffectorsToObjectTransform,
  resolveThreeDEffectorsEnabled,
  resolveThreeDEffectorAxis,
} from '../../src/utils/threeDEffectors';
import type { SplatEffectorRuntimeData } from '../../src/engine/three/types';

function createEffector(overrides: Partial<SplatEffectorRuntimeData> = {}): SplatEffectorRuntimeData {
  return {
    clipId: 'effector-1',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    radius: 2,
    mode: 'repel',
    strength: 100,
    falloff: 1,
    speed: 1,
    seed: 0,
    time: 0,
    ...overrides,
  };
}

describe('threeDEffectors', () => {
  it('treats undefined as enabled and false as disabled', () => {
    expect(resolveThreeDEffectorsEnabled(undefined)).toBe(true);
    expect(resolveThreeDEffectorsEnabled(true)).toBe(true);
    expect(resolveThreeDEffectorsEnabled(false)).toBe(false);
  });

  it('resolves the default effector axis along positive z', () => {
    expect(resolveThreeDEffectorAxis({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('repels objects away from the effector center', () => {
    const result = applyThreeDEffectorsToObjectTransform({
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }, [createEffector()], 'layer-a');

    expect(result.position.x).toBeGreaterThan(1);
    expect(result.position.y).toBeCloseTo(0, 6);
  });

  it('attracts objects toward the effector center', () => {
    const result = applyThreeDEffectorsToObjectTransform({
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }, [createEffector({ mode: 'attract' })], 'layer-b');

    expect(result.position.x).toBeLessThan(1);
  });

  it('adds rotational influence for swirl mode', () => {
    const result = applyThreeDEffectorsToObjectTransform({
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }, [createEffector({ mode: 'swirl', time: 1.25 })], 'layer-c');

    expect(Math.abs(result.rotation.z)).toBeGreaterThan(0.1);
  });
});
