import { useMediaStore } from '../../../stores/mediaStore';
import { ModelRuntimeCache, type ModelRuntimeData } from '../../native3d/assets/ModelRuntimeCache';
import type { FlockMeshData } from './flockMeshes';

/**
 * Static imported models (OBJ / FBX / glTF / GLB) as flock instance meshes.
 * Geometry is flattened to non-indexed position+normal triangles, centered and
 * scaled so the longest extent is 2 units (the procedural mesh convention).
 * Skeletal animation is not assumed; swimming deformation still applies.
 */

export const FLOCK_MODEL_MAX_TRIANGLES = 20_000;
const INTERLEAVED_STRIDE = 8;

export interface FlockModelMeshState {
  status: 'loading' | 'ready' | 'missing' | 'failed';
  mesh?: FlockMeshData;
  message?: string;
  decimated?: boolean;
}

const runtimeCache = new ModelRuntimeCache();
const states = new Map<string, FlockModelMeshState>();

export function buildFlockInstanceMeshFromModel(runtime: Pick<ModelRuntimeData, 'primitives'>): { mesh: FlockMeshData; decimated: boolean } {
  let triangles = 0;
  for (const primitive of runtime.primitives) triangles += Math.floor(primitive.indices.length / 3);
  const stride = Math.max(1, Math.ceil(triangles / FLOCK_MODEL_MAX_TRIANGLES));
  const positions: number[] = [];
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let triangleIndex = 0;
  for (const primitive of runtime.primitives) {
    const source = primitive.centeredVertices ?? primitive.vertices;
    for (let i = 0; i + 2 < primitive.indices.length; i += 3, triangleIndex += 1) {
      if (triangleIndex % stride !== 0) continue;
      for (let corner = 0; corner < 3; corner += 1) {
        const base = primitive.indices[i + corner] * INTERLEAVED_STRIDE;
        const x = source[base] ?? 0;
        const y = source[base + 1] ?? 0;
        const z = source[base + 2] ?? 0;
        positions.push(x, y, z, source[base + 3] ?? 0, source[base + 4] ?? 0, source[base + 5] ?? 1);
        min = [Math.min(min[0], x), Math.min(min[1], y), Math.min(min[2], z)];
        max = [Math.max(max[0], x), Math.max(max[1], y), Math.max(max[2], z)];
      }
    }
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
  const scale = 2 / extent;
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const vertices = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 6) {
    vertices[i] = (positions[i] - center[0]) * scale;
    vertices[i + 1] = (positions[i + 1] - center[1]) * scale;
    vertices[i + 2] = (positions[i + 2] - center[2]) * scale;
    const nx = positions[i + 3];
    const ny = positions[i + 4];
    const nz = positions[i + 5];
    const length = Math.hypot(nx, ny, nz) || 1;
    vertices[i + 3] = nx / length;
    vertices[i + 4] = ny / length;
    vertices[i + 5] = nz / length;
  }
  return { mesh: { kind: 'model', vertices, vertexCount: vertices.length / 6 }, decimated: stride > 1 };
}

/** Resolves (and lazily loads) the instance mesh for a model media file id. */
export function getFlockModelMesh(mediaFileId: string, onChange: () => void): FlockModelMeshState {
  if (!mediaFileId) return { status: 'missing', message: 'Choose a model asset for the Instances node.' };
  const file = useMediaStore.getState().files.find((candidate) => candidate.id === mediaFileId);
  if (!file?.url) return { status: 'missing', message: 'The referenced model asset is missing from the project.' };
  const key = `${mediaFileId}|${file.url}`;
  const existing = states.get(key);
  if (existing) return existing;
  const loading: FlockModelMeshState = { status: 'loading', message: `Loading model ${file.name}…` };
  states.set(key, loading);
  void runtimeCache.preload(file.url, file.name).then((ok) => {
    const runtime = ok ? runtimeCache.get(file.url) : undefined;
    if (!runtime || runtime.primitives.length === 0) {
      states.set(key, { status: 'failed', message: `Model ${file.name} could not be loaded for instancing.` });
    } else {
      const { mesh, decimated } = buildFlockInstanceMeshFromModel(runtime);
      states.set(key, {
        status: 'ready',
        mesh,
        decimated,
        ...(decimated ? { message: `Model ${file.name} was decimated to ${FLOCK_MODEL_MAX_TRIANGLES} triangles for instancing.` } : {}),
      });
    }
    onChange();
  }).catch(() => {
    states.set(key, { status: 'failed', message: `Model ${file.name} could not be loaded for instancing.` });
    onChange();
  });
  return loading;
}

export function peekFlockModelMesh(mediaFileId: string): FlockModelMeshState | null {
  const file = useMediaStore.getState().files.find((candidate) => candidate.id === mediaFileId);
  return file?.url ? states.get(`${mediaFileId}|${file.url}`) ?? null : null;
}
