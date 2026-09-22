import { clonePlanarTracks } from '../../../services/planarTracking/clonePlanarTracks';
import { cloneTerrainAnchorConnector, cloneTerrainAttachment, cloneTerrainScreenAnchor } from '../../../types/terrainAttachment';
import { cloneTrackingBinding } from '../../../types/trackingBinding';
import { clonePersistedClipAudioState } from '../../../services/audio/clipAudioStatePersistence';
import * as facePersistence from '../../../services/faceAnalysis/faceAnalysisPersistence';
import { cloneClipNodeGraph } from '../../../services/nodeGraph';
import { recoverPersistedTranscriptStatus } from '../../../services/transcription/persistedTranscriptStatus';
import { normalizeTransitionInstanceParams } from '../../../transitions';
import type { useMediaStore } from '../../mediaStore';
import { restorePersistedClipVideoState } from '../nestedRestore';
import type { SerializableClip, TimelineClip } from '../types';

type MediaFile = ReturnType<typeof useMediaStore.getState>['files'][number];

export function createInitialRestoredMediaSource(
  serializedClip: SerializableClip,
  mediaFile: MediaFile,
  spatialSources: {
    createGaussianSplat: (
      serializedClip: SerializableClip,
      duration: number,
      mediaFile: MediaFile,
    ) => TimelineClip['source'] | null;
    createModel: (
      serializedClip: SerializableClip,
      duration: number,
      mediaFile: MediaFile,
    ) => TimelineClip['source'] | null;
  },
): TimelineClip['source'] {
  if (serializedClip.sourceType === 'gaussian-splat') {
    const gaussianSplatSource = spatialSources.createGaussianSplat(
      serializedClip,
      serializedClip.duration,
      mediaFile,
    );
    if (gaussianSplatSource) return gaussianSplatSource;
  }
  const restoredModelSource = serializedClip.sourceType === 'model'
    ? spatialSources.createModel(serializedClip, serializedClip.duration, mediaFile)
    : null;
  return {
    type: serializedClip.sourceType,
    mediaFileId: serializedClip.mediaFileId,
    naturalDuration: serializedClip.naturalDuration,
    vectorAnimationSettings: serializedClip.vectorAnimationSettings,
    threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
    modelSequence: restoredModelSource?.modelSequence,
    modelPrimitiveIndex: restoredModelSource?.modelPrimitiveIndex,
    modelMaterialSettings: restoredModelSource?.modelMaterialSettings,
  };
}

export function createRestoredMediaClip(params: {
  file: File;
  initialSource: TimelineClip['source'];
  mediaFile: MediaFile;
  needsReload: boolean;
  serializedClip: SerializableClip;
}): TimelineClip {
  const { file, initialSource, mediaFile, needsReload, serializedClip } = params;
  const analysis = facePersistence.sanitizePersistedFaceAnalysis(serializedClip.analysis)
    ?? mediaFile.analysis;
  const faceAnalysisStatus = facePersistence.normalizePersistedFaceStatus(
    serializedClip.faceAnalysisStatus ?? mediaFile.faceAnalysisStatus,
    analysis,
  );
  const transcript = serializedClip.transcript?.length
    ? serializedClip.transcript
    : mediaFile.transcript;
  return {
    id: serializedClip.id,
    trackId: serializedClip.trackId,
    name: serializedClip.name || mediaFile.name || 'Untitled',
    file,
    signalAssetId: serializedClip.signalAssetId,
    signalRefId: serializedClip.signalRefId,
    signalRenderAdapterId: serializedClip.signalRenderAdapterId,
    startTime: serializedClip.startTime,
    duration: serializedClip.duration,
    inPoint: serializedClip.inPoint,
    outPoint: serializedClip.outPoint,
    source: initialSource,
    mediaFileId: serializedClip.mediaFileId,
    needsReload,
    thumbnails: serializedClip.thumbnails,
    linkedClipId: serializedClip.linkedClipId,
    linkedGroupId: serializedClip.linkedGroupId,
    editableHook: serializedClip.editableHook ? { ...serializedClip.editableHook } : undefined,
    parentClipId: serializedClip.parentClipId,
    videoState: restorePersistedClipVideoState(serializedClip),
    audioState: clonePersistedClipAudioState(serializedClip.audioState),
    waveform: serializedClip.waveform,
    waveformChannels: serializedClip.waveformChannels,
    transform: serializedClip.transform,
    videoInspectorSections: serializedClip.videoInspectorSections
      ? { ...serializedClip.videoInspectorSections }
      : undefined,
    sourceRect: serializedClip.sourceRect ? { ...serializedClip.sourceRect } : undefined,
    transitionRender: serializedClip.transitionRender ? structuredClone(serializedClip.transitionRender) : undefined,
    effects: serializedClip.effects || [],
    planarTracks: clonePlanarTracks(serializedClip.planarTracks),
    trackingBinding: cloneTrackingBinding(serializedClip.trackingBinding),
    terrainAttachment: cloneTerrainAttachment(serializedClip.terrainAttachment),
    terrainScreenAnchor: cloneTerrainScreenAnchor(serializedClip.terrainScreenAnchor),
    terrainAnchorConnector: cloneTerrainAnchorConnector(serializedClip.terrainAnchorConnector),
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
    isLoading: !needsReload,
    masks: serializedClip.masks,
    transcript,
    transcriptStatus: recoverPersistedTranscriptStatus(
      serializedClip.transcriptStatus ?? mediaFile.transcriptStatus,
      transcript,
    ),
    analysis,
    analysisStatus: serializedClip.analysisStatus ?? mediaFile.analysisStatus ?? 'none',
    analysisProgress: mediaFile.analysisProgress,
    faceAnalysisStatus,
    faceAnalysisProgress: mediaFile.faceAnalysisProgress,
    faceAnalysisMessage: faceAnalysisStatus === 'error'
      ? serializedClip.faceAnalysisMessage ?? mediaFile.faceAnalysisMessage
      : undefined,
    sceneDescriptions: serializedClip.sceneDescriptions?.length
      ? serializedClip.sceneDescriptions
      : mediaFile.sceneDescriptions,
    sceneDescriptionStatus: serializedClip.sceneDescriptionStatus
      ?? mediaFile.sceneDescriptionStatus,
    sceneDescriptionProgress: mediaFile.sceneDescriptionProgress,
    sceneDescriptionMessage: mediaFile.sceneDescriptionMessage,
    reversed: serializedClip.reversed,
    speed: serializedClip.speed,
    preservesPitch: serializedClip.preservesPitch,
    followsLinkedVideoSpeed: serializedClip.followsLinkedVideoSpeed,
    freeRun: serializedClip.freeRun,
    is3D: serializedClip.is3D,
    meshType: serializedClip.meshType,
  };
}
