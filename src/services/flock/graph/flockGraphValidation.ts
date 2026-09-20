import { checkGraphConnection, graphHasCycle, wouldCreateGraphCycle } from '../../nodeGraph/graphConnections';
import { flockConnectionGraph, flockConnectionEdge } from './flockConnectionGraph';
import {
  FLOCK_DEFINITION_VERSION,
  type FlockDefinition,
  type FlockDiagnostic,
  type FlockEdge,
  type FlockNode,
  type FlockParamValue,
  type FlockPortRef,
} from '../../../types/flock';
import type { FlockParamDescriptor } from '../operators/flockOperatorTypes';
import {
  FLOCK_GROUP_OPERATOR_ID,
  FLOCK_OUTPUT_OPERATOR_ID,
  FLOCK_SIMULATION_OPERATOR_ID,
  getFlockOperator,
} from '../operators/flockOperatorRegistry';
import { FLOCK_MAX_CAPACITY } from '../operators/populationSimulationOperators';
import { expandFlockGroups } from './flockGroupExpansion';

export interface FlockValidationResult {
  valid: boolean;
  diagnostics: FlockDiagnostic[];
}

export type FlockConnectionCheck =
  | { ok: true; replacesEdgeId?: string }
  | { ok: false; code: string; message: string };

const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidFlockNodeId(id: string): boolean {
  return NODE_ID_PATTERN.test(id);
}

export function validateFlockParamValue(
  descriptor: FlockParamDescriptor,
  value: FlockParamValue | undefined,
): string | null {
  if (value === undefined) return null;
  switch (descriptor.type) {
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number';
      if (descriptor.type === 'integer' && !Number.isInteger(value)) return 'must be an integer';
      if (descriptor.min !== undefined && value < descriptor.min) return `must be >= ${descriptor.min}`;
      if (descriptor.max !== undefined && value > descriptor.max) return `must be <= ${descriptor.max}`;
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'enum':
      return typeof value === 'string' && descriptor.options?.some((option) => option.value === value)
        ? null
        : `must be one of ${descriptor.options?.map((option) => option.value).join(', ')}`;
    case 'vec3':
      return Array.isArray(value) && value.length === 3 && value.every((component) => Number.isFinite(component))
        ? null
        : 'must be a 3-component vector';
    case 'color':
      return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? null : 'must be a #rrggbb color';
    case 'asset':
      return typeof value === 'string' ? null : 'must be an asset id';
    default:
      return null;
  }
}

/** Edge-level checks shared by validation and interactive connection. */
export function checkFlockConnection(
  definition: FlockDefinition,
  from: FlockPortRef,
  to: FlockPortRef,
  nodes: FlockNode[] = definition.nodes,
  edges: FlockEdge[] = definition.edges,
  ignoreEdgeId?: string,
): FlockConnectionCheck {
  const check = checkGraphConnection(flockConnectionGraph(definition, nodes, edges), {
    fromNodeId: from.nodeId, fromPortId: from.port, toNodeId: to.nodeId, toPortId: to.port,
  }, ignoreEdgeId);
  return !check.ok && check.code === 'cycle'
    ? { ...check, message: `${check.message} Temporal feedback belongs to the Simulation node.` } : check;
}

export function isParticipatingFlockNode(node: FlockNode, edges: readonly FlockEdge[]): boolean {
  return node.operator === FLOCK_OUTPUT_OPERATOR_ID || edges.some((edge) => edge.from.nodeId === node.id);
}

export function wouldCreateCycle(edges: FlockEdge[], fromNodeId: string, toNodeId: string): boolean {
  return wouldCreateGraphCycle(edges.map(flockConnectionEdge), fromNodeId, toNodeId);
}

function validateLevel(
  definition: FlockDefinition,
  nodes: FlockNode[],
  edges: FlockEdge[],
  diagnostics: FlockDiagnostic[],
  scope: string,
): void {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!isValidFlockNodeId(node.id)) {
      diagnostics.push({ code: 'invalid-node-id', severity: 'error', message: `${scope}Node id "${node.id}" is invalid.`, nodeIds: [node.id] });
    }
    if (ids.has(node.id)) {
      diagnostics.push({ code: 'duplicate-node-id', severity: 'error', message: `${scope}Duplicate node id "${node.id}".`, nodeIds: [node.id] });
    }
    ids.add(node.id);
    if (node.operator === FLOCK_GROUP_OPERATOR_ID) continue;
    const operator = getFlockOperator(node.operator);
    if (!operator) {
      diagnostics.push({
        code: 'unknown-operator',
        severity: 'error',
        message: `${scope}Operator "${node.operator}" is not supported by this version. The node is kept unchanged.`,
        nodeIds: [node.id],
      });
      continue;
    }
    if (node.operatorVersion > operator.version) {
      diagnostics.push({
        code: 'unsupported-operator-version',
        severity: 'error',
        message: `${scope}${operator.label} v${node.operatorVersion} is newer than supported v${operator.version}.`,
        nodeIds: [node.id],
      });
    }
    for (const param of operator.params) {
      const problem = validateFlockParamValue(param, node.params[param.id]);
      if (problem) {
        diagnostics.push({
          code: 'invalid-param',
          severity: 'error',
          message: `${scope}${node.label ?? operator.label}: ${param.label} ${problem}.`,
          nodeIds: [node.id],
        });
      }
    }
  }

  for (const edge of edges) {
    const others = edges.filter((candidate) => candidate.id !== edge.id);
    const check = checkFlockConnection(definition, edge.from, edge.to, nodes, others.filter((candidate) => (
      edges.indexOf(candidate) < edges.indexOf(edge)
    )));
    if (!check.ok && check.code !== 'cycle') {
      diagnostics.push({ code: check.code, severity: 'error', message: `${scope}${check.message}`, edgeIds: [edge.id], nodeIds: [edge.from.nodeId, edge.to.nodeId] });
    } else if (check.ok && check.replacesEdgeId) {
      diagnostics.push({
        code: 'input-occupied',
        severity: 'error',
        message: `${scope}Input ${edge.to.port} accepts one connection; use a Merge / Compose node.`,
        edgeIds: [edge.id, check.replacesEdgeId],
        nodeIds: [edge.to.nodeId],
      });
    }
  }
  if (graphHasCycle(nodes, edges.map(flockConnectionEdge))) {
    diagnostics.push({ code: 'cycle', severity: 'error', message: `${scope}The graph contains a cycle.` });
  }
}

/** Full structural validation. Invalid drafts stay saved; compile/export refuse them. */
export function validateFlockDefinition(definition: FlockDefinition): FlockValidationResult {
  const diagnostics: FlockDiagnostic[] = [];
  if (definition.version !== FLOCK_DEFINITION_VERSION) {
    diagnostics.push({
      code: 'unsupported-definition-version',
      severity: 'error',
      message: `Flock definition version ${String(definition.version)} is not supported.`,
    });
    return { valid: false, diagnostics };
  }

  validateLevel(definition, definition.nodes, definition.edges, diagnostics, '');
  for (const group of definition.groups) {
    validateLevel(definition, group.nodes, group.edges, diagnostics, `Group "${group.label}": `);
    for (const binding of [...group.inputs, ...group.outputs]) {
      if (!group.nodes.some((node) => node.id === binding.target.nodeId)) {
        diagnostics.push({ code: 'group-binding-missing', severity: 'error', message: `Group "${group.label}" port ${binding.label} targets a missing node.` });
      }
    }
  }

  const expanded = expandFlockGroups(definition);
  diagnostics.push(...expanded.diagnostics);

  const outputs = expanded.nodes.filter((node) => node.operator === FLOCK_OUTPUT_OPERATOR_ID);
  const simulations = expanded.nodes.filter((node) => node.operator === FLOCK_SIMULATION_OPERATOR_ID);
  // Unconnected draft nodes never count toward structural limits.
  const participating = (node: FlockNode) => isParticipatingFlockNode(node, expanded.edges);
  if (outputs.length !== 1) {
    diagnostics.push({ code: 'output-count', severity: 'error', message: outputs.length === 0 ? 'The graph needs a Scene Output node.' : 'Only one Scene Output node is allowed.' });
  }
  if (simulations.length === 0) {
    diagnostics.push({ code: 'simulation-count', severity: 'error', message: 'The graph needs a Simulation node.' });
  } else if (simulations.filter(participating).length > 1) {
    diagnostics.push({ code: 'simulation-count', severity: 'error', message: 'Only one Simulation node may be connected.' });
  }

  const counts = new Map<string, number>();
  for (const node of expanded.nodes) {
    if (participating(node)) counts.set(node.operator, (counts.get(node.operator) ?? 0) + 1);
  }
  for (const [operatorId, count] of counts) {
    const operator = getFlockOperator(operatorId);
    if (operator?.maxInstances !== undefined && count > operator.maxInstances) {
      diagnostics.push({
        code: 'too-many-instances',
        severity: 'error',
        message: `${operator.label} allows at most ${operator.maxInstances} instance(s); found ${count}.`,
        nodeIds: expanded.nodes.filter((node) => node.operator === operatorId).map((node) => expanded.sourceNodeIds.get(node.id) ?? node.id),
      });
    }
  }

  for (const node of expanded.nodes) {
    if (node.bypassed) continue;
    const operator = getFlockOperator(node.operator);
    if (!operator) continue;
    for (const input of operator.inputs) {
      if (!input.required) continue;
      const connected = expanded.edges.some((edge) => edge.to.nodeId === node.id && edge.to.port === input.id);
      if (!connected) {
        diagnostics.push({
          code: 'missing-required-input',
          severity: 'error',
          message: `${node.label ?? operator.label} needs its ${input.label} input connected.`,
          nodeIds: [expanded.sourceNodeIds.get(node.id) ?? node.id],
        });
      }
    }
  }

  const capacity = expanded.nodes
    .filter((node) => node.operator === 'flock.emitter' && !node.bypassed)
    .reduce((sum, node) => sum + (typeof node.params.count === 'number' ? node.params.count : 0), 0);
  if (capacity > FLOCK_MAX_CAPACITY) {
    diagnostics.push({ code: 'capacity-exceeded', severity: 'error', message: `Total emitter count ${capacity} exceeds ${FLOCK_MAX_CAPACITY}.` });
  }

  for (const exposed of definition.exposed) {
    const node = definition.nodes.find((candidate) => candidate.id === exposed.nodeId);
    const hasParam = !!node && (
      node.operator === FLOCK_GROUP_OPERATOR_ID
        ? Object.prototype.hasOwnProperty.call(node.params, exposed.param)
        : !!getFlockOperator(node.operator)?.params.some((param) => param.id === exposed.param)
    );
    if (!hasParam) {
      diagnostics.push({
        code: 'exposed-param-missing',
        severity: 'warning',
        message: `Exposed control "${exposed.label}" points to a parameter that no longer exists.`,
        nodeIds: node ? [node.id] : undefined,
      });
    }
  }

  return { valid: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'), diagnostics };
}
