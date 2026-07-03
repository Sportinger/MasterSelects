import type { Layer, TimelineClip, TimelineTrack } from '../../types';
import {
  DEFAULT_TRANSITION_PLACEMENT,
  findActiveTransitionPlanForTrack,
} from '../../stores/timeline/editOperations/transitionPlanner';
import { compositionRenderer } from '../compositionRenderer';
import type { FrameContext } from './types';
import { buildTransitionNestedCompositionLayer } from './transitionNestedCompositionLayer';

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
  return buildTransitionNestedCompositionLayer({
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
}
