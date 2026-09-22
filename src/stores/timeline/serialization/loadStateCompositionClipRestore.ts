import type { SerializableClip, TimelineClip, TimelineStore } from '../types';
import type { Keyframe } from '../../../types/keyframes';
import { clonePersistedClipAudioState } from '../../../services/audio/clipAudioStatePersistence';
import { Logger } from '../../../services/logger';
import { cloneClipNodeGraph } from '../../../services/nodeGraph';
import { normalizeTransitionInstanceParams } from '../../../transitions';
import { mediaNeedsRelink } from '../../../services/project/relinkMedia';
import type { useMediaStore } from '../../mediaStore';
import {
  calculateNestedClipBoundaries,
  loadNestedClips,
  scheduleNestedClipSegmentBuild,
} from '../nestedCompositionLoader';
import { restorePersistedClipVideoState } from '../nestedRestore';
import { createNestedContentHash } from '../clip/nestedCompositionContentHash';
import { beginNestedCompositionLoad, releaseStaleNestedCompositionClips } from '../nestedCompositionLoadGeneration';
import {
  canBatchGeneratedComposition,
  createLoadStateMissingNestedRuntimeSource,
  restoreNestedVideoSourceThumbnails,
} from './loadStateCompositionNestedRestore';

const log = Logger.create('Timeline');

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;
type TimelineSet = (partial: Partial<TimelineStore> | ((state: TimelineStore) => Partial<TimelineStore>)) => void;

export type RestoreLoadStateCompositionClipResult = 'not-handled' | 'handled' | 'stale';

export async function restoreLoadStateCompositionClip(params: {
  serializedClip: SerializableClip;
  mediaStore: MediaStoreState;
  get: () => TimelineStore;
  set: TimelineSet;
  pushRestoredClip: (clip: TimelineClip) => void;
  flushRestoredClipBuffer: () => void;
  patchRestoredClip?: (clipId: string, updater: (clip: TimelineClip) => TimelineClip) => boolean;
  pushRestoredNestedKeyframes?: (keyframes: ReadonlyMap<string, Keyframe[]>) => void;
  isCurrentTimelineSession: () => boolean;
  wakePreviewAfterRestore: () => void;
  restoreSourceThumbnails: (mediaFileId: string | undefined) => void;
}): Promise<RestoreLoadStateCompositionClipResult> {
  const {
    serializedClip,
    mediaStore,
    get,
    set,
    pushRestoredClip,
    flushRestoredClipBuffer,
    patchRestoredClip,
    pushRestoredNestedKeyframes,
    isCurrentTimelineSession: isCurrentSession,
    wakePreviewAfterRestore,
    restoreSourceThumbnails,
  } = params;

  if (!serializedClip.isComposition || !serializedClip.compositionId) {
    return 'not-handled';
  }

  const composition = mediaStore.compositions.find(c => c.id === serializedClip.compositionId);
  if (!composition) {
    log.warn('Could not find composition for clip', { clip: serializedClip.name });
    return 'handled';
  }

  const compDuration = composition.timelineData?.duration ?? composition.duration;
  const nestedContentHash = createNestedContentHash(composition.timelineData, mediaStore.compositions);
  const isLatestLoad = beginNestedCompositionLoad(get, serializedClip.id);
  const isCurrentTimelineSession = () => isCurrentSession() && isLatestLoad();
  if (serializedClip.sourceType === 'audio') {
    pushRestoredClip({ ...createCompositionAudioClip(serializedClip, compDuration), nestedContentHash });
    return 'handled';
  }

  const compClip = { ...createCompositionVideoClip(serializedClip, compDuration), nestedContentHash };
  pushRestoredClip(compClip);
  const batchGenerated = !!patchRestoredClip
    && !!pushRestoredNestedKeyframes
    && canBatchGeneratedComposition(composition, mediaStore.compositions);
  if (!batchGenerated) flushRestoredClipBuffer();

  if (!composition.timelineData) {
    if (!isCurrentTimelineSession()) {
      return isCurrentSession() ? 'handled' : 'stale';
    }
    set(state => ({
      clips: state.clips.map(c =>
        c.id === compClip.id ? { ...c, isLoading: false } : c
      ),
    }));
    return 'handled';
  }

  const nestedTracks = composition.timelineData.tracks;
  log.info('Loading nested clips for comp', {
    compClipId: compClip.id,
    compositionId: composition.id,
    compositionName: composition.name,
    nestedClipCount: composition.timelineData.clips.length,
    nestedClips: composition.timelineData.clips.map((c: SerializableClip) => ({
      id: c.id,
      name: c.name,
      trackId: c.trackId,
      mediaFileId: c.mediaFileId,
      sourceType: c.sourceType,
    })),
    availableMediaFiles: mediaStore.files.map(f => ({ id: f.id, name: f.name, hasFile: !!f.file })),
  });

  const nestedClips = await loadNestedClips({
    compClipId: compClip.id,
    composition,
    get,
    set,
    getMediaState: () => mediaStore,
    depth: 1,
    isCurrentTimelineSession,
    restoreHooks: {
      runtimeReady: {
        invalidateCache: false,
        onReady: () => {
          wakePreviewAfterRestore();
        },
      },
      mediaRelink: {
        getNeedsReload: ({ mediaFile }) => mediaNeedsRelink(mediaFile),
        createMissingRuntimeSource: createLoadStateMissingNestedRuntimeSource,
      },
    },
    deferNestedKeyframeMerge: batchGenerated ? pushRestoredNestedKeyframes : undefined,
  });
  if (!isCurrentTimelineSession()) {
    releaseStaleNestedCompositionClips(nestedClips);
    // A newer installer only owns this clip. Continue restoring the remaining
    // project clips unless the entire timeline session was replaced.
    return isCurrentSession() ? 'handled' : 'stale';
  }
  restoreNestedVideoSourceThumbnails(nestedClips, restoreSourceThumbnails, mediaStore);

  const boundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);

  const finishClip = (clip: TimelineClip): TimelineClip => ({
    ...clip,
    nestedClips,
    nestedTracks,
    nestedClipBoundaries: boundaries,
    isLoading: false,
  });
  const remainedBuffered = batchGenerated && patchRestoredClip(compClip.id, finishClip);
  if (!remainedBuffered) {
    set(state => ({
      clips: state.clips.map(c => c.id === compClip.id ? finishClip(c) : c),
    }));
  }

  // Generated-only cards/shapes already expose names and clip boundaries.
  // Avoid scheduling hundreds of redundant nested raster-thumbnail jobs while
  // a large authored graphics sequence is still being restored.
  if (!batchGenerated) {
    scheduleNestedClipSegmentBuild({
      clipId: compClip.id,
      timelineData: composition.timelineData,
      compDuration,
      nestedClips,
      thumbnailsEnabled: get().thumbnailsEnabled,
      get,
      set,
      isCurrentTimelineSession,
      delayMs: 1000,
      logLabel: 'Built clip segments on project load',
    });
  }
  return 'handled';
}

function createCompositionAudioClip(serializedClip: SerializableClip, sourceDuration: number): TimelineClip {
  return {
    id: serializedClip.id,
    trackId: serializedClip.trackId,
    name: serializedClip.name,
    file: new File([], serializedClip.name),
    startTime: serializedClip.startTime,
    duration: serializedClip.duration,
    inPoint: serializedClip.inPoint,
    outPoint: serializedClip.outPoint,
    source: {
      type: 'audio',
      naturalDuration: sourceDuration,
    },
    linkedClipId: serializedClip.linkedClipId,
    parentClipId: serializedClip.parentClipId,
    videoState: restorePersistedClipVideoState(serializedClip),
    audioState: clonePersistedClipAudioState(serializedClip.audioState),
    waveform: serializedClip.waveform || [],
    waveformChannels: serializedClip.waveformChannels,
    transform: serializedClip.transform,
    videoInspectorSections: serializedClip.videoInspectorSections
      ? { ...serializedClip.videoInspectorSections }
      : undefined,
    effects: serializedClip.effects || [],
    transitionIn: serializedClip.transitionIn ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionIn)) : undefined,
    transitionOut: serializedClip.transitionOut ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionOut)) : undefined,
    transitionSourceMap: serializedClip.transitionSourceMap ? structuredClone(serializedClip.transitionSourceMap) : undefined,
    transitionRecipeBlendWindows: serializedClip.transitionRecipeBlendWindows ? structuredClone(serializedClip.transitionRecipeBlendWindows) : undefined,
    colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
    colorGradeMode: serializedClip.colorGradeMode,
    localColorCorrection: serializedClip.localColorCorrection
      ? structuredClone(serializedClip.localColorCorrection)
      : undefined,
    sceneGraphOutput: serializedClip.sceneGraphOutput,
    nodeGraph: cloneClipNodeGraph(serializedClip.nodeGraph),
    isLoading: false,
    isComposition: true,
    compositionId: serializedClip.compositionId,
    speed: serializedClip.speed,
    preservesPitch: serializedClip.preservesPitch,
    followsLinkedVideoSpeed: serializedClip.followsLinkedVideoSpeed,
    mixdownGenerating: false,
    hasMixdownAudio: false,
  };
}

function createCompositionVideoClip(serializedClip: SerializableClip, sourceDuration: number): TimelineClip {
  return {
    id: serializedClip.id,
    trackId: serializedClip.trackId,
    name: serializedClip.name,
    file: new File([], serializedClip.name),
    startTime: serializedClip.startTime,
    duration: serializedClip.duration,
    inPoint: serializedClip.inPoint,
    outPoint: serializedClip.outPoint,
    source: {
      type: 'video',
      naturalDuration: sourceDuration,
    },
    thumbnails: serializedClip.thumbnails,
    linkedClipId: serializedClip.linkedClipId,
    parentClipId: serializedClip.parentClipId,
    videoState: restorePersistedClipVideoState(serializedClip),
    audioState: clonePersistedClipAudioState(serializedClip.audioState),
    transform: serializedClip.transform,
    videoInspectorSections: serializedClip.videoInspectorSections
      ? { ...serializedClip.videoInspectorSections }
      : undefined,
    effects: serializedClip.effects || [],
    transitionIn: serializedClip.transitionIn ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionIn)) : undefined,
    transitionOut: serializedClip.transitionOut ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionOut)) : undefined,
    transitionSourceMap: serializedClip.transitionSourceMap ? structuredClone(serializedClip.transitionSourceMap) : undefined,
    transitionRecipeBlendWindows: serializedClip.transitionRecipeBlendWindows ? structuredClone(serializedClip.transitionRecipeBlendWindows) : undefined,
    colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
    colorGradeMode: serializedClip.colorGradeMode,
    localColorCorrection: serializedClip.localColorCorrection
      ? structuredClone(serializedClip.localColorCorrection)
      : undefined,
    sceneGraphOutput: serializedClip.sceneGraphOutput,
    nodeGraph: cloneClipNodeGraph(serializedClip.nodeGraph),
    masks: serializedClip.masks || [],
    isLoading: true,
    isComposition: true,
    compositionId: serializedClip.compositionId,
    terrainAttachment: serializedClip.terrainAttachment ? structuredClone(serializedClip.terrainAttachment) : undefined,
    terrainScreenAnchor: serializedClip.terrainScreenAnchor ? structuredClone(serializedClip.terrainScreenAnchor) : undefined,
    terrainAnchorConnector: serializedClip.terrainAnchorConnector ? structuredClone(serializedClip.terrainAnchorConnector) : undefined,
    trackingBinding: serializedClip.trackingBinding ? structuredClone(serializedClip.trackingBinding) : undefined,
    nestedClips: [],
    nestedTracks: [],
    speed: serializedClip.speed,
    preservesPitch: serializedClip.preservesPitch,
    followsLinkedVideoSpeed: serializedClip.followsLinkedVideoSpeed,
  };
}
