import type { Composition } from '../../stores/mediaStore/types';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import type { ActiveTransitionPlan } from '../../stores/timeline/editOperations/transitionPlanner';
import type {
  Layer,
  SerializableClip,
  TimelineClip,
  TimelineClipSource,
  TimelineTrack,
} from '../../types';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import {
  createTimelineMathSceneCanvasRuntime,
  createTimelineTransitionOverlayCanvasRuntime,
  renderTimelineSolidCanvasRuntime,
  renderTimelineTextCanvasRuntime,
} from '../timeline/timelineGeneratedCanvasRuntime';
import { buildLayerBuilderNestedLayers } from './layerBuilderNestedLayerBuilder';
import type { LayerBuilderProxyFrames } from './layerBuilderProxyFrames';
import { createTransitionNestedCompositionLayer } from './transitionNestedCompositionLayer';
import type { FrameContext } from './types';

const generatedCanvasCache = new Map<string, HTMLCanvasElement>();

type TransitionCompositionMediaFileLike = { file?: File };

export type TransitionCompositionSourceResolver = (
  clip: SerializableClip,
  runtimeClip: TimelineClip | null,
  composition: Composition,
) => TimelineClipSource | null | undefined;

function createPlaceholderFile(name: string): File {
  return typeof File !== 'undefined'
    ? new File([], name || 'transition-comp')
    : ({} as File);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function optionalClone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}

function matchesLinkedClipId(clipId: string, baseId: string): boolean {
  return clipId === baseId || clipId.startsWith(`${baseId}:`);
}

function getClipMediaIds(clip: TimelineClip): Set<string> {
  return new Set(
    [clip.mediaFileId, clip.source?.mediaFileId].filter((id): id is string => !!id)
  );
}

function getLinkedRuntimeClip(
  clip: SerializableClip,
  composition: Composition,
  activeTransition: ActiveTransitionPlan,
): TimelineClip | null {
  const link = composition.transitionComp;
  if (link?.kind === 'transition-comp') {
    if (matchesLinkedClipId(clip.id, link.linkedOutgoingClipId)) {
      return activeTransition.outgoingClip;
    }
    if (matchesLinkedClipId(clip.id, link.linkedIncomingClipId)) {
      return activeTransition.incomingClip;
    }
  }

  if (!clip.mediaFileId) return null;
  if (getClipMediaIds(activeTransition.outgoingClip).has(clip.mediaFileId)) {
    return activeTransition.outgoingClip;
  }
  if (getClipMediaIds(activeTransition.incomingClip).has(clip.mediaFileId)) {
    return activeTransition.incomingClip;
  }
  return null;
}

function getGeneratedCanvas(cacheKey: string, factory: (current?: HTMLCanvasElement) => HTMLCanvasElement): HTMLCanvasElement {
  const next = factory(generatedCanvasCache.get(cacheKey));
  generatedCanvasCache.set(cacheKey, next);
  return next;
}

function buildGeneratedSource(
  clip: SerializableClip,
  composition: Composition,
): TimelineClipSource | null {
  const dimensions = { width: composition.width, height: composition.height };
  const mediaFileId = clip.mediaFileId || undefined;
  const naturalDuration = clip.naturalDuration ?? clip.duration;
  const cacheKey = `${composition.id}:${clip.id}:${clip.sourceType}:${composition.width}x${composition.height}`;

  if (clip.sourceType === 'transition-overlay' && clip.transitionOverlay) {
    return {
      type: 'transition-overlay',
      mediaFileId,
      naturalDuration,
      transitionOverlay: clip.transitionOverlay,
      textCanvas: createTimelineTransitionOverlayCanvasRuntime({
        overlay: clip.transitionOverlay,
        dimensions,
      }),
    };
  }

  if (clip.sourceType === 'solid') {
    return {
      type: 'solid',
      mediaFileId,
      naturalDuration,
      textCanvas: getGeneratedCanvas(cacheKey, currentCanvas =>
        renderTimelineSolidCanvasRuntime({
          color: clip.solidColor ?? '#000000',
          currentCanvas,
          dimensions,
        })
      ),
    };
  }

  if (clip.sourceType === 'text' && clip.textProperties) {
    return {
      type: 'text',
      mediaFileId,
      naturalDuration,
      textCanvas: getGeneratedCanvas(cacheKey, currentCanvas =>
        renderTimelineTextCanvasRuntime({
          textProperties: clip.textProperties!,
          currentCanvas,
          dimensions,
        })
      ),
    };
  }

  if (clip.sourceType === 'math-scene' && clip.mathScene) {
    return {
      type: 'math-scene',
      mediaFileId,
      naturalDuration,
      textCanvas: createTimelineMathSceneCanvasRuntime({
        mathScene: clip.mathScene,
        duration: clip.duration,
        dimensions,
      }),
    };
  }

  return {
    type: clip.sourceType,
    mediaFileId,
    naturalDuration,
    vectorAnimationSettings: clip.vectorAnimationSettings,
    modelSequence: clip.modelSequence,
    gaussianSplatSequence: clip.gaussianSplatSequence,
    threeDEffectorsEnabled: clip.threeDEffectorsEnabled,
    meshType: clip.meshType,
    cameraSettings: clip.cameraSettings,
    splatEffectorSettings: clip.splatEffectorSettings,
    gaussianBlendshapes: clip.gaussianBlendshapes,
    gaussianSplatSettings: clip.gaussianSplatSettings,
  } as TimelineClipSource;
}

function buildHydratedSource(
  clip: SerializableClip,
  runtimeClip: TimelineClip | null,
  composition: Composition,
  resolveSource?: TransitionCompositionSourceResolver,
): TimelineClipSource | null {
  const resolvedSource = resolveSource?.(clip, runtimeClip, composition);
  if (resolvedSource !== undefined) {
    return resolvedSource;
  }

  if (runtimeClip?.source) {
    return {
      ...runtimeClip.source,
      type: runtimeClip.source.type ?? clip.sourceType,
      mediaFileId: clip.mediaFileId || runtimeClip.source.mediaFileId || runtimeClip.mediaFileId,
      naturalDuration: clip.naturalDuration ?? runtimeClip.source.naturalDuration ?? runtimeClip.duration,
    };
  }

  return buildGeneratedSource(clip, composition);
}

function hydrateTransitionClip(
  clip: SerializableClip,
  composition: Composition,
  activeTransition: ActiveTransitionPlan,
  mediaFileById?: ReadonlyMap<string, TransitionCompositionMediaFileLike>,
  resolveSource?: TransitionCompositionSourceResolver,
): TimelineClip {
  const runtimeClip = getLinkedRuntimeClip(clip, composition, activeTransition);
  const mediaFile = clip.mediaFileId ? mediaFileById?.get(clip.mediaFileId) : undefined;
  const hydrated: TimelineClip & { keyframes?: SerializableClip['keyframes'] } = {
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    file: runtimeClip?.file ?? mediaFile?.file ?? createPlaceholderFile(clip.name),
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    source: buildHydratedSource(clip, runtimeClip, composition, resolveSource),
    mediaFileId: clip.mediaFileId || runtimeClip?.mediaFileId || runtimeClip?.source?.mediaFileId,
    signalAssetId: clip.signalAssetId,
    signalRefId: clip.signalRefId,
    signalRenderAdapterId: clip.signalRenderAdapterId,
    linkedClipId: clip.linkedClipId,
    linkedGroupId: clip.linkedGroupId,
    videoState: optionalClone(clip.videoState),
    audioState: optionalClone(clip.audioState),
    waveform: clip.waveform,
    waveformChannels: clip.waveformChannels,
    transform: clip.transform ? clone(clip.transform) : clone(DEFAULT_TRANSFORM),
    sourceRect: optionalClone(clip.sourceRect),
    effects: clone(clip.effects ?? []),
    colorCorrection: optionalClone(clip.colorCorrection),
    nodeGraph: optionalClone(clip.nodeGraph),
    masks: optionalClone(clip.masks),
    transcript: optionalClone(clip.transcript),
    transcriptStatus: clip.transcriptStatus,
    analysis: optionalClone(clip.analysis),
    analysisStatus: clip.analysisStatus,
    sceneDescriptions: optionalClone(clip.sceneDescriptions),
    sceneDescriptionStatus: clip.sceneDescriptionStatus,
    reversed: clip.reversed,
    speed: clip.speed,
    preservesPitch: clip.preservesPitch,
    textProperties: optionalClone(clip.textProperties),
    text3DProperties: optionalClone(clip.text3DProperties),
    solidColor: clip.solidColor,
    transitionOverlay: optionalClone(clip.transitionOverlay),
    midiData: optionalClone(clip.midiData),
    mathScene: optionalClone(clip.mathScene),
    motion: optionalClone(clip.motion),
    transitionIn: optionalClone(clip.transitionIn),
    transitionOut: optionalClone(clip.transitionOut),
    transitionSourceTimeOverride: clip.transitionSourceTimeOverride,
    transitionSourceHold: clip.transitionSourceHold,
    is3D: clip.is3D,
    meshType: clip.meshType,
    isLoading: false,
  };

  if (clip.keyframes?.length) {
    hydrated.keyframes = clone(clip.keyframes);
  }
  if (isVectorAnimationSourceType(clip.sourceType) && hydrated.source) {
    hydrated.source.vectorAnimationSettings = clip.vectorAnimationSettings;
  }

  return hydrated;
}

export function hydrateTransitionCompositionTimeline(params: {
  composition: Composition;
  activeTransition: ActiveTransitionPlan;
  mediaFileById?: ReadonlyMap<string, TransitionCompositionMediaFileLike>;
  resolveSource?: TransitionCompositionSourceResolver;
}): { clips: TimelineClip[]; tracks: TimelineTrack[] } {
  const { composition, activeTransition, mediaFileById, resolveSource } = params;
  const timelineData = composition.timelineData;
  return {
    tracks: (timelineData?.tracks ?? []) as TimelineTrack[],
    clips: (timelineData?.clips ?? []).map(clip =>
      hydrateTransitionClip(clip, composition, activeTransition, mediaFileById, resolveSource)
    ),
  };
}

export function getTransitionCompositionTime(
  activeTransition: ActiveTransitionPlan,
  composition: Composition,
  parentTime: number,
): number {
  const compositionDuration = Math.max(0.0001, composition.timelineData?.duration ?? composition.duration);
  const maxSampleTime = Math.max(0, compositionDuration - 0.0001);
  return Math.min(maxSampleTime, Math.max(0, parentTime - activeTransition.plan.bodyStart));
}

export function buildLayerBuilderTransitionCompositionLayer(
  activeTransition: ActiveTransitionPlan,
  layerIndex: number,
  ctx: FrameContext,
  proxyFrames: LayerBuilderProxyFrames,
): Layer | null {
  const transition = activeTransition.outgoingClip.transitionOut;
  const compositionId = transition?.compositionId;
  if (!transition || !compositionId || compositionId === ctx.activeCompId) return null;

  const composition = ctx.compositionById.get(compositionId);
  if (!composition?.timelineData || composition.transitionComp?.kind !== 'transition-comp') {
    return null;
  }

  const compositionTime = getTransitionCompositionTime(activeTransition, composition, ctx.playheadPosition);
  const nestedTimeline = hydrateTransitionCompositionTimeline({
    composition,
    activeTransition,
    mediaFileById: ctx.mediaFileById,
  });
  const duration = Math.max(0.0001, composition.timelineData.duration ?? composition.duration);
  const syntheticClip: TimelineClip = {
    id: `transition-comp-parent:${composition.id}`,
    trackId: activeTransition.outgoingClip.trackId,
    name: composition.name,
    file: createPlaceholderFile(composition.name),
    startTime: 0,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: null,
    transform: clone(DEFAULT_TRANSFORM),
    effects: [],
    isComposition: true,
    compositionId: composition.id,
    nestedClips: nestedTimeline.clips,
    nestedTracks: nestedTimeline.tracks,
    isLoading: false,
  };
  const nestedLayers = buildLayerBuilderNestedLayers({
    clip: syntheticClip,
    clipTime: compositionTime,
    ctx,
    proxyFrames,
  });

  return createTransitionNestedCompositionLayer({
    transition,
    composition,
    compositionTime,
    nestedLayers,
    layerIndex,
    layerIdPrefix: ctx.activeCompId,
    sceneClips: nestedTimeline.clips,
    sceneTracks: nestedTimeline.tracks,
  });
}
