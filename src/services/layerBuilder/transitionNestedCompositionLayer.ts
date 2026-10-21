import type { Composition } from '../../stores/mediaStore/types';
import type { ActiveTransitionPlan } from '../../stores/timeline/editOperations/transitionPlanner';
import type { Layer } from '../../types/layers';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { TimelineTransition } from '../../types/timelineCore';
import type { BackgroundVideoPlaybackOptions } from '../compositionRender/layerEvaluation';
import { resolveTransitionCompositionBlend } from './transitionCompositionBlend';

interface TransitionNestedCompositionRuntime {
  getComposition: (compositionId: string) => Composition | null | undefined;
  isCompositionReady: (compositionId: string) => boolean;
  prepareComposition: (compositionId: string) => void;
  evaluateCompositionAtTime: (
    compositionId: string,
    time: number,
    options?: { playbackOptions?: BackgroundVideoPlaybackOptions },
  ) => Layer[];
}

/**
 * The layers that draw a transition composition over the lower tracks, top
 * first: one layer, or one per blend part when the clips use blend modes
 * (see resolveTransitionCompositionBlend). Every render path pushes all of
 * them in this order.
 */
export function createTransitionNestedCompositionLayers(params: {
  transition: TimelineTransition;
  composition: Composition;
  compositionTime: number;
  nestedLayers: Layer[];
  layerIndex: number;
  layerIdPrefix: string;
  sceneClips?: TimelineClip[];
  sceneTracks?: TimelineTrack[];
}): Layer[] {
  const {
    transition,
    composition,
    compositionTime,
    nestedLayers,
    layerIndex,
    layerIdPrefix,
    sceneClips,
    sceneTracks,
  } = params;

  // The clips' blend modes (Screen, Multiply, …) blend the finished
  // transition over the lower tracks instead of a transparent background.
  const blend = resolveTransitionCompositionBlend({
    transitionId: transition.id,
    composition,
    nestedLayers,
    compositionTime,
  });
  const baseId = `${layerIdPrefix}_transition_comp_${layerIndex}_${transition.id}`;

  return blend.parts.map((part, index) => ({
    // Each part renders into its own texture (keyed by layer id).
    id: index === 0 ? baseId : `${baseId}_part${index}`,
    name: composition.name,
    sourceClipId: transition.id,
    visible: true,
    opacity: 1,
    blendMode: part.blendMode,
    // The transition composition is rendered by the compositor, whose output
    // is premultiplied; composite it as such over the lower tracks.
    premultipliedAlpha: true,
    source: {
      type: 'image',
      mediaTime: compositionTime,
      nestedComposition: {
        compositionId: composition.id,
        layers: part.nestedLayers,
        width: composition.width,
        height: composition.height,
        frameRate: composition.frameRate,
        currentTime: compositionTime,
        sceneClips,
        sceneTracks,
        // A blend part draws only some of the composition's layers.
        ...(blend.parts.length > 1 ? { partial: true } : {}),
      },
    },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  }));
}

export function buildTransitionNestedCompositionLayers(params: {
  activeTransition: ActiveTransitionPlan;
  layerIndex: number;
  parentCompositionId: string;
  parentTime: number;
  layerIdPrefix: string;
  playbackOptions?: BackgroundVideoPlaybackOptions;
  runtime: TransitionNestedCompositionRuntime;
}): Layer[] {
  const {
    activeTransition,
    layerIndex,
    parentCompositionId,
    parentTime,
    layerIdPrefix,
    playbackOptions,
    runtime,
  } = params;
  const transition = activeTransition.outgoingClip.transitionOut;
  const compositionId = transition?.compositionId;
  if (!compositionId || compositionId === parentCompositionId) return [];

  const composition = runtime.getComposition(compositionId);
  if (!composition) return [];
  if (composition.transitionComp?.kind !== 'transition-comp') return [];

  const compositionDuration = Math.max(0.0001, composition.timelineData?.duration ?? composition.duration);
  const maxSampleTime = Math.max(0, compositionDuration - 0.0001);
  const compositionTime = Math.min(
    maxSampleTime,
    Math.max(0, parentTime - activeTransition.plan.bodyStart),
  );

  let nestedLayers: Layer[] = [];
  if (!runtime.isCompositionReady(compositionId)) {
    runtime.prepareComposition(compositionId);
  } else {
    nestedLayers = runtime.evaluateCompositionAtTime(compositionId, compositionTime, {
      playbackOptions,
    });
  }

  return createTransitionNestedCompositionLayers({
    transition,
    composition,
    compositionTime,
    nestedLayers,
    layerIndex,
    layerIdPrefix,
    sceneClips: composition.timelineData?.clips as TimelineClip[] | undefined,
    sceneTracks: composition.timelineData?.tracks,
  });
}
