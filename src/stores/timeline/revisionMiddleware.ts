import type { StateCreator, StoreApi } from 'zustand';

import type { TimelineClip } from '../../types/timeline';
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
let updateDerivedClips: ((updater: (clips: TimelineClip[]) => TimelineClip[]) => void) | null = null;
let restoreHostedAgentRevision: ((revision: number) => void) | null = null;

const DERIVED_CLIP_KEYS = new Set<keyof TimelineClip>([
  'analysis',
  'analysisProgress',
  'analysisStatus',
  'audioAnalysisJob',
  'faceAnalysisMessage',
  'faceAnalysisProgress',
  'faceAnalysisStatus',
  'sceneDescriptionMessage',
  'sceneDescriptionProgress',
  'sceneDescriptionStatus',
  'sceneDescriptions',
  'transcript',
  'transcriptMessage',
  'transcriptProgress',
  'transcriptStatus',
  'waveform',
  'waveformChannels',
  'waveformGenerating',
  'waveformProgress',
]);

const DERIVED_AUDIO_STATE_KEYS = new Set(['processedAnalysisRefs', 'sourceAnalysisRefs']);

function sameAudioEditState(
  before: TimelineClip['audioState'],
  after: TimelineClip['audioState'],
): boolean {
  if (Object.is(before, after)) return true;
  // Creating/removing an analysis-only container does not edit the audio.
  const previous = before ?? {};
  const next = after ?? {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (DERIVED_AUDIO_STATE_KEYS.has(key)) continue;
    if (!Object.is(
      (previous as Record<string, unknown>)[key],
      (next as Record<string, unknown>)[key],
    )) return false;
  }
  return true;
}

function assertDerivedClipUpdate(
  before: readonly TimelineClip[],
  after: readonly TimelineClip[],
): void {
  if (before.length !== after.length) {
    throw new Error('Derived timeline updates cannot add or remove clips.');
  }
  for (let index = 0; index < before.length; index += 1) {
    const previousClip = before[index];
    const nextClip = after[index];
    if (!previousClip || !nextClip || previousClip.id !== nextClip.id) {
      throw new Error('Derived timeline updates cannot reorder or replace clip identities.');
    }
    if (Object.is(previousClip, nextClip)) continue;
    const keys = new Set([
      ...Object.keys(previousClip),
      ...Object.keys(nextClip),
    ] as Array<keyof TimelineClip>);
    for (const key of keys) {
      if (DERIVED_CLIP_KEYS.has(key)) continue;
      if (key === 'audioState' && sameAudioEditState(previousClip.audioState, nextClip.audioState)) {
        continue;
      }
      if (!Object.is(previousClip[key], nextClip[key])) {
        throw new Error(`Derived timeline updates cannot change durable clip field "${String(key)}".`);
      }
    }
  }
}

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
  restoreHostedAgentRevision = (revision) => {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('The hosted-agent resume revision is invalid.');
    }
    // This uses Zustand's underlying setter intentionally. The caller first
    // proves that the reload-restored canonical timeline equals the persisted
    // in-flight timeline, so restoring the revision does not mutate content.
    set({ timelineRevision: revision });
  };
  updateDerivedClips = (updater) => {
    assertExclusiveTimelineMutationAllowed();
    const currentState = get();
    const clips = updater(currentState.clips);
    if (Object.is(clips, currentState.clips)) return;
    assertDerivedClipUpdate(currentState.clips, clips);
    set({ clips });
  };

  return initializer(revisionSetState, get, store);
};

export function getTimelineRevision(): number {
  return readTimelineState?.().timelineRevision ?? 0;
}

/**
 * Restores the exact revision of an in-flight Normal Path turn after a page reload.
 * Callers must first verify the canonical durable timeline state from the same
 * resume checkpoint; ordinary state loads must continue through the middleware.
 */
export function restoreTimelineRevisionForHostedAgentResume(revision: number): void {
  if (!restoreHostedAgentRevision) throw new Error('The timeline store is not initialized.');
  restoreHostedAgentRevision(revision);
}

/**
 * Projects source intelligence and runtime analysis onto existing clips without
 * invalidating structural edit plans. The update is fail-closed: clip identity,
 * timing, effects, transforms, audio edits, and every other durable field must
 * remain referentially unchanged.
 */
export function updateDerivedTimelineClips(
  updater: (clips: TimelineClip[]) => TimelineClip[],
): void {
  if (!updateDerivedClips) throw new Error('The timeline store is not initialized.');
  updateDerivedClips(updater);
}
