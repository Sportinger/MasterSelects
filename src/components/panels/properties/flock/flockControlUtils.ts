import type { FlockDefinition, FlockNode } from '../../../../types/flock';
import {
  FLOCK_GROUP_OPERATOR_ID,
  FLOCK_OUTPUT_OPERATOR_ID,
  getFlockOperator,
} from '../../../../services/flock/operators/flockOperatorRegistry';
import type { FlockParamDescriptor } from '../../../../services/flock/operators/flockOperatorTypes';

export interface FlockParamEntry {
  /** Param id, or `${innerNodeId}__${paramId}` on group instances. */
  key: string;
  descriptor: FlockParamDescriptor;
  innerLabel?: string;
}

export function getFlockNodeLabel(definition: FlockDefinition, nodeId: string): string {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return nodeId;
  if (node.label) return node.label;
  if (node.operator === FLOCK_GROUP_OPERATOR_ID) {
    return definition.groups.find((group) => group.id === node.groupRef)?.label ?? 'Group';
  }
  return getFlockOperator(node.operator)?.label ?? node.operator;
}

export function listFlockNodeParams(definition: FlockDefinition, node: FlockNode): FlockParamEntry[] {
  if (node.operator === FLOCK_OUTPUT_OPERATOR_ID) return [];
  if (node.operator !== FLOCK_GROUP_OPERATOR_ID) {
    return (getFlockOperator(node.operator)?.params ?? []).map((descriptor) => ({ key: descriptor.id, descriptor }));
  }
  const group = definition.groups.find((candidate) => candidate.id === node.groupRef);
  return (group?.nodes ?? []).flatMap((inner) => (
    (getFlockOperator(inner.operator)?.params ?? []).map((descriptor) => ({
      key: `${inner.id}__${descriptor.id}`,
      descriptor,
      innerLabel: inner.label ?? getFlockOperator(inner.operator)?.label ?? inner.operator,
    }))
  ));
}

/** Non-animatable or discrete values change structure / resimulate and are never keyframed. */
export function isStructuralFlockParam(descriptor: FlockParamDescriptor): boolean {
  return !descriptor.animatable
    || descriptor.type === 'integer'
    || descriptor.type === 'enum'
    || descriptor.type === 'boolean'
    || descriptor.type === 'asset';
}

export function getFlockInvalidationHint(descriptor: FlockParamDescriptor): string {
  switch (descriptor.invalidation) {
    case 'topology':
      return 'Resimulates from start';
    case 'behavior':
      return 'Resimulates from the change';
    case 'derived':
      return 'Rebuilds lines';
    default:
      return 'Redraw only';
  }
}

export function getFlockNumberDecimals(step?: number): number {
  if (step === undefined) return 2;
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

export function getFlockNumberSensitivity(descriptor: FlockParamDescriptor, min?: number, max?: number): number {
  if (min !== undefined && max !== undefined && Number.isFinite(max - min) && max > min) {
    return Math.max(0.001, (max - min) / 200);
  }
  return descriptor.step ?? 0.5;
}

export function clampFlockNumber(value: number, min?: number, max?: number): number {
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));
}

export function formatFlockBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const FLOCK_POPULATION_HINT =
  'Population is structural and cannot be keyframed. Animate the emitter Active Fraction or Lifetime instead.';
