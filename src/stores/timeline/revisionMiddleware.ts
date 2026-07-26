import type { StateCreator, StoreApi } from 'zustand';

import type { TimelineStore } from './types';

const WATCHED_TIMELINE_KEYS = [
  'clips',
  'tracks',
  'clipKeyframes',
  'markers',
  'masterAudioState',
] as const satisfies readonly (keyof TimelineStore)[];

type TimelineStatePatch = TimelineStore | Partial<TimelineStore>;
type TimelineStateUpdate =
  | TimelineStatePatch
  | ((state: TimelineStore) => TimelineStatePatch);

let readTimelineState: StoreApi<TimelineStore>['getState'] | null = null;

function applyRevision(
  currentState: TimelineStore,
  patch: TimelineStatePatch,
  replace: boolean,
): TimelineStatePatch {
  const nextState = (replace ? patch : { ...currentState, ...patch }) as TimelineStore;
  const watchedStateChanged = WATCHED_TIMELINE_KEYS.some(
    (key) => !Object.is(currentState[key], nextState[key]),
  );

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
