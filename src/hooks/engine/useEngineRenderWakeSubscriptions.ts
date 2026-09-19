import { useEffect } from 'react';
import { compositionRenderer } from '../../services/compositionRenderer';
import { layerBuilder } from '../../services/layerBuilder';
import { renderHostPort } from '../../services/render/renderHostPort';
import { hasTimelineVisualRenderDemand } from '../../services/timeline/timelineVisualDemand';
import { useMediaStore } from '../../stores/mediaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimelineStore } from '../../stores/timeline';
import { hasCompositionSourceTopologyChanged } from './compositionSourceTopology';

export function useEngineRenderWakeSubscriptions(isEngineReady: boolean): void {
  const activeCompositionId = useMediaStore((state) => state.activeCompositionId);

  useEffect(() => {
    if (!isEngineReady) return;

    let compositionSourceRebindTimer: ReturnType<typeof setTimeout> | null = null;
    let compositionSourceRebindQueue = Promise.resolve();

    const scheduleCompositionSourceRebind = () => {
      if (compositionSourceRebindTimer !== null) {
        clearTimeout(compositionSourceRebindTimer);
      }
      compositionSourceRebindTimer = setTimeout(() => {
        compositionSourceRebindTimer = null;
        compositionSourceRebindQueue = compositionSourceRebindQueue
          .then(async () => {
            if (!activeCompositionId) return;
            compositionRenderer.invalidateCompositionAndParents(activeCompositionId);
            await compositionRenderer.prepareComposition(activeCompositionId);
            renderHostPort.requestRender();
          });
      }, 0);
    };

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
        if (!timelineState.isPlaying || timelineState.isDraggingPlayhead) {
          renderHostPort.requestRender();
        }
        if (!hasVisualDemand && timelineState.isDraggingPlayhead) {
          layerBuilder.syncAudioElements();
        }
      }
    );

    const unsubClips = useTimelineStore.subscribe(
      (state) => state.clips,
      (clips, previousClips) => {
        if (hasCompositionSourceTopologyChanged(previousClips, clips)) {
          scheduleCompositionSourceRebind();
        }
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

    const unsubLayerTransformPreview = useTimelineStore.subscribe(
      (state) => state.layerTransformPreview,
      () => renderHostPort.requestRender()
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
      if (compositionSourceRebindTimer !== null) {
        clearTimeout(compositionSourceRebindTimer);
      }
      unsubPlayhead();
      unsubClips();
      unsubTracks();
      unsubLayers();
      unsubClipDragPreview();
      unsubLayerTransformPreview();
      unsubSettings();
      unsubActiveComp();
      unsubLayerSlots();
      unsubSlotGridProgress();
      unsubLayerOpacities();
    };
  }, [activeCompositionId, isEngineReady]);
}
