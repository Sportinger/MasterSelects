import type { TimelineClip } from '../../types';
import type { SplatEffectorClipActions, SliceCreator } from './types';
import { DEFAULT_TRANSFORM } from './constants';
import { generateSplatEffectorClipId } from './helpers/idGenerator';
import { useMediaStore } from '../mediaStore';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../types/splatEffector';
import { Logger } from '../../services/logger';

const log = Logger.create('SplatEffectorClipSlice');

export const createSplatEffectorClipSlice: SliceCreator<SplatEffectorClipActions> = (set, get) => ({
  addSplatEffectorClip: (trackId, startTime, duration = 10, skipMediaItem = false) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find((t) => t.id === trackId);

    if (!track || track.type !== 'video') {
      log.warn('Splat effector clips can only be added to video tracks');
      return null;
    }

    const clipId = generateSplatEffectorClipId();
    const effectorClip: TimelineClip = {
      id: clipId,
      trackId,
      name: '3D Effector',
      file: new File([], 'splat-effector.dat', { type: 'application/octet-stream' }),
      startTime,
      duration,
      inPoint: 0,
      outPoint: duration,
      source: {
        type: 'splat-effector',
        naturalDuration: Number.MAX_SAFE_INTEGER,
        splatEffectorSettings: { ...DEFAULT_SPLAT_EFFECTOR_SETTINGS },
      },
      transform: {
        ...DEFAULT_TRANSFORM,
        scale: { x: 1, y: 1, z: 1 },
      },
      effects: [],
      is3D: true,
      isLoading: false,
    };

    if (!skipMediaItem) {
      const mediaStore = useMediaStore.getState();
      const effectorFolderId = mediaStore.getOrCreateSplatEffectorFolder();
      const mediaItemId = mediaStore.createSplatEffectorItem(undefined, effectorFolderId);
      effectorClip.mediaFileId = mediaItemId;
      effectorClip.source = { ...effectorClip.source!, mediaFileId: mediaItemId };
    }

    set({ clips: [...clips, effectorClip] });
    updateDuration();
    invalidateCache();

    log.debug('Created splat effector clip', { clipId });
    return clipId;
  },
});
