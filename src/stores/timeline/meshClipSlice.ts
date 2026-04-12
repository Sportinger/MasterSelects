// Mesh clip actions slice - creates 3D primitive mesh clips on the timeline

import type { TimelineClip, Text3DProperties } from '../../types';
import type { MeshClipActions, SliceCreator } from './types';
import type { MeshPrimitiveType } from '../mediaStore/types';
import { DEFAULT_TEXT_3D_PROPERTIES, DEFAULT_TRANSFORM } from './constants';
import { generateMeshClipId } from './helpers/idGenerator';
import { useMediaStore } from '../mediaStore';
import { Logger } from '../../services/logger';
import { layerBuilder } from '../../services/layerBuilder';
import { engine } from '../../engine/WebGPUEngine';

const log = Logger.create('MeshClipSlice');

const MESH_LABELS: Record<MeshPrimitiveType, string> = {
  cube: 'Cube',
  sphere: 'Sphere',
  plane: 'Plane',
  cylinder: 'Cylinder',
  torus: 'Torus',
  cone: 'Cone',
  text3d: '3D Text',
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
    const text3DProperties = meshType === 'text3d'
      ? { ...DEFAULT_TEXT_3D_PROPERTIES }
      : undefined;

    const meshClip: TimelineClip = {
      id: clipId,
      trackId,
      name: label,
      file: new File([], `mesh-${meshType}.dat`, { type: 'application/octet-stream' }),
      startTime,
      duration,
      inPoint: 0,
      outPoint: duration,
      source: {
        type: 'model',
        meshType,
        naturalDuration: 3600,
        ...(text3DProperties ? { text3DProperties } : {}),
      },
      transform: meshType === 'text3d'
        ? {
            ...DEFAULT_TRANSFORM,
            scale: { x: 1, y: 1, z: 1 },
          }
        : { ...DEFAULT_TRANSFORM },
      effects: [],
      is3D: true,
      meshType,
      text3DProperties,
      isLoading: false,
    };

    if (!skipMediaItem) {
      const mediaStore = useMediaStore.getState();
      const parentFolderId = meshType === 'text3d'
        ? mediaStore.getOrCreateTextFolder()
        : mediaStore.getOrCreateMeshFolder();
      const mediaItemId = mediaStore.createMeshItem(meshType, undefined, parentFolderId);
      meshClip.mediaFileId = mediaItemId;
      meshClip.source = { ...meshClip.source!, mediaFileId: mediaItemId };
    }

    set({ clips: [...clips, meshClip] });
    updateDuration();
    invalidateCache();

    log.debug('Created mesh clip', { clipId, meshType });
    return clipId;
  },

  updateText3DProperties: (clipId, props) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    const meshType = clip?.meshType ?? clip?.source?.meshType;
    const currentProps = meshType === 'text3d'
      ? (clip?.text3DProperties ?? clip?.source?.text3DProperties ?? DEFAULT_TEXT_3D_PROPERTIES)
      : (clip?.text3DProperties ?? clip?.source?.text3DProperties);
    if (!clip || meshType !== 'text3d' || !currentProps) return;

    const nextProps: Text3DProperties = { ...currentProps, ...props };

    set({
      clips: clips.map(c => c.id !== clipId ? c : {
        ...c,
        name: nextProps.text.trim().slice(0, 30) || '3D Text',
        text3DProperties: nextProps,
        source: c.source ? {
          ...c.source,
          text3DProperties: nextProps,
        } : c.source,
      }),
    });

    invalidateCache();
    layerBuilder.invalidateCache();
    engine.requestRender();
  },
});
