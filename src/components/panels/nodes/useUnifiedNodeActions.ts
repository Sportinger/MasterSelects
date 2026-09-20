import { useState } from 'react';
import type { NodeGraph, NodeGraphConnectionRequest, NodeGraphLayout, NodeGraphNode } from '../../../types/nodeGraph';
import type { TimelineClip } from '../../../types';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { createClipNodeGraphState } from '../../../services/nodeGraph';
import { createEffectGraphActions } from '../../../services/operators/effectGraphEditing';
import type { FlockGraphActions } from './flock/useFlockGraphActions';

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
    if (binding?.kind === 'scene-node') return {
      moveNode: (id, layout) => {
        const state = useTimelineStore.getState(), current = state.clips.find(c => c.id === clip.id)!;
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
    if (binding?.kind === 'color-node') {
      const s = useTimelineStore.getState();
      return { moveNode: (id, layout) => s.moveColorNode(clip.id, id, layout),
        connectPorts: c => s.connectColorNodes(clip.id, c.fromNodeId, c.toNodeId, c.fromPortId, c.toPortId),
        disconnectEdge: id => s.removeColorEdge(clip.id, id), deleteNode: id => s.removeColorNode(clip.id, id),
        toggleBypass: id => s.setColorNodeEnabled(clip.id, id, node.params?.enabled === false) };
    }
    return base;
  };
  const route = (id: string, action: (actions: BaseActions, node: NodeGraphNode) => void) => safely(() => {
    const node = graph?.nodes.find(n => n.id === id); if (!node) return;
    const actions = bindingActions(node); if (actions) action(actions, node);
  });
  return {
    message, clearMessage: () => setMessage(''),
    moveNode: (id: string, position: NodeGraphLayout) => route(id, (actions, node) => {
      if (node.groupId && !node.id.includes('/')) {
        const state = useTimelineStore.getState(), current = state.clips.find(c => c.id === clip!.id)!;
        if (state.isExporting || state.tracks.find(t => t.id === current.trackId)?.locked) throw new Error('The clip is locked or exporting.');
        const model = current.nodeGraph ?? createClipNodeGraphState(current);
        state.updateClip(current.id, { nodeGraph: { ...model, groups: { ...model.groups, [node.groupId]: { ...model.groups?.[node.groupId], position } } } });
      } else actions.moveNode(localId(node), { x: position.x - (node.groupOffset?.x ?? 0), y: position.y - (node.groupOffset?.y ?? 0) });
    }),
    toggleBypass: (id: string) => route(id, (actions, node) => actions.toggleBypass(localId(node))),
    deleteNode: (id: string) => route(id, (actions, node) => actions.deleteNode(localId(node))),
    connectPorts: (c: NodeGraphConnectionRequest) => safely(() => {
      const from = graph?.nodes.find(n => n.id === c.fromNodeId), to = graph?.nodes.find(n => n.id === c.toNodeId);
      if (!from || !to) return;
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
      const edge = graph?.edges.find(e => e.id === id), node = graph?.nodes.find(n => n.id === edge?.toNodeId);
      if (!edge || !node) return;
      if (edge.toPortId.startsWith('group-') || edge.fromPortId.startsWith('group-')) throw new Error('Reconnect the Clip input/output ports to reorder effects, or bypass an effect to skip it.');
      bindingActions(node)?.disconnectEdge(id.slice(id.lastIndexOf('/') + 1));
    }),
    toggleGroup: (id: string) => safely(() => {
      if (!clip) return;
      const state = useTimelineStore.getState(), current = state.clips.find(c => c.id === clip.id)!;
      if (state.isExporting || state.tracks.find(t => t.id === current.trackId)?.locked) throw new Error('The clip is locked or exporting.');
      const model = current.nodeGraph ?? createClipNodeGraphState(current);
      startBatch('Toggle node group');
      try { state.updateClip(current.id, { nodeGraph: { ...model, groups: { ...model.groups,
        [id]: { ...model.groups?.[id], collapsed: !model.groups?.[id]?.collapsed } } } }); } finally { endBatch(); }
    }),
  };
}
