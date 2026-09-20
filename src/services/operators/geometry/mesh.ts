/** Transient geometry values shared by generators, renderers and collision adapters. */
export interface MeshVertex { position: number[]; uv: number[] }
export interface SurfaceMesh { vertices: MeshVertex[]; indices: number[]; outline?: number[] }

/** Topology is supplied by the tracker adapter, not inferred by the mesh operator. */
export function landmarksToMesh(landmarks: { x: number; y: number }[], positions: number[][],
  triangles: number[], outline: number[]): SurfaceMesh {
  if (positions.length > landmarks.length || positions.some(p => p.length !== 3 || !p.every(Number.isFinite))
    || [...triangles, ...outline].some(i => !Number.isInteger(i) || i < 0 || i >= positions.length)) throw new Error('Invalid landmark mesh.');
  return { vertices: positions.map((position, i) => ({ position: [...position], uv: [landmarks[i].x, landmarks[i].y] })), indices: [...triangles], outline: [...outline] };
}

export function joinMeshes(meshes: SurfaceMesh[]): SurfaceMesh {
  const vertices: MeshVertex[] = [], indices: number[] = [];
  for (const mesh of meshes) {
    const offset = vertices.length;
    vertices.push(...mesh.vertices);
    for (const i of mesh.indices) indices.push(offset + i);
  }
  return { vertices, indices };
}
