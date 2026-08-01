import type { StateCreator, StoreApi } from 'zustand';

import type { TimelineStore } from './types';
import { assertExclusiveTimelineMutationAllowed } from './exclusiveMutationLease';

const WATCHED_TIMELINE_KEYS = [
  'clips',
  'tracks',
  'clipKeyframes',
  'markers',
  'masterAudioState',
  'duration',
  'durationLocked',
  'inPoint',
  'outPoint',
  'tempoMap',
  'rulerLanes',
  'videoBakeRegions',
] as const satisfies readonly (keyof TimelineStore)[];

// Derived from historyStore/snapshotCapture.ts. These keys must be protected
// even when they intentionally do not advance the durable timeline revision
// (selection and viewport state are restored by project history as well).
const HISTORY_SNAPSHOT_TIMELINE_KEYS = [
  'duration',
  'durationLocked',
  'tracks',
  'clips',
  'selectedClipIds',
  'selectedKeyframeIds',
  'zoom',
  'scrollX',
  'layers',
  'selectedLayerId',
  'clipKeyframes',
  'markers',
  'tempoMap',
  'masterAudioState',
] as const satisfies readonly (keyof TimelineStore)[];

type TimelineStatePatch = TimelineStore | Partial<TimelineStore>;
type TimelineStateUpdate =
  | TimelineStatePatch
  | ((state: TimelineStore) => TimelineStatePatch);

// Re-evaluating this module under HMR can reset the store's revision epoch.
// That is acceptable for now: monotonicity is session-scoped, and the agent
// kernel re-snapshots each run.
let readTimelineState: StoreApi<TimelineStore>['getState'] | null = null;

function hasOwnKey(patch: TimelineStatePatch, key: keyof TimelineStore): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function applyRevision(
  currentState: TimelineStore,
  patch: TimelineStatePatch,
  replace: boolean,
): TimelineStatePatch {
  const watchedStateChanged = WATCHED_TIMELINE_KEYS.some(
    (key) => (replace || hasOwnKey(patch, key))
      && !Object.is(currentState[key], patch[key]),
  );

  const historySnapshotStateChanged = HISTORY_SNAPSHOT_TIMELINE_KEYS.some(
    (key) => (replace || hasOwnKey(patch, key))
      && !Object.is(currentState[key], patch[key]),
  );

  if (watchedStateChanged || historySnapshotStateChanged) {
    assertExclusiveTimelineMutationAllowed();
  }

  return {
    ...patch,
    // The revision is store-owned: state loads and composition switches may
    // supply an older value, but stale-plan detection requires monotonicity
    // for the lifetime of this store session.
    timelineRevision: watchedStateChanged
      ? currentState.timelineRevision + 1
      : currentState.timelineRevision,
  };
}

/**
 * Increments timelineRevision once for each set call that changes the identity
 * of durable timeline edit state. Transition state is embedded in clips; there
 * is no separate top-level transitions key in TimelineStore.
 */
export const withTimelineRevision = (
  initializer: StateCreator<TimelineStore>,
): StateCreator<TimelineStore> => (set, get, store) => {
  const setWithTimelineRevision = (
    update: TimelineStateUpdate,
    replace = false,
  ): void => {
    const currentState = get();
    if (typeof update !== 'function') {
      const hasWatchedKey = WATCHED_TIMELINE_KEYS.some((key) => hasOwnKey(update, key));
      const hasHistorySnapshotKey = HISTORY_SNAPSHOT_TIMELINE_KEYS.some(
        (key) => hasOwnKey(update, key),
      );
      const suppliesRevision = hasOwnKey(update, 'timelineRevision');
      if (!replace && !hasWatchedKey && !hasHistorySnapshotKey && !suppliesRevision) {
        set(update);
        return;
      }
    }

    const patch = typeof update === 'function' ? update(currentState) : update;
    const revisedPatch = applyRevision(currentState, patch, replace);

    if (replace) {
      set(revisedPatch as TimelineStore, true);
      return;
    }
    set(revisedPatch);
  };

  // Zustand models setState with overloads for merge and replace. This adapter
  // implements both branches above; the casts retain those overloads without
  // weakening the implementation to `any`.
  const revisionSetState = setWithTimelineRevision as StoreApi<TimelineStore>['setState'];
  store.setState = revisionSetState;
  readTimelineState = store.getState;

  return initializer(revisionSetState, get, store);
};

export function getTimelineRevision(): number {
  return readTimelineState?.().timelineRevision ?? 0;
}
