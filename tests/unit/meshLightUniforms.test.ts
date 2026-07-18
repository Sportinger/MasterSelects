import { describe, expect, it } from 'vitest';

import type { SceneLightLayer } from '../../src/engine/scene/types';
import { MESH_UNIFORM_SIZE } from '../../src/engine/native3d/passes/meshPass/constants';
import { buildMeshUniformData } from '../../src/engine/native3d/passes/meshPass/uniforms';

function identityMatrix(): Float32Array {
  const matrix = new Float32Array(16);
  matrix[0] = 1;
  matrix[5] = 1;
  matrix[10] = 1;
  matrix[15] = 1;
  return matrix;
}

function createLight(
  kind: SceneLightLayer['lightSettings']['kind'],
  color: string,
  intensity: number,
  position: readonly [number, number, number] = [0, 0, 0],
): SceneLightLayer {
  const worldMatrix = identityMatrix();
  worldMatrix[12] = position[0];
  worldMatrix[13] = position[1];
  worldMatrix[14] = position[2];

  return {
    kind: 'light',
    layerId: `layer-${kind}`,
    clipId: `clip-${kind}`,
    opacity: 1,
    blendMode: 'normal',
    sourceWidth: 1,
    sourceHeight: 1,
    worldMatrix,
    lightSettings: {
      kind,
      color,
      intensity,
      diameter: 3,
      castsShadows: false,
      shadowStrength: 0.5,
    },
  };
}

describe('mesh light uniforms', () => {
  it('keeps the legacy fallback path when no light clips are active', () => {
    const data = buildMeshUniformData(identityMatrix(), identityMatrix(), [1, 1, 1, 1], 1, false);

    expect(data.length).toBe(MESH_UNIFORM_SIZE / 4);
    expect(data[38]).toBe(0);
  });

  it('packs environment and point lights for the mesh shader', () => {
    const data = buildMeshUniformData(
      identityMatrix(),
      identityMatrix(),
      [1, 1, 1, 1],
      1,
      false,
      undefined,
      [
        createLight('environment', '#0000ff', 0.5),
        createLight('point', '#ff8000', 2, [1, 2, 3]),
      ],
    );

    expect(data[37]).toBe(1);
    expect(data[38]).toBe(1);
    expect(data[44]).toBeCloseTo(0.08);
    expect(data[45]).toBeCloseTo(0.08);
    expect(data[46]).toBeCloseTo(0.58);
    expect(data[48]).toBe(1);
    expect(data[49]).toBe(2);
    expect(data[50]).toBe(3);
    expect(data[51]).toBe(1);
    expect(data[52]).toBe(1);
    expect(data[53]).toBeCloseTo(128 / 255);
    expect(data[55]).toBe(2);
    expect(data[59]).toBe(3);
  });

  it('packs material texture and uv transform flags', () => {
    const data = buildMeshUniformData(
      identityMatrix(),
      identityMatrix(),
      [1, 1, 1, 1],
      1,
      true,
      { textureEnabled: false, uvScaleX: 2, uvScaleY: 3, uvOffsetX: 0.25, uvOffsetY: -0.5 },
    );

    expect(data[36]).toBe(1);
    expect(data[39]).toBe(0);
    expect(data[40]).toBe(2);
    expect(data[41]).toBe(3);
    expect(data[42]).toBe(0.25);
    expect(data[43]).toBe(-0.5);
  });
});
