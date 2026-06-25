import type { Layer } from '../../types/layers';
import type { ActiveTransitionPlan } from '../../stores/timeline/editOperations/transitionPlanner';
import { compositionRenderer } from '../compositionRenderer';
import type { FrameContext } from './types';

export function buildLayerBuilderTransitionCompositionLayer(
  activeTransition: ActiveTransitionPlan,
  layerIndex: number,
  ctx: FrameContext,
): Layer | null {
  const transition = activeTransition.outgoingClip.transitionOut;
  const compositionId = transition?.compositionId;
  if (!compositionId || compositionId === ctx.activeCompId) return null;

  const composition = ctx.compositionById.get(compositionId);
  if (!composition) return null;

  if (!compositionRenderer.isReady(compositionId)) {
    void compositionRenderer.prepareComposition(compositionId);
    return null;
  }

  const transitionDuration = Math.max(0.0001, activeTransition.plan.bodyEnd - activeTransition.plan.bodyStart);
  const progress = Math.min(
    1,
    Math.max(0, (ctx.playheadPosition - activeTransition.plan.bodyStart) / transitionDuration),
  );
  const bodyStart = composition.timelineData?.inPoint ?? composition.transitionComp?.bodyStart ?? 0;
  const bodyEnd = composition.timelineData?.outPoint ??
    composition.transitionComp?.bodyEnd ??
    Math.max(bodyStart, composition.duration);
  const compositionTime = bodyStart + progress * Math.max(0.0001, bodyEnd - bodyStart);
  const nestedLayers = compositionRenderer.evaluateAtTime(compositionId, compositionTime) as Layer[];
  if (nestedLayers.length === 0) return null;

  return {
    id: `${ctx.activeCompId}_transition_comp_${layerIndex}_${transition.id}`,
    name: composition.name,
    sourceClipId: transition.id,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: {
      type: 'image',
      nestedComposition: {
        compositionId,
        layers: nestedLayers,
        width: composition.width,
        height: composition.height,
        currentTime: compositionTime,
      },
    },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}
