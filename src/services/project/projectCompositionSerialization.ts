import type { Composition } from '../../stores/mediaStore';
import type { ClipVideoState, Effect, SerializableClip, SerializableMarker, TimelineClip, VideoBakeRegion } from '../../types';
import type { ProjectComposition, ProjectTrack, ProjectClip, ProjectMarker } from '../projectFileService';
import { clonePlanarTracks } from '../planarTracking/clonePlanarTracks';
import { cloneTerrainAnchorConnector, cloneTerrainAttachment, cloneTerrainScreenAnchor } from '../../types/terrainAttachment';
import { cloneTrackingBinding } from '../../types/trackingBinding';
import { clonePersistedClipAudioState } from '../audio/clipAudioStatePersistence';
import { cloneClipNodeGraph } from '../nodeGraph';
import { remapKeyframeNodeProperties } from '../nodeGraph/keyframeNodeRemapping';
import { cloneStoryboardClipProperties } from '../storyboard/core';
import { normalizeTransitionInstanceParams } from '../../transitions';
import { normalizeMotionLayerDefinition } from '../motionDesign/contracts/replicatorTimelineAdapter';
import { toProjectTransform } from './transformSerialization';
import { serializeMaskEdgeFeathers, serializeMaskKeyframeProperty } from './maskSerialization';
import { normalizeRulerLaneState } from '../../timeline/tempo/rulerDefaults';
import { serializeGaussianSplatSequence, serializeModelSequence } from './projectMediaSerialization';
import { migratePersistedEffectOperatorGraph } from '../operators/effectGraphOwner';

type ProjectSaveClip = SerializableClip & {
  source?: TimelineClip['source'];
  mediaId?: string;
  volume?: number;
  audioEnabled?: boolean;
  disabled?: boolean;
};
type ProjectSaveTrack = NonNullable<Composition['timelineData']>['tracks'][number] & {
  locked?: boolean;
};

function serializeProjectVideoBakeRegion(region: VideoBakeRegion): VideoBakeRegion {
  const clone = structuredClone(region);
  delete clone.bakedAt;
  delete clone.error;
  delete clone.progress;
  clone.status = 'marked';
  return clone;
}

function serializeProjectClipVideoState(videoState: ClipVideoState | undefined): ClipVideoState | undefined {
  if (!videoState) return undefined;
  return {
    ...structuredClone(videoState),
    bakeRegions: videoState.bakeRegions?.map(serializeProjectVideoBakeRegion),
  };
}

function serializeProjectEffect(effect: Effect) {
  const migrated = migratePersistedEffectOperatorGraph(effect);
  return {
    id: migrated.id, type: migrated.type, name: migrated.name || migrated.type,
    enabled: migrated.enabled !== false, params: structuredClone(migrated.params),
    operatorGraph: migrated.operatorGraph ? structuredClone(migrated.operatorGraph) : undefined,
  };
}

function shouldPersistClipWaveform(clip: ProjectSaveClip): boolean {
  return !clip.audioState?.sourceAnalysisRefs?.waveformPyramidId &&
    !clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId;
}

// ============================================
// CONVERTER HELPERS (store → project format)
// ============================================

/**
 * Convert compositions to ProjectComposition format
 */
export function convertCompositions(compositions: Composition[]): ProjectComposition[] {
  return compositions.map((comp) => {
    const timelineData = comp.timelineData;
    const duration = timelineData?.duration ?? comp.duration;

    // Convert tracks
    const tracks: ProjectTrack[] = ((timelineData?.tracks || []) as ProjectSaveTrack[]).map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      height: t.height || 60,
      labelColor: t.labelColor && t.labelColor !== 'none' ? t.labelColor : undefined,
      locked: t.locked || false,
      visible: t.visible !== false,
      muted: t.muted || false,
      solo: t.solo || false,
      audioState: t.audioState ? structuredClone(t.audioState) : undefined,
      // MIDI track instrument (issue #182/#193) — persist so the synth + GM program
      // survive a hard refresh / project reload, not just the in-memory loadState path.
      midiInstrument: t.midiInstrument ? structuredClone(t.midiInstrument) : undefined,
    }));

    // Convert clips
    const clips: ProjectClip[] = ((timelineData?.clips || []) as ProjectSaveClip[]).map((c) => ({
      id: c.id,
      trackId: c.trackId,
      name: c.name || '',
      mediaId: c.source?.mediaFileId || c.mediaFileId || c.mediaId || '',
      signalAssetId: c.signalAssetId,
      signalRefId: c.signalRefId,
      signalRenderAdapterId: c.signalRenderAdapterId,
      sourceType: c.source?.type || c.sourceType || 'video',
      liveInputId: c.source?.liveInputId || c.liveInputId,
      naturalDuration: c.source?.naturalDuration || c.naturalDuration,
      // MIDI note data (issue #182) — notes on the clip, instrument on the track.
      midiData: (c.source?.type === 'midi' || c.sourceType === 'midi') && c.midiData
        ? structuredClone(c.midiData)
        : undefined,
      // MIDI clip automation (issue #298) — the four performed CC lanes.
      automation: (c.source?.type === 'midi' || c.sourceType === 'midi') && c.automation
        ? structuredClone(c.automation)
        : undefined,
      thumbnails: c.thumbnails,
      linkedClipId: c.linkedClipId,
      linkedGroupId: c.linkedGroupId,
      editableHook: c.editableHook ? { ...c.editableHook } : undefined,
      videoState: serializeProjectClipVideoState(c.videoState),
      waveform: shouldPersistClipWaveform(c) ? c.waveform : undefined,
      waveformChannels: shouldPersistClipWaveform(c) ? c.waveformChannels : undefined,
      audioState: clonePersistedClipAudioState(c.audioState),
      modelSequence: serializeModelSequence(c.source?.modelSequence || c.modelSequence),
      gaussianSplatSequence: serializeGaussianSplatSequence(c.source?.gaussianSplatSequence || c.gaussianSplatSequence),
      meshType: c.source?.meshType || c.meshType,
      modelPrimitiveIndex: c.source?.modelPrimitiveIndex ?? c.modelPrimitiveIndex,
      modelMaterialSettings: c.source?.modelMaterialSettings || c.modelMaterialSettings,
      text3DProperties: c.source?.text3DProperties || c.text3DProperties,
      cameraSettings: c.source?.cameraSettings || c.cameraSettings,
      lightSettings: c.source?.lightSettings || c.lightSettings,
      splatEffectorSettings: c.source?.splatEffectorSettings || c.splatEffectorSettings,
      threeDEffectorsEnabled: c.source?.threeDEffectorsEnabled,
      gaussianBlendshapes: c.source?.gaussianBlendshapes || c.gaussianBlendshapes,
      gaussianSplatSettings: c.source?.gaussianSplatSettings || c.gaussianSplatSettings,
      is3D: c.is3D || undefined,
      startTime: c.startTime,
      duration: c.duration,
      inPoint: c.inPoint || 0,
      outPoint: c.outPoint || c.duration,
      transform: toProjectTransform(c.transform),
      sourceRect: c.sourceRect ? structuredClone(c.sourceRect) : undefined,
      transitionRender: c.transitionRender ? structuredClone(c.transitionRender) : undefined,
      planarTracks: clonePlanarTracks(c.planarTracks),
      trackingBinding: cloneTrackingBinding(c.trackingBinding),
      terrainAttachment: cloneTerrainAttachment(c.terrainAttachment),
      terrainScreenAnchor: cloneTerrainScreenAnchor(c.terrainScreenAnchor),
      terrainAnchorConnector: cloneTerrainAnchorConnector(c.terrainAnchorConnector),
      effects: (c.effects || []).map(serializeProjectEffect),
      transitionIn: c.transitionIn ? normalizeTransitionInstanceParams(structuredClone(c.transitionIn)) : undefined,
      transitionOut: c.transitionOut ? normalizeTransitionInstanceParams(structuredClone(c.transitionOut)) : undefined,
      transitionSourceTimeOverride: c.transitionSourceTimeOverride,
      transitionSourceHold: c.transitionSourceHold,
      transitionSourceMap: c.transitionSourceMap ? structuredClone(c.transitionSourceMap) : undefined,
      transitionRecipeBlendWindows: c.transitionRecipeBlendWindows ? structuredClone(c.transitionRecipeBlendWindows) : undefined,
      colorCorrection: c.colorCorrection ? structuredClone(c.colorCorrection) : undefined,
      colorGradeMode: c.colorGradeMode,
      localColorCorrection: c.localColorCorrection
        ? structuredClone(c.localColorCorrection)
        : undefined,
      sceneGraphOutput: c.sceneGraphOutput,
      nodeGraph: remapKeyframeNodeProperties(cloneClipNodeGraph(c.nodeGraph), property => serializeMaskKeyframeProperty(property, c.masks)),
      masks: (c.masks || []).map((m) => ({
        id: m.id,
        name: m.name || 'Mask',
        purpose: m.purpose,
        compositeEnabled: m.compositeEnabled,
        mode: m.mode || 'add',
        inverted: m.inverted || false,
        opacity: m.opacity ?? 1,
        feather: m.feather || 0,
        edgeFeathers: serializeMaskEdgeFeathers(m),
        featherQuality: m.featherQuality ?? 50,
        enabled: m.enabled !== false,
        visible: m.visible !== false,
        outlineColor: m.outlineColor,
        closed: m.closed !== false,
        vertices: (m.vertices || []).map((vertex) => ({
          x: vertex.x,
          y: vertex.y,
          inTangent: vertex.handleIn ?? { x: 0, y: 0 },
          outTangent: vertex.handleOut ?? { x: 0, y: 0 },
          handleMode: vertex.handleMode,
        })),
        position: m.position || { x: 0, y: 0 },
        rotation: m.rotation ?? 0,
      })),
      keyframes: (c.keyframes || []).map((keyframe) => ({
        ...keyframe,
        property: serializeMaskKeyframeProperty(keyframe.property, c.masks),
      })),
      volume: c.volume ?? 1,
      audioEnabled: c.audioEnabled !== false,
      reversed: c.reversed || false,
      disabled: c.disabled || false,
      speed: c.speed,
      videoInspectorSections: c.videoInspectorSections,
      preservesPitch: c.preservesPitch,
      followsLinkedVideoSpeed: c.followsLinkedVideoSpeed,
      freeRun: c.freeRun,
      // Nested composition support
      isComposition: c.isComposition || undefined,
      compositionId: c.compositionId || undefined,
      // Motion Design structure support
      parentClipId: c.parentClipId || undefined,
      // Text clip support
      textProperties: c.textProperties || undefined,
      captionProperties: c.captionProperties
        ? structuredClone(c.captionProperties)
        : undefined,
      captionLayerBinding: c.captionLayerBinding
        ? structuredClone(c.captionLayerBinding)
        : undefined,
      // Solid clip support
      solidColor: c.solidColor || undefined,
      storyboardProperties: cloneStoryboardClipProperties(c.storyboardProperties),
      // Generated transition overlay support
      transitionOverlay: c.transitionOverlay || c.source?.transitionOverlay
        ? structuredClone(c.transitionOverlay ?? c.source?.transitionOverlay)
        : undefined,
      // Math scene clip support
      mathScene: c.mathScene ? structuredClone(c.mathScene) : undefined,
      // Flock clip executable graph (plain JSON; runtime caches live elsewhere)
      flock: (c.source?.type === 'flock' || c.sourceType === 'flock') && c.flock ? structuredClone(c.flock) : undefined,
      // Motion design clip support
      motion: c.motion ? normalizeMotionLayerDefinition(c.motion) : undefined,
      vectorAnimationSettings: c.source?.vectorAnimationSettings || c.vectorAnimationSettings || undefined,
      // Transcript, visual analysis, face analysis, and scene descriptions are
      // media-scoped artifacts. They must never be duplicated into compositions.
    }));

    const markers: ProjectMarker[] = ((timelineData?.markers || []) as SerializableMarker[]).map((marker) => ({
      id: marker.id,
      time: marker.time,
      name: marker.label || '',
      color: marker.color || '#2997E5',
      duration: 0,
      stopPlayback: marker.stopPlayback === true ? true : undefined,
      midiBindings: marker.midiBindings || undefined,
    }));

    // Multi-ruler infrastructure (issue #257) — persist lanes/tempo, defaulting
    // comps authored before the feature so the durable file always has the fields.
    const rulerState = normalizeRulerLaneState({
      tempoMap: timelineData?.tempoMap,
      rulerLanes: timelineData?.rulerLanes,
      activeRulerLaneId: timelineData?.activeRulerLaneId,
    });

    return {
      id: comp.id,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      frameRate: comp.frameRate,
      duration,
      durationLocked: timelineData?.durationLocked ?? false,
      backgroundColor: comp.backgroundColor,
      folderId: comp.parentId,
      labelColor: comp.labelColor && comp.labelColor !== 'none' ? comp.labelColor : undefined,
      transitionComp: comp.transitionComp ? structuredClone(comp.transitionComp) : undefined,
      captionComp: comp.captionComp ? structuredClone(comp.captionComp) : undefined,
      annotations: comp.annotations ? structuredClone(comp.annotations) : undefined,
      tracks,
      clips,
      videoBakeRegions: timelineData?.videoBakeRegions
        ? timelineData.videoBakeRegions.map(serializeProjectVideoBakeRegion)
        : undefined,
      sharedSceneGraphs: timelineData?.sharedSceneGraphs,
      masterAudioState: timelineData?.masterAudioState
        ? structuredClone(timelineData.masterAudioState)
        : undefined,
      markers,
      tempoMap: rulerState.tempoMap,
      rulerLanes: rulerState.rulerLanes,
      activeRulerLaneId: rulerState.activeRulerLaneId,
    };
  });
}
