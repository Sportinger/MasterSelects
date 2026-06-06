// Timeline serialization utilities - save, load, clear
// Extracted from index.ts for maintainability

import type { SliceCreator, TimelineClip, TimelineTrack, TimelineUtils, Keyframe, CompositionTimelineData } from './types';
import type {
  SerializableClip,
  ClipAnalysis,
  FrameAnalysisData,
} from '../../types';
import { DEFAULT_TRACKS } from './constants';
import { useMediaStore } from '../mediaStore';
import {
  calculateNestedClipBoundaries,
  loadNestedClips,
  scheduleNestedClipSegmentBuild,
  type NestedMediaRestoreEvent,
} from './nestedCompositionLoader';
import { projectFileService } from '../../services/projectFileService';
import {
  createPrimaryMediaObjectUrl,
  getPrimaryMediaObjectUrlKey,
  mediaObjectUrlManager,
} from '../../services/project/mediaObjectUrlManager';
import { mediaNeedsRelink } from '../../services/project/relinkMedia';
import { Logger } from '../../services/logger';
import { engine } from '../../engine/WebGPUEngine';
import { layerBuilder } from '../../services/layerBuilder';
import { videoBakeProxyCache } from '../../services/videoBakeProxyCache';
import { NativeHelperClient } from '../../services/nativeHelper/NativeHelperClient';
import { sanitizePlayheadPosition } from '../../services/layerBuilder/PlayheadState';
import { thumbnailCacheService } from '../../services/thumbnailCacheService';
import { clearAINodeRuntimeCache, cloneClipNodeGraph } from '../../services/nodeGraph';
import { clonePersistedClipAudioState } from '../../services/audio/clipAudioStatePersistence';
import { runtimeAudioMeterBus } from '../../services/audio/runtimeAudioMeterBus';
import { withProjectStoreSyncGuard } from '../../services/project/projectStoreSyncGuard';
import { vectorAnimationRuntimeManager } from '../../services/vectorAnimation/VectorAnimationRuntimeManager';
import {
  resetVolatileVideoBakeRegionStatuses,
  serializeVideoBakeRegion,
} from './videoBakeSlice';
import {
  createDataOnlyRestoredGaussianSplatSource,
  createDataOnlyRestoredModelSource,
} from './restoredMediaSource';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { markDynamicCanvasUpdated } from '../../services/canvasVersion';
import { releaseAllLazyTimelineMediaElements } from '../../services/timeline/lazyMediaElements';
import { releaseAllLazyTimelineImageElements } from '../../services/timeline/lazyImageElements';
import {
  createManagedRestoredImageUrl,
  createRestoredMotionClip,
  createRestoredPrimitiveMeshClip,
  applyManagedRestoredSpatialSource,
  isRestoredSpatialSourceType,
  restorePersistedClipVideoState,
} from './nestedRestore';
import { startRestoredVectorRuntimeRestore } from './vectorRuntimeRestore';
import { blobUrlManager } from './helpers/blobUrlManager';

const log = Logger.create('Timeline');

function getDefaultExpandedTrackIds(tracks: readonly TimelineTrack[]): string[] {
  return tracks.map(track => track.id);
}

function restoreSourceThumbnails(
  mediaFileId: string | undefined,
): void {
  if (!mediaFileId) {
    return;
  }

  const fileHash = useMediaStore.getState().files.find(f => f.id === mediaFileId)?.fileHash;
  void thumbnailCacheService.loadCachedForSource(mediaFileId, fileHash);
}

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

function createInitialRestoredMediaSource(
  serializedClip: SerializableClip,
  mediaFile: ReturnType<typeof useMediaStore.getState>['files'][number],
): TimelineClip['source'] {
  if (serializedClip.sourceType === 'gaussian-splat') {
    const gaussianSplatSource = createDataOnlyRestoredGaussianSplatSource(
      serializedClip,
      serializedClip.duration,
      mediaFile,
    );
    if (gaussianSplatSource) {
      return gaussianSplatSource;
    }
  }

  const restoredModelSource = serializedClip.sourceType === 'model'
    ? createDataOnlyRestoredModelSource(serializedClip, serializedClip.duration, mediaFile)
    : null;

  return {
    type: serializedClip.sourceType,
    mediaFileId: serializedClip.mediaFileId,
    naturalDuration: serializedClip.naturalDuration,
    vectorAnimationSettings: serializedClip.vectorAnimationSettings,
    threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
    modelSequence: restoredModelSource?.modelSequence,
  };
}

type PatchRestoredClip = (
  clipId: string,
  updater: (clip: TimelineClip) => TimelineClip,
) => void;

function isObjectUrl(url: string | undefined): boolean {
  return Boolean(url?.startsWith('blob:'));
}

function getLoadStateImageRuntimeUrl(params: {
  clipId: string;
  mediaFileId: string;
  loadFile?: File;
  fileUrl?: string;
}): string | undefined {
  const { clipId, mediaFileId, loadFile, fileUrl } = params;
  if (!fileUrl) {
    return loadFile ? createManagedRestoredImageUrl(clipId, loadFile) : undefined;
  }

  if (!isObjectUrl(fileUrl)) {
    return fileUrl;
  }

  if (mediaObjectUrlManager.get(mediaFileId, getPrimaryMediaObjectUrlKey()) === fileUrl) {
    return fileUrl;
  }

  return loadFile ? createManagedRestoredImageUrl(clipId, loadFile) : fileUrl;
}

function startLoadStateTopLevelRuntimeRestore(params: {
  clip: TimelineClip;
  serializedClip: SerializableClip;
  mediaFile: ReturnType<typeof useMediaStore.getState>['files'][number];
  type: SerializableClip['sourceType'];
  loadFile?: File;
  fileUrl?: string;
  isCurrentTimelineSession: () => boolean;
  patchRestoredClip: PatchRestoredClip;
  wakePreviewAfterRestore: () => void;
}): boolean {
  const {
    clip,
    serializedClip,
    mediaFile,
    type,
    loadFile,
    fileUrl,
    isCurrentTimelineSession,
    patchRestoredClip,
    wakePreviewAfterRestore,
  } = params;

  if (type === 'image') {
    const imageUrl = getLoadStateImageRuntimeUrl({
      clipId: clip.id,
      mediaFileId: mediaFile.id,
      loadFile,
      fileUrl,
    });
    if (!imageUrl) {
      log.warn('Skipping image restore - no image URL available', { clip: clip.name, mediaFileId: mediaFile.id });
      patchRestoredClip(clip.id, (currentClip) => ({ ...currentClip, isLoading: false }));
      return true;
    }

    if (!isCurrentTimelineSession()) {
      return true;
    }

    patchRestoredClip(clip.id, (currentClip) => ({
      ...currentClip,
      file: loadFile ?? currentClip.file,
      source: {
        type: 'image',
        mediaFileId: serializedClip.mediaFileId,
        naturalDuration: serializedClip.naturalDuration || mediaFile.duration || clip.duration,
        imageUrl,
        ...(mediaFile.absolutePath ? { filePath: mediaFile.absolutePath } : {}),
      },
      isLoading: false,
      needsReload: false,
    }));
    wakePreviewAfterRestore();
    return true;
  }

  if (isVectorAnimationSourceType(type)) {
    if (!loadFile) {
      log.warn('Skipping vector animation restore - file object not available', { clip: clip.name, type });
      patchRestoredClip(clip.id, (currentClip) => ({
        ...currentClip,
        isLoading: false,
        needsReload: mediaNeedsRelink(mediaFile),
      }));
      return true;
    }

    void (async () => {
      try {
        const runtimeClip: TimelineClip = {
          ...clip,
          file: loadFile,
          source: {
            type,
            mediaFileId: serializedClip.mediaFileId,
            naturalDuration: serializedClip.naturalDuration,
            vectorAnimationSettings: serializedClip.vectorAnimationSettings,
          },
        };
        startRestoredVectorRuntimeRestore({
          clip: runtimeClip,
          serializedClip,
          sourceType: type,
          file: loadFile,
          isCurrentSession: isCurrentTimelineSession,
          createReadyPatch: (source) => ({
            file: loadFile,
            source,
            isLoading: false,
            needsReload: false,
          }),
          applyPatch: (patch) => {
            patchRestoredClip(clip.id, (currentClip) => ({
              ...currentClip,
              ...patch,
            }));
          },
          onReady: () => {
            wakePreviewAfterRestore();
          },
          onError: (error) => {
            log.warn('Failed to restore lottie clip', { clip: clip.name, error });
          },
        });
      } catch (error) {
        if (!isCurrentTimelineSession()) {
          return;
        }
        log.warn('Failed to start vector restore', { clip: clip.name, error });
        patchRestoredClip(clip.id, (currentClip) => ({ ...currentClip, isLoading: false }));
      }
    })();
    return true;
  }

  if (isRestoredSpatialSourceType(type)) {
    const spatialResult = applyManagedRestoredSpatialSource(
      clip,
      serializedClip,
      serializedClip.duration,
      {
        ...mediaFile,
        file: loadFile ?? mediaFile.file,
        url: fileUrl,
      },
    );
    if (!spatialResult.restored) {
      log.warn('Skipping spatial restore - no source URL available', {
        clip: clip.name,
        mediaFileId: mediaFile.id,
        sourceType: type,
      });
      patchRestoredClip(clip.id, (currentClip) => ({ ...currentClip, isLoading: false }));
      return true;
    }
    patchRestoredClip(clip.id, (currentClip) => ({
      ...currentClip,
      source: clip.source,
      is3D: clip.is3D,
      meshType: clip.meshType,
      text3DProperties: clip.text3DProperties,
      isLoading: false,
    }));
    wakePreviewAfterRestore();
    return true;
  }

  return false;
}

function restoreNestedVideoSourceThumbnails(nestedClips: readonly TimelineClip[]): void {
  for (const nestedClip of nestedClips) {
    const mediaFileId = nestedClip.source?.type === 'video'
      ? nestedClip.source.mediaFileId
      : undefined;
    if (mediaFileId && useMediaStore.getState().files.find(file => file.id === mediaFileId)?.file) {
      restoreSourceThumbnails(mediaFileId);
    }

    if (nestedClip.nestedClips?.length) {
      restoreNestedVideoSourceThumbnails(nestedClip.nestedClips);
    }
  }
}

function restoreClipNodeGraph(serializedClip: SerializableClip) {
  return cloneClipNodeGraph(serializedClip.nodeGraph);
}

function restoreClipVideoState(serializedClip: SerializableClip) {
  return restorePersistedClipVideoState(serializedClip);
}

type SerializationUtils = Pick<TimelineUtils, 'getSerializableState' | 'loadState' | 'clearTimeline'>;

const RESTORE_STATE_YIELD_INTERVAL = 64;

export const createSerializationUtils: SliceCreator<SerializationUtils> = (set, get) => ({
  // Get serializable timeline state for saving to composition
  getSerializableState: (): CompositionTimelineData => {
    const {
      tracks,
      clips,
      playheadPosition,
      duration,
      durationLocked,
      zoom,
      scrollX,
      inPoint,
      outPoint,
      loopPlayback,
      clipKeyframes,
      markers,
      videoBakeRegions,
      masterAudioState,
    } = get();
    const safePlayheadPosition = sanitizePlayheadPosition(playheadPosition, 0);
    const serializableTracks: TimelineTrack[] = tracks.map((track) => ({
      ...track,
      audioState: track.audioState ? structuredClone(track.audioState) : undefined,
    }));

    // Convert clips to serializable format (without DOM elements)
    const mediaStore = useMediaStore.getState();
    const serializableClips: SerializableClip[] = clips.map(clip => {
      // Use existing mediaFileId if available, otherwise lookup by name
      let resolvedMediaFileId = clip.source?.mediaFileId || '';

      if (!resolvedMediaFileId && !clip.isComposition && !clip.signalAssetId) {
        // Fallback: Find the mediaFile ID by matching the file name in mediaStore
        // For linked audio clips (name ends with "(Audio)"), strip the suffix to find the video file
        let lookupName = clip.name;
        if (clip.linkedClipId && clip.source?.type === 'audio' && lookupName.endsWith(' (Audio)')) {
          lookupName = lookupName.replace(' (Audio)', '');
        }
        const mediaFile = mediaStore.files.find(f => f.name === lookupName);
        resolvedMediaFileId = mediaFile?.id || '';
      }

      // Get keyframes for this clip
      const keyframes = clipKeyframes.get(clip.id) || [];

      return {
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        mediaFileId: clip.isComposition ? '' : resolvedMediaFileId, // Comp clips don't have media files
        signalAssetId: clip.signalAssetId,
        signalRefId: clip.signalRefId,
        signalRenderAdapterId: clip.signalRenderAdapterId,
        startTime: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        sourceType: clip.source?.type || 'video',
        naturalDuration: clip.source?.naturalDuration,
        // MIDI note data (issue #182) — instrument lives on the track, notes on the clip.
        midiData: clip.source?.type === 'midi' && clip.midiData
          ? structuredClone(clip.midiData)
          : undefined,
        thumbnails: clip.thumbnails,
        linkedClipId: clip.linkedClipId,
        linkedGroupId: clip.linkedGroupId,
        videoState: clip.videoState
          ? {
              ...clip.videoState,
              bakeRegions: clip.videoState.bakeRegions?.map(serializeVideoBakeRegion),
            }
          : undefined,
        audioState: clonePersistedClipAudioState(clip.audioState),
        waveform: clip.audioState?.sourceAnalysisRefs?.waveformPyramidId ||
          clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId
          ? undefined
          : clip.waveform,
        waveformChannels: clip.audioState?.sourceAnalysisRefs?.waveformPyramidId ||
          clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId
          ? undefined
          : clip.waveformChannels,
        transform: clip.transform,
        effects: clip.effects,
        colorCorrection: clip.colorCorrection ? structuredClone(clip.colorCorrection) : undefined,
        nodeGraph: cloneClipNodeGraph(clip.nodeGraph),
        keyframes: keyframes.length > 0 ? keyframes : undefined,
        // Nested composition support
        isComposition: clip.isComposition,
        compositionId: clip.compositionId,
        // Mask support
        masks: clip.masks && clip.masks.length > 0 ? clip.masks : undefined,
        // Transcript data
        transcript: clip.transcript && clip.transcript.length > 0 ? clip.transcript : undefined,
        transcriptStatus: clip.transcriptStatus !== 'none' ? clip.transcriptStatus : undefined,
        // Analysis data
        analysis: clip.analysis,
        analysisStatus: clip.analysisStatus !== 'none' ? clip.analysisStatus : undefined,
        // Playback
        reversed: clip.reversed || undefined,
        speed: clip.speed != null && clip.speed !== 1 ? clip.speed : undefined,
        preservesPitch: clip.preservesPitch === false ? false : undefined,
        // Text clip support
        textProperties: clip.textProperties,
        text3DProperties: clip.text3DProperties ?? clip.source?.text3DProperties,
        // Solid clip support
        solidColor: clip.source?.type === 'solid' ? (clip.solidColor || clip.name.replace('Solid ', '')) : undefined,
        vectorAnimationSettings: clip.source?.vectorAnimationSettings,
        mathScene: clip.source?.type === 'math-scene' && clip.mathScene
          ? structuredClone(clip.mathScene)
          : undefined,
        motion: clip.motion ? structuredClone(clip.motion) : undefined,
        // Clip label color
        // 3D layer support
        is3D: clip.is3D || undefined,
        threeDEffectorsEnabled: clip.source?.threeDEffectorsEnabled,
        meshType: clip.meshType ?? clip.source?.meshType,
        cameraSettings: clip.source?.type === 'camera' ? clip.source.cameraSettings : undefined,
        splatEffectorSettings: clip.source?.type === 'splat-effector' ? clip.source.splatEffectorSettings : undefined,
        // Gaussian avatar blendshapes
        gaussianBlendshapes: clip.source?.type === 'gaussian-avatar' ? clip.source.gaussianBlendshapes : undefined,
        gaussianSplatSequence: clip.source?.type === 'gaussian-splat' ? clip.source.gaussianSplatSequence : undefined,
        // Gaussian splat settings
        gaussianSplatSettings: clip.source?.type === 'gaussian-splat' ? clip.source.gaussianSplatSettings : undefined,
      };
    });

    return {
      tracks: serializableTracks,
      clips: serializableClips,
      playheadPosition: safePlayheadPosition,
      duration,
      durationLocked: durationLocked || undefined,  // Only save if true
      zoom,
      scrollX,
      inPoint,
      outPoint,
      loopPlayback,
      markers: markers.length > 0 ? markers : undefined,  // Only save if there are markers
      videoBakeRegions: videoBakeRegions.length > 0
        ? videoBakeRegions.map(serializeVideoBakeRegion)
        : undefined,
      masterAudioState: masterAudioState ? structuredClone(masterAudioState) : undefined,
    };
  },

  // Load timeline state from composition data
  loadState: async (data: CompositionTimelineData | undefined) => {
    // Suppress autosave for the ENTIRE restore (incl. the chunked yields below) so
    // a partially-loaded timeline can never be persisted over the full project.
    // The depth-counter guard holds across awaits/yields (issue #228 data-loss guard).
    return withProjectStoreSyncGuard(async () => {
    const { pause, clearTimeline } = get();
    const wakePreviewAfterRestore = () => {
      layerBuilder.invalidateCache();
      engine.requestRender();
    };
    // Stop playback
    pause();

    // Clear current timeline
    videoBakeProxyCache.clear();
    clearTimeline();
    const timelineSessionId = get().timelineSessionId;
    const isCurrentTimelineSession = () => get().timelineSessionId === timelineSessionId;

    if (!data) {
      // No data - start with fresh default timeline
      set({
        tracks: DEFAULT_TRACKS.map(t => ({ ...t })),
        clips: [],
        playheadPosition: 0,
        duration: 60,
        durationLocked: false,
        zoom: 50,
        scrollX: 0,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
        playbackSpeed: 1,
        selectedClipIds: new Set(),
        primarySelectedClipId: null,
        propertiesSelection: null,
        targetTrackIdByType: {},
        markers: [],
        videoBakeRegionSelection: null,
        videoBakeRegions: [],
        masterAudioState: undefined,
        clipStemSeparationJobs: {},
      });
      return;
    }

    // Restore tracks and basic state
    // Increment animation key to trigger entrance animations on clips
    const { clipEntranceAnimationKey } = get();
    const safePlayheadPosition = sanitizePlayheadPosition(data.playheadPosition, 0);
    const restoredVideoBakeState = resetVolatileVideoBakeRegionStatuses(
      [],
      data.videoBakeRegions ?? [],
    );

    set({
      tracks: data.tracks.map(t => ({ ...t })),
      clips: [], // We'll restore clips separately
      playheadPosition: safePlayheadPosition,
      duration: data.duration,
      durationLocked: data.durationLocked || false,
      zoom: data.zoom,
      scrollX: data.scrollX,
      inPoint: data.inPoint,
      outPoint: data.outPoint,
      loopPlayback: data.loopPlayback,
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      propertiesSelection: null,
      targetTrackIdByType: {},
      // Clear keyframe state
      clipKeyframes: new Map<string, Keyframe[]>(),
      keyframeRecordingEnabled: new Set<string>(),
      expandedTracks: new Set<string>(getDefaultExpandedTrackIds(data.tracks)),
      expandedTrackPropertyGroups: new Map<string, Set<string>>(),
      selectedKeyframeIds: new Set<string>(),
      expandedCurveProperties: new Map<string, Set<import('../../types').AnimatableProperty>>(),
      clipStemSeparationJobs: {},
      // Restore markers
      markers: data.markers || [],
      videoBakeRegionSelection: null,
      videoBakeRegions: restoredVideoBakeState.videoBakeRegions,
      masterAudioState: data.masterAudioState ? structuredClone(data.masterAudioState) : undefined,
      // Increment animation key for clip entrance animations
      clipEntranceAnimationKey: clipEntranceAnimationKey + 1,
    });

    // Restore keyframes from serialized clips
    const keyframeMap = new Map<string, Keyframe[]>();
    for (const serializedClip of data.clips) {
      if (serializedClip.keyframes && serializedClip.keyframes.length > 0) {
        keyframeMap.set(serializedClip.id, serializedClip.keyframes);
      }
    }
    if (keyframeMap.size > 0) {
      set({ clipKeyframes: keyframeMap });
    }

    // Restore clips - need to recreate media elements from file references
    const mediaStore = useMediaStore.getState();
    const restoredClipBuffer: TimelineClip[] = [];
    const flushRestoredClipBuffer = () => {
      if (restoredClipBuffer.length === 0) {
        return;
      }
      const nextClips = restoredClipBuffer.splice(0);
      set(state => ({
        clips: [...state.clips, ...nextClips],
      }));
    };
    const pushRestoredClip = (clip: TimelineClip) => {
      restoredClipBuffer.push(clip);
      if (restoredClipBuffer.length >= 128) {
        flushRestoredClipBuffer();
      }
    };
    const patchRestoredClip = (clipId: string, updater: (clip: TimelineClip) => TimelineClip) => {
      const bufferedIndex = restoredClipBuffer.findIndex((candidate) => candidate.id === clipId);
      if (bufferedIndex >= 0) {
        restoredClipBuffer[bufferedIndex] = updater(restoredClipBuffer[bufferedIndex]);
        return;
      }
      set(state => ({
        clips: state.clips.map(c => c.id === clipId ? updater(c) : c),
      }));
    };

    let restoreYieldCounter = 0;
    for (const serializedClip of data.clips) {
      // Yield every few clips so a large comp loads in responsive chunks instead of
      // one long task that freezes the whole tab. Safe now: autosave is suppressed by
      // the withProjectStoreSyncGuard wrapper around this restore (issue #228).
      if (++restoreYieldCounter % RESTORE_STATE_YIELD_INTERVAL === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      // Handle composition clips specially
      if (serializedClip.isComposition && serializedClip.compositionId) {
        const composition = mediaStore.compositions.find(c => c.id === serializedClip.compositionId);
        if (composition) {
          // Check if this is a composition AUDIO clip (linked audio for nested comp)
          if (serializedClip.sourceType === 'audio') {
            // Keep composition audio restore data-only. Playback/export can request
            // mixdown lazily; project load must not create audio elements or blobs.
            const compAudioClip: TimelineClip = {
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
              videoState: restoreClipVideoState(serializedClip),
              audioState: clonePersistedClipAudioState(serializedClip.audioState),
              waveform: serializedClip.waveform || [],
              waveformChannels: serializedClip.waveformChannels,
              transform: serializedClip.transform,
              effects: serializedClip.effects || [],
              colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
              nodeGraph: restoreClipNodeGraph(serializedClip),
              isLoading: false,
              isComposition: true,
              compositionId: serializedClip.compositionId,
              speed: serializedClip.speed,
              preservesPitch: serializedClip.preservesPitch,
              mixdownGenerating: false,
              hasMixdownAudio: false,
            };

            pushRestoredClip(compAudioClip);
            continue;
          }

          // Create comp VIDEO clip manually to restore specific settings
          const compClip: TimelineClip = {
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
            videoState: restoreClipVideoState(serializedClip),
            audioState: clonePersistedClipAudioState(serializedClip.audioState),
            transform: serializedClip.transform,
            effects: serializedClip.effects || [],
            colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
            nodeGraph: restoreClipNodeGraph(serializedClip),
            masks: serializedClip.masks || [],  // Restore masks for composition clips
            isLoading: true,
            isComposition: true,
            compositionId: serializedClip.compositionId,
            nestedClips: [],
            nestedTracks: [],
            speed: serializedClip.speed,
            preservesPitch: serializedClip.preservesPitch,
          };

          pushRestoredClip(compClip);
          flushRestoredClipBuffer();

          // Load nested composition content in background
          if (composition.timelineData) {
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
            restoreNestedVideoSourceThumbnails(nestedClips);

            // Calculate clip boundaries for visual markers and thumbnail alignment
            const compDuration = composition.timelineData?.duration ?? composition.duration;
            const boundaries = calculateNestedClipBoundaries(composition.timelineData, compDuration);

            // Update comp clip with nested data and boundaries
            if (!isCurrentTimelineSession()) {
              return;
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
          } else {
            // No timeline data
            if (!isCurrentTimelineSession()) {
              return;
            }
            set(state => ({
              clips: state.clips.map(c =>
                c.id === compClip.id ? { ...c, isLoading: false } : c
              ),
            }));
          }
        } else {
          log.warn('Could not find composition for clip', { clip: serializedClip.name });
        }
        continue;
      }

      const motionClip = createRestoredMotionClip(serializedClip, serializedClip.id);
      if (motionClip) {
        pushRestoredClip(motionClip);

        log.debug('Restored motion clip', { clip: serializedClip.name, sourceType: serializedClip.sourceType });
        continue;
      }

      // Math Scene clips - restore from serializable scene definition
      if (serializedClip.sourceType === 'math-scene' && serializedClip.mathScene) {
        const { mathSceneRenderer } = await import('../../services/mathScene/MathSceneRenderer');

        const activeComp = mediaStore.getActiveComposition?.();
        const compWidth = activeComp?.width || 1920;
        const compHeight = activeComp?.height || 1080;
        const canvas = mathSceneRenderer.createCanvas(compWidth, compHeight);
        mathSceneRenderer.render(serializedClip.mathScene, canvas, 0, serializedClip.duration);

        const mathClip: TimelineClip = {
          id: serializedClip.id,
          trackId: serializedClip.trackId,
          name: serializedClip.name || 'Math Scene',
          file: new File([JSON.stringify(serializedClip.mathScene)], 'math-scene.json', { type: 'application/json' }),
          mediaFileId: serializedClip.mediaFileId || undefined,
          signalAssetId: serializedClip.signalAssetId,
          signalRefId: serializedClip.signalRefId,
          signalRenderAdapterId: serializedClip.signalRenderAdapterId,
          startTime: serializedClip.startTime,
          duration: serializedClip.duration,
          inPoint: serializedClip.inPoint,
          outPoint: serializedClip.outPoint,
          source: {
            type: 'math-scene',
            textCanvas: canvas,
            mediaFileId: serializedClip.mediaFileId || undefined,
            naturalDuration: serializedClip.duration,
          },
          mathScene: serializedClip.mathScene,
          videoState: restoreClipVideoState(serializedClip),
          audioState: clonePersistedClipAudioState(serializedClip.audioState),
          transform: serializedClip.transform,
          effects: serializedClip.effects || [],
          colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
          nodeGraph: restoreClipNodeGraph(serializedClip),
          masks: serializedClip.masks,
          speed: serializedClip.speed,
          preservesPitch: serializedClip.preservesPitch,
          isLoading: false,
        };

        pushRestoredClip(mathClip);

        log.debug('Restored math scene clip', { clip: serializedClip.name });
        continue;
      }

      // Text clips - restore from textProperties
      if (serializedClip.sourceType === 'text' && serializedClip.textProperties) {
        const { textRenderer } = await import('../../services/textRenderer');
        const { googleFontsService } = await import('../../services/googleFontsService');
        const { createTextBoundsFromRect, resolveTextBoxRect } = await import('../../services/textLayout');
        const activeComp = mediaStore.getActiveComposition?.();
        const compWidth = activeComp?.width || 1920;
        const compHeight = activeComp?.height || 1080;
        const textProperties = structuredClone(serializedClip.textProperties);
        if (textProperties.textBounds?.vertices?.length) {
          textProperties.boxEnabled = true;
        } else if (textProperties.boxEnabled) {
          const box = resolveTextBoxRect(textProperties, compWidth, compHeight);
          textProperties.textBounds = createTextBoundsFromRect(
            box,
            compWidth,
            compHeight,
            undefined,
            { clampToCanvas: false },
          );
        }

        // Load the font first
        await googleFontsService.loadFont(
          textProperties.fontFamily,
          textProperties.fontWeight
        );

        // Render text to a per-clip canvas matching the active composition.
        const textCanvas = textRenderer.createCanvas(compWidth, compHeight);
        textRenderer.render(textProperties, textCanvas);

        const textClip: TimelineClip = {
          id: serializedClip.id,
          trackId: serializedClip.trackId,
          name: serializedClip.name,
          file: new File([], 'text-clip.txt', { type: 'text/plain' }),
          mediaFileId: serializedClip.mediaFileId || undefined,
          signalAssetId: serializedClip.signalAssetId,
          signalRefId: serializedClip.signalRefId,
          signalRenderAdapterId: serializedClip.signalRenderAdapterId,
          startTime: serializedClip.startTime,
          duration: serializedClip.duration,
          inPoint: serializedClip.inPoint,
          outPoint: serializedClip.outPoint,
          source: {
            type: 'text',
            textCanvas,
            mediaFileId: serializedClip.mediaFileId || undefined,
            naturalDuration: serializedClip.duration,
          },
          videoState: restoreClipVideoState(serializedClip),
          audioState: clonePersistedClipAudioState(serializedClip.audioState),
          transform: serializedClip.transform,
          effects: serializedClip.effects || [],
          colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
          nodeGraph: restoreClipNodeGraph(serializedClip),
          masks: serializedClip.masks,
          textProperties,
          speed: serializedClip.speed,
          preservesPitch: serializedClip.preservesPitch,
          isLoading: false,
        };

        pushRestoredClip(textClip);

        log.debug('Restored text clip', { clip: serializedClip.name });
        continue;
      }

      // Solid clips - restore from solidColor
      if (serializedClip.sourceType === 'solid' && serializedClip.solidColor) {
        const color = serializedClip.solidColor;
        // Use active composition dimensions, fallback to 1920x1080
        const activeComp = mediaStore.getActiveComposition?.();
        const compWidth = activeComp?.width || 1920;
        const compHeight = activeComp?.height || 1080;
        const canvas = document.createElement('canvas');
        canvas.width = compWidth;
        canvas.height = compHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, compWidth, compHeight);
        markDynamicCanvasUpdated(canvas, 'solid');

        const solidClip: TimelineClip = {
          id: serializedClip.id,
          trackId: serializedClip.trackId,
          name: serializedClip.name,
          file: new File([], 'solid-clip.dat', { type: 'application/octet-stream' }),
          mediaFileId: serializedClip.mediaFileId || undefined,
          signalAssetId: serializedClip.signalAssetId,
          signalRefId: serializedClip.signalRefId,
          signalRenderAdapterId: serializedClip.signalRenderAdapterId,
          startTime: serializedClip.startTime,
          duration: serializedClip.duration,
          inPoint: serializedClip.inPoint,
          outPoint: serializedClip.outPoint,
          source: {
            type: 'solid',
            textCanvas: canvas,
            mediaFileId: serializedClip.mediaFileId || undefined,
            naturalDuration: serializedClip.duration,
          },
          videoState: restoreClipVideoState(serializedClip),
          audioState: clonePersistedClipAudioState(serializedClip.audioState),
          transform: serializedClip.transform,
          effects: serializedClip.effects || [],
          colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
          nodeGraph: restoreClipNodeGraph(serializedClip),
          masks: serializedClip.masks,
          solidColor: color,
          speed: serializedClip.speed,
          preservesPitch: serializedClip.preservesPitch,
          isLoading: false,
        };

        pushRestoredClip(solidClip);

        log.debug('Restored solid clip', { clip: serializedClip.name, color });
        continue;
      }

      // Camera clips - restore shared scene camera controls
      if (serializedClip.sourceType === 'camera') {
        const { DEFAULT_SCENE_CAMERA_SETTINGS } = await import('../mediaStore/types');

        const cameraClip: TimelineClip = {
          id: serializedClip.id,
          trackId: serializedClip.trackId,
          name: serializedClip.name || 'Camera',
          file: new File([], 'camera-clip.dat', { type: 'application/octet-stream' }),
          mediaFileId: serializedClip.mediaFileId || undefined,
          signalAssetId: serializedClip.signalAssetId,
          signalRefId: serializedClip.signalRefId,
          signalRenderAdapterId: serializedClip.signalRenderAdapterId,
          startTime: serializedClip.startTime,
          duration: serializedClip.duration,
          inPoint: serializedClip.inPoint,
          outPoint: serializedClip.outPoint,
          source: {
            type: 'camera',
            cameraSettings: serializedClip.cameraSettings || { ...DEFAULT_SCENE_CAMERA_SETTINGS },
            mediaFileId: serializedClip.mediaFileId || undefined,
            naturalDuration: Number.MAX_SAFE_INTEGER,
          },
          videoState: restoreClipVideoState(serializedClip),
          audioState: clonePersistedClipAudioState(serializedClip.audioState),
          transform: serializedClip.transform,
          effects: serializedClip.effects || [],
          colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
          nodeGraph: restoreClipNodeGraph(serializedClip),
          masks: serializedClip.masks,
          speed: serializedClip.speed,
          preservesPitch: serializedClip.preservesPitch,
          isLoading: false,
        };

        pushRestoredClip(cameraClip);

        log.debug('Restored camera clip', { clip: serializedClip.name });
        continue;
      }

      if (serializedClip.sourceType === 'splat-effector') {
        const { DEFAULT_SPLAT_EFFECTOR_SETTINGS } = await import('../../types/splatEffector');

        const effectorClip: TimelineClip = {
          id: serializedClip.id,
          trackId: serializedClip.trackId,
          name: serializedClip.name || '3D Effector',
          file: new File([], 'splat-effector.dat', { type: 'application/octet-stream' }),
          mediaFileId: serializedClip.mediaFileId || undefined,
          signalAssetId: serializedClip.signalAssetId,
          signalRefId: serializedClip.signalRefId,
          signalRenderAdapterId: serializedClip.signalRenderAdapterId,
          startTime: serializedClip.startTime,
          duration: serializedClip.duration,
          inPoint: serializedClip.inPoint,
          outPoint: serializedClip.outPoint,
          source: {
            type: 'splat-effector',
            splatEffectorSettings: serializedClip.splatEffectorSettings || { ...DEFAULT_SPLAT_EFFECTOR_SETTINGS },
            mediaFileId: serializedClip.mediaFileId || undefined,
            naturalDuration: Number.MAX_SAFE_INTEGER,
          },
          videoState: restoreClipVideoState(serializedClip),
          audioState: clonePersistedClipAudioState(serializedClip.audioState),
          transform: serializedClip.transform,
          effects: serializedClip.effects || [],
          colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
          nodeGraph: restoreClipNodeGraph(serializedClip),
          masks: serializedClip.masks,
          speed: serializedClip.speed,
          preservesPitch: serializedClip.preservesPitch,
          is3D: serializedClip.is3D ?? true,
          isLoading: false,
        };

        pushRestoredClip(effectorClip);

        log.debug('Restored splat effector clip', { clip: serializedClip.name });
        continue;
      }

      // Primitive mesh clips - restore without a backing media file
      const meshClip = createRestoredPrimitiveMeshClip(serializedClip);
      if (meshClip) {
        pushRestoredClip(meshClip);

        log.debug('Restored mesh clip', { clip: serializedClip.name, meshType: serializedClip.meshType });
        continue;
      }

      // MIDI clips - data-only (no media file); notes restored from midiData,
      // rendered by the track instrument (issue #182). Mirrors addMidiClip's shape.
      if (serializedClip.sourceType === 'midi') {
        const midiClip: TimelineClip = {
          id: serializedClip.id,
          trackId: serializedClip.trackId,
          name: serializedClip.name || 'MIDI Clip',
          file: new File([], 'midi-clip.dat', { type: 'application/octet-stream' }),
          startTime: serializedClip.startTime,
          duration: serializedClip.duration,
          inPoint: serializedClip.inPoint,
          outPoint: serializedClip.outPoint,
          source: {
            type: 'midi',
            naturalDuration: serializedClip.naturalDuration ?? serializedClip.duration,
          },
          transform: serializedClip.transform,
          effects: serializedClip.effects || [],
          colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
          nodeGraph: restoreClipNodeGraph(serializedClip),
          audioState: serializedClip.audioState ? structuredClone(serializedClip.audioState) : undefined,
          midiData: serializedClip.midiData ? structuredClone(serializedClip.midiData) : { notes: [] },
          masks: serializedClip.masks,
          isLoading: false,
        };

        pushRestoredClip(midiClip);

        log.debug('Restored MIDI clip', { clip: serializedClip.name, noteCount: midiClip.midiData?.notes.length ?? 0 });
        continue;
      }

      // Regular media clips
      const mediaFile = mediaStore.files.find(f => f.id === serializedClip.mediaFileId);
      if (!mediaFile) {
        log.warn('Media file not found for clip', { clip: serializedClip.name, mediaFileId: serializedClip.mediaFileId });
        continue;
      }

      // Create the clip - even if the browser File object is not in memory.
      // Native-helper projects can restore from persisted project/absolute paths.
      const needsReload = mediaNeedsRelink(mediaFile);
      if (needsReload) {
        log.debug('Clip needs reload (file permission required)', { clip: serializedClip.name });
      }

      // Create placeholder file if missing
      const file = mediaFile.file || new File([], mediaFile.name || 'pending', { type: 'video/mp4' });
      const initialSource = createInitialRestoredMediaSource(serializedClip, mediaFile);

      // Create the clip with loading state
      const clip: TimelineClip = {
        id: serializedClip.id,
        trackId: serializedClip.trackId,
        name: serializedClip.name || mediaFile.name || 'Untitled',
        file: file,
        signalAssetId: serializedClip.signalAssetId,
        signalRefId: serializedClip.signalRefId,
        signalRenderAdapterId: serializedClip.signalRenderAdapterId,
        startTime: serializedClip.startTime,
        duration: serializedClip.duration,
        inPoint: serializedClip.inPoint,
        outPoint: serializedClip.outPoint,
        source: initialSource,
        mediaFileId: serializedClip.mediaFileId, // Restore top-level mediaFileId for audio/proxy lookup
        needsReload: needsReload, // Flag for UI to show reload indicator
        thumbnails: serializedClip.thumbnails,
        linkedClipId: serializedClip.linkedClipId,
        linkedGroupId: serializedClip.linkedGroupId,
        videoState: restoreClipVideoState(serializedClip),
        audioState: clonePersistedClipAudioState(serializedClip.audioState),
        waveform: serializedClip.waveform,
        waveformChannels: serializedClip.waveformChannels,
        transform: serializedClip.transform,
        effects: serializedClip.effects || [],
        colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
        nodeGraph: restoreClipNodeGraph(serializedClip),
        isLoading: !needsReload,
        masks: serializedClip.masks,  // Restore masks
        // Restore transcript data
        transcript: serializedClip.transcript,
        transcriptStatus: serializedClip.transcriptStatus || 'none',
        // Restore analysis data
        analysis: serializedClip.analysis,
        analysisStatus: serializedClip.analysisStatus || 'none',
        // Restore playback settings
        reversed: serializedClip.reversed,
        speed: serializedClip.speed,
        preservesPitch: serializedClip.preservesPitch,
        // 3D layer support
        is3D: serializedClip.is3D,
        meshType: serializedClip.meshType,
      };

      pushRestoredClip(clip);

      // Check for cached analysis in project folder if clip doesn't have analysis but has mediaFileId
      // Try exact range first, then fall back to merged all-ranges
      if (!serializedClip.analysis && serializedClip.mediaFileId && projectFileService.isProjectOpen()) {
        const mfId = serializedClip.mediaFileId;
        projectFileService.getAnalysis(
          mfId,
          serializedClip.inPoint,
          serializedClip.outPoint
        ).then(async cachedAnalysis => {
          // If no exact range match, try merging all available ranges
          if (!cachedAnalysis) {
            cachedAnalysis = await projectFileService.getAllAnalysisMerged(mfId);
          }
          if (cachedAnalysis) {
            log.debug('Loaded analysis from project folder', { clip: serializedClip.name });
            const analysis: ClipAnalysis = {
              frames: cachedAnalysis.frames as FrameAnalysisData[],
              sampleInterval: cachedAnalysis.sampleInterval,
            };
            set(state => ({
              clips: state.clips.map(c =>
                c.id === clip.id
                  ? { ...c, analysis, analysisStatus: 'ready' as const }
                  : c
              ),
            }));
          }
        }).catch(err => {
          log.warn('Failed to load analysis from project folder', err);
        });
      }

      // Skip media loading if the media has no stored path/handle to recover from.
      if (needsReload) {
        log.debug('Skipping media load for clip that needs reload', { clip: clip.name });
        continue;
      }

      // Load media element async
      const type = serializedClip.sourceType;
      const deferMediaElementRestore = (type as string) === 'video' || (type as string) === 'audio';
      const deferObjectUrlRestore =
        deferMediaElementRestore ||
        type === 'image' ||
        type === 'model' ||
        type === 'gaussian-avatar' ||
        type === 'gaussian-splat' ||
        isVectorAnimationSourceType(type);
      let loadFile = mediaFile.file;
      let fileUrl = loadFile
        ? (deferObjectUrlRestore ? mediaFile.url : URL.createObjectURL(loadFile))
        : mediaFile.url;

      if (
        !loadFile &&
        fileUrl &&
        (type === 'image' || type === 'lottie' || type === 'rive') &&
        NativeHelperClient.parseFileReferenceUrl(fileUrl)
      ) {
        const referencedFile = await NativeHelperClient.getReferencedFile(fileUrl, mediaFile.name);
        if (referencedFile) {
          loadFile = referencedFile;
          fileUrl = isVectorAnimationSourceType(type)
            ? fileUrl
            : createPrimaryMediaObjectUrl(mediaFile.id, referencedFile);
          useMediaStore.setState((state) => ({
            files: state.files.map((currentFile) =>
              currentFile.id === mediaFile.id
                ? {
                    ...currentFile,
                    file: referencedFile,
                    url: fileUrl,
                    hasFileHandle: true,
                  }
                : currentFile
            ),
          }));
        }
      }

      if (type === 'video' && !loadFile && mediaFile.absolutePath && projectFileService.activeBackend === 'native') {
        patchRestoredClip(clip.id, (c) => ({
          ...c,
          source: {
            type: 'video',
            naturalDuration: serializedClip.naturalDuration || mediaFile.duration || clip.duration,
            mediaFileId: serializedClip.mediaFileId,
            filePath: mediaFile.absolutePath,
          },
          isLoading: false,
          needsReload: false,
        }));
        restoreSourceThumbnails(serializedClip.mediaFileId);
        continue;
      }

      const hasRestoredGaussianSplatSourceUrl =
        initialSource?.type === 'gaussian-splat' && !!initialSource.gaussianSplatUrl;

      if (
        !loadFile &&
        !fileUrl &&
        (type === 'video' || type === 'audio' || type === 'image' || type === 'model' || (type === 'gaussian-splat' && !hasRestoredGaussianSplatSourceUrl))
      ) {
        log.warn('Skipping media load - no file URL available', { clip: clip.name, mediaFileId: mediaFile.id });
        patchRestoredClip(clip.id, (c) => ({ ...c, isLoading: false }));
        continue;
      }

      if (deferMediaElementRestore) {
        patchRestoredClip(clip.id, (c) => ({
          ...c,
          file: loadFile ?? c.file,
          source: {
            type,
            naturalDuration: serializedClip.naturalDuration || mediaFile.duration || clip.duration,
            mediaFileId: serializedClip.mediaFileId,
            ...(mediaFile.absolutePath ? { filePath: mediaFile.absolutePath } : {}),
          },
          isLoading: false,
          needsReload: false,
        }));
        if (type === 'video') {
          restoreSourceThumbnails(serializedClip.mediaFileId);
        }
        wakePreviewAfterRestore();
        continue;
      }

      if (startLoadStateTopLevelRuntimeRestore({
        clip,
        serializedClip,
        mediaFile,
        type,
        loadFile,
        fileUrl,
        isCurrentTimelineSession,
        patchRestoredClip,
        wakePreviewAfterRestore,
      })) {
        continue;
      }
    }

    flushRestoredClipBuffer();
    get().relinkClipStemSeparationJobsFromMediaLibrary();
    });
  },

  // Clear all timeline data
  clearTimeline: () => {
    const { clips, pause } = get();

    // Stop playback
    pause();

    // CRITICAL: Clear store state FIRST — synchronously.
    // The rAF render loop reads clips/layers from the store. If we destroy
    // media resources while clips still reference them, the render loop can
    // pass a closed VideoFrame to importExternalTexture → GPU crash.
    const { tracks } = get();
    const nextTimelineSessionId = get().timelineSessionId + 1;
    // Clear the runtime meter bus (source of truth) before resetting the store
    // mirror, so a pending bus write cannot repopulate stale meters after load.
    runtimeAudioMeterBus.clearAll();
    set({
      clips: [],
      layers: [],
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      propertiesSelection: null,
      targetTrackIdByType: {},
      cachedFrameTimes: new Set(),
      ramPreviewProgress: null,
      ramPreviewRange: null,
      isRamPreviewing: false,
      videoBakeRegionSelection: null,
      videoBakeRegions: [],
      clipKeyframes: new Map<string, Keyframe[]>(),
      keyframeRecordingEnabled: new Set<string>(),
      expandedTracks: new Set<string>(getDefaultExpandedTrackIds(tracks)),
      expandedTrackPropertyGroups: new Map<string, Set<string>>(),
      selectedKeyframeIds: new Set<string>(),
      expandedCurveProperties: new Map<string, Set<import('../../types').AnimatableProperty>>(),
      runtimeAudioMeters: { trackMeters: {} },
      clipStemSeparationJobs: {},
      timelineSessionId: nextTimelineSessionId,
    });
    releaseAllLazyTimelineMediaElements();
    releaseAllLazyTimelineImageElements();
    clearAINodeRuntimeCache();
    blobUrlManager.clear();

    // Clean up media elements owned by restored clips. WebCodecs players may be
    // owned by lazy/runtime paths, so cleanup only pauses detached players here.
    const cleanupClip = (clip: TimelineClip) => {
      if (clip.source?.videoElement) {
        const video = clip.source.videoElement;
        video.pause();
        try { if (video.src) URL.revokeObjectURL(video.src); } catch {}
        video.removeAttribute('src');
        video.load();
      }
      if (clip.source?.audioElement) {
        const audio = clip.source.audioElement;
        audio.pause();
        try { if (audio.src) URL.revokeObjectURL(audio.src); } catch {}
        audio.removeAttribute('src');
        audio.load();
      }
      if (isVectorAnimationSourceType(clip.source?.type)) {
        vectorAnimationRuntimeManager.destroyClipRuntime(clip.id, clip.source.type);
      }
      // Pause WebCodecs players so the decoder is not running while detached.
      if (clip.source?.webCodecsPlayer?.isPlaying) {
        clip.source.webCodecsPlayer.pause();
      }
      if (clip.nestedClips) {
        clip.nestedClips.forEach(cleanupClip);
      }
    };

    clips.forEach(cleanupClip);
    engine.clearCaches();
    layerBuilder.getVideoSyncManager().reset();
  },
});
