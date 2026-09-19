import type { DenseTerrainMesh } from '../../types/terrainTracking';

const retained:WeakSet<object>=import.meta.hot?.data?.retainedTerrainMeshes??new WeakSet<object>();
import.meta.hot?.dispose?.(data=>{data.retainedTerrainMeshes=retained;});
/** Reconstruction geometry is immutable; marker edits and undo share its numeric data. */
export function retainTerrainMesh(mesh:DenseTerrainMesh):DenseTerrainMesh {
  if(!retained.has(mesh)){
    for(const values of [mesh.positions,mesh.indices,mesh.origin,mesh.axisX,mesh.axisY,mesh.normal,mesh.size])Object.freeze(values);
    Object.freeze(mesh);retained.add(mesh);
  }
  return mesh;
}
export const isRetainedTerrainMesh=(value:object):boolean=>retained.has(value);

const historyMeshIds = new WeakMap<object, number>();
let nextHistoryMeshId = 1;
/** Small runtime-only equality token; never serialized into project geometry. */
export function terrainMeshHistoryToken(value: object): string | undefined {
  if (!isRetainedTerrainMesh(value)) return undefined;
  let id = historyMeshIds.get(value);
  if (id === undefined) { id = nextHistoryMeshId++; historyMeshIds.set(value, id); }
  return `immutable-terrain-mesh:${id}`;
}
