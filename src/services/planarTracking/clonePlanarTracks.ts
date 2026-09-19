import type { PlanarTrack } from '../../types/planarTracking';
import { retainTerrainMesh } from './immutableTerrainMesh';

/** Copy editable tracking state without duplicating immutable reconstruction geometry. */
export function clonePlanarTracks(tracks: PlanarTrack[] | undefined): PlanarTrack[] | undefined {
  return tracks?.map(track => {
    const { terrain, ...editable } = track;
    if (!terrain) return structuredClone(editable);
    const { denseMesh, footsteps, ...reconstruction } = terrain;
    return {
      ...structuredClone(editable),
      terrain: {
        ...structuredClone(reconstruction),
        ...(denseMesh ? { denseMesh: retainTerrainMesh(denseMesh) } : {}),
        ...(footsteps ? { footsteps: footsteps.map(step => {
          const { mesh, ...settings } = step;
          return { ...structuredClone(settings), ...(mesh ? { mesh: retainTerrainMesh(mesh) } : {}) };
        }) } : {}),
      },
    };
  });
}
