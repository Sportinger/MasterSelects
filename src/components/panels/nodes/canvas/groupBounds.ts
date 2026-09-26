import type { NodeGraph, NodeGraphNode, NodeGroupSize } from '../../../../types/nodeGraph';
import { getGraphBounds, getNodeHeight, NODE_WIDTH, type NodeBounds } from './canvasGeometry';

export function encloseNodeGroup(members: NodeGraphNode[], children: NodeBounds[]): NodeBounds {
  return {
    left: Math.min(...members.map(n => n.layout.x - 22), ...children.map(b => b.left - 16)),
    top: Math.min(...members.map(n => n.layout.y - 48), ...children.map(b => b.top - 38)),
    right: Math.max(...members.map(n => n.layout.x + NODE_WIDTH + 22), ...children.map(b => b.right + 16)),
    bottom: Math.max(...members.map(n => n.layout.y + getNodeHeight(n) + 22), ...children.map(b => b.bottom + 16)),
  };
}

/** A hand-sized empty effect frame grows from its top-left corner; members still enlarge it. */
export function withGroupSize(box: NodeBounds, size?: NodeGroupSize): NodeBounds {
  return size ? { ...box, right: Math.max(box.right, box.left + size.width), bottom: Math.max(box.bottom, box.top + size.height) } : box;
}

export function nodeGroupBounds(graph: NodeGraph, nodes: NodeGraphNode[]): Map<string, NodeBounds> {
  const bounds = new Map<string, NodeBounds>();
  const groups = new Map(graph.groups?.map(group => [group.id, group]));
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  const childrenById = new Map<string, string[]>();
  for (const group of graph.groups ?? []) if (group.parentId) {
    const children = childrenById.get(group.parentId) ?? [];
    children.push(group.id); childrenById.set(group.parentId, children);
  }
  const measure = (id: string): NodeBounds | undefined => {
    if (bounds.has(id)) return bounds.get(id);
    const group = groups.get(id), members = (group?.nodeIds ?? []).map(nodeId => nodesById.get(nodeId)).filter((node): node is NodeGraphNode => !!node);
    const children = group?.collapsed ? [] : (childrenById.get(id) ?? []).map(measure).filter((b): b is NodeBounds => !!b);
    if (!members.length && !children.length) return;
    const value = group?.collapsed
      ? { left: Math.min(...members.map(n => n.layout.x)), top: Math.min(...members.map(n => n.layout.y)),
        right: Math.max(...members.map(n => n.layout.x + NODE_WIDTH)), bottom: Math.max(...members.map(n => n.layout.y + getNodeHeight(n))) }
      : withGroupSize(encloseNodeGroup(members, children), group?.size);
    bounds.set(id, value); return value;
  };
  graph.groups?.forEach(g => measure(g.id)); return bounds;
}
export function annotatedGraphBounds(graph: NodeGraph, nodes: NodeGraphNode[], groups = nodeGroupBounds(graph, nodes)): NodeBounds {
  const all = [getGraphBounds({ ...graph, nodes }), ...groups.values()];
  return { left: Math.min(...all.map(b => b.left)), top: Math.min(...all.map(b => b.top)), right: Math.max(...all.map(b => b.right)), bottom: Math.max(...all.map(b => b.bottom)) };
}
