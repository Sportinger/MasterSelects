import type { SerializableClip, TimelineClip, TimelineStore } from '../types';
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
  type NestedMediaRestoreEvent,
} from '../nestedCompositionLoader';
import { restorePersistedClipVideoState } from '../nestedRestore';

const log = Logger.create('Timeline');

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;
type TimelineSet = (partial: Partial<TimelineStore> | ((state: TimelineStore) => Partial<TimelineStore>)) => void;

export type RestoreLoadStateCompositionClipResult = 'not-handled' | 'handled' | 'stale';

function createLoadStateMissingNestedRuntimeSource(event: NestedMediaRestoreEvent): TimelineClip['source'] | undefined {
  const { serializedClip, sourceType } = event;
  if (!sourceType) {
    return undefined;
  }

  return {
    type: sourceType as NonNullable<TimelineClip['source']>['type'],
    naturalDuration: serializedClip.naturalDuration || serializedClip.duration,
    mediaFileId: serializedClip.mediaFileId,
    threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
    ...(serializedClip.meshType ? { meshType: serializedClip.meshType } : {}),
    ...(serializedClip.text3DProperties ? { text3DProperties: { ...serializedClip.text3DProperties } } : {}),
  };
}

function restoreNestedVideoSourceThumbnails(
  nestedClips: readonly TimelineClip[],
  restoreSourceThumbnails: (mediaFileId: string | undefined) => void,
  mediaStore: MediaStoreState,
): void {
  for (const nestedClip of nestedClips) {
    const mediaFileId = nestedClip.source?.type === 'video'
      ? nestedClip.source.mediaFileId
      : undefined;
    if (mediaFileId && mediaStore.files.find(file => file.id === mediaFileId)?.file) {
      restoreSourceThumbnails(mediaFileId);
    }

    if (nestedClip.nestedClips?.length) {
      restoreNestedVideoSourceThumbnails(nestedClip.nestedClips, restoreSourceThumbnails, mediaStore);
    }
  }
}

export async function restoreLoadStateCompositionClip(params: {
  serializedClip: SerializableClip;
  mediaStore: MediaStoreState;
  get: () => TimelineStore;
  set: TimelineSet;
  pushRestoredClip: (clip: TimelineClip) => void;
  flushRestoredClipBuffer: () => void;
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
    isCurrentTimelineSession,
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

  if (serializedClip.sourceType === 'audio') {
    pushRestoredClip(createCompositionAudioClip(serializedClip));
    return 'handled';
  }

  const compClip = createCompositionVideoClip(serializedClip);
  pushRestoredClip(compClip);
  flushRestoredClipBuffer();

  if (!composition.timelineData) {
    if (!isCurrentTimelineSession()) {
      return 'stale';
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
  });
  restoreNestedVideoSourceThumbnails(nestedClips, restoreSourceThumbnails, mediaStore);

  const compDuration = composition.timelineData?.duration ?? composition.duration;
  const boundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);

  if (!isCurrentTimelineSession()) {
    return 'stale';
  }
  set(state => ({
    clips: state.clips.map(c =>
      c.id === compClip.id
        ? { ...c, nestedClips, nestedTracks, nestedClipBoundaries: boundaries, isLoading: false }
        : c
    ),
  }));

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
  return 'handled';
}

function createCompositionAudioClip(serializedClip: SerializableClip): TimelineClip {
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
      naturalDuration: serializedClip.naturalDuration || serializedClip.duration,
    },
    linkedClipId: serializedClip.linkedClipId,
    videoState: restorePersistedClipVideoState(serializedClip),
    audioState: clonePersistedClipAudioState(serializedClip.audioState),
    waveform: serializedClip.waveform || [],
    waveformChannels: serializedClip.waveformChannels,
    transform: serializedClip.transform,
    effects: serializedClip.effects || [],
    transitionIn: serializedClip.transitionIn ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionIn)) : undefined,
    transitionOut: serializedClip.transitionOut ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionOut)) : undefined,
    transitionSourceMap: serializedClip.transitionSourceMap ? structuredClone(serializedClip.transitionSourceMap) : undefined,
    transitionRecipeBlendWindows: serializedClip.transitionRecipeBlendWindows ? structuredClone(serializedClip.transitionRecipeBlendWindows) : undefined,
    colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
    nodeGraph: cloneClipNodeGraph(serializedClip.nodeGraph),
    isLoading: false,
    isComposition: true,
    compositionId: serializedClip.compositionId,
    speed: serializedClip.speed,
    preservesPitch: serializedClip.preservesPitch,
    mixdownGenerating: false,
    hasMixdownAudio: false,
  };
}

function createCompositionVideoClip(serializedClip: SerializableClip): TimelineClip {
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
      naturalDuration: serializedClip.duration,
    },
    thumbnails: serializedClip.thumbnails,
    linkedClipId: serializedClip.linkedClipId,
    videoState: restorePersistedClipVideoState(serializedClip),
    audioState: clonePersistedClipAudioState(serializedClip.audioState),
    transform: serializedClip.transform,
    effects: serializedClip.effects || [],
    transitionIn: serializedClip.transitionIn ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionIn)) : undefined,
    transitionOut: serializedClip.transitionOut ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionOut)) : undefined,
    transitionSourceMap: serializedClip.transitionSourceMap ? structuredClone(serializedClip.transitionSourceMap) : undefined,
    transitionRecipeBlendWindows: serializedClip.transitionRecipeBlendWindows ? structuredClone(serializedClip.transitionRecipeBlendWindows) : undefined,
    colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
    nodeGraph: cloneClipNodeGraph(serializedClip.nodeGraph),
    masks: serializedClip.masks || [],
    isLoading: true,
    isComposition: true,
    compositionId: serializedClip.compositionId,
    nestedClips: [],
    nestedTracks: [],
    speed: serializedClip.speed,
    preservesPitch: serializedClip.preservesPitch,
  };
}
