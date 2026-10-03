import type { NodeGraphEdge, NodeGraphNode, NodeGraphPort } from '../../../../../types/nodeGraph';
import type { CanvasView } from './nodeCanvasTypes';
import { NodePreviewController } from '../../previews/NodePreviewController';
import { workspaceClipOwner } from '../../../../../services/nodeGraph/unified/workspaceIds';

type Sink = ConstructorParameters<typeof NodePreviewController>[0];
const local = (id: string) => workspaceClipOwner(id)?.localId ?? id;
function localNode(node: NodeGraphNode): NodeGraphNode {
  const port = (port: NodeGraphPort): NodeGraphPort => ({ ...port, ...(port.metadata ? { metadata: { ...port.metadata,
    groupEndpoint: port.metadata.groupEndpoint && { ...port.metadata.groupEndpoint, nodeId: local(port.metadata.groupEndpoint.nodeId) },
    groupEndpoints: port.metadata.groupEndpoints?.map(endpoint => ({ ...endpoint, nodeId: local(endpoint.nodeId) })),
  } } : {}) });
  return { ...node, id: local(node.id), groupId: node.groupId && local(node.groupId), inputs: node.inputs.map(port), outputs: node.outputs.map(port) };
}

/** Reuses the existing preview scheduler per requested owner; collapsed/unrequested clips cost nothing. */
export class WorkspacePreviewController {
  private controllers = new Map<string, NodePreviewController>();
  private evictions = new Map<string, (keys: string[]) => void>();
  private view?: CanvasView;
  private visible = true;
  private suspended = false;
  private sink: Sink;
  private host: HTMLElement;
  constructor(sink: Sink, host: HTMLElement) {
    this.sink = sink; this.host = host;
    sink.onPreviewsEvicted = keys => { for (const listener of this.evictions.values()) listener(keys); };
  }
  scene(clipId: string | null, nodes: NodeGraphNode[], selected: string | null, expanded?: NodeGraphNode[], edges: readonly NodeGraphEdge[] = []) {
    const owners = new Set(nodes.filter(node => node.preview?.requested || node.preview?.enabled).flatMap(node => node.workspaceOwner?.clipId ?? clipId ?? []));
    for (const [id, controller] of this.controllers) if (!owners.has(id)) { controller.dispose(); this.controllers.delete(id); this.evictions.delete(id); }
    for (const id of owners) {
      let controller = this.controllers.get(id);
      if (!controller) {
        const sink = this.sink, listeners = this.evictions;
        controller = new NodePreviewController({ preview: frame => sink.preview(frame), get software() { return sink.software; },
          get previewBusy() { return sink.previewBusy; }, set onPreviewsEvicted(listener: ((keys: string[]) => void) | undefined) {
            if (listener) listeners.set(id, listener); else listeners.delete(id);
          } }, this.host);
        this.controllers.set(id, controller);
        controller.visibility(this.visible); controller.suspend(this.suspended); if (this.view) controller.viewport(this.view);
      }
      const belongs = (node: NodeGraphNode) => (node.workspaceOwner?.clipId ?? clipId) === id;
      const owned = nodes.filter(belongs), ids = new Set(owned.map(node => node.id));
      controller.scene(id, owned.map(localNode), selected && ids.has(selected) ? local(selected) : null,
        expanded?.filter(belongs).map(localNode), edges.filter(edge => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId)).map(edge => ({
          ...edge, id: local(edge.id), fromNodeId: local(edge.fromNodeId), toNodeId: local(edge.toNodeId),
        })));
    }
  }
  viewport(view: CanvasView) { this.view = view; for (const controller of this.controllers.values()) controller.viewport(view); }
  visibility(value: boolean) { this.visible = value; for (const controller of this.controllers.values()) controller.visibility(value); }
  suspend(value: boolean) { this.suspended = value; for (const controller of this.controllers.values()) controller.suspend(value); }
  reset() { for (const controller of this.controllers.values()) controller.reset(); }
  dispose() { for (const controller of this.controllers.values()) controller.dispose(); this.controllers.clear(); this.evictions.clear(); }
}
