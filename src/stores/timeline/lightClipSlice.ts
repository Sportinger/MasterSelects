import type { TimelineClip } from '../../types/timeline';
import type { LightClipActions, SliceCreator } from './types';
import { DEFAULT_TRANSFORM } from './constants';
import { generateLightClipId } from './helpers/idGenerator';
import { DEFAULT_LIGHT_CLIP_SETTINGS, mergeLightClipSettings } from '../../types/light';
import { Logger } from '../../services/logger';

const log = Logger.create('LightClipSlice');

export const createLightClipSlice: SliceCreator<LightClipActions> = (set, get) => ({
  addLightClip: (trackId, startTime, duration = 10, _skipMediaItem = false, lightSettings, mediaItemId) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find((t) => t.id === trackId);

    if (!track || track.type !== 'video') {
      log.warn('Light clips can only be added to video tracks');
      return null;
    }

    const clipId = generateLightClipId();
    const lightClip: TimelineClip = {
      id: clipId,
      trackId,
      name: 'Light',
      file: new File([], 'light-clip.dat', { type: 'application/octet-stream' }),
      startTime,
      duration,
      inPoint: 0,
      outPoint: duration,
      mediaFileId: mediaItemId,
      source: {
        type: 'light',
        naturalDuration: Number.MAX_SAFE_INTEGER,
        mediaFileId: mediaItemId,
        lightSettings: mergeLightClipSettings(lightSettings ?? DEFAULT_LIGHT_CLIP_SETTINGS),
      },
      transform: {
        ...DEFAULT_TRANSFORM,
        position: { x: 0, y: 0, z: 3 },
        scale: { x: 1, y: 1, z: 1 },
      },
      effects: [],
      is3D: true,
      isLoading: false,
    };

    set({ clips: [...clips, lightClip] });
    updateDuration();
    invalidateCache();

    log.debug('Created light clip', { clipId });
    return clipId;
  },
});
