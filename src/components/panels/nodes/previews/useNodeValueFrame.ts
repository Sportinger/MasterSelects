import { useCallback, useSyncExternalStore } from 'react';
import { previewTextStore } from '../../../../services/nodePreview/previewTextStore';

export function useNodeValueFrame(key: string) {
  const subscribe = useCallback((listener: () => void) => previewTextStore.subscribe(key, listener), [key]);
  const snapshot = useCallback(() => previewTextStore.get(key), [key]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
