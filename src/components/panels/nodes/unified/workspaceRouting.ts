import type { NodeGraph, NodeGraphConnectionRequest, NodeGraphLayout } from '../../../../types/nodeGraph';
import type { NodeGraphCanvasProps } from '../NodeGraphCanvas';
import type { ClipWorkspaceControllerValue } from './ClipWorkspaceController';
import { workspaceClipId, workspaceClipGroup, resolveWorkspaceClipOwner } from '../../../../services/nodeGraph/unified/workspaceIds';
import { localWorkspacePoint } from '../../../../services/nodeGraph/unified/embedWorkspaceGraph';
import { clipWorkspaceBatch } from './useClipDomainAdapter';

type Controllers = ReadonlyMap<string, ClipWorkspaceControllerValue>;
/** Explicit owner lookup: composition ids never fall through to the selected clip. */
export function workspaceRouting(graph: NodeGraph, controllers: Controllers, selected: readonly string[], activate: (clipId: string) => void,
  composition: { connect: (connection: NodeGraphConnectionRequest) => void; toggle: (groupId: string) => void; message: (text: string) => void; openMenu: NonNullable<NodeGraphCanvasProps['onOpenAddMenu']> }) {
  const owner = (id: string) => {
    const parsed = resolveWorkspaceClipOwner(graph, id);
    const controller = parsed && controllers.get(parsed.clipId);
    return parsed && controller && graph.workspace?.clips[parsed.clipId] ? { ...parsed, controller, actions: controller.canvasProps } : null;
  };
  const point = (clipId: string, value: NodeGraphLayout) => localWorkspacePoint(value, graph.workspace!.clips[clipId].origin);
  const connection = (value: NodeGraphConnectionRequest) => {
    const a = owner(value.fromNodeId), b = owner(value.toNodeId);
    return a && b && a.clipId === b.clipId ? { a, local: { ...value, fromNodeId: a.localId, toNodeId: b.localId } } : null;
  };
  const byOwner = (ids: readonly string[]) => {
    const groups = new Map<string, string[]>();
    for (const id of ids) { const found = owner(id); if (found) groups.set(found.clipId, [...groups.get(found.clipId) ?? [], found.localId]); }
    return groups;
  };
  const routes: Partial<NodeGraphCanvasProps> = {
    onMoveNode: (id, layout) => { const found = owner(id); found?.actions.onMoveNode?.(found.localId, point(found.clipId, layout)); },
    onMoveNodes: moves => clipWorkspaceBatch('Move nodes', () => moves.forEach(move => routes.onMoveNode?.(move.nodeId, move.layout))),
    onConnectPorts: value => { const local = connection(value); if (local) local.a.actions.onConnectPorts?.(local.local); else composition.connect(value); },
    onReconnectPorts: (id, value) => {
      const local = connection(value), edge = owner(id);
      if (local && edge?.clipId === local.a.clipId) edge.actions.onReconnectPorts?.(edge.localId, local.local);
      else composition.connect(value);
    },
    onDisconnectEdge: id => { const found = owner(id); if (found) found.actions.onDisconnectEdge?.(found.localId); else composition.message('Move the clip output to another compatible track. Composition references are read-only.'); },
    onDeleteNode: id => { const found = owner(id); found?.actions.onDeleteNode?.(found.localId); },
    onDeleteNodes: ids => clipWorkspaceBatch('Delete nodes', () => {
      for (const [id, nodes] of byOwner(ids)) controllers.get(id)?.canvasProps.onDeleteNodes?.(nodes);
    }),
    onToggleNodeBypass: id => { const found = owner(id); found?.actions.onToggleNodeBypass?.(found.localId); },
    onToggleGroup: id => { const found = owner(id); if (found) found.actions.onToggleGroup?.(found.localId); else composition.toggle(id); },
    onDropConnection: drop => {
      const found = owner(drop.nodeId); if (!found) return;
      activate(found.clipId); found.actions.onDropConnection?.({ ...drop, nodeId: found.localId, layout: point(found.clipId, drop.layout) });
    },
    onOpenAddMenu: menu => {
      for (const controller of controllers.values()) controller.closeMenus();
      const groupClip = Object.keys(graph.workspace?.clips ?? {}).find(id => workspaceClipGroup(id) === menu.groupId);
      const found = groupClip ? owner(workspaceClipId(groupClip, graph.workspace!.clips[groupClip].graph.nodes[0].id))
        : menu.nodeId || menu.groupId ? owner(menu.nodeId ?? menu.groupId!)
          : graph.owner.kind === 'clip' ? owner(workspaceClipId(graph.owner.id, graph.workspace!.clips[graph.owner.id]?.graph.nodes[0]?.id ?? '')) : null;
      if (!found) { composition.openMenu(menu); return; }
      activate(found.clipId);
      found.actions.onOpenAddMenu?.({ ...menu, layout: point(found.clipId, menu.layout),
        nodeId: menu.nodeId ? owner(menu.nodeId)?.localId : null, groupId: menu.groupId ? owner(menu.groupId)?.localId ?? null : null });
    },
    cableInsertEntries: (edge, position) => {
      const found = owner(edge.id); if (!found) return [];
      const local = found.controller.projection.graph.edges.find(candidate => candidate.id === found.localId);
      return local ? found.actions.cableInsertEntries?.(local, point(found.clipId, position)) ?? [] : [];
    },
    onTransferNodes: (ids, groupId) => {
      const target = owner(groupId), members = ids.map(owner);
      if (!target || members.some(member => member?.clipId !== target.clipId)) throw new Error('Move nodes within their owning clip.');
      const moved = target.actions.onTransferNodes?.(members.map(member => member!.localId), target.localId) ?? {};
      return Object.fromEntries(Object.entries(moved).map(([a, b]) => [workspaceClipId(target.clipId, a), workspaceClipId(target.clipId, b)]));
    },
    onGroupSelection: () => {
      const groups = byOwner(selected);
      if (groups.size !== 1 || [...groups.values()][0].length !== selected.length) { composition.message('Select nodes from one clip to group them.'); return; }
      controllers.get([...groups.keys()][0])?.canvasProps.onGroupSelection?.();
    },
    onDuplicateSelection: () => { const groups = byOwner(selected); if (groups.size === 1) controllers.get([...groups.keys()][0])?.canvasProps.onDuplicateSelection?.(); },
  };
  return { ...routes, owner, point };
}
