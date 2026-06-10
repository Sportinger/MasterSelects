import { applySceneEffectorsToObjectTransform } from '../../../scene/SceneEffectorUtils';
import type { SceneNativeMeshLayer } from '../MeshPass';

interface MeshCameraMatrices {
  projectionMatrix: Float32Array;
  viewMatrix: Float32Array;
}

interface SceneVector3Like {
  x: number;
  y: number;
  z: number;
}

interface SceneWorldTransformLike {
  position: SceneVector3Like;
  rotationRadians: SceneVector3Like;
  rotationDegrees: SceneVector3Like;
  scale: SceneVector3Like;
}

export interface MeshMatrixPlan {
  modelMatrix: Float32Array;
  mvp: Float32Array;
}

export function buildMeshMatrixPlan(
  layer: SceneNativeMeshLayer,
  camera: MeshCameraMatrices,
  effectors: Parameters<typeof applySceneEffectorsToObjectTransform>[1],
): MeshMatrixPlan {
  const modelMatrix = resolveModelMatrix(layer, effectors);
  const mvp = multiplyMat4(
    multiplyMat4(camera.projectionMatrix, camera.viewMatrix),
    modelMatrix,
  );
  return { modelMatrix, mvp };
}

function resolveModelMatrix(
  layer: SceneNativeMeshLayer,
  effectors: Parameters<typeof applySceneEffectorsToObjectTransform>[1],
): Float32Array {
  if (!layer.worldTransform || effectors.length === 0) {
    return layer.worldMatrix;
  }

  const effected = applySceneEffectorsToObjectTransform({
    position: layer.worldTransform.position,
    rotation: layer.worldTransform.rotationRadians,
    scale: layer.worldTransform.scale,
  }, effectors, layer.layerId);
  return buildWorldMatrix({
    position: effected.position,
    rotationRadians: effected.rotation,
    rotationDegrees: {
      x: effected.rotation.x * (180 / Math.PI),
      y: effected.rotation.y * (180 / Math.PI),
      z: effected.rotation.z * (180 / Math.PI),
    },
    scale: effected.scale,
  });
}

function buildWorldMatrix(transform: SceneWorldTransformLike): Float32Array {
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

function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
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
