import type { NodeGraph, NodeGraphLayout, NodeGraphNode, NodeGraphPort } from '../../../types/nodeGraph';
import { workspaceClipId } from './workspaceIds';

/** Domain bindings remain local; only presentation identities and endpoints are remapped. */
export function namespaceClipGraph(graph: NodeGraph, clipId: string, origin: NodeGraphLayout): NodeGraph {
  const id = (local: string) => workspaceClipId(clipId, local);
  const position = (point: NodeGraphLayout) => ({ x: point.x + origin.x, y: point.y + origin.y });
  const endpoint = <T extends { nodeId: string }>(value: T): T => ({ ...value, nodeId: id(value.nodeId) });
  const port = (value: NodeGraphPort): NodeGraphPort => ({ ...value, ...(value.metadata ? { metadata: { ...value.metadata,
    ...(value.metadata.groupEndpoint ? { groupEndpoint: endpoint(value.metadata.groupEndpoint) } : {}),
    ...(value.metadata.groupEndpoints ? { groupEndpoints: value.metadata.groupEndpoints.map(endpoint) } : {}),
  } } : {}) });
  const node = (value: NodeGraphNode): NodeGraphNode => ({ ...value, id: id(value.id), layout: position(value.layout),
    ...(value.groupId ? { groupId: id(value.groupId) } : {}),
    ...(value.groupOffset ? { groupOffset: position(value.groupOffset) } : {}),
    inputs: value.inputs.map(port), outputs: value.outputs.map(port),
    connectionVariants: value.connectionVariants?.map(variant => ({ ...variant, inputs: variant.inputs.map(port), outputs: variant.outputs.map(port) })),
    workspaceOwner: { clipId, localId: value.id },
  });
  return { ...graph, nodes: graph.nodes.map(node), expandedNodes: graph.expandedNodes?.map(node),
    edges: graph.edges.map(edge => ({ ...edge, id: id(edge.id), fromNodeId: id(edge.fromNodeId), toNodeId: id(edge.toNodeId) })),
    groups: graph.groups?.map(group => ({ ...group, id: id(group.id), proxyId: id(group.proxyId), nodeIds: group.nodeIds.map(id),
      ...(group.parentId ? { parentId: id(group.parentId) } : {}), ...(group.bypassNodeId ? { bypassNodeId: id(group.bypassNodeId) } : {}),
      ...(group.composition ? { composition: { ...group.composition, position: position(group.composition.position),
        inputs: group.composition.inputs.map(port => ({ ...port, endpoints: port.endpoints.map(endpoint) })),
        outputs: group.composition.outputs.map(port => ({ ...port, endpoints: port.endpoints.map(endpoint) })),
      } } : {}),
    })),
  };
}
