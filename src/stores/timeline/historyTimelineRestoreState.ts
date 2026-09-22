import { clonePlanarTracks } from '../../services/planarTracking/clonePlanarTracks';
import { cloneTerrainAnchorConnector, cloneTerrainAttachment, cloneTerrainScreenAnchor } from '../../types/terrainAttachment';
import type {
  Keyframe,
  Layer,
  TimelineClip,
  TimelineSourceType,
  TimelineTrack,
} from '../../types';
import type {
  HistoryTimelineClipEditState,
  HistoryTimelineEditState,
  HistoryTimelineLayerEditState,
  HistoryTimelineLayerSourceRef,
  HistoryTimelineRuntimeRef,
  HistoryTimelineTrackEditState,
} from './historyTimelineEditState';
import { getClipAnalysisSourceId } from '../../services/clipAnalysis/sourceAnalysisSharing';
import { resolveClipTranscriptWords } from '../../services/transcription/clipTranscriptResolver';
import { normalizeMotionLayerDefinitionForLoad } from '../../services/motionDesign/contracts/replicatorTimelineAdapter';

export interface HistoryTimelineRestoreCurrentState {
  duration?: number;
  durationLocked?: boolean;
  clips?: readonly TimelineClip[];
  tracks?: readonly TimelineTrack[];
  selectedClipIds?: ReadonlySet<string>;
  zoom?: number;
  scrollX?: number;
  layers?: readonly Layer[];
  selectedLayerId?: string | null;
  clipKeyframes?: ReadonlyMap<string, readonly Keyframe[]>;
  markers?: Readonly<HistoryTimelineEditState['timeline']['markers']>;
  tempoMap?: HistoryTimelineEditState['timeline']['tempoMap'];
  masterAudioState?: HistoryTimelineEditState['timeline']['masterAudioState'];
  sharedSceneGraphs?: HistoryTimelineEditState['timeline']['sharedSceneGraphs'];
}

export interface HistoryTimelineRestoreState {
  duration?: number;
  durationLocked?: boolean;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  selectedClipIds: Set<string>;
  zoom: number;
  scrollX: number;
  layers: Layer[];
  selectedLayerId: string | null;
  clipKeyframes: Map<string, Keyframe[]>;
  markers: HistoryTimelineEditState['timeline']['markers'];
  tempoMap?: HistoryTimelineEditState['timeline']['tempoMap'];
  masterAudioState?: HistoryTimelineEditState['timeline']['masterAudioState'];
  sharedSceneGraphs?: HistoryTimelineEditState['timeline']['sharedSceneGraphs'];
}

export interface HistoryTimelineRestoreDiagnostics {
  stateId: string;
  restoredClipIds: string[];
  reusedRuntimeClipIds: string[];
  deferredRuntimeClipIds: string[];
  reusedLayerSourceIds: string[];
  deferredLayerSourceIds: string[];
}

export interface CreateHistoryTimelineRestoreStateResult {
  state: HistoryTimelineRestoreState;
  diagnostics: HistoryTimelineRestoreDiagnostics;
}

export interface CreateHistoryTimelineRestoreStateOptions {
  placeholderFileMode?: 'file' | 'plain-data';
}

function clonePlain<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function createHistoryPlaceholderFile(
  name: string,
  sourceType: TimelineSourceType,
  mode: CreateHistoryTimelineRestoreStateOptions['placeholderFileMode'] = 'file',
): File {
  const safeName = name.trim() || `${sourceType}-clip`;
  if (mode !== 'plain-data' && typeof File !== 'undefined') {
    return new File([], safeName, { type: 'application/octet-stream' });
  }
  return {
    name: safeName,
    size: 0,
    type: 'application/octet-stream',
    lastModified: 0,
  } as File;
}

function isReusableSourceForRuntimeRef(
  source: TimelineClip['source'],
  clip: HistoryTimelineClipEditState,
  runtimeRef: HistoryTimelineRuntimeRef,
): boolean {
  if (!source || source.type !== runtimeRef.sourceType) return false;

  const liveInputId = clip.liveInputId ?? runtimeRef.liveInputId;
  if (liveInputId) {
    return source.liveInputId === liveInputId;
  }

  if (runtimeRef.kind === 'media-file') {
    const mediaFileId = clip.mediaFileId ?? source.mediaFileId ?? source.liveInputId;
    return Boolean(
      runtimeRef.mediaFileId &&
      mediaFileId === runtimeRef.mediaFileId
    );
  }

  if (runtimeRef.kind === 'composition') {
    return Boolean(runtimeRef.compositionId && clip.compositionId === runtimeRef.compositionId);
  }

  if (runtimeRef.kind === 'signal') {
    return (
      (!runtimeRef.signalAssetId || clip.signalAssetId === runtimeRef.signalAssetId) &&
      (!runtimeRef.signalRefId || clip.signalRefId === runtimeRef.signalRefId) &&
      (!runtimeRef.signalRenderAdapterId || clip.signalRenderAdapterId === runtimeRef.signalRenderAdapterId)
    );
  }

  if (runtimeRef.kind === 'inline-data') {
    return true;
  }

  // Older snapshots used `missing-media` for generated sources. They are
  // self-contained only when their required durable data is actually present.
  if (
    runtimeRef.kind === 'generated' ||
    (
      runtimeRef.kind === 'missing-media' &&
      isSelfContainedGeneratedClip(clip)
    )
  ) {
    return clip.sourceType !== 'model' || source.meshType === clip.meshType;
  }

  return false;
}

function createDataOnlyClipSource(
  clip: HistoryTimelineClipEditState,
): NonNullable<TimelineClip['source']> {
  const liveInputId = clip.liveInputId ?? clip.runtimeRef.liveInputId;
  return {
    type: clip.sourceType,
    naturalDuration: clip.naturalDuration ?? clip.runtimeRef.naturalDuration ?? clip.outPoint,
    mediaFileId: clip.mediaFileId ?? clip.runtimeRef.mediaFileId ?? liveInputId,
    liveInputId,
    vectorAnimationSettings: clonePlain(clip.vectorAnimationSettings),
    text3DProperties: clonePlain(clip.text3DProperties),
    meshType: clip.meshType,
    cameraSettings: clonePlain(clip.cameraSettings),
    threeDEffectorsEnabled: clip.threeDEffectorsEnabled,
  };
}

function mergeRestoredSourceData(
  runtimeSource: NonNullable<TimelineClip['source']>,
  restoredSource: NonNullable<TimelineClip['source']>,
): NonNullable<TimelineClip['source']> {
  const merged = { ...runtimeSource } as Record<string, unknown>;
  for (const [key, value] of Object.entries(restoredSource)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as unknown as NonNullable<TimelineClip['source']>;
}

function isSelfContainedGeneratedClip(clip: HistoryTimelineClipEditState): boolean {
  return clip.sourceType === 'camera' ||
    (clip.sourceType === 'flock' && Boolean(clip.flock)) || (
    clip.sourceType === 'model' && Boolean(clip.meshType)
  );
}

function createRestoredClip(
  clip: HistoryTimelineClipEditState,
  currentClip: TimelineClip | undefined,
  currentAnalysisSource: TimelineClip | undefined,
  options: CreateHistoryTimelineRestoreStateOptions,
): { clip: TimelineClip; reusedRuntime: boolean } {
  const reusedRuntime = Boolean(
    currentClip &&
      isReusableSourceForRuntimeRef(currentClip.source, clip, clip.runtimeRef)
  );
  const restoredSource = createDataOnlyClipSource(clip);
  const source = reusedRuntime && currentClip?.source
    ? mergeRestoredSourceData(currentClip.source, restoredSource)
    : restoredSource;
  const file = reusedRuntime && currentClip?.file
    ? currentClip.file
    : createHistoryPlaceholderFile(clip.name, clip.sourceType, options.placeholderFileMode);

  return {
    reusedRuntime,
    clip: {
      id: clip.id,
      trackId: clip.trackId,
      name: clip.name,
      file,
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      source,
      mediaFileId: clip.mediaFileId ?? clip.runtimeRef.mediaFileId,
      signalAssetId: clip.signalAssetId,
      signalRefId: clip.signalRefId,
      signalRenderAdapterId: clip.signalRenderAdapterId,
      linkedClipId: clip.linkedClipId,
      linkedGroupId: clip.linkedGroupId,
      editableHook: clip.editableHook ? { ...clip.editableHook } : undefined,
      parentClipId: clip.parentClipId,
      videoState: clonePlain(clip.videoState),
      videoInspectorSections: clonePlain(clip.videoInspectorSections),
      audioState: clonePlain(clip.audioState),
      transform: clonePlain(clip.transform),
      effects: clonePlain(clip.effects),
    planarTracks: clonePlanarTracks(clip.planarTracks),
    terrainAttachment: cloneTerrainAttachment(clip.terrainAttachment),
    terrainScreenAnchor: cloneTerrainScreenAnchor(clip.terrainScreenAnchor),
    terrainAnchorConnector: cloneTerrainAnchorConnector(clip.terrainAnchorConnector),
    trackingBinding: clip.trackingBinding ? structuredClone(clip.trackingBinding) : undefined,
      colorCorrection: clonePlain(clip.colorCorrection),
      sceneGraphOutput: clonePlain(clip.sceneGraphOutput),
      nodeGraph: clonePlain(clip.nodeGraph),
      masks: clonePlain(clip.masks),
      transcriptStatus: clip.transcriptStatus,
      // History states don't carry transcript words (media file is the anchor);
      // reuse the live clip's words or re-derive them from the media store.
      transcript: currentClip?.transcript ?? resolveClipTranscriptWords({
        transcript: undefined,
        mediaFileId: clip.mediaFileId ?? clip.runtimeRef.mediaFileId,
        source: null,
      }),
      analysis: clip.analysisStatus && clip.analysisStatus !== 'none'
        ? currentAnalysisSource?.analysis
        : undefined,
      analysisStatus: clip.analysisStatus,
      analysisProgress: currentAnalysisSource?.analysisProgress,
      faceAnalysisStatus: clip.faceAnalysisStatus,
      faceAnalysisProgress: currentAnalysisSource?.faceAnalysisProgress,
      faceAnalysisMessage: clip.faceAnalysisMessage,
      sceneDescriptionStatus: clip.sceneDescriptionStatus,
      reversed: clip.reversed,
      speed: clip.speed,
      preservesPitch: clip.preservesPitch,
      followsLinkedVideoSpeed: clip.followsLinkedVideoSpeed,
      freeRun: clip.freeRun,
      textProperties: clonePlain(clip.textProperties),
      captionProperties: clonePlain(clip.captionProperties),
      captionLayerBinding: clonePlain(clip.captionLayerBinding),
      text3DProperties: clonePlain(clip.text3DProperties),
      solidColor: clip.solidColor,
      transitionOverlay: clonePlain(clip.transitionOverlay),
      midiData: clonePlain(clip.midiData),
      automation: clonePlain(clip.automation),
      mathScene: clonePlain(clip.mathScene),
      motion: clip.motion
        ? normalizeMotionLayerDefinitionForLoad(clip.motion)
        : undefined,
      flock: clonePlain(clip.flock),
      isComposition: clip.isComposition,
      compositionId: clip.compositionId ?? clip.runtimeRef.compositionId,
      transitionIn: clonePlain(clip.transitionIn),
      transitionOut: clonePlain(clip.transitionOut),
      is3D: clip.is3D,
      wireframe: clip.wireframe,
      meshType: clip.meshType,
      storyboardProperties: clonePlain(clip.storyboardProperties),
      needsReload: clip.runtimeRef.kind === 'inline-data' ||
        clip.runtimeRef.kind === 'generated' ||
        isSelfContainedGeneratedClip(clip)
        ? false
        : !reusedRuntime && !(clip.liveInputId ?? clip.runtimeRef.liveInputId)
          ? true
          : clip.runtimeRef.needsReload,
      isLoading: false,
    },
  };
}

function createRestoredTrack(track: HistoryTimelineTrackEditState): TimelineTrack {
  return {
    id: track.id,
    name: track.name,
    type: track.type,
    height: track.height,
    labelColor: track.labelColor,
    muted: track.muted,
    visible: track.visible,
    solo: track.solo,
    locked: track.locked,
    parentTrackId: track.parentTrackId,
    audioState: clonePlain(track.audioState),
    midiInstrument: clonePlain(track.midiInstrument),
  };
}

function isReusableLayerSource(
  source: Layer['source'],
  sourceRef: HistoryTimelineLayerSourceRef | null,
): boolean {
  if (!source || !sourceRef || source.type !== sourceRef.type) return false;
  if (sourceRef.mediaFileId && source.mediaFileId !== sourceRef.mediaFileId) return false;
  if (sourceRef.previewPath && source.previewPath !== sourceRef.previewPath) return false;
  if (
    typeof sourceRef.proxyFrameIndex === 'number' &&
    source.proxyFrameIndex !== sourceRef.proxyFrameIndex
  ) {
    return false;
  }
  return true;
}

function createDataOnlyLayerSource(sourceRef: HistoryTimelineLayerSourceRef | null): Layer['source'] {
  if (!sourceRef) return null;
  return {
    type: sourceRef.type,
    mediaFileId: sourceRef.mediaFileId,
    previewPath: sourceRef.previewPath,
    proxyFrameIndex: sourceRef.proxyFrameIndex,
  };
}

function createRestoredLayer(
  layer: HistoryTimelineLayerEditState,
  currentLayer: Layer | undefined,
): { layer: Layer; reusedSource: boolean } {
  const { sourceRef, ...layerWithoutSource } = layer;
  const reusedSource = Boolean(
    currentLayer && isReusableLayerSource(currentLayer.source, sourceRef)
  );

  return {
    reusedSource,
    layer: {
      ...clonePlain(layerWithoutSource),
      source: reusedSource && currentLayer?.source
        ? currentLayer.source
        : createDataOnlyLayerSource(sourceRef),
    },
  };
}

export function createHistoryTimelineRestoreState(
  historyState: HistoryTimelineEditState,
  currentTimeline: HistoryTimelineRestoreCurrentState = {},
  options: CreateHistoryTimelineRestoreStateOptions = {},
): CreateHistoryTimelineRestoreStateResult {
  const currentClipsById = new Map(
    (currentTimeline.clips ?? []).map((clip) => [clip.id, clip])
  );
  const currentAnalysisBySourceId = new Map<string, TimelineClip>();
  for (const clip of currentTimeline.clips ?? []) {
    const sourceId = getClipAnalysisSourceId(clip);
    if (sourceId && clip.analysis && !currentAnalysisBySourceId.has(sourceId)) {
      currentAnalysisBySourceId.set(sourceId, clip);
    }
  }
  const currentLayersById = new Map(
    (currentTimeline.layers ?? []).filter(Boolean).map((layer) => [layer.id, layer])
  );
  const reusedRuntimeClipIds: string[] = [];
  const deferredRuntimeClipIds: string[] = [];
  const restoredClipEntries = historyState.timeline.clips.map((clip) => {
    const currentClip = currentClipsById.get(clip.id);
    const sourceId = clip.sourceType === 'video'
      ? clip.mediaFileId ?? clip.runtimeRef.mediaFileId
      : undefined;
    const restored = createRestoredClip(
      clip,
      currentClip,
      currentClip?.analysis ? currentClip : sourceId ? currentAnalysisBySourceId.get(sourceId) : undefined,
      options,
    );
    if (restored.reusedRuntime) {
      reusedRuntimeClipIds.push(clip.id);
    } else if (
      !(clip.liveInputId ?? clip.runtimeRef.liveInputId) &&
      clip.runtimeRef.kind !== 'inline-data' &&
      clip.runtimeRef.kind !== 'generated' &&
      !isSelfContainedGeneratedClip(clip)
    ) {
      deferredRuntimeClipIds.push(clip.id);
    }
    return restored.clip;
  });

  const reusedLayerSourceIds: string[] = [];
  const deferredLayerSourceIds: string[] = [];
  const restoredLayers = historyState.timeline.layers.map((layer) => {
    const restored = createRestoredLayer(layer, currentLayersById.get(layer.id));
    if (restored.reusedSource) {
      reusedLayerSourceIds.push(layer.id);
    } else if (layer.sourceRef) {
      deferredLayerSourceIds.push(layer.id);
    }
    return restored.layer;
  });

  const restoredKeyframes = new Map<string, Keyframe[]>();
  for (const [clipId, keyframes] of Object.entries(historyState.timeline.clipKeyframes)) {
    restoredKeyframes.set(clipId, clonePlain(keyframes));
  }

  return {
    state: {
      duration: historyState.timeline.duration ?? currentTimeline.duration,
      durationLocked: historyState.timeline.durationLocked ?? currentTimeline.durationLocked,
      clips: restoredClipEntries,
      tracks: historyState.timeline.tracks.map(createRestoredTrack),
      selectedClipIds: new Set(historyState.timeline.selectedClipIds),
      zoom: historyState.timeline.zoom,
      scrollX: historyState.timeline.scrollX,
      layers: restoredLayers,
      selectedLayerId: historyState.timeline.selectedLayerId,
      clipKeyframes: restoredKeyframes,
      markers: clonePlain(historyState.timeline.markers),
      tempoMap: clonePlain(historyState.timeline.tempoMap ?? currentTimeline.tempoMap),
      // History entries captured before #299 carry no tempo map, and the result
      // of this function is fed straight to the store's shallow-merging
      // setState — so an `undefined` here would CLOBBER the live tempo map
      // rather than leave it alone. Fall back to the current one.
      sharedSceneGraphs: clonePlain(historyState.timeline.sharedSceneGraphs),
      masterAudioState: clonePlain(historyState.timeline.masterAudioState),
    },
    diagnostics: {
      stateId: historyState.id,
      restoredClipIds: historyState.timeline.clips.map((clip) => clip.id),
      reusedRuntimeClipIds,
      deferredRuntimeClipIds,
      reusedLayerSourceIds,
      deferredLayerSourceIds,
    },
  };
}
