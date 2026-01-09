// Selection-related actions slice

import type { SelectionActions, SliceCreator, Keyframe } from './types';

export const createSelectionSlice: SliceCreator<SelectionActions> = (set, get) => ({
  // Clip selection (multi-select support)
  selectClip: (id, addToSelection = false) => {
    const { selectedClipIds } = get();

    if (id === null) {
      set({ selectedClipIds: new Set() });
      return;
    }

    if (addToSelection) {
      const newSet = new Set(selectedClipIds);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      set({ selectedClipIds: newSet });
    } else {
      set({ selectedClipIds: new Set([id]) });
    }
  },

  selectClips: (ids) => {
    set({ selectedClipIds: new Set(ids) });
  },

  addClipToSelection: (id) => {
    const { selectedClipIds } = get();
    const newSet = new Set(selectedClipIds);
    newSet.add(id);
    set({ selectedClipIds: newSet });
  },

  removeClipFromSelection: (id) => {
    const { selectedClipIds } = get();
    const newSet = new Set(selectedClipIds);
    newSet.delete(id);
    set({ selectedClipIds: newSet });
  },

  clearClipSelection: () => {
    set({ selectedClipIds: new Set() });
  },

  // Keyframe selection
  selectKeyframe: (keyframeId, addToSelection = false) => {
    const { selectedKeyframeIds } = get();

    if (addToSelection) {
      const newSet = new Set(selectedKeyframeIds);
      if (newSet.has(keyframeId)) {
        newSet.delete(keyframeId);
      } else {
        newSet.add(keyframeId);
      }
      set({ selectedKeyframeIds: newSet });
    } else {
      set({ selectedKeyframeIds: new Set([keyframeId]) });
    }
  },

  deselectAllKeyframes: () => {
    set({ selectedKeyframeIds: new Set() });
  },

  deleteSelectedKeyframes: () => {
    const { selectedKeyframeIds, clipKeyframes, invalidateCache } = get();
    if (selectedKeyframeIds.size === 0) return;

    const newMap = new Map<string, Keyframe[]>();

    clipKeyframes.forEach((keyframes, clipId) => {
      const filtered = keyframes.filter(k => !selectedKeyframeIds.has(k.id));
      if (filtered.length > 0) {
        newMap.set(clipId, filtered);
      }
    });

    set({
      clipKeyframes: newMap,
      selectedKeyframeIds: new Set(),
    });
    invalidateCache();
  },
});
