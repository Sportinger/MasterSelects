import { useCallback, useSyncExternalStore } from 'react';
import { flockRuntime, type FlockRuntimeStatus } from '../../../../engine/flock/runtime/flockRuntimeApi';

export function useFlockRuntimeStatus(clipId: string | null): FlockRuntimeStatus | null {
  const getSnapshot = useCallback(() => (clipId ? flockRuntime.getStatus(clipId) : null), [clipId]);
  return useSyncExternalStore(
    (listener) => flockRuntime.subscribe(listener),
    getSnapshot,
    getSnapshot,
  );
}

export const FLOCK_RUNTIME_STATE_LABELS: Record<FlockRuntimeStatus['state'], string> = {
  idle: 'Idle',
  compiling: 'Compiling',
  computing: 'Computing',
  ready: 'Ready',
  stale: 'Stale',
  invalid: 'Invalid graph',
  'missing-asset': 'Missing asset',
  unsupported: 'Unsupported',
};
