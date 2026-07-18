import type { Keyframe } from '../../types/keyframes';
import type { SerializableClip, TimelineClip } from '../../types/timeline';
import type { TransitionSourceMap, TransitionSourceMapV2 } from '../../types/timelineCore';
import type { TransitionSourceDurationResolver } from '../../stores/timeline/editOperations/transitionPlanner';

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function getSourceType(clip: TimelineClip): SerializableClip['sourceType'] {
  return (clip.source?.type ?? 'video') as SerializableClip['sourceType'];
}

export function serializeFallbackClip(clip: TimelineClip): SerializableClip {
  const runtimeKeyframes = (clip as TimelineClip & { keyframes?: Keyframe[] }).keyframes;
  return {
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    mediaFileId: clip.source?.mediaFileId ?? clip.mediaFileId ?? '',
    signalAssetId: clip.signalAssetId,
    signalRefId: clip.signalRefId,
    signalRenderAdapterId: clip.signalRenderAdapterId,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    sourceType: getSourceType(clip),
    naturalDuration: clip.source?.naturalDuration,
    thumbnails: clip.thumbnails,
    linkedClipId: clip.linkedClipId,
    linkedGroupId: clip.linkedGroupId,
    videoState: clip.videoState ? clone(clip.videoState) : undefined,
    audioState: clip.audioState ? clone(clip.audioState) : undefined,
    waveform: clip.waveform,
    waveformChannels: clip.waveformChannels,
    transform: clone(clip.transform),
    sourceRect: clip.sourceRect ? clone(clip.sourceRect) : undefined,
    effects: clone(clip.effects ?? []),
    keyframes: runtimeKeyframes ? clone(runtimeKeyframes) : undefined,
    colorCorrection: clip.colorCorrection ? clone(clip.colorCorrection) : undefined,
    nodeGraph: clip.nodeGraph ? clone(clip.nodeGraph) : undefined,
    masks: clip.masks ? clone(clip.masks) : undefined,
    transcript: clip.transcript ? clone(clip.transcript) : undefined,
    transcriptStatus: clip.transcriptStatus,
    analysis: clip.analysis ? clone(clip.analysis) : undefined,
    analysisStatus: clip.analysisStatus,
    reversed: clip.reversed,
    speed: clip.speed,
    preservesPitch: clip.preservesPitch,
    textProperties: clip.textProperties ? clone(clip.textProperties) : undefined,
    text3DProperties: clip.text3DProperties ? clone(clip.text3DProperties) : undefined,
    solidColor: clip.solidColor,
    transitionOverlay: clip.transitionOverlay ? clone(clip.transitionOverlay) : clip.source?.transitionOverlay ? clone(clip.source.transitionOverlay) : undefined,
    midiData: clip.midiData ? clone(clip.midiData) : undefined,
    vectorAnimationSettings: clip.source?.vectorAnimationSettings,
    mathScene: clip.mathScene ? clone(clip.mathScene) : undefined,
    motion: clip.motion ? clone(clip.motion) : undefined,
    transitionIn: clip.transitionIn ? clone(clip.transitionIn) : undefined,
    transitionOut: clip.transitionOut ? clone(clip.transitionOut) : undefined,
    transitionSourceTimeOverride: clip.transitionSourceTimeOverride,
    transitionSourceHold: clip.transitionSourceHold,
    is3D: clip.is3D,
    modelSequence: clip.source?.modelSequence,
    gaussianSplatSequence: clip.source?.gaussianSplatSequence,
    threeDEffectorsEnabled: clip.source?.threeDEffectorsEnabled,
    meshType: clip.meshType ?? clip.source?.meshType,
    modelMaterialSettings: clip.source?.type === 'model' ? clip.source.modelMaterialSettings : undefined,
    cameraSettings: clip.source?.cameraSettings,
    lightSettings: clip.source?.type === 'light' ? clip.source.lightSettings : undefined,
    splatEffectorSettings: clip.source?.splatEffectorSettings,
    gaussianBlendshapes: clip.source?.gaussianBlendshapes,
    gaussianSplatSettings: clip.source?.gaussianSplatSettings,
  };
}

export function getSerializableClip(
  runtimeClip: TimelineClip,
  serializableClips: readonly SerializableClip[],
): SerializableClip {
  return clone(serializableClips.find((clip) => clip.id === runtimeClip.id) ?? serializeFallbackClip(runtimeClip));
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

const MEDIA_DURATION_ROUNDING_TOLERANCE = 0.05;

/** Returns a durable media bound; mapped video/audio clips may not guess one. */
export function resolveTransitionCompositionMediaDuration(
  clip: SerializableClip,
  getMediaDuration: TransitionSourceDurationResolver,
): number | null {
  const resolved = getMediaDuration(clip.mediaFileId);
  const mediaDuration = isPositiveFinite(resolved)
    ? resolved
    : isPositiveFinite(clip.naturalDuration)
      ? clip.naturalDuration
      : clip.sourceType === 'video' || clip.sourceType === 'audio'
        ? undefined
        : isPositiveFinite(clip.outPoint)
          ? clip.outPoint
          : undefined;

  return mediaDuration !== undefined &&
    Number.isFinite(clip.duration) && clip.duration > 0 &&
    Number.isFinite(clip.inPoint) && Number.isFinite(clip.outPoint) &&
    clip.inPoint >= 0 && clip.inPoint <= mediaDuration &&
    clip.outPoint >= clip.inPoint && clip.outPoint <= mediaDuration + MEDIA_DURATION_ROUNDING_TOLERANCE
    ? mediaDuration
    : null;
}

function rebaseKeyframes(
  keyframes: readonly Keyframe[],
  targetClipId: string,
  sourceClipId?: string,
): Keyframe[] {
  const sourcePrefix = sourceClipId ? `${sourceClipId}:` : '';
  return keyframes.map((keyframe) => {
    const originalId = sourcePrefix && keyframe.id.startsWith(sourcePrefix)
      ? keyframe.id.slice(sourcePrefix.length)
      : keyframe.id;
    return {
      ...clone(keyframe),
      id: `${targetClipId}:${originalId}`,
      clipId: targetClipId,
    };
  });
}

function buildTransitionSourceMap(input: {
  base: SerializableClip;
  targetClipId: string;
  bodyStart: number;
  bodyEnd: number;
  duration: number;
  mediaDuration: number;
}): TransitionSourceMapV2 {
  const { base, targetClipId, bodyStart, bodyEnd, duration, mediaDuration } = input;
  return {
    version: 2,
    mediaDuration,
    parent: {
      duration: base.duration,
      inPoint: base.inPoint,
      outPoint: Math.min(base.outPoint, mediaDuration),
      defaultSpeed: base.speed ?? (base.reversed ? -1 : 1),
      animation: {
        baseTransform: clone(base.transform),
        keyframes: rebaseKeyframes(base.keyframes ?? [], targetClipId),
        sourceEffectIds: (base.effects ?? []).map((effect) => effect.id),
        sourceMaskIds: (base.masks ?? []).map((mask) => mask.id),
      },
    },
    segments: [{
      kind: 'parent-linear',
      compStart: 0,
      compEnd: duration,
      parentStart: bodyStart - base.startTime,
      parentEnd: bodyEnd - base.startTime,
    }],
  };
}

/** Gives each multi-panel copy its own v2 animation namespace and snapshot. */
export function cloneTransitionSourceMapForClip(
  sourceMap: TransitionSourceMap | undefined,
  sourceClipId: string,
  targetClipId: string,
): TransitionSourceMap | undefined {
  if (sourceMap?.version !== 2) return sourceMap ? clone(sourceMap) : undefined;
  return {
    ...clone(sourceMap),
    parent: {
      ...clone(sourceMap.parent),
      animation: {
        ...clone(sourceMap.parent.animation),
        keyframes: rebaseKeyframes(sourceMap.parent.animation.keyframes, targetClipId, sourceClipId),
      },
    },
  };
}

export function buildLinkedMappedClip(input: {
  base: SerializableClip;
  baseId: string;
  trackId: string;
  nameSuffix: string;
  bodyStart: number;
  bodyEnd: number;
  duration: number;
  mediaDuration: number;
  materialize: (clip: SerializableClip) => SerializableClip;
}): SerializableClip {
  const transitionSourceMap = buildTransitionSourceMap({
    base: input.base,
    targetClipId: input.baseId,
    bodyStart: input.bodyStart,
    bodyEnd: input.bodyEnd,
    duration: input.duration,
    mediaDuration: input.mediaDuration,
  });
  return input.materialize({
    ...clone(input.base),
    id: input.baseId,
    trackId: input.trackId,
    name: `${input.base.name} ${input.nameSuffix}`,
    startTime: 0,
    duration: input.duration,
    linkedClipId: undefined,
    transitionIn: undefined,
    transitionOut: undefined,
    transitionSourceTimeOverride: undefined,
    transitionSourceHold: undefined,
    transitionSourceMap,
    transitionRecipeBlendWindows: undefined,
    keyframes: undefined,
    reversed: false,
    speed: 1,
  });
}
