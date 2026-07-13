import type { Composition, MediaSliceCreator } from '../../types';
import { useTimelineStore } from '../../../timeline';
import type { CompositionActions, CompositionSwitchOptions } from '../compositionSlice';
import {
  resetPlaybackClockForCompositionStart,
  resolvePlayStartTime,
} from './playbackClock';
import { doSetActiveComposition } from './timelineSwitchBridge';

export const createCompositionTabActions: MediaSliceCreator<Pick<
  CompositionActions,
  | 'setActiveComposition'
  | 'openCompositionTab'
  | 'closeCompositionTab'
  | 'getOpenCompositions'
  | 'reorderCompositionTabs'
>> = (set, get) => ({
  setActiveComposition: (id: string | null) => {
    const { activeCompositionId, compositions } = get();
    if (id === activeCompositionId) {
      return;
    }
    doSetActiveComposition(set, get, activeCompositionId, id, compositions);
  },

  openCompositionTab: (id: string, options?: CompositionSwitchOptions) => {
    const { openCompositionIds, activeCompositionId, compositions } = get();
    if (!openCompositionIds.includes(id)) {
      set({ openCompositionIds: [...openCompositionIds, id] });
    }

    if (id === activeCompositionId && options?.playFromStart) {
      const ts = useTimelineStore.getState();
      const playStartTime = resolvePlayStartTime(options);
      ts.pause();
      ts.setPlayheadPosition(playStartTime);
      resetPlaybackClockForCompositionStart(playStartTime);
      for (const clip of ts.clips) {
        if (clip.source?.videoElement) {
          clip.source.videoElement.currentTime = clip.inPoint;
        }
        if (clip.source?.audioElement) {
          clip.source.audioElement.currentTime = clip.inPoint;
        }
      }
      ts.play();
      return;
    }

    if (id === activeCompositionId) {
      return;
    }

    doSetActiveComposition(set, get, activeCompositionId, id, compositions, options);
  },

  closeCompositionTab: (id: string) => {
    const { openCompositionIds, activeCompositionId, compositions } = get();
    const newOpenIds = openCompositionIds.filter((cid) => cid !== id);
    set({ openCompositionIds: newOpenIds });

    if (activeCompositionId === id && newOpenIds.length > 0) {
      const closedIndex = openCompositionIds.indexOf(id);
      const newActiveIndex = Math.min(closedIndex, newOpenIds.length - 1);
      doSetActiveComposition(set, get, activeCompositionId, newOpenIds[newActiveIndex], compositions, { skipAnimation: true });
    } else if (newOpenIds.length === 0) {
      doSetActiveComposition(set, get, activeCompositionId, null, compositions, { skipAnimation: true });
    }
  },

  getOpenCompositions: () => {
    const { compositions, openCompositionIds } = get();
    return openCompositionIds
      .map((id) => compositions.find((c): c is Composition => c.id === id))
      .filter((c): c is Composition => c !== undefined);
  },

  reorderCompositionTabs: (fromIndex: number, toIndex: number) => {
    const { openCompositionIds } = get();
    if (fromIndex < 0 || fromIndex >= openCompositionIds.length) return;
    if (toIndex < 0 || toIndex >= openCompositionIds.length) return;
    if (fromIndex === toIndex) return;

    const newOrder = [...openCompositionIds];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);
    set({ openCompositionIds: newOrder });
  },
});
