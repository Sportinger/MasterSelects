import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { getFlockSimulationRegistry } from '../../flock/runtime/FlockSimulationRegistry';
import type { NativeSceneHost } from './NativeSceneHost';

export const nativeSceneMainHost: NativeSceneHost = {
  flockRuntime: getFlockSimulationRegistry,
  isRealtime: () => {
    const state = useTimelineStore.getState();
    return state.isPlaying || state.isDraggingPlayhead;
  },
  sourceFingerprint: sourceId => {
    const media = useMediaStore.getState().files.find(file => file.id === sourceId);
    return media ? media.fileHash ?? '' : undefined;
  },
};
