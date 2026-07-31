import { clearAINodeRuntimeCache } from '../../services/nodeGraph';
import { stopTimelineAudioPlayback } from '../../services/audio/timelineAudioPlaybackStopper';
import { syncHistoryRehydratedTimelineRuntimeResources } from '../../services/timeline/historyRuntimeRehydration';
import type { Keyframe } from '../../types/keyframes';
import { createDefaultFlashBoardComposer } from '../flashboardStore/defaults';
import { createHistoryTimelineRestoreState } from '../timeline/historyTimelineRestoreState';
import type { HistoryStoreRefs, StateSnapshot, TimelineStoreState } from './historyStoreTypes';
import {
  cloneClipForHistory,
  cloneCompositionForHistory,
  cloneMasterAudioState,
  cloneMediaFileForHistory,
  cloneTrackForHistory,
  deepClone,
} from './snapshotCloning';
import { flashBoardMediaBridge } from '../../services/flashboard/FlashBoardMediaBridge';

export interface ApplyHistorySnapshotOptions {
  afterApply?: () => void;
  onTimelineEditStateRestored?: (diagnostics: unknown) => void;
}

export function applyHistorySnapshot(
  snapshot: StateSnapshot | null | undefined,
  refs: HistoryStoreRefs,
  options: ApplyHistorySnapshotOptions = {}
): void {
  if (!snapshot) return;

  // Apply timeline state (including layers)
  if (refs.setTimelineState && refs.getTimelineState) {
    const currentTimeline = refs.getTimelineState();
    let timelineState: Partial<TimelineStoreState>;

    if (snapshot.timelineEditState) {
      const restored = createHistoryTimelineRestoreState(snapshot.timelineEditState, currentTimeline);
      timelineState = restored.state;
      options.onTimelineEditStateRestored?.(restored.diagnostics);
    } else {
      // Preserve source references for layers (filter out undefined entries from snapshots)
      const restoredLayers = (snapshot.timeline.layers || []).filter(Boolean).map((layer) => {
        const currentLayer = (currentTimeline.layers || []).find((l) => l?.id === layer.id);
        return {
          ...deepClone(layer),
          source: currentLayer?.source || layer.source,
        };
      });

      // Convert plain object back to Map<string, Keyframe[]>
      const restoredKeyframes = new Map<string, Keyframe[]>();
      if (snapshot.timeline.clipKeyframes) {
        for (const [clipId, kfs] of Object.entries(snapshot.timeline.clipKeyframes)) {
          restoredKeyframes.set(clipId, deepClone(kfs));
        }
      }

      timelineState = {
        clips: snapshot.timeline.clips.map(cloneClipForHistory),
        tracks: snapshot.timeline.tracks.map(cloneTrackForHistory),
        selectedClipIds: new Set(snapshot.timeline.selectedClipIds || []),
        zoom: snapshot.timeline.zoom,
        scrollX: snapshot.timeline.scrollX,
        layers: restoredLayers,
        selectedLayerId: snapshot.timeline.selectedLayerId,
        clipKeyframes: restoredKeyframes,
        markers: deepClone(snapshot.timeline.markers || []),
      };

      // Absent on history entries captured before #299 — leave the live tempo
      // map alone rather than clobbering it with undefined.
      if (snapshot.timeline.tempoMap) {
        timelineState.tempoMap = deepClone(snapshot.timeline.tempoMap);
      }
    }

    if ('masterAudioState' in currentTimeline || snapshot.timeline.masterAudioState !== undefined) {
      timelineState.masterAudioState = snapshot.timelineEditState
        ? cloneMasterAudioState(snapshot.timelineEditState.timeline.masterAudioState)
        : cloneMasterAudioState(snapshot.timeline.masterAudioState);
    }

    stopTimelineAudioPlayback();
    clearAINodeRuntimeCache();
    refs.setTimelineState(timelineState);
    syncHistoryRehydratedTimelineRuntimeResources(timelineState.clips ?? []);
  }

  // Apply media state (preserve file references)
  if (refs.setMediaState && refs.getMediaState) {
    const currentMedia = refs.getMediaState();
    const restoredFiles = (snapshot.media.files || []).filter(Boolean).map((file) => {
      const currentFile = (currentMedia.files || []).find((f) => f?.id === file.id);
      const clonedFile = cloneMediaFileForHistory(file);
      return {
        ...clonedFile,
        file: currentFile?.file || file.file, // Preserve File reference
        url: currentFile?.url || clonedFile.url || '',
        thumbnailUrl: currentFile?.thumbnailUrl || clonedFile.thumbnailUrl,
        proxyVideoUrl: currentFile?.proxyVideoUrl || clonedFile.proxyVideoUrl,
      };
    });

    refs.setMediaState({
      files: restoredFiles,
      compositions: snapshot.media.compositions.map(cloneCompositionForHistory),
      folders: deepClone(snapshot.media.folders),
      selectedIds: [...snapshot.media.selectedIds],
      expandedFolderIds: [...snapshot.media.expandedFolderIds],
      textItems: deepClone(snapshot.media.textItems || []),
      solidItems: deepClone(snapshot.media.solidItems || []),
      mathSceneItems: deepClone(snapshot.media.mathSceneItems || []),
      motionShapeItems: deepClone(snapshot.media.motionShapeItems || []),
      signalAssets: deepClone(snapshot.media.signalAssets || []),
      signalArtifacts: deepClone(snapshot.media.signalArtifacts || []),
      signalGraphs: deepClone(snapshot.media.signalGraphs || []),
      signalOperators: deepClone(snapshot.media.signalOperators || []),
    });
  }

  // Apply dock state
  if (refs.setDockState && snapshot.dock.layout) {
    refs.setDockState({
      layout: deepClone(snapshot.dock.layout),
    });
  }

  if (refs.setFlashBoardState) {
    refs.setFlashBoardState({
      activeGenerationRecords: deepClone(snapshot.flashboard?.activeGenerationRecords || []),
      selectedActiveGenerationRecordIds: [],
      composer: deepClone(snapshot.flashboard?.composer || createDefaultFlashBoardComposer()),
    });
  }

  flashBoardMediaBridge.hydrateMetadata(
    deepClone(snapshot.flashboard?.generationMetadataByMediaId || {})
  );

  if (refs.setStoryboardState && snapshot.storyboard) {
    refs.setStoryboardState(deepClone(snapshot.storyboard));
  }

  if (refs.setExportState) {
    refs.setExportState(deepClone(snapshot.export));
  }

  // Rebuild the preview from the restored state. Without this, restoring deleted
  // clips (or any layer-affecting undo/redo) leaves the canvas showing the old
  // frame until the next interaction.
  options.afterApply?.();
}
