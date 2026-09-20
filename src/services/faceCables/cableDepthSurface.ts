import { cableSceneLayout, type CableSceneBake } from './cableSceneData';
import { depthToMesh } from '../operators/geometry/depthMesh';
import { landmarksToMesh } from '../operators/geometry/mesh';
import { mergeSurfaceMeshes } from '../operators/geometry/mergeSurfaceMeshes';

/** The bake adapter supplies values; mesh generators and seam merging are effect-independent. */
export function buildCableDepthGeometry(bake: CableSceneBake, base: number) {
  const grid = bake.depthGrid!;
  const offset = base + cableSceneLayout(bake.cables, grid).depthOffset, data = bake.data;
  const values = data.subarray(offset + 4, offset + 4 + grid.width * grid.height);
  const corners = Array.from({ length: 4 }, (_, i) => Array.from(data.subarray(base + 1 + i * 5, base + 4 + i * 5)));
  const background = depthToMesh(values, grid, corners, Array.from(data.subarray(offset, offset + 3)), data[offset + 3]);
  const hasFace = data[base] && bake.surface?.face !== false;
  const positions = hasFace ? Array.from({ length: 468 }, (_, i) => Array.from(data.subarray(base + 21 + i * 5, base + 24 + i * 5))) : [];
  const landmarks = positions.map((_, i) => ({ x: data[base + 24 + i * 5], y: data[base + 25 + i * 5] }));
  const primary = landmarksToMesh(landmarks, positions, hasFace ? bake.triangles : [], hasFace ? bake.outline : []);
  return mergeSurfaceMeshes(primary, background, bake.surface?.blendWidth, bake.surface?.subdivisions).exterior;
}
