import type {
  FlockDefinition,
  FlockEdge,
  FlockExposedParam,
  FlockGroupDefinition,
  FlockGroupPortBinding,
  FlockNode,
  FlockNodeLayout,
  FlockParamValue,
  FlockPortRef,
} from '../../../types/flock';
import { checkFlockConnection, validateFlockParamValue } from '../graph/flockGraphValidation';
import { groupOverrideKey, wouldCreateGroupRecursion } from '../graph/flockGroupExpansion';
import {
  FLOCK_GROUP_OPERATOR_ID,
  createFlockNode,
  generateFlockNodeId,
  getFlockOperator,
  resolveFlockNodePorts,
} from '../operators/flockOperatorRegistry';

export type FlockMutationFailure = { ok: false; code: string; message: string };
export type FlockMutationResult<T extends object = object> =
  | ({ ok: true; definition: FlockDefinition } & T)
  | FlockMutationFailure;

const fail = (code: string, message: string): FlockMutationFailure => ({ ok: false, code, message });

function cloneDefinition(definition: FlockDefinition): FlockDefinition {
  return structuredClone(definition);
}

export function generateFlockEdgeId(): string {
  return generateFlockNodeId('fe');
}

function findNode(definition: FlockDefinition, nodeId: string): FlockNode | undefined {
  return definition.nodes.find((node) => node.id === nodeId);
}

export function addFlockNode(
  definition: FlockDefinition,
  operatorId: string,
  options: { layout?: FlockNodeLayout; params?: Record<string, FlockParamValue>; label?: string; groupRef?: string; id?: string } = {},
): FlockMutationResult<{ nodeId: string }> {
  if (operatorId === FLOCK_GROUP_OPERATOR_ID) {
    if (!options.groupRef || !definition.groups.some((group) => group.id === options.groupRef)) {
      return fail('group-missing', 'Group nodes need an existing group definition.');
    }
  } else if (!getFlockOperator(operatorId)) {
    return fail('unknown-operator', `Unknown flock operator ${operatorId}.`);
  }
  if (options.id && findNode(definition, options.id)) {
    return fail('duplicate-node-id', `Node ${options.id} already exists.`);
  }
  const next = cloneDefinition(definition);
  const node = operatorId === FLOCK_GROUP_OPERATOR_ID
    ? { id: options.id ?? generateFlockNodeId(), operator: FLOCK_GROUP_OPERATOR_ID, operatorVersion: 1, params: options.params ?? {}, groupRef: options.groupRef, ...(options.label ? { label: options.label } : {}) }
    : createFlockNode(operatorId, { id: options.id, label: options.label, params: options.params });
  if (options.params && operatorId !== FLOCK_GROUP_OPERATOR_ID) {
    const operator = getFlockOperator(operatorId)!;
    for (const [paramId, value] of Object.entries(options.params)) {
      const descriptor = operator.params.find((param) => param.id === paramId);
      if (!descriptor) return fail('unknown-param', `${operator.label} has no parameter ${paramId}.`);
      const problem = validateFlockParamValue(descriptor, value);
      if (problem) return fail('invalid-param', `${descriptor.label} ${problem}.`);
    }
  }
  next.nodes.push(node);
  next.layout[node.id] = options.layout ?? { x: 0, y: 0 };
  return { ok: true, definition: next, nodeId: node.id };
}

export function removeFlockNodes(
  definition: FlockDefinition,
  nodeIds: string[],
): FlockMutationResult<{ removedNodeIds: string[]; removedEdgeIds: string[]; removedExposedIds: string[] }> {
  const targets = new Set(nodeIds.filter((id) => !!findNode(definition, id)));
  if (targets.size === 0) return fail('missing-node', 'No matching nodes to remove.');
  const next = cloneDefinition(definition);
  const removedEdgeIds = next.edges
    .filter((edge) => targets.has(edge.from.nodeId) || targets.has(edge.to.nodeId))
    .map((edge) => edge.id);
  const removedExposedIds = next.exposed.filter((exposed) => targets.has(exposed.nodeId)).map((exposed) => exposed.id);
  next.nodes = next.nodes.filter((node) => !targets.has(node.id));
  next.edges = next.edges.filter((edge) => !removedEdgeIds.includes(edge.id));
  next.exposed = next.exposed.filter((exposed) => !targets.has(exposed.nodeId));
  for (const id of targets) delete next.layout[id];
  return { ok: true, definition: next, removedNodeIds: [...targets], removedEdgeIds, removedExposedIds };
}

export function connectFlockPorts(
  definition: FlockDefinition,
  from: FlockPortRef,
  to: FlockPortRef,
): FlockMutationResult<{ edgeId: string; replacedEdgeId?: string }> {
  const check = checkFlockConnection(definition, from, to);
  if (!check.ok) return fail(check.code, check.message);
  const next = cloneDefinition(definition);
  if (check.replacesEdgeId) {
    next.edges = next.edges.filter((edge) => edge.id !== check.replacesEdgeId);
  }
  const edge: FlockEdge = { id: generateFlockEdgeId(), from: { ...from }, to: { ...to } };
  next.edges.push(edge);
  return {
    ok: true,
    definition: next,
    edgeId: edge.id,
    ...(check.replacesEdgeId ? { replacedEdgeId: check.replacesEdgeId } : {}),
  };
}

export function disconnectFlockEdge(definition: FlockDefinition, edgeId: string): FlockMutationResult {
  if (!definition.edges.some((edge) => edge.id === edgeId)) return fail('missing-edge', `Edge ${edgeId} does not exist.`);
  const next = cloneDefinition(definition);
  next.edges = next.edges.filter((edge) => edge.id !== edgeId);
  return { ok: true, definition: next };
}

/** Group instances store overrides as `${innerNodeId}__${paramId}`. */
export function setFlockNodeParam(
  definition: FlockDefinition,
  nodeId: string,
  paramId: string,
  value: FlockParamValue,
): FlockMutationResult {
  const node = findNode(definition, nodeId);
  if (!node) return fail('missing-node', `Node ${nodeId} does not exist.`);
  if (node.operator === FLOCK_GROUP_OPERATOR_ID) {
    const group = definition.groups.find((candidate) => candidate.id === node.groupRef);
    const separator = paramId.indexOf('__');
    const inner = separator > 0 ? group?.nodes.find((candidate) => candidate.id === paramId.slice(0, separator)) : undefined;
    const innerParam = inner ? getFlockOperator(inner.operator)?.params.find((param) => param.id === paramId.slice(separator + 2)) : undefined;
    if (!innerParam) return fail('unknown-param', `Group has no parameter ${paramId}.`);
    const problem = validateFlockParamValue(innerParam, value);
    if (problem) return fail('invalid-param', `${innerParam.label} ${problem}.`);
  } else {
    const descriptor = getFlockOperator(node.operator)?.params.find((param) => param.id === paramId);
    if (!descriptor) return fail('unknown-param', `${node.operator} has no parameter ${paramId}.`);
    const problem = validateFlockParamValue(descriptor, value);
    if (problem) return fail('invalid-param', `${descriptor.label} ${problem}.`);
  }
  const next = cloneDefinition(definition);
  const target = findNode(next, nodeId)!;
  target.params[paramId] = Array.isArray(value) ? [value[0], value[1], value[2]] : value;
  return { ok: true, definition: next };
}

export function setFlockNodeBypass(definition: FlockDefinition, nodeId: string, bypassed: boolean): FlockMutationResult {
  const node = findNode(definition, nodeId);
  if (!node) return fail('missing-node', `Node ${nodeId} does not exist.`);
  const operator = getFlockOperator(node.operator);
  if (operator?.bypass.kind === 'none') return fail('not-bypassable', `${operator.label} cannot be bypassed.`);
  const next = cloneDefinition(definition);
  const target = findNode(next, nodeId)!;
  if (bypassed) target.bypassed = true; else delete target.bypassed;
  return { ok: true, definition: next };
}

export function moveFlockNode(definition: FlockDefinition, nodeId: string, layout: FlockNodeLayout): FlockMutationResult {
  if (!findNode(definition, nodeId)) return fail('missing-node', `Node ${nodeId} does not exist.`);
  return { ok: true, definition: { ...definition, layout: { ...definition.layout, [nodeId]: { x: layout.x, y: layout.y } } } };
}

export function renameFlockNode(definition: FlockDefinition, nodeId: string, label: string): FlockMutationResult {
  if (!findNode(definition, nodeId)) return fail('missing-node', `Node ${nodeId} does not exist.`);
  const next = cloneDefinition(definition);
  const target = findNode(next, nodeId)!;
  if (label.trim()) target.label = label.trim(); else delete target.label;
  return { ok: true, definition: next };
}

export function duplicateFlockNodes(
  definition: FlockDefinition,
  nodeIds: string[],
  offset: FlockNodeLayout = { x: 40, y: 40 },
): FlockMutationResult<{ idMap: Record<string, string> }> {
  const sources = nodeIds.map((id) => findNode(definition, id)).filter((node): node is FlockNode => !!node);
  if (sources.length === 0) return fail('missing-node', 'No matching nodes to duplicate.');
  const next = cloneDefinition(definition);
  const idMap: Record<string, string> = {};
  for (const source of sources) {
    const id = generateFlockNodeId();
    idMap[source.id] = id;
    next.nodes.push({ ...structuredClone(source), id });
    const layout = definition.layout[source.id] ?? { x: 0, y: 0 };
    next.layout[id] = { x: layout.x + offset.x, y: layout.y + offset.y };
  }
  for (const edge of definition.edges) {
    if (idMap[edge.from.nodeId] && idMap[edge.to.nodeId]) {
      next.edges.push({
        id: generateFlockEdgeId(),
        from: { nodeId: idMap[edge.from.nodeId], port: edge.from.port },
        to: { nodeId: idMap[edge.to.nodeId], port: edge.to.port },
      });
    }
  }
  return { ok: true, definition: next, idMap };
}

export function exposeFlockParam(
  definition: FlockDefinition,
  nodeId: string,
  paramId: string,
  options: { label?: string; group?: string; min?: number; max?: number } = {},
): FlockMutationResult<{ exposedId: string }> {
  const node = findNode(definition, nodeId);
  if (!node) return fail('missing-node', `Node ${nodeId} does not exist.`);
  const descriptor = node.operator === FLOCK_GROUP_OPERATOR_ID
    ? undefined
    : getFlockOperator(node.operator)?.params.find((param) => param.id === paramId);
  if (node.operator !== FLOCK_GROUP_OPERATOR_ID && !descriptor) {
    return fail('unknown-param', `${node.operator} has no parameter ${paramId}.`);
  }
  const existing = definition.exposed.find((exposed) => exposed.nodeId === nodeId && exposed.param === paramId);
  if (existing) return { ok: true, definition, exposedId: existing.id };
  const next = cloneDefinition(definition);
  const exposed: FlockExposedParam = {
    id: generateFlockNodeId('fx'),
    nodeId,
    param: paramId,
    label: options.label ?? descriptor?.label ?? paramId,
    group: options.group ?? getFlockOperator(node.operator)?.label ?? 'Controls',
    order: next.exposed.length,
    ...(options.min !== undefined ? { min: options.min } : descriptor?.min !== undefined ? { min: descriptor.min } : {}),
    ...(options.max !== undefined ? { max: options.max } : descriptor?.max !== undefined ? { max: descriptor.max } : {}),
  };
  next.exposed.push(exposed);
  return { ok: true, definition: next, exposedId: exposed.id };
}

export function unexposeFlockParam(definition: FlockDefinition, exposedId: string): FlockMutationResult {
  if (!definition.exposed.some((exposed) => exposed.id === exposedId)) return fail('missing-exposed', 'Control does not exist.');
  const next = cloneDefinition(definition);
  next.exposed = next.exposed.filter((exposed) => exposed.id !== exposedId).map((exposed, order) => ({ ...exposed, order }));
  return { ok: true, definition: next };
}

export function updateFlockExposedParam(
  definition: FlockDefinition,
  exposedId: string,
  patch: Partial<Pick<FlockExposedParam, 'label' | 'group' | 'order' | 'min' | 'max'>>,
): FlockMutationResult {
  if (!definition.exposed.some((exposed) => exposed.id === exposedId)) return fail('missing-exposed', 'Control does not exist.');
  const next = cloneDefinition(definition);
  next.exposed = next.exposed
    .map((exposed) => (exposed.id === exposedId ? { ...exposed, ...patch } : exposed))
    .toSorted((a, b) => a.order - b.order);
  return { ok: true, definition: next };
}

/** Collapses nodes into a reusable group; boundary edges become group ports. */
export function createFlockGroupFromNodes(
  definition: FlockDefinition,
  nodeIds: string[],
  label = 'Group',
): FlockMutationResult<{ groupId: string; groupNodeId: string }> {
  const members = new Set(nodeIds.filter((id) => findNode(definition, id)));
  if (members.size === 0) return fail('missing-node', 'Select nodes to group.');
  const memberNodes = definition.nodes.filter((node) => members.has(node.id));
  if (memberNodes.some((node) => node.operator === 'flock.output' || node.operator === 'flock.simulation')) {
    return fail('group-structure', 'Scene Output and Simulation stay at the top level.');
  }
  const next = cloneDefinition(definition);
  const groupId = generateFlockNodeId('fg');
  const groupNodeId = generateFlockNodeId();
  const inputs: FlockGroupPortBinding[] = [];
  const outputs: FlockGroupPortBinding[] = [];
  const outerEdges: FlockEdge[] = [];
  const innerEdges: FlockEdge[] = [];
  const portType = (ref: FlockPortRef, direction: 'inputs' | 'outputs') => {
    const node = findNode(definition, ref.nodeId);
    const ports = node ? resolveFlockNodePorts(node, definition) : null;
    return ports?.[direction].find((candidate) => candidate.id === ref.port)?.type;
  };
  for (const edge of definition.edges) {
    const fromInside = members.has(edge.from.nodeId);
    const toInside = members.has(edge.to.nodeId);
    if (fromInside && toInside) {
      innerEdges.push(structuredClone(edge));
    } else if (toInside) {
      const key = `${edge.to.nodeId}_${edge.to.port}`;
      let binding = inputs.find((candidate) => candidate.id === key);
      if (!binding) {
        const type = portType(edge.to, 'inputs');
        if (!type) return fail('missing-port', 'A boundary port could not be resolved.');
        binding = { id: key, label: edge.to.port, type, target: { ...edge.to } };
        inputs.push(binding);
      }
      outerEdges.push({ id: edge.id, from: edge.from, to: { nodeId: groupNodeId, port: binding.id } });
    } else if (fromInside) {
      const key = `${edge.from.nodeId}_${edge.from.port}`;
      let binding = outputs.find((candidate) => candidate.id === key);
      if (!binding) {
        const type = portType(edge.from, 'outputs');
        if (!type) return fail('missing-port', 'A boundary port could not be resolved.');
        binding = { id: key, label: edge.from.port, type, target: { ...edge.from } };
        outputs.push(binding);
      }
      outerEdges.push({ id: edge.id, from: { nodeId: groupNodeId, port: binding.id }, to: edge.to });
    } else {
      outerEdges.push(structuredClone(edge));
    }
  }
  const layouts = memberNodes.map((node) => definition.layout[node.id] ?? { x: 0, y: 0 });
  const centerX = layouts.reduce((sum, layout) => sum + layout.x, 0) / layouts.length;
  const centerY = layouts.reduce((sum, layout) => sum + layout.y, 0) / layouts.length;
  const group: FlockGroupDefinition = {
    id: groupId,
    label,
    version: 1,
    nodes: structuredClone(memberNodes),
    edges: innerEdges,
    inputs,
    outputs,
    layout: Object.fromEntries(memberNodes.map((node) => [node.id, { ...(definition.layout[node.id] ?? { x: 0, y: 0 }) }])),
  };
  next.groups.push(group);
  next.nodes = next.nodes.filter((node) => !members.has(node.id));
  next.nodes.push({ id: groupNodeId, operator: FLOCK_GROUP_OPERATOR_ID, operatorVersion: 1, label, params: {}, groupRef: groupId });
  next.edges = outerEdges;
  for (const id of members) delete next.layout[id];
  next.layout[groupNodeId] = { x: centerX, y: centerY };
  // Promoted controls on grouped nodes move onto the group instance.
  next.exposed = next.exposed.map((exposed) => (
    members.has(exposed.nodeId)
      ? { ...exposed, nodeId: groupNodeId, param: groupOverrideKey(exposed.nodeId, exposed.param) }
      : exposed
  ));
  for (const exposed of next.exposed) {
    if (exposed.nodeId !== groupNodeId) continue;
    const separator = exposed.param.indexOf('__');
    const inner = group.nodes.find((node) => node.id === exposed.param.slice(0, separator));
    const paramId = exposed.param.slice(separator + 2);
    if (inner && inner.params[paramId] !== undefined) {
      next.nodes[next.nodes.length - 1].params[exposed.param] = inner.params[paramId];
    }
  }
  return { ok: true, definition: next, groupId, groupNodeId };
}

/** Adds a group definition (e.g. from a preset) under a fresh id, rejecting recursion. */
export function importFlockGroupDefinition(
  definition: FlockDefinition,
  group: FlockGroupDefinition,
): FlockMutationResult<{ groupId: string }> {
  const groupId = generateFlockNodeId('fg');
  const imported: FlockGroupDefinition = { ...structuredClone(group), id: groupId };
  const next = cloneDefinition(definition);
  next.groups.push(imported);
  if (imported.nodes.some((node) => node.operator === FLOCK_GROUP_OPERATOR_ID && node.groupRef
    && (node.groupRef === groupId || wouldCreateGroupRecursion(next, groupId, node.groupRef)))) {
    return fail('group-recursion', 'The group preset would contain itself.');
  }
  return { ok: true, definition: next, groupId };
}

/**
 * Inlines a group instance: inner nodes get fresh ids, boundary edges are
 * rewired, instance overrides and promoted controls move back onto the inner
 * nodes. `nodeIdMap` maps inner group node ids to the new top-level ids so
 * keyframes `flock.node.<group>.<inner>__<param>` can be rewritten.
 */
export function ungroupFlockNode(
  definition: FlockDefinition,
  groupNodeId: string,
): FlockMutationResult<{ nodeIdMap: Record<string, string> }> {
  const node = findNode(definition, groupNodeId);
  if (!node || node.operator !== FLOCK_GROUP_OPERATOR_ID) return fail('not-group', 'Select a group node to ungroup.');
  const group = definition.groups.find((candidate) => candidate.id === node.groupRef);
  if (!group) return fail('group-missing', `Group definition "${node.groupRef ?? '?'}" is missing.`);
  const next = cloneDefinition(definition);
  const nodeIdMap: Record<string, string> = {};
  for (const inner of group.nodes) nodeIdMap[inner.id] = generateFlockNodeId();
  const splitOverrideKey = (key: string) => {
    const separator = key.indexOf('__');
    return separator > 0 && nodeIdMap[key.slice(0, separator)]
      ? { innerId: key.slice(0, separator), rest: key.slice(separator + 2) }
      : null;
  };
  const overrides = new Map<string, Record<string, FlockParamValue>>();
  for (const [key, value] of Object.entries(node.params)) {
    const parsed = splitOverrideKey(key);
    if (!parsed) continue;
    const entry = overrides.get(parsed.innerId) ?? {};
    entry[parsed.rest] = Array.isArray(value) ? [value[0], value[1], value[2]] : value;
    overrides.set(parsed.innerId, entry);
  }
  const innerLayouts = group.nodes.map((inner) => group.layout[inner.id] ?? { x: 0, y: 0 });
  const centerX = innerLayouts.reduce((sum, layout) => sum + layout.x, 0) / Math.max(1, innerLayouts.length);
  const centerY = innerLayouts.reduce((sum, layout) => sum + layout.y, 0) / Math.max(1, innerLayouts.length);
  const anchor = definition.layout[groupNodeId] ?? { x: centerX, y: centerY };

  next.nodes = next.nodes.filter((candidate) => candidate.id !== groupNodeId);
  delete next.layout[groupNodeId];
  group.nodes.forEach((inner, index) => {
    const id = nodeIdMap[inner.id];
    next.nodes.push({ ...structuredClone(inner), id, params: { ...structuredClone(inner.params), ...(overrides.get(inner.id) ?? {}) } });
    next.layout[id] = { x: anchor.x + innerLayouts[index].x - centerX, y: anchor.y + innerLayouts[index].y - centerY };
  });

  const edges: FlockEdge[] = [];
  for (const edge of next.edges) {
    if (edge.to.nodeId === groupNodeId) {
      const binding = group.inputs.find((candidate) => candidate.id === edge.to.port);
      if (binding && nodeIdMap[binding.target.nodeId]) {
        edges.push({ id: edge.id, from: edge.from, to: { nodeId: nodeIdMap[binding.target.nodeId], port: binding.target.port } });
      }
    } else if (edge.from.nodeId === groupNodeId) {
      const binding = group.outputs.find((candidate) => candidate.id === edge.from.port);
      if (binding && nodeIdMap[binding.target.nodeId]) {
        edges.push({ id: edge.id, from: { nodeId: nodeIdMap[binding.target.nodeId], port: binding.target.port }, to: edge.to });
      }
    } else {
      edges.push(edge);
    }
  }
  for (const edge of group.edges) {
    edges.push({
      id: generateFlockEdgeId(),
      from: { nodeId: nodeIdMap[edge.from.nodeId] ?? edge.from.nodeId, port: edge.from.port },
      to: { nodeId: nodeIdMap[edge.to.nodeId] ?? edge.to.nodeId, port: edge.to.port },
    });
  }
  next.edges = edges;
  next.exposed = next.exposed.flatMap((exposed) => {
    if (exposed.nodeId !== groupNodeId) return [exposed];
    const parsed = splitOverrideKey(exposed.param);
    return parsed ? [{ ...exposed, nodeId: nodeIdMap[parsed.innerId], param: parsed.rest }] : [];
  });
  const stillReferenced = next.nodes.some((candidate) => candidate.groupRef === group.id)
    || next.groups.some((candidate) => candidate.nodes.some((inner) => inner.groupRef === group.id));
  if (!stillReferenced) next.groups = next.groups.filter((candidate) => candidate.id !== group.id);
  return { ok: true, definition: next, nodeIdMap };
}

/** Fresh node/edge ids for an independent copy; returns the id map for keyframe remapping. */
export function remapFlockDefinitionIds(definition: FlockDefinition): { definition: FlockDefinition; nodeIdMap: Record<string, string> } {
  const next = cloneDefinition(definition);
  const nodeIdMap: Record<string, string> = {};
  for (const node of next.nodes) nodeIdMap[node.id] = generateFlockNodeId();
  const remap = (id: string) => nodeIdMap[id] ?? id;
  next.nodes = next.nodes.map((node) => ({ ...node, id: remap(node.id) }));
  next.edges = next.edges.map((edge) => ({
    id: generateFlockEdgeId(),
    from: { nodeId: remap(edge.from.nodeId), port: edge.from.port },
    to: { nodeId: remap(edge.to.nodeId), port: edge.to.port },
  }));
  next.exposed = next.exposed.map((exposed) => ({ ...exposed, nodeId: remap(exposed.nodeId) }));
  next.layout = Object.fromEntries(Object.entries(next.layout).map(([id, layout]) => [remap(id), layout]));
  return { definition: next, nodeIdMap };
}
