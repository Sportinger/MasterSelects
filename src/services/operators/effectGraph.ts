import { checkGraphConnection, graphHasCycle } from '../nodeGraph/graphConnections';
import { operatorConnectionEdge, operatorConnectionGraph } from './operatorConnectionGraph';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorBinding, OperatorEdge, OperatorValue } from '../../types/operatorGraph';
import type { Keyframe } from '../../types/keyframes';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { getEffectOperator } from './operatorRegistry';
import { directionFromAngles, periodicWindModulation, windForce } from './wind';

export const EFFECT_GRAPH_PARAM = 'operatorGraph';
export type OperatorParameters = Record<string, unknown>;

export function validateEffectGraph(graph: EffectOperatorGraph, allowIncomplete = false): string[] {
  if (graph?.version !== 1 || (graph.schemaVersion !== undefined && graph.schemaVersion !== 1)
    || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !graph.layout
    || graph.nodes.length > 64 || graph.edges.length > 256) return ['Invalid operator graph.'];
  if (graph.nodes.some(n => !n || typeof n !== 'object') || graph.edges.some(e => !e || typeof e !== 'object')) return ['Invalid graph entries.'];
  if (Object.values(graph.layout).some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return ['Invalid node position.'];
  const errors: string[] = [], nodes = new Map(graph.nodes.map(n => [n.id, n]));
  if (nodes.size !== graph.nodes.length) errors.push('Duplicate node ID.');
  const occupied = new Set<string>(), edgeIds = new Set<string>();
  const validBinding = (b: OperatorBinding) => typeof b === 'string' || (Array.isArray(b) ? b.length === 3 && b.every(v => typeof v === 'string') : b && typeof b.yaw === 'string' && typeof b.pitch === 'string');
  for (const n of graph.nodes) {
    if (typeof n.id !== 'string' || !/^[\w-]+$/.test(n.id) || !getEffectOperator(n.operator)
      || (n.operatorVersion !== undefined && n.operatorVersion !== getEffectOperator(n.operator)?.version)
      || !n.bindings || !Object.values(n.bindings).every(validBinding)) errors.push(`Invalid node: ${n.id}.`);
  }
  const connections = operatorConnectionGraph(graph);
  for (let index = 0; index < connections.edges.length; index++) {
    const edge = connections.edges[index];
    const check = checkGraphConnection({ ...connections, edges: connections.edges.slice(0, index) }, edge);
    const repairableVariantMismatch = allowIncomplete && !check.ok
      && (check.code === 'type-mismatch' || check.code === 'missing-port');
    const target = nodes.get(edge.toNodeId);
    const repeated = target && getEffectOperator(target.operator)?.inputs.find(port => port.id === edge.toPortId)?.repeated;
    const duplicateInput = !repeated && occupied.has(`${edge.toNodeId}:${edge.toPortId}`);
    if (typeof edge.id !== 'string' || edgeIds.has(edge.id)
      || duplicateInput || ((!check.ok && !repairableVariantMismatch) || (check.ok && check.replacesEdgeId))) errors.push(`Invalid connection: ${edge.id}.`);
    occupied.add(`${edge.toNodeId}:${edge.toPortId}`); edgeIds.add(edge.id);
  }
  for (const n of graph.nodes) for (const p of getEffectOperator(n.operator)?.inputs ?? []) {
    if (!allowIncomplete && p.required && !occupied.has(`${n.id}:${p.id}`)) errors.push(`${getEffectOperator(n.operator)!.label}: connect ${p.label}.`);
  }
  if (graphHasCycle(connections.nodes, connections.edges)) errors.push('Cycles are not supported.');
  const outputOperator = graph.domain === 'voxel' ? 'render.voxel'
    : graph.domain === 'scene' ? 'scene.render'
    : graph.domain === 'image' || graph.domain === 'analog-signal' ? 'image.output' : 'scene.output';
  if (!allowIncomplete && graph.nodes.filter(n => n.operator === outputOperator).length !== 1) errors.push('The graph needs one clip output.');
  if (graph.groups) {
    if (!Array.isArray(graph.groups) || graph.groups.length > 32) return [...errors, 'Invalid groups.'];
    const groups = new Map(graph.groups.map(g => [g?.id, g]));
    const members = new Set<string>();
    if (groups.size !== graph.groups.length) errors.push('Duplicate group ID.');
    for (const g of graph.groups) {
      if (!g || !/^[\w-]+$/.test(g.id) || typeof g.label !== 'string' || typeof g.color !== 'string' || !Array.isArray(g.nodeIds)) { errors.push('Invalid group.'); continue; }
      for (const id of g.nodeIds) { if (!nodes.has(id) || members.has(id)) errors.push('Invalid group member.'); members.add(id); }
      const parents = new Set([g.id]); let parent = g.parentId;
      while (parent) { if (parents.has(parent) || !groups.has(parent)) { errors.push('Invalid group hierarchy.'); break; } parents.add(parent); parent = groups.get(parent)?.parentId; }
    }
  }
  return errors;
}

/** Missing graph means an older project. A malformed saved graph must never silently revert. */
export function readEffectGraph(value: unknown, fallback: () => EffectOperatorGraph, migrate?: (graph: EffectOperatorGraph) => EffectOperatorGraph): EffectOperatorGraph {
  if (value === undefined || value === '') return fallback();
  if (typeof value !== 'string' || value.length > 500_000) throw new Error('Invalid saved operator graph.');
  let graph: EffectOperatorGraph;
  try { graph = JSON.parse(value); } catch { throw new Error('Invalid saved operator graph.'); }
  if (migrate) graph = migrate(graph);
  const errors = validateEffectGraph(graph, typeof graph.incomplete === 'string');
  if (errors.length) throw new Error(errors[0]);
  return graph;
}

export function operatorEnabled(node: BoundOperatorNode, params: OperatorParameters): boolean {
  return !node.bypassed && (node.enabled ? Boolean(params[node.enabled] ?? node.enabledDefault ?? true) : true);
}

export function sampleOperatorParameter(node: BoundOperatorNode, parameter: string, params: OperatorParameters, effectId: string, keys: Keyframe[], time: number): OperatorValue {
  const spec = getEffectOperator(node.operator)?.parameters.find(p => p.id === parameter);
  const sample = (key: string, fallback: OperatorValue): OperatorValue => {
    const value = params[key] ?? fallback;
    return typeof value === 'number'
      ? interpolateKeyframes(keys, `effect.${effectId}.${key}` as Keyframe['property'], time, value)
      : value as OperatorValue;
  };
  const binding = node.bindings[parameter], fallback = spec?.default ?? 0;
  if (!binding) return node.constants?.[parameter] ?? fallback;
  if (typeof binding === 'string') return sample(binding, fallback);
  if (Array.isArray(binding)) return binding.map((key, i) => Number(sample(key, Array.isArray(fallback) ? fallback[i] : 0))) as [number, number, number];
  return directionFromAngles(Number(sample(binding.yaw, 0)), Number(sample(binding.pitch, 0)));
}

export function graphInputNodes(graph: EffectOperatorGraph, id: string, input: string) {
  return graph.edges.filter(e => e.to === id && e.input === input).map(e => graph.nodes.find(n => n.id === e.from)!);
}

/** Stateless values/fields can be shared by multiple consumers; solvers own their temporal state. */
export function evaluateGraphForces(graph: EffectOperatorGraph, simulation: string, params: OperatorParameters, effectId: string, keys: Keyframe[], time: number) {
  const scalar = (node: BoundOperatorNode): number => {
    const value = (name: string) => Number(sampleOperatorParameter(node, name, params, effectId, keys, time));
    return node.operator === 'values.oscillator' ? value('offset') + value('amplitude') * Math.sin(time * Math.PI * 2 * value('frequency')) : value('value');
  };
  const force = [0, 0, 0], windNodes: string[] = [];
  for (const node of graphInputNodes(graph, simulation, 'forces')) {
    if (!operatorEnabled(node, params)) continue;
    const value = (name: string) => sampleOperatorParameter(node, name, params, effectId, keys, time);
    if (node.operator === 'forces.gravity') { force[1] -= Number(value('strength')); continue; }
    if (node.operator !== 'forces.wind') continue;
    windNodes.push(node.id);
    const input = graphInputNodes(graph, node.id, 'strength')[0];
    const vector = windForce(value('direction') as number[], input && operatorEnabled(input, params) ? scalar(input) : Number(value('strength')), Number(value('gust')), periodicWindModulation(time));
    vector.forEach((v, i) => { force[i] += v; });
  }
  const damping = graphInputNodes(graph, simulation, 'drag').reduce((sum, node) => sum + (operatorEnabled(node, params) ? Number(sampleOperatorParameter(node, 'amount', params, effectId, keys, time)) : 0), 0);
  return { force, damping, replacesCableWind: windNodes.length > 0 };
}

export function connectEffectGraph(graph: EffectOperatorGraph, edge: OperatorEdge): EffectOperatorGraph {
  const input = getEffectOperator(graph.nodes.find(n => n.id === edge.to)?.operator ?? '')?.inputs.find(p => p.id === edge.input);
  const edges = graph.edges.filter(e => e.id !== edge.id && (input?.repeated || e.to !== edge.to || e.input !== edge.input));
  // Existing incompatible edges may remain visible after a variant change, but
  // a new connection must itself satisfy the current typed port contract.
  const connection = checkGraphConnection(operatorConnectionGraph({ ...graph, edges }), operatorConnectionEdge(edge));
  if (!connection.ok) throw new Error(`Invalid connection: ${edge.id}.`);
  const next = { ...graph, edges: [...edges, edge] };
  const errors = validateEffectGraph(next, true);
  if (errors.length) throw new Error(errors[0]);
  return next;
}
