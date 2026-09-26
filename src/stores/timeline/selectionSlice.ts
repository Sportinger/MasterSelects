// Selection-related actions slice

import type { SelectionActions, SliceCreator, Keyframe } from './types';
import { isManualLinkedGroupId } from './helpers/idGenerator';

export const createSelectionSlice: SliceCreator<SelectionActions> = (set, get) => ({
  // Clip selection (multi-select support)
  selectClip: (id, addToSelection = false, setPrimaryOnly = false) => {
    const { selectedClipIds, clips } = get();

    // setPrimaryOnly: just update which clip is "focused" for Properties panel
    if (setPrimaryOnly && id !== null) {
      set({ primarySelectedClipId: id, propertiesSelection: { kind: 'clip', clipId: id } });
      return;
    }

    if (id === null) {
      set({ selectedClipIds: new Set(), primarySelectedClipId: null, propertiesSelection: null });
      return;
    }

    if (addToSelection) {
      // Shift+click: toggle only the clicked clip (independent selection)
      const newSet = new Set(selectedClipIds);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      const nextPropertiesClipId = newSet.has(id) ? id : ([...newSet][0] ?? null);
      set({
        selectedClipIds: newSet,
        primarySelectedClipId: id,
        propertiesSelection: nextPropertiesClipId ? { kind: 'clip', clipId: nextPropertiesClipId } : null,
      });
    } else {
      // Normal click: select clip + its linked clip
      const clip = clips.find(c => c.id === id);
      const newSelection = new Set([id]);
      if (clip?.linkedClipId) {
        newSelection.add(clip.linkedClipId);
      }
      for (const candidate of clips) {
        if (candidate.linkedClipId === id) {
          newSelection.add(candidate.id);
        }
        if (
          clip?.linkedGroupId &&
          isManualLinkedGroupId(clip.linkedGroupId) &&
          candidate.linkedGroupId === clip.linkedGroupId
        ) {
          newSelection.add(candidate.id);
        }
      }
      set({
        selectedClipIds: newSelection,
        primarySelectedClipId: id,
        propertiesSelection: { kind: 'clip', clipId: id },
      });
    }
  },

  selectClips: (ids, options) => {
    set({
      selectedClipIds: new Set(ids),
      primarySelectedClipId: ids.length > 0 ? ids[0] : null,
      propertiesSelection: ids.length > 0 ? { kind: 'clip', clipId: ids[0],
        ...(options?.revealProperties === false ? { revealPanel: false } : {}) } : null,
    });
  },

  addClipToSelection: (id) => {
    const { selectedClipIds } = get();
    const newSet = new Set(selectedClipIds);
    newSet.add(id);
    set({ selectedClipIds: newSet, primarySelectedClipId: id, propertiesSelection: { kind: 'clip', clipId: id } });
  },

  removeClipFromSelection: (id) => {
    const { selectedClipIds } = get();

    const newSet = new Set(selectedClipIds);
    newSet.delete(id);
    const { propertiesSelection, primarySelectedClipId } = get();
    const nextPrimaryId = primarySelectedClipId === id ? ([...newSet][0] ?? null) : primarySelectedClipId;
    set({
      selectedClipIds: newSet,
      primarySelectedClipId: nextPrimaryId,
      propertiesSelection: propertiesSelection?.kind === 'clip' && propertiesSelection.clipId === id
        ? (nextPrimaryId ? { kind: 'clip', clipId: nextPrimaryId } : null)
        : propertiesSelection,
    });
  },

  clearClipSelection: () => {
    set({ selectedClipIds: new Set(), primarySelectedClipId: null, propertiesSelection: null });
  },

  selectTransitionProperties: (clipId, edge, transitionId) => {
    const { clips } = get();
    const clip = clips.find(candidate => candidate.id === clipId);
    const transition = edge === 'in' ? clip?.transitionIn : clip?.transitionOut;
    if (!clip || transition?.id !== transitionId) return;

    set({
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      propertiesSelection: { kind: 'transition', clipId, edge, transitionId },
    });
  },

  selectTrackProperties: (trackId) => {
    const { tracks } = get();
    if (!tracks.some(track => track.id === trackId)) return;
    set({
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      propertiesSelection: { kind: 'track', trackId },
    });
  },

  selectMasterProperties: () => {
    set({
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      propertiesSelection: { kind: 'master' },
    });
  },

  clearPropertiesSelection: () => {
    set({
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      propertiesSelection: null,
    });
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
