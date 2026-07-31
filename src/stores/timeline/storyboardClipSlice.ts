import { captureSnapshot } from '../historyStore';
import {
  createStoryboardTimelineClip,
  DEFAULT_STORYBOARD_PLAN_ID,
  updateStoryboardTimelineClip,
} from '../../services/storyboard/core';
import type {
  StoryboardClipActions,
  SliceCreator,
} from './types';
import { reconcileStoryboardTimelineClips } from '../storyboardStore';

export const createStoryboardClipSlice: SliceCreator<StoryboardClipActions> = (set, get) => ({
  addStoryboardClip: (trackId, startTime, options = {}) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    const track = tracks.find(candidate => candidate.id === trackId);
    if (!track || track.type !== 'video' || track.locked) return null;

    const clip = createStoryboardTimelineClip({
      ...options,
      trackId,
      startTime,
      planId: options.planId?.trim() || DEFAULT_STORYBOARD_PLAN_ID,
    });
    captureSnapshot('Add storyboard scene');
    const nextClips = [...clips, clip];
    set({
      clips: nextClips,
      selectedClipIds: new Set([clip.id]),
      primarySelectedClipId: clip.id,
      propertiesSelection: { kind: 'clip', clipId: clip.id },
    });
    updateDuration();
    invalidateCache();
    reconcileStoryboardTimelineClips(nextClips);
    return clip.id;
  },

  updateStoryboardScene: (sceneId, patch, options = {}) => {
    const { clips, tracks, invalidateCache } = get();
    const lockedTrackIds = new Set(
      tracks.filter(track => track.locked).map(track => track.id),
    );
    const matching = clips.filter(
      clip => clip.storyboardProperties?.sceneId === sceneId &&
        clip.source?.type === 'storyboard' &&
        !lockedTrackIds.has(clip.trackId),
    );
    if (matching.length === 0) return 0;

    if (options.captureHistory !== false) {
      captureSnapshot(options.historyLabel ?? 'Edit storyboard scene');
    }
    const matchingIds = new Set(matching.map(clip => clip.id));
    const nextClips = clips.map(clip =>
      matchingIds.has(clip.id) ? updateStoryboardTimelineClip(clip, patch) : clip
    );
    set({ clips: nextClips });
    invalidateCache();
    reconcileStoryboardTimelineClips(nextClips);
    return matching.length;
  },
});
