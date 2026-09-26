import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import type { Effect } from '../../types/effects';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { validateEffectOwnerGraph } from './effectGraphOwner';
import { renderHostPort } from '../render/renderHostPort';
import { getEffectOperator } from './operatorRegistry';
import { createEffectGraphActions } from './effectGraphEditing';
import type { NodeGraphLayout } from '../../types/nodeGraph';

/** Name of the free-standing graph that receives nodes added without an effect target. */
export const FREE_NODE_GRAPH_NAME = 'Node Graph';

/**
 * Appends an empty image node graph (frame -> output) to a clip; it executes
 * through the generic image-effect owner. One undo step; returns the effect ID.
 */
export function createImageNodeGraphEffect(clipId: string, name = 'Image Graph',
  options: { groupPosition?: NodeGraphLayout; detached?: boolean } = {}): string {
  const { groupPosition, detached } = options;
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore), clip = state.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Clip not found in the active timeline.');
  if (state.isExporting || state.tracks.find(t => t.id === clip.trackId)?.locked) throw new Error('Clip is locked or exporting.');
  if (clip.source?.type === 'motion-adjustment' || clip.source?.type === 'audio') throw new Error('An image-capable clip is required.');
  const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image',
    nodes: [{ id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} }, { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} }],
    edges: [{ id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' }],
    layout: { frame: { x: 0, y: 0 }, output: { x: 900, y: 0 } } };
  const effect: Effect = { id: `effect-${crypto.randomUUID()}`, type: 'invert', name, enabled: !detached, params: {}, operatorGraph: graph,
    ...(detached ? { detached: true } : {}) };
  validateEffectOwnerGraph(effect, graph, effect.params);
  const batch = startBatch('Create image node graph');
  try {
    state.updateClip(clip.id, { effects: [...clip.effects, effect], nodeGraph: {
      version: 1, nodes: [], ...clip.nodeGraph,
      groups: { ...clip.nodeGraph?.groups, [`effect:${effect.id}`]: { collapsed: false, ...(groupPosition ? { position: groupPosition } : {}) } },
    } });
    state.invalidateCache(); renderHostPort.requestRender();
  } finally { if (batch.opened) endBatch(); }
  return effect.id;
}

/** The clip's free node graph, created on first use. */
export function freeNodeGraphEffectId(clipId: string): string {
  const clip = readTimelineRuntimeState(useTimelineStore).clips.find(item => item.id === clipId);
  const existing = clip?.effects.find(effect => effect.type === 'invert' && effect.name === FREE_NODE_GRAPH_NAME && effect.operatorGraph);
  return existing?.id ?? createImageNodeGraphEffect(clipId, FREE_NODE_GRAPH_NAME);
}

/**
 * Adds one image node in its own effect group (frame -> node -> output, wired where the node
 * has image ports) that opens at `groupPosition` (workspace coordinates). Without a chain
 * position the group stands free (detached, not rendered) until the user wires it in; with
 * `chain` it joins right before `beforeEffectId`, or at the end of the chain.
 * One undo step; returns the effect and the graph-local node ID.
 */
export function createSingleNodeEffect(clipId: string, operatorId: string,
  options: { groupPosition?: NodeGraphLayout; chain?: { beforeEffectId?: string } } = {}): { effectId: string; nodeId: string } {
  const operator = getEffectOperator(operatorId);
  if (!operator) throw new Error('Unknown node.');
  const batch = startBatch(`Add ${operator.label}`);
  try {
    const effectId = createImageNodeGraphEffect(clipId, operator.label, { groupPosition: options.groupPosition, detached: !options.chain });
    const actions = createEffectGraphActions(clipId, effectId);
    const nodeId = actions.addNode(operatorId, { x: 450, y: 0 }, undefined, { free: true }).replace(/^@compound-/, '');
    const input = operator.inputs.find(port => port.type === 'image'), output = operator.outputs.find(port => port.type === 'image');
    // A side without an image port stays open; the frame keeps feeding the output then.
    try { if (input) actions.connectPorts({ fromNodeId: 'frame', fromPortId: 'image', toNodeId: nodeId, toPortId: input.id }); } catch { /* unwired */ }
    try { if (output) actions.connectPorts({ fromNodeId: nodeId, fromPortId: output.id, toNodeId: 'output', toPortId: 'image' }); } catch { /* unwired */ }
    const before = options.chain?.beforeEffectId;
    if (before) {
      const state = readTimelineRuntimeState(useTimelineStore);
      const index = state.clips.find(item => item.id === clipId)?.effects.findIndex(effect => effect.id === before) ?? -1;
      if (index >= 0) state.reorderClipEffect(clipId, effectId, index);
    }
    return { effectId, nodeId };
  } finally { if (batch.opened) endBatch(); }
}
