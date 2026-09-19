import { gzip, gunzipSync, strFromU8, strToU8 } from 'fflate';
import type { ProjectFile } from '../types/project.types';
import type { DenseTerrainMesh } from '../../../types/terrainTracking';
import { isRetainedTerrainMesh, retainTerrainMesh } from '../../planarTracking/immutableTerrainMesh';

const PREFIX = 'Geometry/terrain/';
const REF = '$msTerrainMesh';
interface PackedMesh { path: string; bytes: Uint8Array }
const packedMeshes = new WeakMap<object, Promise<PackedMesh>>();

export function isTerrainGeometryEntry(path: string): boolean {
  return /^Geometry\/terrain\/[a-zA-Z0-9_-]+\.json\.gz$/.test(path);
}

function packMesh(mesh: DenseTerrainMesh): Promise<PackedMesh> {
  retainTerrainMesh(mesh);
  let pending = packedMeshes.get(mesh);
  if (!pending) {
    pending = new Promise<PackedMesh>((resolve, reject) => {
      const bytes = strToU8(JSON.stringify(mesh));
      gzip(bytes, { level: 1 }, (error, compressed) => {
        if (error) reject(error);
        else resolve({ path: `${PREFIX}${crypto.randomUUID()}.json.gz`, bytes: compressed });
      });
    });
    packedMeshes.set(mesh, pending);
    void pending.catch(() => packedMeshes.delete(mesh));
  }
  return pending;
}

/** Geometry is encoded once per immutable mesh, independent of timeline edits. */
export async function encodeProjectTerrain(project: ProjectFile) {
  const meshes = new Set<DenseTerrainMesh>();
  const collectTrackMeshes = (track: import('../../../types/planarTracking').PlanarTrack) => {
    if (track.terrain?.denseMesh) meshes.add(track.terrain.denseMesh);
    for (const step of track.terrain?.footsteps ?? []) if (step.mesh) meshes.add(step.mesh);
  };
  for (const composition of project.compositions) {
    for (const clip of composition.clips) {
      for (const track of clip.planarTracks ?? []) {
        collectTrackMeshes(track);
      }
    }
  }
  for (const asset of project.trackingAssets ?? []) collectTrackMeshes(asset.track);
  const refs = new Map<object, PackedMesh>();
  // Limit first-save compression to one worker and one temporary JSON buffer.
  for (const mesh of meshes) refs.set(mesh, await packMesh(mesh));
  const json = JSON.stringify(project, (_key, value: unknown) => {
    if (value && typeof value === 'object' && isRetainedTerrainMesh(value)) {
      const packed = refs.get(value);
      if (packed) return { [REF]: packed.path };
    }
    return value;
  });
  return { bytes: strToU8(json), entries: [...refs.values()].map(p => [p.path, p.bytes] as const) };
}

export function decodeProjectTerrain(bytes: Uint8Array, entries: Record<string, Uint8Array>): ProjectFile {
  const meshes = new Map<string, DenseTerrainMesh>();
  return JSON.parse(strFromU8(bytes), (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || !(REF in value)) return value;
    const path = (value as Record<string, unknown>)[REF];
    if (typeof path !== 'string' || !isTerrainGeometryEntry(path) || !entries[path]) {
      throw new Error('Project terrain geometry is missing or has an invalid reference');
    }
    let mesh = meshes.get(path);
    if (!mesh) {
      const parsed = JSON.parse(strFromU8(gunzipSync(entries[path]))) as DenseTerrainMesh;
      if (![parsed.positions, parsed.indices, parsed.origin, parsed.axisX, parsed.axisY, parsed.normal, parsed.size]
        .every(values => Array.isArray(values) && values.every(Number.isFinite))) {
        throw new Error('Project terrain geometry contains invalid numeric data');
      }
      mesh = retainTerrainMesh(parsed);
      meshes.set(path, mesh);
      packedMeshes.set(mesh, Promise.resolve({ path, bytes: entries[path] }));
    }
    return mesh;
  }) as ProjectFile;
}

export function terrainGeometryReferences(bytes: Uint8Array): string[] {
  const refs = new Set<string>();
  JSON.parse(strFromU8(bytes), (_key, value: unknown) => {
    if (value && typeof value === 'object' && REF in value) {
      const path = (value as Record<string, unknown>)[REF];
      if (typeof path !== 'string' || !isTerrainGeometryEntry(path)) throw new Error('Invalid terrain geometry reference');
      refs.add(path);
    }
    return value;
  });
  return [...refs];
}
