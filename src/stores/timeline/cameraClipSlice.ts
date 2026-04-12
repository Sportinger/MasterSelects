// Camera clip actions slice - shared Three.js scene cameras on the timeline

import type { TimelineClip } from '../../types';
import type { CameraClipActions, SliceCreator } from './types';
import { DEFAULT_TRANSFORM } from './constants';
import { generateCameraClipId } from './helpers/idGenerator';
import { useMediaStore, DEFAULT_SCENE_CAMERA_SETTINGS } from '../mediaStore';
import { Logger } from '../../services/logger';

const log = Logger.create('CameraClipSlice');

export const createCameraClipSlice: SliceCreator<CameraClipActions> = (set, get) => ({
  addCameraClip: (trackId, startTime, duration = 10, skipMediaItem = false) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find(t => t.id === trackId);

    if (!track || track.type !== 'video') {
      log.warn('Camera clips can only be added to video tracks');
      return null;
    }

    const clipId = generateCameraClipId();

    const cameraClip: TimelineClip = {
      id: clipId,
      trackId,
      name: 'Camera',
      file: new File([], 'camera-clip.dat', { type: 'application/octet-stream' }),
      startTime,
      duration,
      inPoint: 0,
      outPoint: duration,
      source: {
        type: 'camera',
        naturalDuration: Number.MAX_SAFE_INTEGER,
        cameraSettings: { ...DEFAULT_SCENE_CAMERA_SETTINGS },
      },
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      isLoading: false,
    };

    if (!skipMediaItem) {
      const mediaStore = useMediaStore.getState();
      const cameraFolderId = mediaStore.getOrCreateCameraFolder();
      const mediaItemId = mediaStore.createCameraItem(undefined, cameraFolderId);
      cameraClip.mediaFileId = mediaItemId;
      cameraClip.source = { ...cameraClip.source!, mediaFileId: mediaItemId };
    }

    set({ clips: [...clips, cameraClip] });
    updateDuration();
    invalidateCache();

    log.debug('Created camera clip', { clipId });
    return clipId;
  },
});
