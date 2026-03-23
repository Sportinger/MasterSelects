// Mesh clip actions slice — creates 3D primitive mesh clips on the timeline

import type { TimelineClip } from '../../types';
import type { MeshClipActions, SliceCreator } from './types';
import type { MeshPrimitiveType } from '../mediaStore/types';
import { DEFAULT_TRANSFORM } from './constants';
import { generateMeshClipId } from './helpers/idGenerator';
import { useMediaStore } from '../mediaStore';
import { Logger } from '../../services/logger';

const log = Logger.create('MeshClipSlice');

const MESH_LABELS: Record<MeshPrimitiveType, string> = {
  cube: 'Cube',
  sphere: 'Sphere',
  plane: 'Plane',
  cylinder: 'Cylinder',
  torus: 'Torus',
  cone: 'Cone',
};

export const createMeshClipSlice: SliceCreator<MeshClipActions> = (set, get) => ({
  addMeshClip: (trackId, startTime, meshType, duration = 10, skipMediaItem = false) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find(t => t.id === trackId);

    if (!track || track.type !== 'video') {
      log.warn('Mesh clips can only be added to video tracks');
      return null;
    }

    const clipId = generateMeshClipId();
    const label = MESH_LABELS[meshType] || meshType;

    const meshClip: TimelineClip = {
      id: clipId,
      trackId,
      name: label,
      file: new File([], `mesh-${meshType}.dat`, { type: 'application/octet-stream' }),
      startTime,
      duration,
      inPoint: 0,
      outPoint: duration,
      source: { type: 'model', meshType, naturalDuration: 3600 },
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      is3D: true,
      meshType,
      isLoading: false,
    };

    set({ clips: [...clips, meshClip] });
    updateDuration();
    invalidateCache();

    if (!skipMediaItem) {
      const mediaStore = useMediaStore.getState();
      const meshFolderId = mediaStore.getOrCreateMeshFolder();
      mediaStore.createMeshItem(meshType, undefined, meshFolderId);
    }

    log.debug('Created mesh clip', { clipId, meshType });
    return clipId;
  },
});
