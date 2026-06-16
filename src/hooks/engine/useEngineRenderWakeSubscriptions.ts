import { useEffect } from 'react';
import { layerBuilder } from '../../services/layerBuilder';
import { renderHostPort } from '../../services/render/renderHostPort';
import { hasTimelineVisualRenderDemand } from '../../services/timeline/timelineVisualDemand';
import { useMediaStore } from '../../stores/mediaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimelineStore } from '../../stores/timeline';

export function useEngineRenderWakeSubscriptions(isEngineReady: boolean): void {
  useEffect(() => {
    if (!isEngineReady) return;

    const unsubPlayhead = useTimelineStore.subscribe(
      (state) => state.playheadPosition,
      (playheadPosition) => {
        const timelineState = useTimelineStore.getState();
        const hasVisualDemand = hasTimelineVisualRenderDemand({
          clips: timelineState.clips,
          tracks: timelineState.tracks,
          playheadPosition,
          clipDragPreview: timelineState.clipDragPreview,
        });
        renderHostPort.requestRender();
        if (!hasVisualDemand && timelineState.isDraggingPlayhead) {
          layerBuilder.syncAudioElements();
        }
      }
    );

    const unsubClips = useTimelineStore.subscribe(
      (state) => state.clips,
      () => {
        if (!useTimelineStore.getState().maskDragging) {
          renderHostPort.requestRender();
        }
      }
    );

    const unsubTracks = useTimelineStore.subscribe(
      (state) => state.tracks,
      () => renderHostPort.requestRender()
    );

    const unsubLayers = useTimelineStore.subscribe(
      (state) => state.layers,
      () => renderHostPort.requestRender()
    );

    const unsubClipDragPreview = useTimelineStore.subscribe(
      (state) => state.clipDragPreview,
      (clipDragPreview) => {
        const timelineState = useTimelineStore.getState();
        if (!hasTimelineVisualRenderDemand({
          clips: timelineState.clips,
          tracks: timelineState.tracks,
          playheadPosition: timelineState.playheadPosition,
          clipDragPreview,
        })) {
          return;
        }
        layerBuilder.invalidateCache();
        renderHostPort.requestRender();
      }
    );

    const unsubSettings = useSettingsStore.subscribe(
      (state) => state.previewQuality,
      () => renderHostPort.requestRender()
    );

    const unsubActiveComp = useMediaStore.subscribe(
      (state) => state.activeCompositionId,
      () => renderHostPort.requestRender()
    );

    const unsubLayerSlots = useMediaStore.subscribe(
      (state) => state.activeLayerSlots,
      () => renderHostPort.requestRender()
    );

    const unsubSlotGridProgress = useTimelineStore.subscribe(
      (state) => state.slotGridProgress,
      () => renderHostPort.requestRender()
    );

    const unsubLayerOpacities = useMediaStore.subscribe(
      (state) => state.layerOpacities,
      () => renderHostPort.requestRender()
    );

    return () => {
      unsubPlayhead();
      unsubClips();
      unsubTracks();
      unsubLayers();
      unsubClipDragPreview();
      unsubSettings();
      unsubActiveComp();
      unsubLayerSlots();
      unsubSlotGridProgress();
      unsubLayerOpacities();
    };
  }, [isEngineReady]);
}
