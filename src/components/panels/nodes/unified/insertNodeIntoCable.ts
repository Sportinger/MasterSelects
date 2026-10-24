import { getEffectOperator } from '../../../../services/operators/operatorRegistry';
import { createEffectGraphActions } from '../../../../services/operators/effectGraphEditing';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import type { NodeGraphLayout } from '../../../../services/nodeGraph';
import { addEffectGraphNode } from '../workspace/addEffectGraphNode';

/** A cable inside one effect graph, by projected ids, with the local ids of its two ends. */
export interface EffectGraphCable {
  id: string;
  type: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
  fromLocalId: string;
  toLocalId: string;
}

const localId = (id: string) => id.split('/').at(-1)!;

/**
 * Puts a new node of `operatorId` between the ends of a cable inside one effect graph and returns
 * its projected id. It is wired in the effect's own graph by local ids, in one undo step: the
 * rendered workspace graph does not hold the new node yet, and connecting through it used to skip
 * both sides while the original cable was removed. A side that cannot connect keeps the original
 * cable, and the result says how many sides joined.
 */
export function insertNodeIntoCable(clipId: string, effectId: string, cable: EffectGraphCable, operatorId: string,
  position: NodeGraphLayout): { nodeId: string; wired: number } {
  const batch = startBatch('Insert node into cable');
  try {
    const nodeId = addEffectGraphNode(clipId, effectId, operatorId, position);
    const operator = getEffectOperator(operatorId);
    const port = <T extends { id: string; type: string }>(ports: readonly T[] | undefined) =>
      ports?.find(candidate => candidate.type === cable.type) ?? ports?.[0];
    const input = port(operator?.inputs), output = port(operator?.outputs);
    const actions = createEffectGraphActions(clipId, effectId), inserted = localId(nodeId);
    let wired = 0;
    try {
      if (input) { actions.connectPorts({ fromNodeId: cable.fromLocalId, fromPortId: cable.fromPortId, toNodeId: inserted, toPortId: input.id }); wired++; }
    } catch (error) { console.warn('Insert node into cable: the input side did not connect', error); }
    try {
      if (output) { actions.connectPorts({ fromNodeId: inserted, fromPortId: output.id, toNodeId: cable.toLocalId, toPortId: cable.toPortId }); wired++; }
    } catch (error) { console.warn('Insert node into cable: the output side did not connect', error); }
    if (wired === 2) actions.disconnectEdge(localId(cable.id));
    else console.warn(`Insert node into cable: ${wired} of 2 sides connected; the original cable stays.`);
    return { nodeId, wired };
  } finally { if (batch.opened) endBatch(); }
}
