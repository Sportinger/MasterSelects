import {
  DEFAULT_TIMELINE_FRAME_RATE,
  sanitizeTimelineFrameRate,
} from '../../../utils/timelineFrameQuantization';

interface ActiveCompositionFrameRateState {
  activeCompositionId?: string | null;
  compositions: Array<{ id: string; frameRate?: number }>;
}

interface MediaStoreModule {
  useMediaStore: {
    getState: () => ActiveCompositionFrameRateState;
  };
}

export function getActiveCompositionFrameRate(): number {
  const mediaStoreModule = (globalThis as typeof globalThis & {
    __mediaStoreModule?: MediaStoreModule;
  }).__mediaStoreModule;
  const mediaState = mediaStoreModule?.useMediaStore.getState();
  const activeComposition = mediaState?.compositions.find(
    (composition) => composition.id === mediaState.activeCompositionId,
  );
  return sanitizeTimelineFrameRate(activeComposition?.frameRate ?? DEFAULT_TIMELINE_FRAME_RATE);
}
