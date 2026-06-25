import type { Layer } from '../../types/layers';
import type { SerializableClip, TimelineClip, TimelineTrack } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import type { VectorAnimationClipSettings } from '../../types/vectorAnimation';
import {
  DEFAULT_TRANSITION_PLACEMENT,
  findActiveTransitionPlanForTrack,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { assemblePreviewTransitionLayers } from '../layerBuilder/transitionLayerAssembly';
import { buildEvaluatedClipLayer } from './layerEvaluation';
import type {
  CompositionMediaFile,
  CompositionSources,
  EvaluatedLayer,
} from './sourceTypes';

type VectorSettingsReader = (clipId: string, localTime: number) => VectorAnimationClipSettings | undefined;
type ClipKeyframesReader = (clipId: string) => readonly Keyframe[] | undefined;

function createPlaceholderFile(name: string): File {
  return typeof File !== 'undefined'
    ? new File([], name)
    : ({} as File);
}

function asTimelineClip(clip: SerializableClip | TimelineClip): TimelineClip {
  const timelineClip = clip as TimelineClip;
  if (timelineClip.source !== undefined) return timelineClip;

  const serializableClip = clip as SerializableClip;
  return {
    ...serializableClip,
    file: createPlaceholderFile(serializableClip.name || 'clip'),
    source: {
      type: serializableClip.sourceType,
      mediaFileId: serializableClip.mediaFileId || undefined,
      naturalDuration: serializableClip.naturalDuration,
      vectorAnimationSettings: serializableClip.vectorAnimationSettings,
      threeDEffectorsEnabled: serializableClip.threeDEffectorsEnabled,
      modelSequence: serializableClip.modelSequence,
      gaussianSplatSequence: serializableClip.gaussianSplatSequence,
      meshType: serializableClip.meshType,
      cameraSettings: serializableClip.cameraSettings,
      splatEffectorSettings: serializableClip.splatEffectorSettings,
      gaussianBlendshapes: serializableClip.gaussianBlendshapes,
      gaussianSplatSettings: serializableClip.gaussianSplatSettings,
    },
    transform: serializableClip.transform,
    effects: serializableClip.effects || [],
  } as TimelineClip;
}

export function buildCompositionTransitionLayersForTrack(params: {
  compositionId: string;
  time: number;
  track: TimelineTrack;
  trackIndex: number;
  clips: readonly (SerializableClip | TimelineClip)[];
  sources: CompositionSources;
  mediaFiles: readonly CompositionMediaFile[];
  width: number;
  height: number;
  isActiveComposition: boolean;
  getVectorAnimationSettings: VectorSettingsReader;
  getClipKeyframes?: ClipKeyframesReader;
}): EvaluatedLayer[] | null {
  const {
    compositionId,
    time,
    track,
    trackIndex,
    clips,
    sources,
    mediaFiles,
    width,
    height,
    isActiveComposition,
    getVectorAnimationSettings,
    getClipKeyframes,
  } = params;
  const transitionTimelineClips = clips.map(asTimelineClip);
  const mediaDurationById = new Map(mediaFiles.map((mediaFile) => [mediaFile.id, mediaFile.duration]));
  const activeTransition = findActiveTransitionPlanForTrack({
    clips: transitionTimelineClips,
    trackId: track.id,
    time,
    placement: DEFAULT_TRANSITION_PLACEMENT,
    edgePolicy: 'hold',
    getMediaDuration: (mediaFileId) => mediaDurationById.get(mediaFileId),
  });
  if (!activeTransition) return null;

  return assemblePreviewTransitionLayers({
    plan: activeTransition.plan,
    playheadPosition: time,
    trackIndex,
    outgoingClip: activeTransition.outgoingClip,
    incomingClip: activeTransition.incomingClip,
    buildClipLayer: (transitionClip, _role, opacity) => {
      const source = sources.clipSources.get(transitionClip.id);
      if (!source) return null;
      return buildEvaluatedClipLayer({
        compositionId,
        time,
        clipAtTime: transitionClip,
        source,
        isActiveComposition,
        getVectorAnimationSettings,
        getClipKeyframes,
        opacityOverride: opacity,
      }) as Layer;
    },
    outputSize: { width, height },
  }) as EvaluatedLayer[];
}
