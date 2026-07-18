import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import { useDockStore } from '../../../../stores/dockStore';
import { useGuidedActionStore } from '../../../../stores/guidedActionStore';
import { useRenderTargetStore } from '../../../../stores/renderTargetStore';
import { layerPlaybackManager } from '../../../layerPlaybackManager';
import { layerBuilder } from '../../../layerBuilder';
import { projectFileService } from '../../../projectFileService';
import { tabId } from './presence';

export function collectDebugState(scope: string = 'all') {
  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();
  const dockState = useDockStore.getState();
  const guidedState = useGuidedActionStore.getState();
  const renderTargetState = useRenderTargetStore.getState();
  const activeLayers = Object.fromEntries(
    layerPlaybackManager.getActiveLayerIndices().map((layerIndex) => [
      layerIndex,
      layerPlaybackManager.getLayerPlaybackInfo(layerIndex),
    ]),
  );
  const activeComposition = mediaState.compositions.find((composition) => composition.id === mediaState.activeCompositionId);
  const activeCompositionTimeline = activeComposition?.timelineData;
  const persistedKeyframeCounts = (activeCompositionTimeline?.clips || [])
    .map((clip) => ({
      clipId: clip.id,
      count: Array.isArray(clip.keyframes) ? clip.keyframes.length : 0,
      properties: Array.from(new Set((clip.keyframes || []).map((keyframe) => keyframe.property))).sort(),
    }))
    .filter((entry) => entry.count > 0);

  const renderTargets = Array.from(renderTargetState.targets.values()).map((target) => ({
    id: target.id,
    name: target.name,
    source: target.source,
    enabled: target.enabled,
    destinationType: target.destinationType,
    hasCanvas: !!target.canvas,
    hasWindow: !!target.window,
    showTransparencyGrid: target.showTransparencyGrid,
  }));

  const keyframeCounts = Array.from(timelineState.clipKeyframes.entries()).map(([clipId, keyframes]) => ({
    clipId,
    count: keyframes.length,
    properties: Array.from(new Set(keyframes.map((keyframe) => keyframe.property))).sort(),
  }));

  let builtLayers: Array<{
    id: string;
    name: string;
    sourceType: string | null;
    sourceClipId?: string;
    is3D: boolean;
    hasNestedComposition: boolean;
    modelUrl?: string;
    modelFileName?: string;
    modelMediaFileId?: string;
    hasModelFile?: boolean;
  }> = [];

  if (scope === 'all' || scope === 'preview') {
    try {
      builtLayers = layerBuilder.buildLayersFromStore()
        .filter((layer): layer is NonNullable<typeof layer> => layer != null)
        .map((layer) => ({
          id: layer.id,
          name: layer.name,
          sourceType: layer.source?.type ?? null,
          sourceClipId: layer.sourceClipId,
          is3D: layer.is3D === true,
          hasNestedComposition: !!layer.source?.nestedComposition,
          ...(layer.source?.type === 'model'
            ? {
                modelUrl: layer.source.modelUrl,
                modelFileName: layer.source.modelFileName,
                modelMediaFileId: layer.source.mediaFileId,
                hasModelFile: layer.source.file instanceof File,
              }
            : {}),
        }));
    } catch (error) {
      builtLayers = [{
        id: '__error__',
        name: error instanceof Error ? error.message : String(error),
        sourceType: 'error',
        is3D: false,
        hasNestedComposition: false,
      }];
    }
  }

  return {
    scope,
    capturedAt: new Date().toISOString(),
    tabId,
    timeline: {
      playheadPosition: timelineState.playheadPosition,
      isPlaying: timelineState.isPlaying,
      slotGridProgress: timelineState.slotGridProgress,
      selectedClipIds: Array.from(timelineState.selectedClipIds),
      primarySelectedClipId: timelineState.primarySelectedClipId,
      clipCount: timelineState.clips.length,
      keyframeClipCount: timelineState.clipKeyframes.size,
      keyframeCounts,
    },
    media: {
      activeCompositionId: mediaState.activeCompositionId,
      previewCompositionId: mediaState.previewCompositionId,
      selectedSlotCompositionId: mediaState.selectedSlotCompositionId,
      activeLayerSlots: mediaState.activeLayerSlots,
      slotAssignments: mediaState.slotAssignments,
      slotClipSettings: mediaState.slotClipSettings,
      openCompositionIds: mediaState.openCompositionIds,
      activeCompositionPersistedKeyframeClipCount: persistedKeyframeCounts.length,
      activeCompositionPersistedKeyframeCounts: persistedKeyframeCounts,
    },
    project: {
      isOpen: projectFileService.isProjectOpen(),
      hasUnsavedChanges: projectFileService.hasUnsavedChanges(),
    },
    guided: {
      activeSession: guidedState.activeSession
        ? {
            id: guidedState.activeSession.id,
            status: guidedState.activeSession.status,
            label: guidedState.activeSession.label,
            playbackMode: guidedState.activeSession.context.playbackMode,
            visualizationMode: guidedState.activeSession.context.visualizationMode,
            inputLockMode: guidedState.activeSession.context.inputLock.mode,
            plannedDurationMs: guidedState.activeSession.plan.diagnostics.plannedDurationMs,
            actionCount: guidedState.activeSession.plan.diagnostics.actionCount,
          }
        : null,
      currentStep: guidedState.currentStep
        ? {
            index: guidedState.currentStep.index,
            type: guidedState.currentStep.action.type,
            family: guidedState.currentStep.family,
            label: guidedState.currentStep.action.label,
            startsAtMs: guidedState.currentStep.startsAtMs,
            plannedDurationMs: guidedState.currentStep.plannedDurationMs,
          }
        : null,
      diagnosticCount: guidedState.diagnostics.length,
      recentDiagnostics: guidedState.diagnostics.slice(-5),
      eventCount: guidedState.eventLog.length,
    },
    layerPlayback: activeLayers,
    builtLayers,
    renderTargets,
    dock: {
      activePanelTypes: dockState.layout.root
        ? dockState.layout.root.kind === 'tab-group'
          ? dockState.layout.root.panels.map((panel) => panel.type)
          : []
        : [],
    },
  };
}
