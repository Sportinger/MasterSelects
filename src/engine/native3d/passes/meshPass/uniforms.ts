import { hexToRgb01 } from '../../../../types/light';
import type { SceneLightLayer } from '../../../scene/types';
import { MAX_MESH_LIGHTS, MESH_UNIFORM_SIZE } from './constants';

function normalizeVector(x: number, y: number, z: number): readonly [number, number, number] {
  const length = Math.hypot(x, y, z);
  return length > 1e-6 ? [x / length, y / length, z / length] : [0, 0, -1];
}

interface MeshMaterialUniformOptions {
  textureEnabled?: boolean;
  uvScaleX?: number;
  uvScaleY?: number;
  uvOffsetX?: number;
  uvOffsetY?: number;
}

function writeMeshLights(data: Float32Array, lights: readonly SceneLightLayer[]): void {
  if (lights.length === 0) {
    data[38] = 0;
    return;
  }

  let ambientR = 0.08;
  let ambientG = 0.08;
  let ambientB = 0.08;
  let directCount = 0;

  for (const light of lights) {
    const settings = light.lightSettings;
    const [r, g, b] = hexToRgb01(settings.color);

    if (settings.kind === 'environment') {
      ambientR += r * settings.intensity;
      ambientG += g * settings.intensity;
      ambientB += b * settings.intensity;
      continue;
    }

    if (directCount >= MAX_MESH_LIGHTS || settings.intensity <= 0) {
      continue;
    }

    const offset = 48 + directCount * 12;
    const matrix = light.worldMatrix;
    data[offset] = matrix[12] ?? 0;
    data[offset + 1] = matrix[13] ?? 0;
    data[offset + 2] = matrix[14] ?? 0;
    data[offset + 3] = settings.kind === 'panel' ? 2 : 1;
    data[offset + 4] = r;
    data[offset + 5] = g;
    data[offset + 6] = b;
    data[offset + 7] = settings.intensity;

    const [dirX, dirY, dirZ] = settings.kind === 'panel'
      ? normalizeVector(-(matrix[8] ?? 0), -(matrix[9] ?? 0), -(matrix[10] ?? 1))
      : [0, 0, -1];
    data[offset + 8] = dirX;
    data[offset + 9] = dirY;
    data[offset + 10] = dirZ;
    data[offset + 11] = settings.diameter;
    directCount += 1;
  }

  data[37] = directCount;
  data[38] = 1;
  data[44] = ambientR;
  data[45] = ambientG;
  data[46] = ambientB;
  data[47] = 1;
}

export function buildMeshUniformData(
  mvp: Float32Array,
  world: Float32Array,
  color: readonly [number, number, number, number],
  opacity: number,
  unlit: boolean,
  material: MeshMaterialUniformOptions = {},
  lights: readonly SceneLightLayer[] = [],
): Float32Array {
  const data = new Float32Array(MESH_UNIFORM_SIZE / 4);
  data.set(mvp, 0);
  data.set(world, 16);
  data[32] = color[0];
  data[33] = color[1];
  data[34] = color[2];
  data[35] = color[3] * opacity;
  data[36] = unlit ? 1 : 0;
  data[39] = material.textureEnabled === false ? 0 : 1;
  data[40] = Number.isFinite(material.uvScaleX) ? material.uvScaleX! : 1;
  data[41] = Number.isFinite(material.uvScaleY) ? material.uvScaleY! : 1;
  data[42] = Number.isFinite(material.uvOffsetX) ? material.uvOffsetX! : 0;
  data[43] = Number.isFinite(material.uvOffsetY) ? material.uvOffsetY! : 0;
  writeMeshLights(data, lights);
  return data;
}
