import { flashBoardMediaBridge } from '../../services/flashboard/FlashBoardMediaBridge';
import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import { createDefaultFlashBoardComposer } from '../flashboardStore/defaults';
import { createDefaultExportStoreData, getExportStoreData } from '../exportStore';
import {
  createHistoryTimelineEditState,
  type HistoryTimelineEditState,
} from '../timeline/historyTimelineEditState';
import { createHistoryTimelineRestoreState } from '../timeline/historyTimelineRestoreState';
import type { HistoryStoreRefs, StateSnapshot } from './historyStoreTypes';
import {
  cloneClipForHistory,
  cloneCompositionForHistory,
  cloneMasterAudioState,
  cloneMediaFileForHistory,
  cloneTrackForHistory,
  deepClone,
} from './snapshotCloning';

function cloneClipWithoutSourceArtifacts(clip: TimelineClip): TimelineClip {
  const {
    analysis: _analysis,
    sceneDescriptions: _sceneDescriptions,
    transcript: _transcript,
    ...clipState
  } = clip;
  return cloneClipForHistory(clipState as TimelineClip);
}

function createTimelineSnapshot(refs: HistoryStoreRefs): StateSnapshot['timeline'] {
  const timeline = refs.getTimelineState?.() || null;

  const keyframesObj: Record<string, Keyframe[]> = {};
  if (timeline?.clipKeyframes instanceof Map) {
    timeline.clipKeyframes.forEach((kfs: Keyframe[], clipId: string) => {
      keyframesObj[clipId] = deepClone(kfs);
    });
  }

  return {
    clips: (timeline?.clips || []).map(cloneClipForHistory),
    tracks: (timeline?.tracks || []).map(cloneTrackForHistory),
    selectedClipIds: timeline?.selectedClipIds ? [...timeline.selectedClipIds] : [],
    selectedKeyframeIds: timeline?.selectedKeyframeIds
      ? [...timeline.selectedKeyframeIds]
      : [],
    zoom: timeline?.zoom || 50,
    scrollX: timeline?.scrollX || 0,
    layers: deepClone((timeline?.layers || []).filter(Boolean)),
    selectedLayerId: timeline?.selectedLayerId || null,
    clipKeyframes: keyframesObj,
    markers: deepClone(timeline?.markers || []),
    tempoMap: deepClone(timeline?.tempoMap),
    masterAudioState: cloneMasterAudioState(timeline?.masterAudioState),
  };
}

function createTimelineEditStateSnapshot(
  refs: HistoryStoreRefs,
  label: string,
  timestamp: number,
): HistoryTimelineEditState | undefined {
  const timeline = refs.getTimelineState?.() || null;
  if (!timeline) return undefined;

  return createHistoryTimelineEditState({
    id: `history:${timestamp}:${label}`,
    label,
    timestamp,
    duration: timeline.duration,
    durationLocked: timeline.durationLocked,
    tracks: timeline.tracks || [],
    clips: timeline.clips || [],
    selectedClipIds: timeline.selectedClipIds || new Set<string>(),
    zoom: timeline.zoom || 50,
    scrollX: timeline.scrollX || 0,
    layers: (timeline.layers || []).filter(Boolean),
    selectedLayerId: timeline.selectedLayerId || null,
    clipKeyframes: timeline.clipKeyframes,
    markers: timeline.markers || [],
    tempoMap: timeline.tempoMap,
    masterAudioState: timeline.masterAudioState,
  });
}

function createTimelineSnapshotFromEditState(
  timelineEditState: HistoryTimelineEditState,
  selectedKeyframeIds: ReadonlySet<string> | undefined,
): StateSnapshot['timeline'] {
  const restored = createHistoryTimelineRestoreState(timelineEditState, {}, {
    placeholderFileMode: 'plain-data',
  }).state;
  return {
    // Source intelligence is owned once by snapshot.media.files and by the
    // media-scoped project artifacts. The v2 timeline edit state already
    // restores those projections by mediaFileId, so the compatibility
    // timeline must not multiply them across every split clip.
    clips: restored.clips.map(cloneClipWithoutSourceArtifacts),
    tracks: restored.tracks.map(cloneTrackForHistory),
    selectedClipIds: [...restored.selectedClipIds],
    selectedKeyframeIds: selectedKeyframeIds ? [...selectedKeyframeIds] : [],
    zoom: restored.zoom,
    scrollX: restored.scrollX,
    layers: deepClone(restored.layers),
    selectedLayerId: restored.selectedLayerId,
    clipKeyframes: Object.fromEntries(
      Array.from(restored.clipKeyframes.entries()).map(([clipId, keyframes]) => [
        clipId,
        deepClone(keyframes),
      ])
    ),
    markers: deepClone(restored.markers),
    tempoMap: deepClone(restored.tempoMap),
    masterAudioState: cloneMasterAudioState(restored.masterAudioState),
  };
}

function createMediaSnapshot(refs: HistoryStoreRefs): StateSnapshot['media'] {
  const media = refs.getMediaState?.() || null;

  return {
    files: (media?.files || []).map(cloneMediaFileForHistory),
    compositions: (media?.compositions || []).map(cloneCompositionForHistory),
    folders: deepClone(media?.folders || []),
    selectedIds: [...(media?.selectedIds || [])],
    expandedFolderIds: [...(media?.expandedFolderIds || [])],
    textItems: deepClone(media?.textItems || []),
    solidItems: deepClone(media?.solidItems || []),
    mathSceneItems: deepClone(media?.mathSceneItems || []),
    motionShapeItems: deepClone(media?.motionShapeItems || []),
    signalAssets: deepClone(media?.signalAssets || []),
    signalArtifacts: deepClone(media?.signalArtifacts || []),
    signalGraphs: deepClone(media?.signalGraphs || []),
    signalOperators: deepClone(media?.signalOperators || []),
  };
}

function createDockSnapshot(refs: HistoryStoreRefs): StateSnapshot['dock'] {
  const dock = refs.getDockState?.();
  return {
    layout: deepClone(dock?.layout ?? null),
  };
}

function createFlashBoardSnapshot(refs: HistoryStoreRefs): StateSnapshot['flashboard'] {
  const flashboard = refs.getFlashBoardState?.() || {
    activeGenerationRecords: [],
    selectedActiveGenerationRecordIds: [],
    composer: createDefaultFlashBoardComposer(),
  };

  return {
    activeGenerationRecords: deepClone(flashboard.activeGenerationRecords || []),
    composer: deepClone(flashboard.composer || createDefaultFlashBoardComposer()),
    generationMetadataByMediaId: deepClone(flashBoardMediaBridge.serializeMetadata()),
  };
}

function createExportSnapshot(refs: HistoryStoreRefs): StateSnapshot['export'] {
  return deepClone(getExportStoreData(refs.getExportState?.() || createDefaultExportStoreData()));
}

function createStoryboardSnapshot(refs: HistoryStoreRefs): StateSnapshot['storyboard'] {
  const storyboard = refs.getStoryboardState?.();
  return storyboard ? deepClone(storyboard) : undefined;
}

export function createHistorySnapshot(
  label: string,
  refs: HistoryStoreRefs,
  _previousSnapshot?: StateSnapshot | null
): StateSnapshot {
  const timestamp = Date.now();
  const timeline = refs.getTimelineState?.() || null;
  const timelineEditState = createTimelineEditStateSnapshot(refs, label, timestamp);
  return {
    timestamp,
    label,
    timeline: timelineEditState
      ? createTimelineSnapshotFromEditState(timelineEditState, timeline?.selectedKeyframeIds)
      : createTimelineSnapshot(refs),
    timelineEditState,
    media: createMediaSnapshot(refs),
    dock: createDockSnapshot(refs),
    flashboard: createFlashBoardSnapshot(refs),
    storyboard: createStoryboardSnapshot(refs),
    export: createExportSnapshot(refs),
  };
}

export function createInitialHistorySnapshot(refs: HistoryStoreRefs): StateSnapshot | null {
  if (!refs.getTimelineState || !refs.getMediaState || !refs.getDockState) return null;
  return createHistorySnapshot('initial', refs);
}
