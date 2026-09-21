import { useTimelineStore } from '../../stores/timeline';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { startBatch, endBatch } from '../../stores/historyStore';
import { createEffectGraphActions } from '../operators/effectGraphEditing';
import { createSceneGraphActions } from '../operators/sceneGraphEditing';
import { addFlockNode, connectFlockPorts } from '../flock/mutations/flockGraphMutations';
import { createColorNode, ensureColorCorrectionState, getActiveColorVersion, type ColorNodeType } from '../../types/colorCorrection';
import { buildClipColorNodeGraph, buildClipNodeGraphDocument } from './clipGraphDocument';
import { createNodeGraphOwnerClip, resolveLinkedClipNodeGraphContext } from './clipGraphLinking';
import { checkGraphConnection } from './graphConnections';
import { connectionToNewNode, type ConnectedNodeOption } from './connectedNodeOptions';
import { connectionNodeCatalog, NEW_CONNECTION_NODE, type ConnectionNodeCatalog } from './connectionNodeCatalog';
import { renderHostPort } from '../render/renderHostPort';

/** No owner is mutated until its connection has been checked; one undo step. */
export function addConnectedNode(catalog: ConnectionNodeCatalog, option: ConnectedNodeOption, workspaceClipId: string): string {
  assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore), clip = state.clips.find(clip => clip.id === catalog.ownerId);
  if (!clip || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) throw new Error('The clip is unavailable, locked or exporting.');
  if (catalog.kind === 'clip') {
    const context = resolveLinkedClipNodeGraphContext(state.clips, state.tracks, workspaceClipId);
    if (!context || context.ownerTrack?.locked) throw new Error('The graph is unavailable or locked.');
    const owner = createNodeGraphOwnerClip(context);
    const graph = buildClipNodeGraphDocument(owner, context.ownerTrack ?? undefined, context).graphs[0];
    const fresh = connectionNodeCatalog(owner, graph, { ...catalog.origin, layout: catalog.position, x: 0, y: 0 }, state.clips);
    if (fresh.ownerId !== catalog.ownerId || !fresh.options.some(item => item.id === option.id && item.port.id === option.port.id)) {
      throw new Error('This connection is no longer available.');
    }
  }
  const batch = startBatch('Add and connect node');
  try {
    if (catalog.kind === 'effect') return catalog.prefix + createEffectGraphActions(clip.id, catalog.effectId!).addNode(
      option.operatorId ?? option.candidateId, catalog.position, { direction: catalog.origin.direction, endpoints: catalog.endpoints, portId: option.port.id, groupId: catalog.groupId });
    if (catalog.kind === 'scene') return catalog.prefix + createSceneGraphActions(clip.id).addNode(option.candidateId, catalog.position,
      connectionToNewNode(catalog.origin, NEW_CONNECTION_NODE, option.port.id));
    if (catalog.kind === 'flock') {
      if (!clip.flock) throw new Error('Flock graph unavailable.');
      const groupRef = option.candidateId.startsWith('group:') ? option.candidateId.slice(6) : undefined;
      const added = addFlockNode(clip.flock, groupRef ? 'flock.group' : option.candidateId, { layout: catalog.position, groupRef });
      if (!added.ok) throw new Error(added.message);
      const c = connectionToNewNode(catalog.origin, added.nodeId, option.port.id);
      const connected = connectFlockPorts(added.definition, { nodeId: c.fromNodeId, port: c.fromPortId }, { nodeId: c.toNodeId, port: c.toPortId });
      if (!connected.ok) throw new Error(connected.message);
      state.replaceFlockDefinition(clip.id, connected.definition);
      return catalog.prefix + added.nodeId;
    }
    if (catalog.kind === 'color') {
      const colorCorrection = ensureColorCorrectionState(clip.colorCorrection), version = getActiveColorVersion(colorCorrection)!;
      const node = createColorNode(option.candidateId as ColorNodeType, `node_${crypto.randomUUID()}`);
      node.position = catalog.position; version.nodes.push(node);
      const c = connectionToNewNode(catalog.origin, node.id, option.port.id);
      const check = checkGraphConnection(buildClipColorNodeGraph({ ...clip, colorCorrection })!, c);
      if (!check.ok) throw new Error(check.message);
      version.edges = version.edges.filter(edge => edge.id !== check.replacesEdgeId);
      version.edges.push({ id: `edge_${crypto.randomUUID()}`, fromNodeId: c.fromNodeId, fromPort: c.fromPortId, toNodeId: c.toNodeId, toPort: c.toPortId });
      state.updateClip(clip.id, { colorCorrection }); state.invalidateCache(); renderHostPort.requestRender();
      return catalog.prefix + node.id;
    }
    const separator = option.candidateId.indexOf(':'), kind = option.candidateId.slice(0, separator), type = option.candidateId.slice(separator + 1);
    let id: string;
    if (kind === 'audio') {
      const effectId = state.addClipAudioEffectInstance(clip.id, type);
      if (!effectId) throw new Error('Audio effect unavailable.');
      id = `audio-effect-${effectId}`;
      const stack = clip.audioState?.effectStack ?? [];
      const index = stack.findIndex(effect => `audio-effect-${effect.id}` === catalog.origin.nodeId);
      const insertion = index < 0 ? catalog.origin.direction === 'output' ? 0 : stack.length
        : index + (catalog.origin.direction === 'output' ? 1 : 0);
      state.reorderClipAudioEffectInstance(clip.id, effectId, insertion);
    } else if (kind === 'builtin') {
      state.showClipNodeGraphBuiltIn(clip.id, type as 'transform' | 'mask' | 'color'); id = type;
    } else {
      const effectId = state.addClipEffect(clip.id, type); id = `effect-${effectId}`;
      const index = clip.effects.findIndex(effect => `effect-${effect.id}` === catalog.origin.nodeId);
      const insertion = index < 0 ? catalog.origin.direction === 'output' ? 0 : clip.effects.length
        : index + (catalog.origin.direction === 'output' ? 1 : 0);
      state.reorderClipEffect(clip.id, effectId, insertion);
    }
    state.connectClipNodeGraphPorts(workspaceClipId, connectionToNewNode(catalog.origin, id, option.port.id));
    state.moveClipNodeGraphNode(workspaceClipId, id, catalog.position);
    return id;
  } finally { if (batch.opened) endBatch(); }
}
