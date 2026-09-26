import type { NodeGraphLayout } from '../../../../types/nodeGraph';
import { createEffectGraphActions } from '../../../../services/operators/effectGraphEditing';
import { effectGraphId } from '../../../../services/nodeGraph/effectGraphProjection';
import { startBatch, endBatch } from '../../../../stores/historyStore';

/** Adds a building block to an effect graph in one undo step; returns the projected workspace node ID. */
export function addEffectGraphNode(clipId: string, effectId: string, operatorId: string, position: NodeGraphLayout): string {
  const batch = startBatch('Add node');
  try {
    const id = createEffectGraphActions(clipId, effectId).addNode(operatorId, position);
    return `${effectGraphId(clipId, effectId)}/${id}`;
  } finally { if (batch.opened) endBatch(); }
}
