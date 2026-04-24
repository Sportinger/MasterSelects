import { describe, expect, it } from 'vitest';

import { EffectorCompute } from '../../src/engine/native3d/passes/EffectorCompute';
import type { SceneSplatEffectorRuntimeData } from '../../src/engine/scene/types';

function createEffector(overrides: Partial<SceneSplatEffectorRuntimeData> = {}): SceneSplatEffectorRuntimeData {
  return {
    clipId: 'effector-1',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    radius: 2,
    mode: 'repel',
    strength: 50,
    falloff: 1.25,
    speed: 2,
    seed: 7,
    time: 0.5,
    ...overrides,
  };
}

describe('EffectorCompute', () => {
  it('keeps planes and disabled layers out of the phase-1 effector path', () => {
    const compute = new EffectorCompute();
    const effectors = [createEffector()];

    expect(compute.resolveEffectorsForLayer({
      kind: 'plane',
      threeDEffectorsEnabled: true,
    }, effectors)).toEqual([]);
    expect(compute.resolveEffectorsForLayer({
      kind: 'splat',
      threeDEffectorsEnabled: false,
    }, effectors)).toEqual([]);
    expect(compute.resolveEffectorsForLayer({
      kind: 'splat',
      threeDEffectorsEnabled: true,
    }, effectors)).toEqual(effectors);
  });

  it('projects shared-scene effectors into local splat space', () => {
    const compute = new EffectorCompute();
    const worldMatrix = new Float32Array([
      2, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, 2, 0,
      1, 2, 3, 1,
    ]);

    const localEffectors = compute.prepareLocalSplatEffectors(worldMatrix, [
      createEffector({
        position: { x: 3, y: 2, z: 3 },
        radius: 4,
        strength: 50,
      }),
    ]);

    expect(localEffectors).toHaveLength(1);
    expect(localEffectors[0]?.position.x).toBeCloseTo(1);
    expect(localEffectors[0]?.position.y).toBeCloseTo(0);
    expect(localEffectors[0]?.position.z).toBeCloseTo(0);
    expect(localEffectors[0]?.axis).toEqual({ x: 0, y: 0, z: 1 });
    expect(localEffectors[0]?.radius).toBeCloseTo(2);
    expect(localEffectors[0]?.strength).toBeCloseTo(0.25);
    expect(localEffectors[0]?.mode).toBe(0);
  });
});
