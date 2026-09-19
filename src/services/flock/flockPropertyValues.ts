import {
  parseFlockProperty,
  type FlockDefinition,
  type FlockParamValue,
  type FlockVec3,
} from '../../types/flock';
import { getHexColorChannel, setHexColorChannel } from '../../utils/colorParam';
import type { FlockParamDescriptor } from './operators/flockOperatorTypes';
import { FLOCK_GROUP_OPERATOR_ID, getFlockOperator } from './operators/flockOperatorRegistry';
import { setFlockNodeParam } from './mutations/flockGraphMutations';

const VECTOR_COMPONENTS = { x: 0, y: 1, z: 2 } as const;

/** Descriptor for a node parameter, resolving group-instance override keys `${innerId}__${param}`. */
export function resolveFlockParamDescriptor(
  definition: FlockDefinition,
  nodeId: string,
  paramKey: string,
): FlockParamDescriptor | undefined {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return undefined;
  if (node.operator !== FLOCK_GROUP_OPERATOR_ID) {
    return getFlockOperator(node.operator)?.params.find((param) => param.id === paramKey);
  }
  const separator = paramKey.indexOf('__');
  if (separator <= 0) return undefined;
  const group = definition.groups.find((candidate) => candidate.id === node.groupRef);
  const inner = group?.nodes.find((candidate) => candidate.id === paramKey.slice(0, separator));
  return inner ? getFlockOperator(inner.operator)?.params.find((param) => param.id === paramKey.slice(separator + 2)) : undefined;
}

export function readFlockParamValue(
  definition: FlockDefinition,
  nodeId: string,
  paramKey: string,
): FlockParamValue | undefined {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return undefined;
  if (node.params[paramKey] !== undefined) return node.params[paramKey];
  if (node.operator === FLOCK_GROUP_OPERATOR_ID) {
    const separator = paramKey.indexOf('__');
    const group = definition.groups.find((candidate) => candidate.id === node.groupRef);
    const inner = separator > 0 ? group?.nodes.find((candidate) => candidate.id === paramKey.slice(0, separator)) : undefined;
    const innerValue = inner?.params[paramKey.slice(separator + 2)];
    if (innerValue !== undefined) return innerValue;
  }
  return resolveFlockParamDescriptor(definition, nodeId, paramKey)?.default;
}

/** Numeric keyframe value for a flock property path (vector component / color channel 0..255). */
export function readFlockParamForProperty(definition: FlockDefinition, property: string): number | undefined {
  const parsed = parseFlockProperty(property);
  if (!parsed) return undefined;
  const descriptor = resolveFlockParamDescriptor(definition, parsed.nodeId, parsed.param);
  const value = readFlockParamValue(definition, parsed.nodeId, parsed.param);
  if (!descriptor || value === undefined) return undefined;
  switch (descriptor.type) {
    case 'number':
    case 'integer':
      return typeof value === 'number' ? value : undefined;
    case 'boolean':
      return value === true ? 1 : 0;
    case 'vec3':
      if (!Array.isArray(value) || !parsed.component || !(parsed.component in VECTOR_COMPONENTS)) return undefined;
      return value[VECTOR_COMPONENTS[parsed.component as keyof typeof VECTOR_COMPONENTS]];
    case 'color':
      if (parsed.component !== 'r' && parsed.component !== 'g' && parsed.component !== 'b') return undefined;
      return getHexColorChannel(value, parsed.component, String(descriptor.default));
    default:
      return undefined;
  }
}

/** Writes a numeric keyframe-style value back into the canonical node parameter. */
export function writeFlockParamForProperty(
  definition: FlockDefinition,
  property: string,
  numericValue: number,
): FlockDefinition | null {
  const parsed = parseFlockProperty(property);
  if (!parsed || !Number.isFinite(numericValue)) return null;
  const descriptor = resolveFlockParamDescriptor(definition, parsed.nodeId, parsed.param);
  const current = readFlockParamValue(definition, parsed.nodeId, parsed.param);
  if (!descriptor || current === undefined) return null;
  const clamp = (value: number) => Math.min(descriptor.max ?? Infinity, Math.max(descriptor.min ?? -Infinity, value));
  let nextValue: FlockParamValue;
  switch (descriptor.type) {
    case 'number':
      nextValue = clamp(numericValue);
      break;
    case 'integer':
      nextValue = Math.round(clamp(numericValue));
      break;
    case 'boolean':
      nextValue = numericValue >= 0.5;
      break;
    case 'vec3': {
      if (!Array.isArray(current) || !parsed.component || !(parsed.component in VECTOR_COMPONENTS)) return null;
      const vector: FlockVec3 = [current[0], current[1], current[2]];
      vector[VECTOR_COMPONENTS[parsed.component as keyof typeof VECTOR_COMPONENTS]] = numericValue;
      nextValue = vector;
      break;
    }
    case 'color':
      if (parsed.component !== 'r' && parsed.component !== 'g' && parsed.component !== 'b') return null;
      nextValue = setHexColorChannel(current, parsed.component, Math.max(0, Math.min(255, numericValue)), String(descriptor.default));
      break;
    default:
      return null;
  }
  const result = setFlockNodeParam(definition, parsed.nodeId, parsed.param, nextValue);
  return result.ok ? result.definition : null;
}
