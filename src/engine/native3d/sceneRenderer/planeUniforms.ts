import type {
  SceneCamera,
  ScenePlaneLayer,
} from '../../scene/types';
import {
  PLANE_UNIFORM_SIZE,
  WORLD_HEIGHT,
} from './constants';
import { calculateSourcePixelScale } from '../../../utils/sourcePixelScale';

export function buildPlaneUniformData(
  mvp: Float32Array,
  opacity: number,
  forceOpaqueAlpha: boolean,
  hasMask: boolean,
  maskInvert: boolean,
): Float32Array {
  const data = new Float32Array(PLANE_UNIFORM_SIZE / 4);
  data.set(mvp, 0);
  data[16] = opacity;
  data[17] = forceOpaqueAlpha ? 1 : 0;
  data[18] = hasMask ? 1 : 0;
  data[19] = maskInvert ? 1 : 0;
  return data;
}

export function buildPlaneMvp(layer: ScenePlaneLayer, camera: SceneCamera): Float32Array {
  const planeScale = createPlaneScaleMatrix(layer, camera.viewport);
  const modelMatrix = multiplyMat4(layer.worldMatrix, planeScale);
  const viewProjection = multiplyMat4(camera.projectionMatrix, camera.viewMatrix);
  return multiplyMat4(viewProjection, modelMatrix);
}

function createPlaneScaleMatrix(
  layer: ScenePlaneLayer,
  viewport: { width: number; height: number },
): Float32Array {
  const outputAspect = viewport.width / Math.max(viewport.height, 1);
  const sourceAspect = layer.sourceWidth / Math.max(layer.sourceHeight, 1);
  const sourcePixelScale = calculateSourcePixelScale(
    layer.sourceWidth,
    layer.sourceHeight,
    viewport.width,
    viewport.height,
  );
  let planeWidth: number;
  let planeHeight: number;

  if (sourceAspect >= outputAspect) {
    planeWidth = WORLD_HEIGHT * outputAspect * sourcePixelScale;
    planeHeight = planeWidth / Math.max(sourceAspect, 1e-6);
  } else {
    planeHeight = WORLD_HEIGHT * sourcePixelScale;
    planeWidth = planeHeight * sourceAspect;
  }

  return new Float32Array([
    planeWidth, 0, 0, 0,
    0, planeHeight, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
