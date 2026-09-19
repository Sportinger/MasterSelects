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
>> = (set, get) => {
  let switchTail: Promise<void> | null = null;

  const restartActivePlayback = (options: CompositionSwitchOptions) => {
    const timelineStore = useTimelineStore.getState();
    const playStartTime = resolvePlayStartTime(options);
    timelineStore.pause();
    timelineStore.setPlayheadPosition(playStartTime);
    resetPlaybackClockForCompositionStart(playStartTime);
    for (const clip of timelineStore.clips) {
      if (clip.source?.videoElement) clip.source.videoElement.currentTime = clip.inPoint;
      if (clip.source?.audioElement) clip.source.audioElement.currentTime = clip.inPoint;
    }
    timelineStore.play();
  };

  const enqueueCompositionSwitch = (
    id: string | null,
    options?: CompositionSwitchOptions,
  ): Promise<void> => {
    const execute = async () => {
      const { activeCompositionId, compositions } = get();
      if (id === activeCompositionId) {
        if (options?.playFromStart) restartActivePlayback(options);
        return;
      }
      await doSetActiveComposition(set, get, activeCompositionId, id, compositions, options);
    };
    const scheduled = switchTail ? switchTail.then(execute, execute) : execute();
    const tracked = scheduled.finally(() => {
      if (switchTail === tracked) switchTail = null;
    });
    switchTail = tracked;
    return tracked;
  };

  return {
    setActiveComposition: (id: string | null) => {
      // Dock-tab clicks can arrive faster than the track morph animation completes.
      // Loading the real timeline directly keeps stale transition snapshots from
      // being rendered as additional track rows while the switch queue catches up.
      void enqueueCompositionSwitch(id, { skipAnimation: true });
    },

    openCompositionTab: async (id: string, options?: CompositionSwitchOptions) => {
      set((state) => state.openCompositionIds.includes(id)
        ? {}
        : { openCompositionIds: [...state.openCompositionIds, id] });
      await enqueueCompositionSwitch(id, options);
    },

    closeCompositionTab: (id: string) => {
      const { openCompositionIds, activeCompositionId } = get();
      const newOpenIds = openCompositionIds.filter((cid) => cid !== id);
      set({ openCompositionIds: newOpenIds });

      if (activeCompositionId === id && newOpenIds.length > 0) {
        const closedIndex = openCompositionIds.indexOf(id);
        const newActiveIndex = Math.min(closedIndex, newOpenIds.length - 1);
        void enqueueCompositionSwitch(newOpenIds[newActiveIndex], { skipAnimation: true });
      } else if (newOpenIds.length === 0) {
        void enqueueCompositionSwitch(null, { skipAnimation: true });
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
  };
};
