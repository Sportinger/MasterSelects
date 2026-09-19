import type { PropertyDescriptor } from '../../types/propertyRegistry';
import type { TimelineClip } from '../../types/timeline';
import {
  createFlockProperty,
  isFlockProperty,
  parseFlockProperty,
  type FlockDefinition,
  type FlockNode,
  type FlockParamComponent,
} from '../../types/flock';
import { getHexColorChannel } from '../../utils/colorParam';
import {
  readFlockParamForProperty,
  resolveFlockParamDescriptor,
  writeFlockParamForProperty,
} from '../flock/flockPropertyValues';
import { FLOCK_GROUP_OPERATOR_ID, getFlockOperator } from '../flock/operators/flockOperatorRegistry';
import type { FlockParamDescriptor } from '../flock/operators/flockOperatorTypes';

const COMPONENT_LABELS: Record<FlockParamComponent, string> = {
  x: 'X',
  y: 'Y',
  z: 'Z',
  r: 'R',
  g: 'G',
  b: 'B',
};

function getFlockClipDefinition(clip: TimelineClip | undefined): FlockDefinition | null {
  return clip?.source?.type === 'flock' && clip.flock ? clip.flock : null;
}

function getNodeLabel(definition: FlockDefinition, node: FlockNode | undefined): string {
  if (!node) return 'Node';
  if (node.label) return node.label;
  if (node.operator === FLOCK_GROUP_OPERATOR_ID) {
    return definition.groups.find((group) => group.id === node.groupRef)?.label ?? 'Group';
  }
  return getFlockOperator(node.operator)?.label ?? node.operator;
}

function getInnerLabel(definition: FlockDefinition, node: FlockNode | undefined, paramKey: string): string | null {
  if (node?.operator !== FLOCK_GROUP_OPERATOR_ID) return null;
  const separator = paramKey.indexOf('__');
  if (separator <= 0) return null;
  const group = definition.groups.find((candidate) => candidate.id === node.groupRef);
  const inner = group?.nodes.find((candidate) => candidate.id === paramKey.slice(0, separator));
  if (!inner) return null;
  return inner.label ?? getFlockOperator(inner.operator)?.label ?? inner.operator;
}

function defaultNumericValue(descriptor: FlockParamDescriptor, component?: FlockParamComponent): number | undefined {
  const value = descriptor.default;
  switch (descriptor.type) {
    case 'number':
    case 'integer':
      return typeof value === 'number' ? value : undefined;
    case 'vec3':
      if (!Array.isArray(value)) return undefined;
      return component === 'x' ? value[0] : component === 'y' ? value[1] : component === 'z' ? value[2] : undefined;
    case 'color':
      return component === 'r' || component === 'g' || component === 'b'
        ? getHexColorChannel(value, component, '#ffffff')
        : undefined;
    default:
      return undefined;
  }
}

function isSupportedComponent(descriptor: FlockParamDescriptor, component?: FlockParamComponent): boolean {
  switch (descriptor.type) {
    case 'number':
    case 'integer':
      return component === undefined;
    case 'vec3':
      return component === 'x' || component === 'y' || component === 'z';
    case 'color':
      return component === 'r' || component === 'g' || component === 'b';
    default:
      return false;
  }
}

/** Resolves `flock.node.<nodeId>.<param>[.component]` against the clip's flock definition. */
export function getFlockDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  if (!isFlockProperty(path)) return undefined;
  const definition = getFlockClipDefinition(clip);
  const parsed = parseFlockProperty(path);
  if (!definition || !parsed) return undefined;
  const descriptor = resolveFlockParamDescriptor(definition, parsed.nodeId, parsed.param);
  if (!descriptor || !isSupportedComponent(descriptor, parsed.component)) return undefined;
  const defaultValue = defaultNumericValue(descriptor, parsed.component);
  if (defaultValue === undefined) return undefined;

  const node = definition.nodes.find((candidate) => candidate.id === parsed.nodeId);
  const innerLabel = getInnerLabel(definition, node, parsed.param);
  const componentLabel = parsed.component ? ` ${COMPONENT_LABELS[parsed.component]}` : '';
  const isColor = descriptor.type === 'color';

  return {
    path,
    label: `${innerLabel ? `${innerLabel} ` : ''}${descriptor.label}${componentLabel}`,
    group: `Flock / ${getNodeLabel(definition, node)}`,
    valueType: 'number',
    animatable: descriptor.animatable && descriptor.type !== 'integer',
    defaultValue,
    ui: {
      ...(isColor ? { min: 0, max: 255, step: 1 } : {}),
      ...(!isColor && descriptor.type !== 'vec3' && descriptor.min !== undefined ? { min: descriptor.min } : {}),
      ...(!isColor && descriptor.type !== 'vec3' && descriptor.max !== undefined ? { max: descriptor.max } : {}),
      ...(!isColor && descriptor.step !== undefined ? { step: descriptor.step } : {}),
      ...(descriptor.unit ? { unit: descriptor.unit } : {}),
    },
    read: (target, targetPath) => {
      const targetDefinition = getFlockClipDefinition(target);
      return targetDefinition ? readFlockParamForProperty(targetDefinition, targetPath) : undefined;
    },
    write: (target, value, targetPath) => {
      const targetDefinition = getFlockClipDefinition(target);
      const numericValue = typeof value === 'number' ? value : Number(value);
      if (!targetDefinition || !Number.isFinite(numericValue)) return target;
      const next = writeFlockParamForProperty(targetDefinition, targetPath, numericValue);
      return next ? { ...target, flock: next } : target;
    },
  };
}

function listParamPaths(nodeId: string, paramKey: string, descriptor: FlockParamDescriptor): string[] {
  switch (descriptor.type) {
    case 'number':
    case 'integer':
      return [createFlockProperty(nodeId, paramKey)];
    case 'vec3':
      return (['x', 'y', 'z'] as const).map((component) => createFlockProperty(nodeId, paramKey, component));
    case 'color':
      return (['r', 'g', 'b'] as const).map((component) => createFlockProperty(nodeId, paramKey, component));
    default:
      return [];
  }
}

/** Every numeric flock parameter path of a clip: numbers, vector components, color channels. */
export function getFlockDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  const definition = getFlockClipDefinition(clip);
  if (!definition) return [];
  const descriptors: PropertyDescriptor[] = [];
  for (const node of definition.nodes) {
    const entries: Array<{ key: string; descriptor: FlockParamDescriptor }> = [];
    if (node.operator === FLOCK_GROUP_OPERATOR_ID) {
      const group = definition.groups.find((candidate) => candidate.id === node.groupRef);
      for (const inner of group?.nodes ?? []) {
        for (const descriptor of getFlockOperator(inner.operator)?.params ?? []) {
          entries.push({ key: `${inner.id}__${descriptor.id}`, descriptor });
        }
      }
    } else {
      for (const descriptor of getFlockOperator(node.operator)?.params ?? []) {
        entries.push({ key: descriptor.id, descriptor });
      }
    }
    for (const { key, descriptor } of entries) {
      for (const path of listParamPaths(node.id, key, descriptor)) {
        const resolved = getFlockDescriptorForPath(path, clip);
        if (resolved) descriptors.push(resolved);
      }
    }
  }
  return descriptors;
}
