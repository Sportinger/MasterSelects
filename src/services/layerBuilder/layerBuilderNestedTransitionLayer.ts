import type { Keyframe, Layer, SerializableClip, TimelineClip, TimelineTrack } from '../../types';
import {
  DEFAULT_TRANSITION_PLACEMENT,
  findActiveTransitionPlanForTrack,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { compositionRenderer } from '../compositionRenderer';
import { getEffectiveScale } from '../../utils/transformScale';
import type { FrameContext } from './types';
import { buildTransitionNestedCompositionLayer } from './transitionNestedCompositionLayer';
import { evaluateParentedClipTransform } from './parentTransformEvaluation';

function matchesLinkedClipId(clipId: string, baseId: string): boolean {
  return clipId === baseId || clipId.startsWith(`${baseId}:`);
}

function getRuntimeTransitionSource(
  clipId: string,
  transitionComposition: NonNullable<ReturnType<FrameContext['compositionById']['get']>>,
  outgoingClip: TimelineClip,
  incomingClip: TimelineClip,
): TimelineClip | undefined {
  const link = transitionComposition.transitionComp;
  if (link?.kind !== 'transition-comp') return undefined;
  if (matchesLinkedClipId(clipId, link.linkedOutgoingClipId)) return outgoingClip;
  if (matchesLinkedClipId(clipId, link.linkedIncomingClipId)) return incomingClip;
  return undefined;
}

function asParentEvaluationClip(
  clip: SerializableClip,
  runtimeSource: TimelineClip | undefined,
): TimelineClip {
  return {
    ...clip,
    file: runtimeSource?.file ?? (typeof File !== 'undefined' ? new File([], clip.name) : ({} as File)),
    source: runtimeSource?.source ?? null,
    parentClipId: runtimeSource?.parentClipId ?? clip.parentClipId,
    effects: clip.effects ?? [],
  } as TimelineClip;
}

function applyNestedTransitionParentTransforms(input: {
  layer: Layer;
  transitionComposition: NonNullable<ReturnType<FrameContext['compositionById']['get']>>;
  parentClip: TimelineClip;
  parentTime: number;
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
  ctx: FrameContext;
}): Layer {
  const source = input.layer.source;
  const nestedComposition = source?.nestedComposition;
  const serializedClips = input.transitionComposition.timelineData?.clips ?? [];
  if (
    !source ||
    !nestedComposition ||
    !Number.isFinite(nestedComposition.currentTime) ||
    serializedClips.length === 0 ||
    nestedComposition.layers.length === 0
  ) {
    return input.layer;
  }

  const transitionClips = serializedClips.map(serializedClip => asParentEvaluationClip(
    serializedClip,
    getRuntimeTransitionSource(
      serializedClip.id,
      input.transitionComposition,
      input.outgoingClip,
      input.incomingClip,
    ),
  ));
  const clips = [...transitionClips, ...(input.parentClip.nestedClips ?? [])];
  const transitionClipById = new Map(transitionClips.map(clip => [clip.id, clip]));
  const layers: Layer[] = [];

  for (const layer of nestedComposition.layers) {
    const evaluatedLayer = layer as Layer & { clipId?: string };
    const clipId = evaluatedLayer.clipId ?? evaluatedLayer.sourceClipId;
    const transitionClip = clipId ? transitionClipById.get(clipId) : undefined;
    if (!transitionClip?.parentClipId) {
      layers.push(layer);
      continue;
    }

    const evaluated = evaluateParentedClipTransform({
      clip: transitionClip,
      clips,
      clipLocalTime: nestedComposition.currentTime! - transitionClip.startTime,
      parentTimelineTime: input.parentTime,
      getKeyframes: candidate => {
        const contextKeyframes = input.ctx.getClipKeyframes?.(candidate.id);
        if (contextKeyframes?.length) return contextKeyframes;
        return (candidate as TimelineClip & { keyframes?: readonly Keyframe[] }).keyframes;
      },
    });
    if (!evaluated.ok) continue;

    layers.push({
      ...layer,
      opacity: evaluated.transform.opacity,
      position: evaluated.transform.position,
      scale: getEffectiveScale(evaluated.transform.scale),
      rotation: typeof layer.rotation === 'number'
        ? evaluated.transform.rotation.z
        : {
            x: evaluated.transform.rotation.x * Math.PI / 180,
            y: evaluated.transform.rotation.y * Math.PI / 180,
            z: evaluated.transform.rotation.z * Math.PI / 180,
          },
    });
  }

  return {
    ...input.layer,
    source: {
      ...source,
      nestedComposition: {
        ...nestedComposition,
        layers,
      },
    },
  };
}

export function buildLayerBuilderNestedTransitionLayer(params: {
  parentClip: TimelineClip;
  nestedTrack: TimelineTrack;
  layerIndex: number;
  clipTime: number;
  ctx: FrameContext;
}): Layer | null {
  const { parentClip, nestedTrack, layerIndex, clipTime, ctx } = params;
  const activeTransition = findActiveTransitionPlanForTrack({
    clips: parentClip.nestedClips ?? [],
    trackId: nestedTrack.id,
    time: clipTime,
    placement: DEFAULT_TRANSITION_PLACEMENT,
    edgePolicy: 'hold',
    getMediaDuration: (mediaFileId) => ctx.mediaFileById.get(mediaFileId)?.duration,
  });
  if (!activeTransition) return null;

  const parentCompositionId = parentClip.compositionId || parentClip.id;
  const transitionLayer = buildTransitionNestedCompositionLayer({
    activeTransition,
    layerIndex,
    parentCompositionId,
    parentTime: clipTime,
    layerIdPrefix: parentCompositionId,
    playbackOptions: {
      isPlaying: ctx.isPlaying,
      continuousPlayback: ctx.isPlaying && !ctx.isDraggingPlayhead && !ctx.hasClipDragPreview,
    },
    runtime: {
      getComposition: (compositionId) => ctx.compositionById.get(compositionId),
      isCompositionReady: (compositionId) => compositionRenderer.isReady(compositionId),
      prepareComposition: (compositionId) => { void compositionRenderer.prepareComposition(compositionId); },
      evaluateCompositionAtTime: (compositionId, time, options) =>
        compositionRenderer.evaluateAtTime(compositionId, time, options) as Layer[],
    },
  });
  if (!transitionLayer) return null;
  const transitionCompositionId = activeTransition.outgoingClip.transitionOut?.compositionId;
  const transitionComposition = transitionCompositionId
    ? ctx.compositionById.get(transitionCompositionId)
    : undefined;
  if (!transitionComposition) return transitionLayer;

  return applyNestedTransitionParentTransforms({
    layer: transitionLayer,
    transitionComposition,
    parentClip,
    parentTime: clipTime,
    outgoingClip: activeTransition.outgoingClip,
    incomingClip: activeTransition.incomingClip,
    ctx,
  });
}
