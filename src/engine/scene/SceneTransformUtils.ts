import type { SceneGizmoAxis, SceneVector3, SceneWorldTransform } from './types';

export function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function buildSceneWorldMatrix(transform: SceneWorldTransform): Float32Array {
  const x = transform.rotationRadians.x;
  const y = transform.rotationRadians.y;
  const z = transform.rotationRadians.z;
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;

  const sx = transform.scale.x;
  const sy = transform.scale.y;
  const sz = transform.scale.z;

  const matrix = new Float32Array(16);
  matrix[0] = c * e * sx;
  matrix[1] = (af + be * d) * sx;
  matrix[2] = (bf - ae * d) * sx;
  matrix[3] = 0;
  matrix[4] = -c * f * sy;
  matrix[5] = (ae - bf * d) * sy;
  matrix[6] = (be + af * d) * sy;
  matrix[7] = 0;
  matrix[8] = d * sz;
  matrix[9] = -b * c * sz;
  matrix[10] = a * c * sz;
  matrix[11] = 0;
  matrix[12] = transform.position.x;
  matrix[13] = transform.position.y;
  matrix[14] = transform.position.z;
  matrix[15] = 1;
  return matrix;
}

export function getSplatOrientationMatrix(
  orientationPreset: 'default' | 'flip-x-180' | undefined,
): Float32Array | null {
  switch (orientationPreset) {
    case 'flip-x-180':
      return new Float32Array([
        1, 0, 0, 0,
        0, -1, 0, 0,
        0, 0, -1, 0,
        0, 0, 0, 1,
      ]);
    default:
      return null;
  }
}

export function resolveAxisBasisFromWorldMatrix(worldMatrix: Float32Array): Record<SceneGizmoAxis, SceneVector3> {
  return {
    x: normalizeSceneVector({ x: worldMatrix[0] ?? 1, y: worldMatrix[1] ?? 0, z: worldMatrix[2] ?? 0 }),
    y: normalizeSceneVector({ x: worldMatrix[4] ?? 0, y: worldMatrix[5] ?? 1, z: worldMatrix[6] ?? 0 }),
    z: normalizeSceneVector({ x: worldMatrix[8] ?? 0, y: worldMatrix[9] ?? 0, z: worldMatrix[10] ?? 1 }),
  };
}

function normalizeSceneVector(vector: SceneVector3): SceneVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 0.000001) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}
