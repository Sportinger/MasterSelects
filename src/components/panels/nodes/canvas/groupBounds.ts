import type { NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import { getGraphBounds, getNodeHeight, NODE_WIDTH, type NodeBounds } from './canvasGeometry';

export function nodeGroupBounds(graph: NodeGraph, nodes: NodeGraphNode[]): Map<string, NodeBounds> {
  const bounds = new Map<string, NodeBounds>();
  const measure = (id: string): NodeBounds | undefined => {
    if (bounds.has(id)) return bounds.get(id);
    const group = graph.groups?.find(g => g.id === id), members = nodes.filter(n => group?.nodeIds.includes(n.id));
    if (!members.length) return;
    const children = group?.collapsed ? [] : (graph.groups ?? []).filter(g => g.parentId === id).map(g => measure(g.id)).filter((b): b is NodeBounds => !!b);
    const value = {
      left: Math.min(...members.map(n => n.layout.x - 22), ...children.map(b => b.left - 16)),
      top: Math.min(...members.map(n => n.layout.y - 48), ...children.map(b => b.top - 38)),
      right: Math.max(...members.map(n => n.layout.x + NODE_WIDTH + 22), ...children.map(b => b.right + 16)),
      bottom: Math.max(...members.map(n => n.layout.y + getNodeHeight(n) + 22), ...children.map(b => b.bottom + 16)),
    };
    bounds.set(id, value); return value;
  };
  graph.groups?.forEach(g => measure(g.id)); return bounds;
}
export function annotatedGraphBounds(graph: NodeGraph, nodes: NodeGraphNode[]): NodeBounds {
  const all = [getGraphBounds({ ...graph, nodes }), ...nodeGroupBounds(graph, nodes).values()];
  return { left: Math.min(...all.map(b => b.left)), top: Math.min(...all.map(b => b.top)), right: Math.max(...all.map(b => b.right)), bottom: Math.max(...all.map(b => b.bottom)) };
}
