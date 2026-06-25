import type { Composition } from '../../stores/mediaStore/types';
import type { ActiveTransitionPlan } from '../../stores/timeline/editOperations/transitionPlanner';
import type { Layer } from '../../types/layers';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { TimelineTransition } from '../../types/timelineCore';
import type { BackgroundVideoPlaybackOptions } from '../compositionRender/layerEvaluation';

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

  return {
    id: `${layerIdPrefix}_transition_comp_${layerIndex}_${transition.id}`,
    name: composition.name,
    sourceClipId: transition.id,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: {
      type: 'image',
      nestedComposition: {
        compositionId: composition.id,
        layers: nestedLayers,
        width: composition.width,
        height: composition.height,
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
