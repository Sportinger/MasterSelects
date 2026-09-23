import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorEndpoint, OperatorGroup } from '../../types/operatorGraph';
import { getOperatorComposition } from './operatorCompositionRegistry';
import { IMAGE_EFFECT_GRAPH_LIMITS } from './effectGraphLimits';

const key = (endpoint: OperatorEndpoint) => `${endpoint.nodeId}:${endpoint.portId}`;
export const sameCompositionNode = (a: BoundOperatorNode, b: BoundOperatorNode): boolean => {
  const semantic = (node: BoundOperatorNode) => Object.entries(node)
    .filter(([name]) => !['id', 'operatorVersion', 'composition'].includes(name))
    .toSorted(([a], [b]) => a.localeCompare(b));
  return (a.operatorVersion ?? 1) === (b.operatorVersion ?? 1) && JSON.stringify(semantic(a)) === JSON.stringify(semantic(b));
};
export function compositionNodeIds(instance: BoundOperatorNode, definition: OperatorDefinition): Record<string, string> {
  return Object.fromEntries(definition.composition!.graph.nodes.map(node => [node.id, instance.composition?.nodeIds[node.id] ?? `${instance.id}--${node.id}`]));
}

/** Group bypass contracts follow the same public ports as composition edges. */
function remapGroupBypassEndpoints(graph: EffectOperatorGraph, replacements: ReadonlyMap<string, OperatorEndpoint>) {
  for (const group of graph.groups ?? []) if (group.bypassOutputs) {
    group.bypassOutputs = Object.fromEntries(Object.entries(group.bypassOutputs).map(([output, target]) => {
      const mappedOutput = replacements.get(output);
      return [mappedOutput ? key(mappedOutput) : output, replacements.get(key(target)) ?? target];
    }));
  }
}

/** Only explicit public inputs/outputs may cross a shared definition's boundary. */
export function compositionBoundary(graph: EffectOperatorGraph, definition: OperatorDefinition, ids: Record<string, string>) {
  const body = definition.composition!;
  const members = new Set(Object.values(ids));
  if (members.size !== body.graph.nodes.length || body.graph.nodes.some(node => {
    const actual = graph.nodes.find(item => item.id === ids[node.id]);
    return !actual || !sameCompositionNode(actual, node);
  })) return;
  const internal = graph.edges.filter(edge => members.has(edge.from) && members.has(edge.to));
  if (internal.length !== body.graph.edges.length || body.graph.edges.some(edge => !internal.some(actual =>
    actual.from === ids[edge.from] && actual.output === edge.output && actual.to === ids[edge.to] && actual.input === edge.input))) return;
  const inputs = Object.fromEntries(Object.entries(body.inputs).map(([port, endpoints]) => [port, endpoints.map(endpoint =>
    ({ nodeId: ids[endpoint.nodeId], portId: endpoint.portId }))]));
  const outputs = Object.fromEntries(Object.entries(body.outputs).map(([port, endpoint]) => [port, { nodeId: ids[endpoint.nodeId], portId: endpoint.portId }]));
  const incoming = graph.edges.filter(edge => !members.has(edge.from) && members.has(edge.to));
  const outgoing = graph.edges.filter(edge => members.has(edge.from) && !members.has(edge.to));
  if (incoming.some(edge => !Object.values(inputs).flat().some(endpoint => key(endpoint) === `${edge.to}:${edge.input}`))
    || outgoing.some(edge => !Object.values(outputs).some(endpoint => key(endpoint) === `${edge.from}:${edge.output}`))) return;
  for (const endpoints of Object.values(inputs)) {
    const links = endpoints.map(endpoint => incoming.filter(edge => edge.to === endpoint.nodeId && edge.input === endpoint.portId));
    if (links.some(items => items.length > 1)) return;
    const sources = links.map(items => items[0] ? `${items[0].from}:${items[0].output}` : 'unconnected');
    if (new Set(sources).size !== 1) return;
  }
  return { members, inputs, outputs, incoming, outgoing };
}

/** Inline expansion retains leaf identities, parameter owners and evaluation order. No render pass is added. */
export function expandOperatorCompositions(source: EffectOperatorGraph): EffectOperatorGraph {
  if (!source.nodes.some(node => getOperatorComposition(node.operator))) return source;
  const graph = structuredClone(source);
  const depths = new Map<string, number>();
  for (;;) {
    const instance = graph.nodes.find(node => getOperatorComposition(node.operator));
    if (!instance) return graph;
    const definition = getOperatorComposition(instance.operator)!, body = definition.composition!;
    const depth = depths.get(instance.id) ?? 0;
    if (depth >= 4) throw new Error('Composition nesting exceeds four levels.');
    if (instance.operatorVersion !== 1 || Object.keys(instance.bindings).length || Object.keys(instance.constants ?? {}).length
      || instance.bypassed || instance.enabled) throw new Error(`Unsupported composition instance: ${instance.id}.`);
    const ids = compositionNodeIds(instance, definition), occupied = new Set(graph.nodes.map(node => node.id));
    if (new Set(Object.values(ids)).size !== body.graph.nodes.length || Object.values(ids).some(id => occupied.has(id) || !/^[\w-]+$/.test(id))) {
      throw new Error(`Composition identity collision: ${instance.id}.`);
    }
    const position = graph.layout[instance.id] ?? { x: 0, y: 0 }, groupId = `compound-${instance.id}`;
    if (graph.groups?.some(group => group.id === groupId)) throw new Error(`Composition group collision: ${groupId}.`);
    const parent = graph.groups?.find(group => group.nodeIds.includes(instance.id));
    graph.edges = graph.edges.flatMap(edge => {
      const from = edge.from === instance.id ? body.outputs[edge.output] : undefined;
      if (edge.from === instance.id && !from) throw new Error(`Unknown composition output: ${edge.output}.`);
      const targets = edge.to === instance.id ? body.inputs[edge.input] : [{ nodeId: edge.to, portId: edge.input }];
      if (!targets) throw new Error(`Unknown composition input: ${edge.input}.`);
      return targets.map((target, index) => ({ ...edge, id: index ? `${edge.id}--${instance.id}-${index}` : edge.id,
        from: from ? ids[from.nodeId] : edge.from, output: from?.portId ?? edge.output,
        to: edge.to === instance.id ? ids[target.nodeId] : target.nodeId, input: target.portId }));
    });
    remapGroupBypassEndpoints(graph, new Map(Object.entries(body.outputs).map(([port, endpoint]) =>
      [`${instance.id}:${port}`, { nodeId: ids[endpoint.nodeId], portId: endpoint.portId }])));
    graph.edges.push(...body.graph.edges.map(edge => ({ ...edge, id: `${instance.id}--${edge.id}`, from: ids[edge.from], to: ids[edge.to] })));
    graph.nodes.splice(graph.nodes.indexOf(instance), 1, ...body.graph.nodes.map(node => ({ ...structuredClone(node), id: ids[node.id],
      ...(instance.composition?.children?.[node.id] ? { composition: structuredClone(instance.composition.children[node.id]) } : {}) })));
    for (const node of body.graph.nodes) {
      const layout = instance.composition?.layout[node.id] ?? body.graph.layout[node.id] ?? { x: 0, y: 0 };
      graph.layout[ids[node.id]] = { x: position.x + layout.x, y: position.y + layout.y };
      depths.set(ids[node.id], depth + 1);
    }
    delete graph.layout[instance.id];
    if (parent) parent.nodeIds = parent.nodeIds.filter(id => id !== instance.id);
    const storedInstance = { ...instance, composition: { ...instance.composition, nodeIds: ids, layout: instance.composition?.layout ?? {} } };
    (graph.groups ??= []).push({ id: groupId, label: definition.label, color: '#799ab4', nodeIds: Object.values(ids),
      ...(parent ? { parentId: parent.id } : {}), collapsedByDefault: true, composition: { instance: storedInstance, position } });
    if (graph.nodes.length > IMAGE_EFFECT_GRAPH_LIMITS.nodes || graph.edges.length > IMAGE_EFFECT_GRAPH_LIMITS.edges) {
      throw new Error('Expanded composition exceeds the image graph budget.');
    }
  }
}

/** Reuse unchanged definitions. An edited interior becomes a local group, never mutates other instances. */
export function packOperatorCompositions(source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.groups?.some(group => group.bypassed)) return source;
  if (!source.groups?.some(group => group.composition)) return source;
  const graph = structuredClone(source);
  const depth = (group: OperatorGroup): number => group.parentId ? 1 + depth(graph.groups!.find(parent => parent.id === group.parentId)!) : 0;
  for (const group of [...graph.groups!].toSorted((a, b) => depth(b) - depth(a))) {
    if (!group.composition) continue;
    const { instance, position } = group.composition, definition = getOperatorComposition(instance.operator)!;
    const ids = compositionNodeIds(instance, definition), boundary = compositionBoundary(graph, definition, ids);
    if (!boundary || group.label !== definition.label || group.nodeIds.length !== boundary.members.size
      || group.nodeIds.some(id => !boundary.members.has(id))) {
      delete group.composition;
      continue;
    }
    const layout = Object.fromEntries(Object.entries(ids).map(([local, id]) => [local,
      { x: (graph.layout[id]?.x ?? position.x) - position.x, y: (graph.layout[id]?.y ?? position.y) - position.y }]));
    const children = Object.fromEntries(Object.entries(ids).flatMap(([local, id]) => {
      const child = graph.nodes.find(node => node.id === id)?.composition;
      return child ? [[local, child]] : [];
    }));
    const packed = { ...instance, composition: { nodeIds: ids, layout, ...(Object.keys(children).length ? { children } : {}) } };
    const first = graph.nodes.findIndex(node => boundary.members.has(node.id));
    graph.nodes = graph.nodes.filter(node => !boundary.members.has(node.id)); graph.nodes.splice(first, 0, packed);
    graph.edges = graph.edges.filter(edge => !boundary.members.has(edge.from) && !boundary.members.has(edge.to));
    for (const [port, endpoints] of Object.entries(boundary.inputs)) {
      const edge = boundary.incoming.find(edge => edge.to === endpoints[0].nodeId && edge.input === endpoints[0].portId);
      if (edge) graph.edges.push({ ...edge, to: instance.id, input: port });
    }
    for (const edge of boundary.outgoing) {
      const port = Object.entries(boundary.outputs).find(([, endpoint]) => endpoint.nodeId === edge.from && endpoint.portId === edge.output)![0];
      graph.edges.push({ ...edge, from: instance.id, output: port });
    }
    remapGroupBypassEndpoints(graph, new Map(Object.entries(boundary.outputs).map(([port, endpoint]) =>
      [key(endpoint), { nodeId: instance.id, portId: port }])));
    for (const id of boundary.members) delete graph.layout[id];
    graph.layout[instance.id] = position;
    const parent = graph.groups!.find(parent => parent.id === group.parentId);
    parent?.nodeIds.push(instance.id);
    graph.groups = graph.groups!.filter(item => item !== group);
  }
  if (!graph.groups?.length) delete graph.groups;
  return graph;
}

export function compositionGroupInterface(graph: EffectOperatorGraph, group: OperatorGroup) {
  if (!group.composition) return;
  const resolve = (endpoint: OperatorEndpoint, direction: 'inputs' | 'outputs'): OperatorEndpoint[] => {
    const child = graph.groups?.find(group => group.composition?.instance.id === endpoint.nodeId);
    if (!child?.composition) return [endpoint];
    const definition = getOperatorComposition(child.composition.instance.operator)!;
    const ids = compositionNodeIds(child.composition.instance, definition), body = definition.composition!;
    const inner = direction === 'inputs' ? body.inputs[endpoint.portId] : [body.outputs[endpoint.portId]];
    return inner.flatMap(item => resolve({ nodeId: ids[item.nodeId], portId: item.portId }, direction));
  };
  const definition = getOperatorComposition(group.composition.instance.operator)!;
  const ids = compositionNodeIds(group.composition.instance, definition);
  const port = (endpoint: OperatorEndpoint) => ({ nodeId: ids[endpoint.nodeId], portId: endpoint.portId });
  return { operatorId: definition.id, description: definition.description, position: group.composition.position,
    inputs: definition.inputs.map(input => ({ ...input, endpoints: definition.composition!.inputs[input.id].flatMap(item => resolve(port(item), 'inputs')) })),
    outputs: definition.outputs.map(output => ({ ...output, endpoints: resolve(port(definition.composition!.outputs[output.id]), 'outputs') })) };
}
