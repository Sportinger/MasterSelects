import type { NodeGraph, NodeGraphNode, NodeGraphPort, ClipNodeGraph } from '../../types/nodeGraph';

/** Nested groups expose the actual typed endpoints; folding never changes executable edges. */
export function foldOperatorGroups(graph: NodeGraph, state?: ClipNodeGraph): NodeGraph {
  const groups = graph.groups?.map(g => ({ ...g, nodeIds: [...g.nodeIds] })) ?? [];
  let nodes = graph.nodes.map(n => ({ ...n, layout: { ...n.layout } }));
  const edges = graph.edges.map(e => ({ ...e }));
  const depth = (id?: string): number => { const g = groups.find(item => item.id === id); return g?.parentId ? 1 + depth(g.parentId) : 0; };
  // Apply saved nested-group positions to all contained nodes, including grandchildren.
  for (const g of groups.filter(g => g.parentId).toSorted((a, b) => depth(a.id) - depth(b.id))) {
    const members = nodes.filter(n => g.nodeIds.includes(n.id)), position = state?.groups?.[g.id]?.position;
    if (!position || !members.length) continue;
    const dx = position.x - Math.min(...members.map(n => n.layout.x)), dy = position.y - Math.min(...members.map(n => n.layout.y));
    members.forEach(n => { n.layout = { x: n.layout.x + dx, y: n.layout.y + dy }; n.groupOffset = { x: (n.groupOffset?.x ?? 0) + dx, y: (n.groupOffset?.y ?? 0) + dy }; });
  }
  const expandedNodes = nodes;
  for (const g of groups.filter(g => g.parentId).toSorted((a, b) => depth(b.id) - depth(a.id))) {
    g.collapsed = state?.groups?.[g.id]?.collapsed === true;
    if (!g.collapsed) continue;
    const members = nodes.filter(n => g.nodeIds.includes(n.id)); if (!members.length) continue;
    const ids = new Set(members.map(n => n.id));
    const effectOwner = members.map(n => n.binding && 'effectId' in n.binding ? n.binding.effectId : undefined).find(Boolean);
    const proxy: NodeGraphNode = { id: g.proxyId, label: g.label, kind: 'effect', runtime: 'subgraph',
      description: 'Reusable node group. Expand to inspect its processing steps.', inputs: [], outputs: [],
      groupId: members[0].groupId, binding: { kind: 'operator-group', groupId: g.id,
        ...(effectOwner ? { effectId: effectOwner } : {}) },
      layout: { x: Math.min(...members.map(n => n.layout.x)), y: Math.min(...members.map(n => n.layout.y)) } };
    const expose = (node: NodeGraphNode, port: NodeGraphPort) => {
      const list = port.direction === 'input' ? proxy.inputs : proxy.outputs;
      const id = `${node.id}:${port.id}`;
      if (!list.some(p => p.id === id)) list.push({ ...port, id, label: `${node.label}: ${port.label}`,
        metadata: { ...port.metadata, groupEndpoint: port.metadata?.groupEndpoint ?? { nodeId: node.id, portId: port.id } } });
      return id;
    };
    for (const node of members) for (const port of [...node.inputs, ...node.outputs]) {
      const connected = edges.filter(e => port.direction === 'input' ? e.toNodeId === node.id && e.toPortId === port.id : e.fromNodeId === node.id && e.fromPortId === port.id);
      if (!connected.length || connected.some(e => !ids.has(port.direction === 'input' ? e.fromNodeId : e.toNodeId))) expose(node, port);
    }
    for (const e of edges) {
      if (ids.has(e.fromNodeId) && ids.has(e.toNodeId)) continue;
      const from = members.find(n => n.id === e.fromNodeId), to = members.find(n => n.id === e.toNodeId);
      if (from) { e.fromPortId = expose(from, from.outputs.find(p => p.id === e.fromPortId)!); e.fromNodeId = proxy.id; }
      if (to) { e.toPortId = expose(to, to.inputs.find(p => p.id === e.toPortId)!); e.toNodeId = proxy.id; }
    }
    nodes = nodes.filter(n => !ids.has(n.id)).concat(proxy);
    for (const parent of groups) if (parent.nodeIds.some(id => ids.has(id))) parent.nodeIds = parent.nodeIds.filter(id => !ids.has(id)).concat(proxy.id);
  }
  const visible = new Set(nodes.map(n => n.id));
  const hiddenByParent = (id?: string): boolean => { const g = groups.find(group => group.id === id); return !!g && (g.collapsed || hiddenByParent(g.parentId)); };
  return { ...graph, nodes, expandedNodes, edges: edges.filter(e => visible.has(e.fromNodeId) && visible.has(e.toNodeId)), groups: groups.filter(g => !hiddenByParent(g.parentId)) };
}
