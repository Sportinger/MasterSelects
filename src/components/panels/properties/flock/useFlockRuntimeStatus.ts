import { useSyncExternalStore } from 'react';
import { flockRuntime, type FlockRuntimeStatus } from '../../../../engine/flock/runtime/flockRuntimeApi';

/** Bounded runtime status snapshot for one flock clip; re-renders on runtime publishes. */
export function useFlockRuntimeStatus(clipId: string): FlockRuntimeStatus | null {
  return useSyncExternalStore(
    (listener) => flockRuntime.subscribe(listener),
    () => flockRuntime.getStatus(clipId),
    () => null,
  );
}
