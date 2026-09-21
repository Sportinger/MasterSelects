import type { BoundOperatorNode, EffectOperatorGraph, OperatorGroup } from '../../types/operatorGraph';
import { createAnalogDisplayResolveIsland, ANALOG_DISPLAY_PARAMETER_IDS, type AnalogDisplayParameterId } from './analogDisplayResolveGraph';
import { effectGraphLimits } from './effectGraphLimits';
import { getEffectOperator } from './operatorRegistry';

const incoming = (graph: EffectOperatorGraph, nodeId: string, port: string) =>
  graph.edges.filter(edge => edge.to === nodeId && edge.input === port);

function parameterValues(node: BoundOperatorNode) {
  const definition = getEffectOperator('analog.display-resolve');
  if (!definition) throw new Error('Legacy Analog Display Resolve registry definition is unavailable.');
  return Object.fromEntries(ANALOG_DISPLAY_PARAMETER_IDS.map(id => {
    const spec = definition.parameters.find(parameter => parameter.id === id);
    if (!spec || spec.type !== 'number' || typeof spec.default !== 'number') throw new Error(`Legacy Analog Display parameter ${id} has no numeric default.`);
    return [id, node.bindings[id] === undefined && node.constants?.[id] === undefined ? { constant: spec.default } : {
      ...(node.bindings[id] === undefined ? {} : { binding: node.bindings[id] }),
      ...(node.constants?.[id] === undefined ? {} : { constant: node.constants[id] }),
    }];
  })) as Partial<Record<AnalogDisplayParameterId, {
    binding?: BoundOperatorNode['bindings'][string]; constant?: NonNullable<BoundOperatorNode['constants']>[string];
  }>>;
}

function replaceGroupNode(groups: OperatorGroup[] | undefined, nodeId: string, replacements: readonly string[]): OperatorGroup[] {
  return (groups ?? []).map(group => ({ ...group, nodeIds: group.nodeIds.flatMap(id => id === nodeId ? replacements : [id]) }));
}

/** Expands legacy Display Resolve stages into the canonical flat image island without resolving owner values. */
export function migrateAnalogSignalGraph(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.domain !== 'analog-signal' || !graph.nodes.some(node => node.operator === 'analog.display-resolve')) return graph;
  const result = structuredClone(graph), usedNodeIds = new Set(result.nodes.map(node => node.id));
  const usedEdgeIds = new Set(result.edges.map(edge => edge.id)), usedGroupIds = new Set((result.groups ?? []).map(group => group.id));
  const legacyIds = result.nodes.filter(node => node.operator === 'analog.display-resolve').map(node => node.id);
  for (const legacyId of legacyIds) {
    const legacy = result.nodes.find(node => node.id === legacyId);
    if (!legacy) throw new Error(`Analog Display Resolve ${legacyId} disappeared during migration.`);
    if (legacy.operatorVersion !== 1) throw new Error(`Legacy Analog Display Resolve ${legacyId} has an unsupported operator version.`);
    const sourceEdges = incoming(result, legacyId, 'source'), decodedEdges = incoming(result, legacyId, 'decoded');
    const unexpectedInputs = result.edges.filter(edge => edge.to === legacyId && edge.input !== 'source' && edge.input !== 'decoded');
    const outgoing = result.edges.filter(edge => edge.from === legacyId);
    if (sourceEdges.length !== 1 || unexpectedInputs.length || outgoing.some(edge => edge.output !== 'image')) {
      throw new Error(`Legacy Analog Display Resolve ${legacyId} has malformed connections.`);
    }
    const source = sourceEdges[0];
    const sourceNode = result.nodes.find(node => node.id === source.from), sourcePort = getEffectOperator(sourceNode?.operator ?? '')?.outputs.find(port => port.id === source.output);
    if (!sourceNode || sourceNode.operatorVersion !== 1 || sourcePort?.type !== 'image') {
      throw new Error(`Legacy Analog Display Resolve ${legacyId} has an invalid source image predecessor.`);
    }
    if (legacy.bypassed) {
      result.nodes = result.nodes.filter(node => node.id !== legacyId);
      result.edges = result.edges.filter(edge => edge.to !== legacyId && edge.from !== legacyId);
      result.edges.push(...outgoing.map(edge => ({ ...edge, from: source.from, output: source.output })));
      delete result.layout[legacyId]; result.groups = replaceGroupNode(result.groups, legacyId, []);
      usedNodeIds.delete(legacyId); continue;
    }
    if (decodedEdges.length !== 1) throw new Error(`Legacy Analog Display Resolve ${legacyId} needs exactly one decoded input.`);
    const decoded = decodedEdges[0], decodedNode = result.nodes.find(node => node.id === decoded.from);
    const decodedPort = getEffectOperator(decodedNode?.operator ?? '')?.outputs.find(port => port.id === decoded.output);
    if (!decodedNode || decodedNode.operatorVersion !== 1 || decodedNode.operator !== 'analog.pal-decode' || decodedPort?.id !== 'image' || decodedPort.type !== 'image') {
      throw new Error(`Legacy Analog Display Resolve ${legacyId} requires an analog.pal-decode image predecessor.`);
    }
    let suffix = 0, island: ReturnType<typeof createAnalogDisplayResolveIsland>;
    do {
      const prefix = suffix ? `${legacyId}-${suffix + 1}` : legacyId;
      island = createAnalogDisplayResolveIsland({ prefix, source: { node: source.from, port: source.output },
        decoded: { node: decoded.from, port: decoded.output }, signalAmount: { node: decoded.from, port: 'signalAmount' },
        anchor: result.layout[legacyId], parameterValues: parameterValues(legacy) });
      suffix++;
    } while (island.nodes.some(node => usedNodeIds.has(node.id)) || island.edges.some(edge => usedEdgeIds.has(edge.id))
      || island.groups.some(group => usedGroupIds.has(group.id)));
    const islandIds = island.nodes.map(node => node.id);
    result.nodes = [...result.nodes.filter(node => node.id !== legacyId), ...island.nodes];
    result.edges = [...result.edges.filter(edge => edge.to !== legacyId && edge.from !== legacyId), ...island.edges,
      ...outgoing.map(edge => ({ ...edge, from: island.output.node, output: island.output.port }))];
    delete result.layout[legacyId]; Object.assign(result.layout, island.layout);
    result.groups = [...replaceGroupNode(result.groups, legacyId, islandIds), ...island.groups];
    usedNodeIds.delete(legacyId); island.nodes.forEach(node => usedNodeIds.add(node.id));
    island.edges.forEach(edge => usedEdgeIds.add(edge.id)); island.groups.forEach(group => usedGroupIds.add(group.id));
  }
  const nodeIds = new Set(result.nodes.map(node => node.id)), edgeIds = new Set(result.edges.map(edge => edge.id));
  if (nodeIds.size !== result.nodes.length || edgeIds.size !== result.edges.length) throw new Error('Analog Signal migration produced duplicate ids.');
  const limits = effectGraphLimits('analog-signal');
  if (result.nodes.length > limits.nodes || result.edges.length > limits.edges) throw new Error('Migrated Analog Signal graph exceeds its node or edge budget.');
  return result;
}
