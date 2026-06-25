import type { Composition, MediaState } from '../../types';
import { compositionRenderer } from '../../../../services/compositionRenderer';
import { playheadState } from '../../../../services/layerBuilder';
import { useTimelineStore } from '../../../timeline';
import type { CompositionSwitchOptions } from '../compositionSlice';
import {
  resetPlaybackClockForCompositionStart,
  resolvePlayStartTime,
} from './playbackClock';
import {
  calculateSyncedPlayhead,
  getCompositionSwitchDirection,
} from './timelineNavigationPlanner';
import { syncTransitionCompositionTimelineToParent } from './transitionCompositionSync';

type MediaSliceSet = (
  partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)
) => void;

/**
 * Internal helper to set active composition without calling get().setActiveComposition.
 * Handles timeline save/restore and composition switch animation phases.
 */
export function doSetActiveComposition(
  set: MediaSliceSet,
  get: () => MediaState,
  currentActiveId: string | null,
  newId: string | null,
  compositions: Composition[],
  options?: CompositionSwitchOptions,
): void {
  const timelineStore = useTimelineStore.getState();
  const skipAnimation = options?.skipAnimation ?? false;

  const syncedPlayhead = calculateSyncedPlayhead(
    currentActiveId,
    newId,
    compositions,
    timelineStore,
  );

  const savedCompId = currentActiveId;
  if (currentActiveId) {
    if (playheadState.isUsingInternalPosition) {
      timelineStore.setPlayheadPosition(playheadState.position);
    }
    const timelineData = timelineStore.getSerializableState();
    set((state) => ({
      compositions: syncTransitionCompositionTimelineToParent(
        state.compositions.map((c) =>
          c.id === currentActiveId ? { ...c, timelineData } : c
        ),
        currentActiveId,
        timelineData,
      ),
    }));
    compositionRenderer.invalidateCompositionAndParents(currentActiveId);
  }

  if (skipAnimation) {
    timelineStore.setCompositionSwitchSourceTracks(null);
    timelineStore.setCompositionSwitchTargetTracks(null);
    finishCompositionSwitch(set, get, newId, savedCompId, syncedPlayhead, options);
    return;
  }

  timelineStore.setCompositionSwitchDirection(
    getCompositionSwitchDirection(currentActiveId, newId, get().openCompositionIds),
  );

  const hasExistingClips = timelineStore.clips.length > 0;
  if (hasExistingClips && newId !== currentActiveId) {
    const targetComp = newId ? compositions.find((c) => c.id === newId) : null;
    timelineStore.setCompositionSwitchSourceTracks(timelineStore.tracks);
    timelineStore.setCompositionSwitchTargetTracks(targetComp?.timelineData?.tracks ?? null);
    timelineStore.setClipAnimationPhase('exiting');

    setTimeout(async () => {
      await finishCompositionSwitch(set, get, newId, savedCompId, syncedPlayhead, options);
    }, 175);
  } else {
    timelineStore.setCompositionSwitchSourceTracks(null);
    timelineStore.setCompositionSwitchTargetTracks(null);
    finishCompositionSwitch(set, get, newId, savedCompId, syncedPlayhead, options);
  }
}

async function finishCompositionSwitch(
  set: MediaSliceSet,
  get: () => MediaState,
  newId: string | null,
  savedCompId: string | null,
  syncedPlayhead: number | null,
  options?: CompositionSwitchOptions,
): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const skipAnimation = options?.skipAnimation ?? false;
  const playFromStart = options?.playFromStart ?? false;
  const playStartTime = resolvePlayStartTime(options);

  set({ activeCompositionId: newId });

  if (newId) {
    if (playFromStart) {
      timelineStore.pause();
      timelineStore.setPlayheadPosition(playStartTime);
      resetPlaybackClockForCompositionStart(playStartTime);
    }

    const freshCompositions = get().compositions;
    const newComp = freshCompositions.find((c) => c.id === newId);
    await timelineStore.loadState(newComp?.timelineData);

    if (playFromStart) {
      timelineStore.setPlayheadPosition(playStartTime);
      resetPlaybackClockForCompositionStart(playStartTime);
      timelineStore.play();
    } else if (syncedPlayhead !== null && syncedPlayhead >= 0) {
      timelineStore.setPlayheadPosition(syncedPlayhead);
    }

    if (savedCompId) {
      timelineStore.refreshCompClipNestedData(savedCompId);
    }

    if (skipAnimation) {
      timelineStore.setClipAnimationPhase('idle');
      timelineStore.setCompositionSwitchSourceTracks(null);
    } else {
      timelineStore.setClipAnimationPhase('entering');

      setTimeout(() => {
        timelineStore.setClipAnimationPhase('idle');
        timelineStore.setCompositionSwitchSourceTracks(null);
        timelineStore.setCompositionSwitchTargetTracks(null);
      }, 350);
    }
  } else {
    timelineStore.clearTimeline();
    timelineStore.setCompositionSwitchSourceTracks(null);
    timelineStore.setCompositionSwitchTargetTracks(null);
    timelineStore.setClipAnimationPhase('idle');
  }
}
