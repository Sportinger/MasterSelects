import { createColorNodeActions } from '../../../services/nodeGraph/colorNodeActions';
import { readTimelineRuntimeState } from '../../../services/timeline/timelineRuntimeCoordinator';
import { useState } from 'react';
import type { NodeGraph, NodeGraphConnectionRequest, NodeGraphLayout, NodeGraphNode } from '../../../types/nodeGraph';
import type { TimelineClip } from '../../../types/timeline';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { createClipNodeGraphState } from '../../../services/nodeGraph';
import { createEffectGraphActions, editEffectGraph, editCompositionInput } from '../../../services/operators/effectGraphEditing';
import { createSceneGraphActions, editSceneGraph } from '../../../services/operators/sceneGraphEditing';
import { groupOperators } from '../../../services/operators/operatorGroups';
import { connectSourceArtifact } from '../../../services/operators/sourceArtifactConnections';
import type { FlockGraphActions } from './flock/useFlockGraphActions';
import { changeKeyframeNode, connectKeyframeNode, disconnectKeyframeNode, removeKeyframeNode } from '../../../services/nodeGraph/keyframeNodeActions';
import { keyframeEdgeId } from '../../../services/nodeGraph/keyframeNodeProjection';
import type { AnimatableProperty } from '../../../types/animationProperties';

interface BaseActions {
  moveNode: (id: string, layout: NodeGraphLayout) => void;
  connectPorts: (c: NodeGraphConnectionRequest) => void;
  disconnectEdge: (id: string) => void;
  deleteNode: (id: string) => void;
  toggleBypass: (id: string) => void;
}
export function useUnifiedNodeActions(clip: TimelineClip | undefined, graph: NodeGraph | undefined, base: BaseActions | null, flock: FlockGraphActions) {
  const [message, setMessage] = useState('');
  const safely = (action: () => void) => { try { action(); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  const localId = (node: NodeGraphNode) => node.binding && 'nodeId' in node.binding ? node.binding.nodeId : node.id;
  const bindingActions = (node: NodeGraphNode): BaseActions | null => {
    if (!clip) return null;
    const binding = node.binding;
    if (binding?.kind === 'clip-stabilization') return {
      moveNode: (_id, layout) => {
        const state = readTimelineRuntimeState(useTimelineStore), current = state.clips.find(candidate => candidate.id === clip.id);
        if (!current || state.isExporting || state.tracks.find(track => track.id === current.trackId)?.locked) throw new Error('The clip is locked or exporting.');
        const model = current.nodeGraph ?? createClipNodeGraphState(current);
        state.updateClip(clip.id, { nodeGraph: { ...model, stabilization: { ...model.stabilization,
          layouts: { ...model.stabilization?.layouts, [binding.stage]: layout } } } });
      },
      deleteNode: () => { throw new Error('This node represents saved stabilization. Edit or bypass it in the inspector.'); },
      connectPorts: () => {}, disconnectEdge: () => {}, toggleBypass: () => {
        const state = readTimelineRuntimeState(useTimelineStore), current = state.clips.find(candidate => candidate.id === clip.id);
        if (!current || state.isExporting || state.tracks.find(track => track.id === current.trackId)?.locked) throw new Error('The clip is locked or exporting.');
        state.updateClip(clip.id, { videoInspectorSections: { ...current.videoInspectorSections,
          stabilization: current.videoInspectorSections?.stabilization === false } });
      },
    };
    if (binding?.kind === 'keyframe-node') return {
      moveNode: (id, layout) => changeKeyframeNode(clip.id, id, { layout }),
      deleteNode: id => removeKeyframeNode(clip.id, id),
      connectPorts: () => {}, disconnectEdge: () => {}, toggleBypass: () => {},
    };
    if (binding?.kind === 'scene-operator') return createSceneGraphActions(clip.id);
    if (binding?.kind === 'scene-node') return {
      moveNode: (id, layout) => {
        const state = readTimelineRuntimeState(useTimelineStore), current = state.clips.find(c => c.id === clip.id)!;
        if (state.isExporting || state.tracks.find(t => t.id === current.trackId)?.locked) throw new Error('The clip is locked or exporting.');
        const model = current.nodeGraph ?? createClipNodeGraphState(current), group = model.groups?.scene3d;
        startBatch('Move scene node');
        try { state.updateClip(clip.id, { nodeGraph: { ...model, groups: { ...model.groups, scene3d: { ...group, nodeLayouts: { ...group?.nodeLayouts, [id]: layout } } } } }); } finally { endBatch(); }
      },
      connectPorts: () => { throw new Error('Scene links follow the clip geometry, camera and light settings.'); },
      disconnectEdge: () => { throw new Error('Scene links follow the clip geometry, camera and light settings.'); },
      deleteNode: () => { throw new Error('This node belongs to the clip’s 3D scene.'); }, toggleBypass: () => {},
    };
    if (binding?.kind === 'effect-operator') return createEffectGraphActions(clip.id, binding.effectId);
    if (binding?.kind === 'flock-node') return { moveNode: flock.moveNode, connectPorts: flock.connect,
      disconnectEdge: flock.disconnect, deleteNode: id => { flock.deleteNodes([id]); }, toggleBypass: flock.toggleBypass };
    if (binding?.kind === 'color-node') return createColorNodeActions(clip.id);
    return base;
  };
  const route = (id: string, action: (actions: BaseActions, node: NodeGraphNode) => void) => safely(() => {
    const node = graph?.nodes.find(n => n.id === id); if (!node) return;
    const actions = bindingActions(node); if (actions) action(actions, node);
  });
  return {
    message, clearMessage: () => setMessage(''),
    groupNodes: (ids: string[]) => safely(() => {
      if (!clip) return;
      const selected = ids.map(id => graph?.nodes.find(n => n.id === id)).filter((n): n is NodeGraphNode => !!n);
      const effects = new Set(selected.map(n => n.binding && 'effectId' in n.binding ? n.binding.effectId : undefined));
      if (!selected.length || effects.size !== 1 || selected.some(n => !['scene-operator', 'effect-operator', 'operator-group'].includes(n.binding?.kind ?? ''))) throw new Error('Select nodes from one effect or scene graph.');
      const childIds = selected.filter(n => n.binding?.kind === 'operator-group').map(n => n.binding!.kind === 'operator-group' ? n.binding!.groupId.split('/').at(-1)! : '');
      const nodeIds = selected.filter(n => n.binding?.kind !== 'operator-group').map(localId);
      const effectId = [...effects][0];
      if (effectId) editEffectGraph(clip.id, effectId, 'Group nodes', g => { groupOperators(g, nodeIds, childIds); });
      else editSceneGraph(clip.id, 'Group nodes', d => { groupOperators(d.graph, nodeIds, childIds); });
    }),
    moveNode: (id: string, position: NodeGraphLayout) => route(id, (actions, node) => {
      if (node.binding?.kind === 'operator-group' || (node.groupId && !node.id.includes('/'))) {
        const state = readTimelineRuntimeState(useTimelineStore), current = state.clips.find(c => c.id === clip!.id)!;
        if (state.isExporting || state.tracks.find(t => t.id === current.trackId)?.locked) throw new Error('The clip is locked or exporting.');
        const model = current.nodeGraph ?? createClipNodeGraphState(current);
        const id = node.binding?.kind === 'operator-group' ? node.binding.groupId : node.groupId!;
        state.updateClip(current.id, { nodeGraph: { ...model, groups: { ...model.groups, [id]: { ...model.groups?.[id], position } } } });
      } else actions.moveNode(localId(node), { x: position.x - (node.groupOffset?.x ?? 0), y: position.y - (node.groupOffset?.y ?? 0) });
    }),
    toggleBypass: (id: string) => {
      // Expanded effect groups no longer contain their root proxy node.
      const effectId = graph?.groups?.find(group => group.bypassNodeId === id)?.effectId;
      if (!effectId) { route(id, (actions, node) => actions.toggleBypass(localId(node))); return; }
      safely(() => {
        const state = readTimelineRuntimeState(useTimelineStore), current = state.clips.find(candidate => candidate.id === clip?.id);
        if (!current || state.isExporting || state.tracks.find(track => track.id === current.trackId)?.locked) throw new Error('The clip is locked or exporting.');
        const effect = current.effects.find(candidate => candidate.id === effectId);
        if (!effect) return;
        startBatch('Toggle effect group bypass');
        try { state.setClipEffectEnabled(current.id, effect.id, !effect.enabled); } finally { endBatch(); }
      });
    },
    deleteNode: (id: string) => route(id, (actions, node) => actions.deleteNode(localId(node))),
    connectPorts: (c: NodeGraphConnectionRequest) => safely(() => {
      if (graph?.nodes.find(node => node.id === c.fromNodeId)?.outputs.find(port => port.id === c.fromPortId)?.metadata?.readOnly
        || graph?.nodes.find(node => node.id === c.toNodeId)?.inputs.find(port => port.id === c.toPortId)?.metadata?.readOnly) return;
      const artifact = graph?.nodes.find(n => n.id === c.fromNodeId)?.outputs.find(p => p.id === c.fromPortId)?.metadata?.sourceArtifact;
      if (artifact && clip) {
        const visible = graph?.nodes.find(n => n.id === c.toNodeId), port = visible?.inputs.find(p => p.id === c.toPortId);
        const endpoint = port?.metadata?.groupEndpoint;
        const node = endpoint ? graph?.expandedNodes?.find(n => n.id === endpoint.nodeId) : visible;
        const target = port?.metadata?.artifactTarget ?? (node?.binding?.kind === 'effect-operator'
          ? { effectId: node.binding.effectId, nodeId: node.binding.nodeId, portId: endpoint?.portId ?? c.toPortId } : undefined);
        if (!target) throw new Error('Connect this artifact to a compatible Face Cables input.');
        connectSourceArtifact(clip.id, artifact, target); return;
      }
      const resolve = (id: string, port: string, direction: 'input' | 'output') => {
        const node = graph?.nodes.find(n => n.id === id), endpoint = (direction === 'input' ? node?.inputs : node?.outputs)?.find(p => p.id === port)?.metadata?.groupEndpoint;
        return endpoint ?? { nodeId: id, portId: port };
      };
      const a = resolve(c.fromNodeId, c.fromPortId, 'output'), b = resolve(c.toNodeId, c.toPortId, 'input');
      const targets = graph?.nodes.find(node => node.id === c.toNodeId)?.inputs.find(port => port.id === c.toPortId)?.metadata?.groupEndpoints;
      c = { fromNodeId: a.nodeId, fromPortId: a.portId, toNodeId: b.nodeId, toPortId: b.portId };
      const from = (graph?.expandedNodes ?? graph?.nodes)?.find(n => n.id === c.fromNodeId), to = (graph?.expandedNodes ?? graph?.nodes)?.find(n => n.id === c.toNodeId);
      if (!from || !to) return;
      if (targets && targets.length > 1 && clip && from.binding?.kind === 'effect-operator' && to.binding?.kind === 'effect-operator'
        && from.binding.effectId === to.binding.effectId) {
        editCompositionInput(clip.id, to.binding.effectId, targets.map(endpoint => ({ nodeId: endpoint.nodeId.split('/').at(-1)!, portId: endpoint.portId })),
          { nodeId: localId(from), portId: a.portId }); return;
      }
      if (from.binding?.kind === 'keyframe-node') {
        const property = to.inputs.find(p => p.id === c.toPortId)?.metadata?.animationProperty;
        if (!property || !clip) throw new Error('Connect the curve to an animation parameter.');
        connectKeyframeNode(clip.id, from.binding.nodeId, property as AnimatableProperty, c.fromPortId);
        return;
      }
      const boundary = (node: NodeGraphNode, port: string) => !node.groupId || !node.id.includes('/') || port.startsWith('group-');
      if (boundary(from, c.fromPortId) && boundary(to, c.toPortId)) {
        if (from.groupId === 'scene3d' || to.groupId === 'scene3d') {
          const cable = clip?.effects.find(e => e.type === 'face-cables' && e.enabled && e.params.scene3D);
          if (!cable) throw new Error('Use the effect order controls to move effects around the 3D render.');
          const effectNode = (node: NodeGraphNode) => graph?.groups?.find(g => g.id === node.groupId)?.proxyId ?? node.id;
          base?.connectPorts({ fromNodeId: from.groupId === 'scene3d' ? `effect-${cable.id}` : effectNode(from), fromPortId: 'output',
            toNodeId: to.groupId === 'scene3d' ? `effect-${cable.id}` : effectNode(to), toPortId: 'input' });
          return;
        }
        const proxy = (node: NodeGraphNode) => graph?.groups?.find(g => g.id === node.groupId)?.proxyId ?? node.id;
        base?.connectPorts({ fromNodeId: proxy(from), fromPortId: c.fromPortId.replace(/^group-out-/, ''),
          toNodeId: proxy(to), toPortId: c.toPortId.replace(/^group-in-/, '') });
        return;
      }
      if (from.groupId !== to.groupId || c.fromPortId.startsWith('group-') || c.toPortId.startsWith('group-')) throw new Error('Use the Clip input/output ports to reorder effect groups.');
      bindingActions(to)?.connectPorts({ ...c, fromNodeId: localId(from), toNodeId: localId(to) });
    }),
    disconnectEdge: (id: string) => safely(() => {
      if (graph?.edges.find(edge => edge.id === id)?.readOnly) return;
      for (const animation of clip?.nodeGraph?.keyframeNodes ?? []) for (const channel of animation.channels) {
        for (const property of [channel.property, ...channel.targets.map(t => t.property)]) {
          if (id === keyframeEdgeId(animation.id, property)) { disconnectKeyframeNode(clip!.id, animation.id, property); return; }
        }
      }
      const edge = graph?.edges.find(e => e.id === id); let node = graph?.nodes.find(n => n.id === edge?.toNodeId);
      if (!edge || !node) return;
      const artifactTarget = node.inputs.find(p => p.id === edge.toPortId)?.metadata?.artifactTarget;
      if (artifactTarget && clip) { createEffectGraphActions(clip.id, artifactTarget.effectId).disconnectEdge(id.slice(id.lastIndexOf('/') + 1)); return; }
      const endpoint = node.inputs.find(p => p.id === edge.toPortId)?.metadata?.groupEndpoint;
      const targets = node.inputs.find(p => p.id === edge.toPortId)?.metadata?.groupEndpoints;
      if (targets && targets.length > 1 && clip && node.binding?.kind === 'operator-group' && node.binding.effectId) {
        editCompositionInput(clip.id, node.binding.effectId, targets.map(endpoint => ({ nodeId: endpoint.nodeId.split('/').at(-1)!, portId: endpoint.portId }))); return;
      }
      if (endpoint) node = graph?.expandedNodes?.find(n => n.id === endpoint.nodeId) ?? node;
      if (edge.toPortId.startsWith('group-') || edge.fromPortId.startsWith('group-')) throw new Error('Reconnect the Clip input/output ports to reorder effects, or bypass an effect to skip it.');
      bindingActions(node)?.disconnectEdge(id.slice(id.lastIndexOf('/') + 1));
    }),
    toggleGroup: (id: string) => safely(() => {
      if (!clip) return;
      const state = readTimelineRuntimeState(useTimelineStore), current = state.clips.find(c => c.id === clip.id)!;
      if (state.isExporting || state.tracks.find(t => t.id === current.trackId)?.locked) throw new Error('The clip is locked or exporting.');
      const model = current.nodeGraph ?? createClipNodeGraphState(current);
      startBatch('Toggle node group');
      try { state.updateClip(current.id, { nodeGraph: { ...model, groups: { ...model.groups,
        [id]: { ...model.groups?.[id], collapsed: !(model.groups?.[id]?.collapsed ?? graph?.groups?.find(group => group.id === id)?.collapsed ?? false) } } } }); } finally { endBatch(); }
    }),
  };
}
