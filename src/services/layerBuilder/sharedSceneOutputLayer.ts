import type { TimelineClip } from '../../types/timeline';
import type { Layer } from '../../types/layers';
import type { SharedSceneGraphs } from '../../types/sharedSceneGraph';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { evaluateCompositionClipEffects } from '../compositionRender/keyframeEvaluation';
import { splatEffectScene } from '../../engine/scene/splatEffectScene';

/** Resolve at the layer boundary, so scene execution remains independent of UI stores. */
export function sharedSceneOutputLayer(clip: TimelineClip, timelineTime: number,
  documents?: SharedSceneGraphs): Pick<Layer, 'sharedSceneGraph' | 'sharedSceneTime' | 'sharedSceneTransform' | 'sceneGraphOutputSelection'> {
  const output = clip.sceneGraphOutput;
  if (!output) return {};
  const state = useTimelineStore.getState();
  const document = documents?.[output.graphId] ?? state.sharedSceneGraphs?.[output.graphId]
    ?? useMediaStore.getState().compositions.find(c => c.timelineData?.sharedSceneGraphs?.[output.graphId])?.timelineData?.sharedSceneGraphs?.[output.graphId];
  if (!document) return { sceneGraphOutputSelection: { include: [] } };
  const time = timelineTime - document.startTime;
  const effects = document.keyframes.length
    ? evaluateCompositionClipEffects([document.effect], document.keyframes, time)
    : [document.effect];
  return {
    sharedSceneGraph: splatEffectScene(effects),
    sharedSceneTime: time,
    sharedSceneTransform: output.nodeIds ? document.transform : undefined,
    sceneGraphOutputSelection: output.nodeIds ? { include: document.effect.enabled ? output.nodeIds : [] }
      : { exclude: Object.values(document.outputs).flat() },
  };
}
