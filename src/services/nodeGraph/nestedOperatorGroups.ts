import type { NodeGraph, NodeGraphNode, NodeGraphPort, ClipNodeGraph } from '../../types/nodeGraph';

/** Nested groups expose the actual typed endpoints; folding never changes executable edges. */
export function foldOperatorGroups(graph: NodeGraph, state?: ClipNodeGraph, expandAllGroups = false): NodeGraph {
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
    g.collapsed = !expandAllGroups && (state?.groups?.[g.id]?.collapsed ?? true);
    if (!g.collapsed) continue;
    const members = nodes.filter(n => g.nodeIds.includes(n.id)); if (!members.length) continue;
    const ids = new Set(members.map(n => n.id));
    const effectOwner = members.map(n => n.binding && 'effectId' in n.binding ? n.binding.effectId : undefined).find(Boolean);
    const proxy: NodeGraphNode = { id: g.proxyId, label: g.label, kind: 'effect', runtime: 'subgraph',
      description: g.composition?.description ?? 'Local node group. Expand to inspect its processing steps.', inputs: [], outputs: [],
      ...(g.composition ? { operatorId: g.composition.operatorId, params: { categoryLabel: 'COMPOSED' } } : {}),
      groupId: members[0].groupId, binding: { kind: 'operator-group', groupId: g.id,
        ...(effectOwner ? { effectId: effectOwner } : {}) },
      layout: state?.groups?.[g.id]?.position ?? g.composition?.position ?? { x: Math.min(...members.map(n => n.layout.x)), y: Math.min(...members.map(n => n.layout.y)) } };
    const controlInputs = members.flatMap(node => node.controlInputs ?? []);
    if (controlInputs.length) proxy.controlInputs = controlInputs;
    const animated = members.filter(node => node.animation);
    if (animated.length) proxy.animation = { clipId: animated[0].animation!.clipId,
      channels: animated.flatMap(node => node.animation!.channels) };
    // Local folders infer a public input from each shared incoming signal. Keep
    // every leaf endpoint so reconnect/disconnect still edits all consumers.
    const inputBundles = new Map<string, { id: string; label: string; endpoints: Array<{ nodeId: string; portId: string }> }>();
    const bundleForPort = new Map<string, string>();
    if (!g.composition) for (const edge of edges) {
      if (!ids.has(edge.toNodeId) || ids.has(edge.fromNodeId)) continue;
      const target = members.find(node => node.id === edge.toNodeId)?.inputs.find(port => port.id === edge.toPortId);
      if (!target || target.metadata?.repeated || target.metadata?.controlProperty) continue;
      const source = nodes.find(node => node.id === edge.fromNodeId), output = source?.outputs.find(port => port.id === edge.fromPortId);
      const key = `${edge.fromNodeId}:${edge.fromPortId}:${target.type}`;
      const endpointKey = `${edge.toNodeId}:${edge.toPortId}`;
      const bundle = inputBundles.get(key) ?? { id: endpointKey,
        label: String(output?.label && output.label !== 'Value' ? output.label : source?.params?.valueLabel ?? source?.label ?? target.label), endpoints: [] };
      const endpoints = target.metadata?.groupEndpoints ?? [target.metadata?.groupEndpoint ?? { nodeId: edge.toNodeId, portId: edge.toPortId }];
      for (const endpoint of endpoints) if (!bundle.endpoints.some(item => item.nodeId === endpoint.nodeId && item.portId === endpoint.portId)) bundle.endpoints.push(endpoint);
      inputBundles.set(key, bundle); bundleForPort.set(endpointKey, key);
    }
    const expose = (node: NodeGraphNode, port: NodeGraphPort) => {
      const list = port.direction === 'input' ? proxy.inputs : proxy.outputs;
      const endpoint = port.metadata?.groupEndpoint ?? { nodeId: node.id, portId: port.id };
      const declared = (port.direction === 'input' ? g.composition?.inputs : g.composition?.outputs)?.find(p =>
        p.endpoints.some(item => item.nodeId === endpoint.nodeId && item.portId === endpoint.portId));
      if (declared) {
        if (!list.some(p => p.id === declared.id)) list.push({ ...port, id: declared.id, label: declared.label,
          metadata: { ...port.metadata, groupEndpoint: declared.endpoints[0], groupEndpoints: declared.endpoints } });
        return declared.id;
      }
      const id = `${node.id}:${port.id}`;
      const bundleKey = port.direction === 'input' ? bundleForPort.get(id) : undefined;
      const bundle = bundleKey ? inputBundles.get(bundleKey) : undefined;
      if (bundle) {
        if (!list.some(p => p.id === bundle.id)) list.push({ ...port, id: bundle.id, label: bundle.label,
          metadata: { ...port.metadata, groupEndpoint: bundle.endpoints[0], groupEndpoints: bundle.endpoints } });
        return bundle.id;
      }
      if (!list.some(p => p.id === id)) list.push({ ...port, id, label: `${node.params?.valueLabel ?? node.label}: ${port.label}`,
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
  const visibleEdges = edges.filter(e => visible.has(e.fromNodeId) && visible.has(e.toNodeId));
  const seen = new Set<string>();
  return { ...graph, nodes, expandedNodes, edges: visibleEdges.filter(edge => {
    const target = nodes.find(node => node.id === edge.toNodeId)?.inputs.find(port => port.id === edge.toPortId);
    if (!target?.metadata?.groupEndpoints) return true;
    const key = `${edge.fromNodeId}:${edge.fromPortId}:${edge.toNodeId}:${edge.toPortId}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  }), groups: groups.filter(g => !hiddenByParent(g.parentId)) };
}
