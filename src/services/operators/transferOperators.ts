import type { BoundOperatorNode, EffectOperatorGraph, OperatorBinding } from '../../types/operatorGraph';
import { getEffectOperator } from './operatorRegistry';
import { validateEffectGraph } from './effectGraph';

export interface OperatorTransferOwner {
  graph: EffectOperatorGraph;
  params: Record<string, unknown>;
  accepts: (operator: string) => boolean;
  removable: (node: BoundOperatorNode) => boolean;
}

/** Preserve internal links. Reconnect boundary wires only to free, unambiguous
 * target ports; missing connections remain editable instead of rejecting a move. */
export function transferOperators(source: OperatorTransferOwner, target: OperatorTransferOwner,
  ids: string[], targetGroupId?: string) {
  const from = structuredClone(source.graph), to = structuredClone(target.graph), params = { ...target.params };
  const selected = new Set(ids), idMap: Record<string, string> = {}, parameterMap: Record<string, string> = {};
  const members = from.nodes.filter(node => selected.has(node.id));
  if (!members.length || members.length !== selected.size) throw new Error('The dragged nodes are no longer available.');
  if (targetGroupId && !to.groups?.some(group => group.id === targetGroupId)) throw new Error('The target group is unavailable.');
  for (const node of members) {
    if (!target.accepts(node.operator)) throw new Error(`${getEffectOperator(node.operator)?.label ?? node.operator} cannot run in this target effect.`);
    let id = node.id;
    while (to.nodes.some(candidate => candidate.id === id) || Object.values(idMap).includes(id)) id = `moved-${crypto.randomUUID().slice(0, 8)}`;
    idMap[node.id] = id;
    const copyKey = (key: string): string => {
      if (parameterMap[key]) return parameterMap[key];
      let next = `${id}_${key}`;
      while (next in params) next += '_moved';
      params[next] = source.params[key]; parameterMap[key] = next; return next;
    };
    const copyBinding = (binding: OperatorBinding): OperatorBinding => typeof binding === 'string' ? copyKey(binding)
      : Array.isArray(binding) ? binding.map(copyKey) as [string, string, string]
        : { yaw: copyKey(binding.yaw), pitch: copyKey(binding.pitch) };
    to.nodes.push({ ...node, id, bindings: Object.fromEntries(Object.entries(node.bindings).map(([key, binding]) => [key, copyBinding(binding)])),
      ...(node.enabled ? { enabled: copyKey(node.enabled) } : {}) });
    to.layout[id] = { ...from.layout[node.id] };
    to.groups?.find(group => group.id === targetGroupId)?.nodeIds.push(id);
  }
  const endpoint = (id: string) => {
    if (selected.has(id)) return idMap[id];
    const operator = from.nodes.find(node => node.id === id)?.operator;
    const equivalents = target.graph.nodes.filter(node => node.operator === operator);
    const exact = equivalents.find(node => node.id === id);
    if (exact) return exact.id;
    if (equivalents.length === 1) return equivalents[0].id;
    return undefined;
  };
  const movingEdges = from.edges.filter(edge => selected.has(edge.from) || selected.has(edge.to))
    .toSorted((a, b) => Number(selected.has(a.from) && !selected.has(a.to)) - Number(selected.has(b.from) && !selected.has(b.to)));
  for (const edge of movingEdges) {
    const fromId = endpoint(edge.from), toId = endpoint(edge.to);
    if (!fromId || !toId) continue;
    const input = getEffectOperator(to.nodes.find(node => node.id === toId)!.operator)?.inputs.find(port => port.id === edge.input);
    const occupied = !input?.repeated && to.edges.find(candidate => candidate.to === toId && candidate.input === edge.input);
    if (occupied) continue;
    to.edges.push({ ...edge, id: `move-${crypto.randomUUID().slice(0, 8)}`, from: fromId, to: toId });
  }
  for (const node of members) for (const output of getEffectOperator(node.operator)?.outputs ?? []) {
    const fromId = idMap[node.id];
    if (to.edges.some(edge => edge.from === fromId && edge.output === output.id)) continue;
    const candidates = target.graph.nodes.flatMap(candidate => (getEffectOperator(candidate.operator)?.inputs ?? [])
      .filter(input => input.type === output.type && (input.repeated || !to.edges.some(edge => edge.to === candidate.id && edge.input === input.id)))
      .map(input => ({ id: `move-${crypto.randomUUID().slice(0, 8)}`, from: fromId, output: output.id, to: candidate.id, input: input.id })))
      .filter(edge => validateEffectGraph({ ...to, edges: [...to.edges, edge] }, true).length === 0);
    if (candidates.length === 1) to.edges.push(candidates[0]);
  }
  from.nodes = from.nodes.filter(node => !selected.has(node.id));
  from.edges = from.edges.filter(edge => !selected.has(edge.from) && !selected.has(edge.to));
  from.groups?.forEach(group => { group.nodeIds = group.nodeIds.filter(id => !selected.has(id)); });
  ids.forEach(id => delete from.layout[id]);
  const errors = [...validateEffectGraph(from, true), ...validateEffectGraph(to, true)];
  if (errors.length) throw new Error(errors[0]);
  return { from, to, params, idMap, parameterMap };
}
