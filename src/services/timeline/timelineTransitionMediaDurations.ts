import { useMediaStore } from '../../stores/mediaStore';
import { createTransitionMediaDurationResolver } from '../../stores/timeline/editOperations/transitionMediaDurationResolver';
import type { TransitionSourceDurationResolver } from '../../stores/timeline/editOperations/transitionPlanner';

export function createTimelineTransitionMediaDurationResolver(): TransitionSourceDurationResolver {
  return createTransitionMediaDurationResolver(useMediaStore.getState().files);
}
