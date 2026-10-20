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

export function createTransitionNestedCompositionLayer(params: {
  transition: TimelineTransition;
  composition: Composition;
  compositionTime: number;
  nestedLayers: Layer[];
  layerIndex: number;
  layerIdPrefix: string;
  sceneClips?: TimelineClip[];
  sceneTracks?: TimelineTrack[];
}): Layer {
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

  // The clips' shared blend mode (Screen, Multiply, …) blends the finished
  // transition over the lower tracks instead of a transparent background.
  const blend = resolveTransitionCompositionBlend({ transitionId: transition.id, composition, nestedLayers });

  return {
    id: `${layerIdPrefix}_transition_comp_${layerIndex}_${transition.id}`,
    name: composition.name,
    sourceClipId: transition.id,
    visible: true,
    opacity: 1,
    blendMode: blend.blendMode,
    // The transition composition is rendered by the compositor, whose output
    // is premultiplied; composite it as such over the lower tracks.
    premultipliedAlpha: true,
    source: {
      type: 'image',
      mediaTime: compositionTime,
      nestedComposition: {
        compositionId: composition.id,
        layers: blend.nestedLayers,
        width: composition.width,
        height: composition.height,
        frameRate: composition.frameRate,
        currentTime: compositionTime,
        sceneClips,
        sceneTracks,
      },
    },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

export function buildTransitionNestedCompositionLayer(params: {
  activeTransition: ActiveTransitionPlan;
  layerIndex: number;
  parentCompositionId: string;
  parentTime: number;
  layerIdPrefix: string;
  playbackOptions?: BackgroundVideoPlaybackOptions;
  runtime: TransitionNestedCompositionRuntime;
}): Layer | null {
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
  if (!compositionId || compositionId === parentCompositionId) return null;

  const composition = runtime.getComposition(compositionId);
  if (!composition) return null;
  if (composition.transitionComp?.kind !== 'transition-comp') return null;

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

  return createTransitionNestedCompositionLayer({
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
