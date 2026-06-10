import { useEffect } from 'react';
import { engine } from '../../engine/WebGPUEngine';
import { layerBuilder } from '../../services/layerBuilder';
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
        if (hasTimelineVisualRenderDemand({
          clips: timelineState.clips,
          tracks: timelineState.tracks,
          playheadPosition,
          clipDragPreview: timelineState.clipDragPreview,
        })) {
          engine.requestRender();
        } else if (timelineState.isDraggingPlayhead) {
          layerBuilder.syncAudioElements();
        }
      }
    );

    const unsubClips = useTimelineStore.subscribe(
      (state) => state.clips,
      () => {
        if (!useTimelineStore.getState().maskDragging) {
          engine.requestRender();
        }
      }
    );

    const unsubTracks = useTimelineStore.subscribe(
      (state) => state.tracks,
      () => engine.requestRender()
    );

    const unsubLayers = useTimelineStore.subscribe(
      (state) => state.layers,
      () => engine.requestRender()
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
        engine.requestRender();
      }
    );

    const unsubSettings = useSettingsStore.subscribe(
      (state) => state.previewQuality,
      () => engine.requestRender()
    );

    const unsubActiveComp = useMediaStore.subscribe(
      (state) => state.activeCompositionId,
      () => engine.requestRender()
    );

    const unsubLayerSlots = useMediaStore.subscribe(
      (state) => state.activeLayerSlots,
      () => engine.requestRender()
    );

    const unsubSlotGridProgress = useTimelineStore.subscribe(
      (state) => state.slotGridProgress,
      () => engine.requestRender()
    );

    const unsubLayerOpacities = useMediaStore.subscribe(
      (state) => state.layerOpacities,
      () => engine.requestRender()
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
