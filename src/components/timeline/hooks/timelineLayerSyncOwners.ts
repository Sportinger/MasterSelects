import { useEffect, useSyncExternalStore } from 'react';

// Counts mounted Timeline panels. Each one syncs render layers with its own
// clip-drag preview; without one, EditorPlaybackRuntimeHost syncs headlessly.
let ownerCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mark the calling Timeline as the owner of render-layer sync while mounted. */
export function useRegisterTimelineLayerSyncOwner(): void {
  useEffect(() => {
    ownerCount += 1;
    emit();
    return () => {
      ownerCount -= 1;
      emit();
    };
  }, []);
}

export function useTimelineLayerSyncOwnerMounted(): boolean {
  return useSyncExternalStore(subscribe, () => ownerCount > 0, () => false);
}
