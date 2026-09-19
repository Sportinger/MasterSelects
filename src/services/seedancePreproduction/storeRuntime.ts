import { useMediaStore } from '../../stores/mediaStore';
import { useSeedancePreproductionStore } from '../../stores/seedancePreproductionStore';
import { useTimelineStore } from '../../stores/timeline';

/** Imperative store boundary for the long-running Story workflow. */
export function readSeedanceMediaStore(): ReturnType<typeof useMediaStore.getState> {
  return useMediaStore.getState();
}

export function readSeedancePreproductionStore(): ReturnType<typeof useSeedancePreproductionStore.getState> {
  return useSeedancePreproductionStore.getState();
}

export function readSeedanceTimelineStore(): ReturnType<typeof useTimelineStore.getState> {
  return useTimelineStore.getState();
}

export function subscribeSeedanceTimelineStore(
  listener: Parameters<typeof useTimelineStore.subscribe>[0],
): () => void {
  return useTimelineStore.subscribe(listener);
}
