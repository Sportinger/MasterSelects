import { useMediaStore } from '../../../stores/mediaStore';
import { ModelRuntimeCache } from '../../native3d/assets/ModelRuntimeCache';
import type { FlockMeshData } from './flockMeshes';

/**
 * Static imported models (OBJ / FBX / glTF / GLB) as flock instance meshes.
 * Geometry is flattened to non-indexed position+normal triangles, centered and
 * scaled so the longest extent is 2 units (the procedural mesh convention).
 * Skeletal animation is not assumed; swimming deformation still applies.
 */

import { buildFlockInstanceMeshFromModel, FLOCK_MODEL_MAX_TRIANGLES } from './flockModelMeshGeometry';
export { buildFlockInstanceMeshFromModel, FLOCK_MODEL_MAX_TRIANGLES } from './flockModelMeshGeometry';

export interface FlockModelMeshState {
  status: 'loading' | 'ready' | 'missing' | 'failed';
  mesh?: FlockMeshData;
  message?: string;
  decimated?: boolean;
}

const runtimeCache = new ModelRuntimeCache();
const states = new Map<string, FlockModelMeshState>();

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
