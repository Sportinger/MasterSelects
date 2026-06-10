import { MESH_UNIFORM_SIZE } from './constants';

export function buildMeshUniformData(
  mvp: Float32Array,
  world: Float32Array,
  color: readonly [number, number, number, number],
  opacity: number,
  unlit: boolean,
): Float32Array {
  const data = new Float32Array(MESH_UNIFORM_SIZE / 4);
  data.set(mvp, 0);
  data.set(world, 16);
  data[32] = color[0];
  data[33] = color[1];
  data[34] = color[2];
  data[35] = color[3] * opacity;
  data[36] = unlit ? 1 : 0;
  return data;
}
