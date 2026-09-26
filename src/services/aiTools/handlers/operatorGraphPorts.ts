import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import { addableEffectOperators } from '../../operators/effectGraphOwner';
import { createEffectGraphActions, editCompositionInput, editEffectGraph } from '../../operators/effectGraphEditing';
import { getOperatorComposition } from '../../operators/operatorCompositionRegistry';
import { compositionNodeIds } from '../../operators/operatorComposition';
import { getEffectOperator } from '../../operators/operatorRegistry';
import { connectEffectGraph } from '../../operators/effectGraph';

export type Endpoint = { nodeId: string; portId: string };
type Addable = ReturnType<typeof addableEffectOperators>;
/** A port as the agent addresses it: plain node ports, or a compound's public ports. */
interface PublicPort { id: string; type?: string; repeated?: boolean; endpoints: Endpoint[] }

/**
 * Compound nodes are expanded while editing; their public ports live on inner
 * nodes. Resolves a compound ID (or the `@compound-<id>` handle `add` returns).
 */
export function compoundGroup(graph: EffectOperatorGraph, nodeId: string) {
  const instanceId = nodeId.startsWith('@compound-') ? nodeId.slice('@compound-'.length) : nodeId;
  return graph.nodes.some(node => node.id === nodeId) ? undefined
    : graph.groups?.find(candidate => candidate.id === `compound-${instanceId}` && candidate.composition);
}

function innerPort(graph: EffectOperatorGraph, endpoint: Endpoint | undefined, side: 'input' | 'output') {
  const operator = getEffectOperator(graph.nodes.find(node => node.id === endpoint?.nodeId)?.operator ?? '');
  return (side === 'input' ? operator?.inputs : operator?.outputs)?.find(port => port.id === endpoint?.portId);
}

/** Every addressable port of a node in declaration order; throws for an unknown node. */
export function publicPorts(graph: EffectOperatorGraph, nodeId: string, side: 'input' | 'output'): PublicPort[] {
  const group = compoundGroup(graph, nodeId);
  const definition = group?.composition && getOperatorComposition(group.composition.instance.operator);
  if (group?.composition && definition?.composition) {
    const ids = compositionNodeIds(group.composition.instance, definition);
    const map = (endpoints: Endpoint[]) => endpoints.map(endpoint => ({ nodeId: ids[endpoint.nodeId], portId: endpoint.portId }));
    return side === 'input'
      ? Object.entries(definition.composition.inputs).map(([id, endpoints]) => {
        const inner = map(endpoints), port = innerPort(graph, inner[0], side);
        return { id, type: port?.type, repeated: port?.repeated, endpoints: inner };
      })
      : Object.entries(definition.composition.outputs).map(([id, endpoint]) => {
        const inner = map([endpoint]);
        return { id, type: innerPort(graph, inner[0], side)?.type, endpoints: inner };
      });
  }
  const node = graph.nodes.find(candidate => candidate.id === nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found in this graph.`);
  const operator = getEffectOperator(node.operator);
  return ((side === 'input' ? operator?.inputs : operator?.outputs) ?? []).map(port => ({
    id: port.id, type: port.type, repeated: port.repeated, endpoints: [{ nodeId, portId: port.id }] }));
}

const describePorts = (ports: PublicPort[]) => ports.map(port => `${port.id}:${port.type ?? 'any'}`).join(', ') || 'none';

function occupied(graph: EffectOperatorGraph, port: PublicPort): boolean {
  return !port.repeated && graph.edges.some(edge => edge.to === port.endpoints[0]?.nodeId && edge.input === port.endpoints[0]?.portId);
}

export function converters(fromType: string, toType: string, addable: Addable) {
  return addable.filter(operator => operator.inputs.length === 1 && operator.inputs[0].type === fromType
    && operator.outputs.length === 1 && operator.outputs[0].type === toType && !operator.parameters.length);
}
function compatibility(from: PublicPort, to: PublicPort, addable: Addable): 'exact' | 'convert' | undefined {
  if (!from.type || !to.type || from.type === to.type) return 'exact';
  return converters(from.type, to.type, addable).length === 1 ? 'convert' : undefined;
}

/** `node` or `node.port`. Node IDs never contain dots, so the last dot separates the port. */
export function parseEndpointRef(ref: string): { nodeId: string; portId?: string } {
  const dot = ref.lastIndexOf('.');
  return dot > 0 ? { nodeId: ref.slice(0, dot), portId: ref.slice(dot + 1) } : { nodeId: ref };
}

/**
 * Fills omitted port IDs. A missing source port uses the only output, or the one
 * whose type fits the target (the first declared when several fit). A missing target port uses the first free input
 * (declaration order) that accepts the source, then the only compatible input.
 */
export function resolveConnection(graph: EffectOperatorGraph, fromNodeId: string, fromPortId: string | undefined,
  toNodeId: string, toPortId: string | undefined, addable: Addable) {
  const outputs = publicPorts(graph, fromNodeId, 'output'), inputs = publicPorts(graph, toNodeId, 'input');
  const pick = <T extends PublicPort>(ports: T[], id: string | undefined, side: string, node: string) => {
    if (id === undefined) return ports;
    const port = ports.find(candidate => candidate.id === id);
    if (!port) throw new Error(`${node} has no ${side} ${id}. Available: ${describePorts(ports)}.`);
    return [port];
  };
  const sources = pick(outputs, fromPortId, 'output', fromNodeId), targets = pick(inputs, toPortId, 'input', toNodeId);
  const sourceFor = (target: PublicPort) => {
    if (sources.length === 1) return compatibility(sources[0], target, addable) ? sources[0] : undefined;
    const exact = sources.filter(source => compatibility(source, target, addable) === 'exact');
    // Several same-typed outputs (e.g. value and weight): the first declared one is the node's primary result.
    if (exact.length >= 1) return exact[0];
    const converted = sources.filter(source => compatibility(source, target, addable));
    if (converted.length > 1) {
      throw new Error(`${fromNodeId} has several outputs for ${toNodeId}.${target.id}; name one: ${describePorts(outputs)}.`);
    }
    return converted[0];
  };
  const free = targets.filter(target => !occupied(graph, target));
  for (const target of targets.length === 1 ? targets : free) {
    const source = sourceFor(target);
    if (source) return { from: source, to: target };
  }
  // Occupied targets are only replaced when exactly one accepts the source.
  const replaceable = targets.length === 1 ? [] : targets.filter(target => !free.includes(target) && sourceFor(target));
  if (replaceable.length === 1) return { from: sourceFor(replaceable[0])!, to: replaceable[0] };
  if (targets.length === 1 && sources.length === 1) return { from: sources[0], to: targets[0] };
  throw new Error(`No compatible ${replaceable.length ? 'unambiguous ' : 'free '}input on ${toNodeId} for ${fromNodeId}`
    + `${fromPortId ? `.${fromPortId}` : ''}. ${fromNodeId} outputs: ${describePorts(outputs)}; ${toNodeId} inputs: ${describePorts(inputs)}.`);
}

function singleConverter(graph: EffectOperatorGraph, from: Endpoint, to: Endpoint, addable: Addable) {
  const fromType = innerPort(graph, from, 'output')?.type, toType = innerPort(graph, to, 'input')?.type;
  if (!fromType || !toType || fromType === toType) return undefined;
  const found = converters(fromType, toType, addable);
  return found.length === 1 ? found[0] : undefined;
}
function insertConversion(clipId: string, effectId: string, graph: EffectOperatorGraph, from: Endpoint, to: Endpoint,
  converter: NonNullable<ReturnType<typeof singleConverter>>, addable: Addable): string {
  const base = `${from.nodeId}-${converter.id.split('.').pop()}`.replace(/[^\w-]/g, '-');
  let id = base;
  for (let index = 2; graph.nodes.some(node => node.id === id) || graph.groups?.some(group => group.id === `compound-${id}`); index++) id = `${base}-${index}`;
  editEffectGraph(clipId, effectId, 'Connect with conversion', next => {
    next.nodes.push({ id, operator: converter.id, operatorVersion: converter.version, bindings: {}, constants: {} });
    const a = next.layout[from.nodeId], b = next.layout[to.nodeId];
    next.layout[id] = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 300, y: next.nodes.length * 120 };
    Object.assign(next, connectEffectGraph(next, { id: `${from.nodeId}-${from.portId}-${id}-${converter.inputs[0].id}`,
      from: from.nodeId, output: from.portId, to: id, input: converter.inputs[0].id }, addable));
    Object.assign(next, connectEffectGraph(next, { id: `${id}-${converter.outputs[0].id}-${to.nodeId}-${to.portId}`,
      from: id, output: converter.outputs[0].id, to: to.nodeId, input: to.portId }, addable));
  });
  return id;
}

/** Names the registered single-step conversion for a signal-type mismatch, e.g. alpha -> number. */
function conversionHint(graph: EffectOperatorGraph, from: Endpoint, to: Endpoint, addable: Addable): string {
  const fromType = innerPort(graph, from, 'output')?.type, toType = innerPort(graph, to, 'input')?.type;
  if (!fromType || !toType || fromType === toType) return '';
  const found = converters(fromType, toType, addable);
  return found.length ? ` ${fromType} -> ${toType}: insert ${found.map(operator => `${operator.id} (${operator.inputs[0].id} -> ${operator.outputs[0].id})`).join(' or ')} between them.`
    : ` ${fromType} -> ${toType} has no single conversion node; use getNodeDefinitions to pick a compatible source or target.`;
}

export interface ConnectedCable { from: string; to: string; insertedConversion?: { nodeId: string; operatorId: string } }

/** Connects resolved public ports; a lone registered conversion is inserted in the same undo step. */
export function connectPublicPorts(clipId: string, effectId: string, effectType: string, graph: EffectOperatorGraph,
  fromNodeId: string, fromPortId: string | undefined, toNodeId: string, toPortId: string | undefined): ConnectedCable & { toPortId: string } {
  const addable = addableEffectOperators(effectType);
  const resolved = resolveConnection(graph, fromNodeId, fromPortId, toNodeId, toPortId, addable);
  const from = resolved.from.endpoints[0], targets = resolved.to.endpoints;
  const cable = { from: `${fromNodeId}.${resolved.from.id}`, to: `${toNodeId}.${resolved.to.id}`, toPortId: resolved.to.id };
  const converter = targets.length === 1 ? singleConverter(graph, from, targets[0], addable) : undefined;
  if (converter) {
    return { ...cable, insertedConversion: { nodeId: insertConversion(clipId, effectId, graph, from, targets[0], converter, addable), operatorId: converter.id } };
  }
  try {
    if (targets.length > 1) editCompositionInput(clipId, effectId, targets, from);
    else createEffectGraphActions(clipId, effectId).connectPorts({ fromNodeId: from.nodeId, fromPortId: from.portId, toNodeId: targets[0].nodeId, toPortId: targets[0].portId });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}${conversionHint(graph, from, targets[0], addable)}`);
  }
  return cable;
}

/** Unconnected, non-repeated inputs the agent may still need to wire. */
export function openInputs(graph: EffectOperatorGraph, nodeId: string): string[] {
  return publicPorts(graph, nodeId, 'input').filter(port => !port.repeated && !occupied(graph, port)).map(port => port.id);
}

/** Canvas position of a plain node or a compound instance. */
export function nodePosition(graph: EffectOperatorGraph, nodeId: string): { x: number; y: number } | undefined {
  return graph.layout[nodeId] ?? compoundGroup(graph, nodeId)?.composition?.position;
}
