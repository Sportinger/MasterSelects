import { useEffect } from 'react';
import { layerBuilder } from '../../services/layerBuilder';
import { renderHostPort } from '../../services/render/renderHostPort';
import { hasTimelineVisualRenderDemand } from '../../services/timeline/timelineVisualDemand';
import { useTimelineStore } from '../../stores/timeline';

export function useEngineTimelineStateSync(
  isEngineReady: boolean,
  isPlaying: boolean,
): void {
  useEffect(() => {
    if (!isEngineReady) return;
    const timelineState = useTimelineStore.getState();
    renderHostPort.setTimelineVisualDemand(hasTimelineVisualRenderDemand({
      clips: timelineState.clips,
      tracks: timelineState.tracks,
      playheadPosition: timelineState.playheadPosition,
      clipDragPreview: timelineState.clipDragPreview,
    }));
    renderHostPort.setIsPlaying(isPlaying);
  }, [isEngineReady, isPlaying]);

  useEffect(() => {
    if (!isEngineReady) return;
    const unsub = useTimelineStore.subscribe(
      (state) => state.isDraggingPlayhead,
      (isDragging) => {
        const timelineState = useTimelineStore.getState();
        const hasVisualDemand = hasTimelineVisualRenderDemand({
          clips: timelineState.clips,
          tracks: timelineState.tracks,
          playheadPosition: timelineState.playheadPosition,
          clipDragPreview: timelineState.clipDragPreview,
        });
        renderHostPort.setTimelineVisualDemand(hasVisualDemand);
        renderHostPort.setIsScrubbing(isDragging);
        if (!hasVisualDemand) {
          layerBuilder.syncAudioElements();
        }
      }
    );
    return unsub;
  }, [isEngineReady]);
}
