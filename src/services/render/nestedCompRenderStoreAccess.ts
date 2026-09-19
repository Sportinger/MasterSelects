import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';

export function isActiveNestedComposition(compositionId: string): boolean {
  return useMediaStore.getState().activeCompositionId === compositionId;
}

export function isTimelinePlayheadDragging(): boolean {
  return useTimelineStore.getState().isDraggingPlayhead;
}
