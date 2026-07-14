import type {
  CompositionTimelineData,
  Keyframe,
  TimelineClip,
  TimelineState,
  TimelineTrack,
} from '../types';
import type { SerializableClip } from '../../../types';
import { clonePersistedClipAudioState } from '../../../services/audio/clipAudioStatePersistence';
import { sanitizePlayheadPosition } from '../../../services/layerBuilder/PlayheadState';
import { cloneClipNodeGraph } from '../../../services/nodeGraph';
import { normalizeTransitionInstanceParams } from '../../../transitions';
import { useMediaStore } from '../../mediaStore';
import { getDataOnlyTimelineSource } from '../sourceRuntimeSanitizer';
import { serializeVideoBakeRegion } from '../videoBakeSlice';

type SerializableTimelineStateInput = Pick<
  TimelineState,
  | 'tracks'
  | 'clips'
  | 'playheadPosition'
  | 'duration'
  | 'durationLocked'
  | 'zoom'
  | 'scrollX'
  | 'inPoint'
  | 'outPoint'
  | 'loopPlayback'
  | 'clipKeyframes'
  | 'markers'
  | 'tempoMap'
  | 'rulerLanes'
  | 'activeRulerLaneId'
  | 'videoBakeRegions'
  | 'masterAudioState'
>;

function createSerializableTrack(track: TimelineTrack): TimelineTrack {
  return {
    ...track,
    audioState: track.audioState ? structuredClone(track.audioState) : undefined,
  };
}

function resolveSerializableMediaFileId(
  clip: TimelineClip,
  dataOnlySource: ReturnType<typeof getDataOnlyTimelineSource>,
): string {
  let resolvedMediaFileId = dataOnlySource?.mediaFileId || '';

  if (!resolvedMediaFileId && !clip.isComposition && !clip.signalAssetId) {
    let lookupName = clip.name;
    if (clip.linkedClipId && dataOnlySource?.type === 'audio' && lookupName.endsWith(' (Audio)')) {
      lookupName = lookupName.replace(' (Audio)', '');
    }
    const mediaFile = useMediaStore.getState().files.find(f => f.name === lookupName);
    resolvedMediaFileId = mediaFile?.id || '';
  }

  return resolvedMediaFileId;
}

function createSerializableClip(
  clip: TimelineClip,
  clipKeyframes: Map<string, Keyframe[]>,
): SerializableClip {
  const dataOnlySource = getDataOnlyTimelineSource(clip);
  const resolvedMediaFileId = resolveSerializableMediaFileId(clip, dataOnlySource);
  const keyframes = clipKeyframes.get(clip.id) || [];

  return {
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    mediaFileId: clip.isComposition ? '' : resolvedMediaFileId,
    signalAssetId: clip.signalAssetId,
    signalRefId: clip.signalRefId,
    signalRenderAdapterId: clip.signalRenderAdapterId,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    sourceType: dataOnlySource?.type || 'video',
    naturalDuration: dataOnlySource?.naturalDuration,
    midiData: dataOnlySource?.type === 'midi' && clip.midiData
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
    sourceRect: clip.sourceRect ? structuredClone(clip.sourceRect) : undefined,
    transitionRender: clip.transitionRender ? structuredClone(clip.transitionRender) : undefined,
    effects: clip.effects,
    transitionIn: clip.transitionIn ? normalizeTransitionInstanceParams(structuredClone(clip.transitionIn)) : undefined,
    transitionOut: clip.transitionOut ? normalizeTransitionInstanceParams(structuredClone(clip.transitionOut)) : undefined,
    colorCorrection: clip.colorCorrection ? structuredClone(clip.colorCorrection) : undefined,
    nodeGraph: cloneClipNodeGraph(clip.nodeGraph),
    keyframes: keyframes.length > 0 ? keyframes : undefined,
    isComposition: clip.isComposition,
    compositionId: clip.compositionId,
    masks: clip.masks && clip.masks.length > 0 ? clip.masks : undefined,
    transcript: clip.transcript && clip.transcript.length > 0 ? clip.transcript : undefined,
    transcriptStatus: clip.transcriptStatus !== 'none' ? clip.transcriptStatus : undefined,
    analysis: clip.analysis,
    analysisStatus: clip.analysisStatus !== 'none' ? clip.analysisStatus : undefined,
    reversed: clip.reversed || undefined,
    speed: clip.speed != null && clip.speed !== 1 ? clip.speed : undefined,
    preservesPitch: clip.preservesPitch === false ? false : undefined,
    textProperties: clip.textProperties,
    text3DProperties: clip.text3DProperties ?? dataOnlySource?.text3DProperties,
    solidColor: dataOnlySource?.type === 'solid' ? (clip.solidColor || clip.name.replace('Solid ', '')) : undefined,
    transitionOverlay: dataOnlySource?.type === 'transition-overlay'
      ? structuredClone(clip.transitionOverlay ?? dataOnlySource.transitionOverlay)
      : undefined,
    vectorAnimationSettings: dataOnlySource?.vectorAnimationSettings,
    mathScene: dataOnlySource?.type === 'math-scene' && clip.mathScene
      ? structuredClone(clip.mathScene)
      : undefined,
    motion: clip.motion ? structuredClone(clip.motion) : undefined,
    is3D: clip.is3D || undefined,
    threeDEffectorsEnabled: dataOnlySource?.threeDEffectorsEnabled,
    meshType: clip.meshType ?? dataOnlySource?.meshType,
    modelPrimitiveIndex: dataOnlySource?.type === 'model' ? dataOnlySource.modelPrimitiveIndex : undefined,
    modelMaterialSettings: dataOnlySource?.type === 'model' ? dataOnlySource.modelMaterialSettings : undefined,
    cameraSettings: dataOnlySource?.type === 'camera' ? dataOnlySource.cameraSettings : undefined,
    lightSettings: dataOnlySource?.type === 'light' ? dataOnlySource.lightSettings : undefined,
    splatEffectorSettings: dataOnlySource?.type === 'splat-effector' ? dataOnlySource.splatEffectorSettings : undefined,
    gaussianBlendshapes: dataOnlySource?.type === 'gaussian-avatar' ? dataOnlySource.gaussianBlendshapes : undefined,
    gaussianSplatSequence: dataOnlySource?.type === 'gaussian-splat' ? dataOnlySource.gaussianSplatSequence : undefined,
    gaussianSplatSettings: dataOnlySource?.type === 'gaussian-splat' ? dataOnlySource.gaussianSplatSettings : undefined,
  };
}

export function createSerializableTimelineState(
  state: SerializableTimelineStateInput,
): CompositionTimelineData {
  return {
    tracks: state.tracks.map(createSerializableTrack),
    clips: state.clips.map(clip => createSerializableClip(clip, state.clipKeyframes)),
    playheadPosition: sanitizePlayheadPosition(state.playheadPosition, 0),
    duration: state.duration,
    durationLocked: state.durationLocked || undefined,
    zoom: state.zoom,
    scrollX: state.scrollX,
    inPoint: state.inPoint,
    outPoint: state.outPoint,
    loopPlayback: state.loopPlayback,
    markers: state.markers.length > 0 ? state.markers : undefined,
    // Always emitted: runtime state is always defaulted (issue #257).
    tempoMap: structuredClone(state.tempoMap),
    rulerLanes: state.rulerLanes.map(lane => ({ ...lane })),
    activeRulerLaneId: state.activeRulerLaneId,
    videoBakeRegions: state.videoBakeRegions.length > 0
      ? state.videoBakeRegions.map(serializeVideoBakeRegion)
      : undefined,
    masterAudioState: state.masterAudioState ? structuredClone(state.masterAudioState) : undefined,
  };
}
