import type { SignalKind, SignalOperatorDescriptor } from '../../../signals/types';
import { SIGNAL_SCHEMA_VERSION } from '../../../signals/types';
import type {
  FlockDefinition,
  FlockNode,
  FlockParamValue,
  FlockPortType,
} from '../../../types/flock';
import type {
  FlockOperatorDescriptor,
  FlockParamDescriptor,
  FlockPortDescriptor,
} from './flockOperatorTypes';
import { defaultParamsFor } from './flockParamBuilders';
import { BEHAVIOR_OPERATORS, GUIDANCE_OPERATORS } from './behaviorGuidanceOperators';
import { POPULATION_OPERATORS, SIMULATION_OPERATORS } from './populationSimulationOperators';
import { RENDER_OPERATORS } from './renderOperators';
import { OUTPUT_OPERATORS, SELECTION_OPERATORS, VALUE_OPERATORS } from './selectionValueOperators';

const ALL_OPERATORS: readonly FlockOperatorDescriptor[] = [
  ...POPULATION_OPERATORS,
  ...SIMULATION_OPERATORS,
  ...BEHAVIOR_OPERATORS,
  ...GUIDANCE_OPERATORS,
  ...SELECTION_OPERATORS,
  ...VALUE_OPERATORS,
  ...RENDER_OPERATORS,
  ...OUTPUT_OPERATORS,
];

const OPERATORS_BY_ID = new Map(ALL_OPERATORS.map((operator) => [operator.id, operator]));

export const FLOCK_GROUP_OPERATOR_ID = 'flock.group';
export const FLOCK_OUTPUT_OPERATOR_ID = 'flock.output';
export const FLOCK_SIMULATION_OPERATOR_ID = 'flock.simulation';

export function listFlockOperators(): readonly FlockOperatorDescriptor[] {
  return ALL_OPERATORS;
}

export function getFlockOperator(operatorId: string): FlockOperatorDescriptor | undefined {
  return OPERATORS_BY_ID.get(operatorId);
}

export function getFlockParamDescriptor(
  operatorId: string,
  paramId: string,
): FlockParamDescriptor | undefined {
  return OPERATORS_BY_ID.get(operatorId)?.params.find((param) => param.id === paramId);
}

export interface ResolvedFlockNodePorts {
  inputs: FlockPortDescriptor[];
  outputs: FlockPortDescriptor[];
}

/** Group nodes derive their boundary ports from the referenced group definition. */
export function resolveFlockNodePorts(
  node: FlockNode,
  definition: Pick<FlockDefinition, 'groups'>,
): ResolvedFlockNodePorts | null {
  if (node.operator === FLOCK_GROUP_OPERATOR_ID) {
    const group = definition.groups.find((candidate) => candidate.id === node.groupRef);
    if (!group) return null;
    return {
      inputs: group.inputs.map((binding) => ({
        id: binding.id,
        label: binding.label,
        type: binding.type,
        required: binding.required,
      })),
      outputs: group.outputs.map((binding) => ({
        id: binding.id,
        label: binding.label,
        type: binding.type,
      })),
    };
  }
  const operator = OPERATORS_BY_ID.get(node.operator);
  return operator ? { inputs: operator.inputs, outputs: operator.outputs } : null;
}

let fallbackCounter = 0;

/** Stable UUID-like node id without property-path delimiters. */
export function generateFlockNodeId(prefix = 'fn'): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.randomUUID) {
    return `${prefix}-${cryptoApi.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  fallbackCounter += 1;
  return `${prefix}-${Date.now().toString(36)}${fallbackCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createFlockNode(
  operatorId: string,
  options: { id?: string; label?: string; params?: Record<string, FlockParamValue>; groupRef?: string } = {},
): FlockNode {
  const operator = OPERATORS_BY_ID.get(operatorId);
  if (!operator) {
    throw new Error(`Unknown flock operator: ${operatorId}`);
  }
  return {
    id: options.id ?? generateFlockNodeId(),
    operator: operatorId,
    operatorVersion: operator.version,
    ...(options.label ? { label: options.label } : {}),
    params: { ...defaultParamsFor(operator.params), ...(options.params ?? {}) },
    ...(options.groupRef ? { groupRef: options.groupRef } : {}),
  };
}

export const FLOCK_PORT_SIGNAL_KIND: Record<FlockPortType, SignalKind> = {
  spawn: 'metadata',
  behavior: 'metadata',
  obstacle: 'geometry',
  boundary: 'geometry',
  path: 'curve',
  particles: 'point-cloud',
  curves: 'curve',
  selection: 'metadata',
  scalar: 'number',
  palette: 'metadata',
  scene: 'scene',
};

/** Signal IR view of a flock operator. Port semantics are versioned via metadata.flockPortType. */
export function toSignalOperatorDescriptor(operator: FlockOperatorDescriptor): SignalOperatorDescriptor {
  const mapPort = (portDescriptor: FlockPortDescriptor) => ({
    id: portDescriptor.id,
    label: portDescriptor.label,
    kind: FLOCK_PORT_SIGNAL_KIND[portDescriptor.type],
    ...(portDescriptor.required ? { required: true } : {}),
    ...(portDescriptor.repeated ? { repeated: true } : {}),
    metadata: { flockPortType: portDescriptor.type, flockPortSchema: 1 },
  });
  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    id: operator.id,
    version: String(operator.version),
    label: operator.label,
    role: 'operator',
    runtime: operator.id === FLOCK_GROUP_OPERATOR_ID ? 'subgraph' : 'wgsl',
    inputs: operator.inputs.map(mapPort),
    outputs: operator.outputs.map(mapPort),
    deterministic: true,
    stateful: operator.id === FLOCK_SIMULATION_OPERATOR_ID || operator.id === 'flock.trails',
    metadata: { category: operator.category, phase: operator.phase },
  };
}
