import type { FlockNode, FlockProperty, FlockVec3 } from '../../../types/flock';
import { createFlockProperty } from '../../../types/flock';
import type { FlockParamOwner } from '../graph/flockGroupExpansion';
import type { FlockInvalidation } from '../operators/flockOperatorTypes';
import { getFlockOperator } from '../operators/flockOperatorRegistry';
import type { FlockParamBundle } from './flockProgramTypes';

/** cyrb53 — a fast, well-distributed 53-bit string hash, returned as hex. */
export function hashFlockString(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, '0');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).toSorted().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export interface BundleBuildOptions {
  paramOwners: Map<string, FlockParamOwner>;
  /** port-driven params: paramId -> value index */
  drivenParams?: Map<string, number>;
}

export interface BuiltBundle {
  bundle: FlockParamBundle;
  /** invalidation class -> hashed static values of that class */
  staticByClass: Record<FlockInvalidation, Record<string, unknown>>;
  propertiesByClass: Record<FlockInvalidation, FlockProperty[]>;
}

/** Lowers node params into typed refs with keyframe properties on their authored owner. */
export function buildParamBundle(node: FlockNode, options: BundleBuildOptions): BuiltBundle {
  const operator = getFlockOperator(node.operator);
  const bundle: FlockParamBundle = {
    numbers: {},
    vectors: {},
    colors: {},
    enums: {},
    integers: {},
    booleans: {},
    assets: {},
  };
  const staticByClass: BuiltBundle['staticByClass'] = { appearance: {}, derived: {}, behavior: {}, topology: {} };
  const propertiesByClass: BuiltBundle['propertiesByClass'] = { appearance: [], derived: [], behavior: [], topology: [] };
  if (!operator) return { bundle, staticByClass, propertiesByClass };

  for (const param of operator.params) {
    const raw = node.params[param.id] ?? param.default;
    const owner = options.paramOwners.get(`${node.id}.${param.id}`) ?? { nodeId: node.id, paramKey: param.id };
    const propertyFor = (component?: 'x' | 'y' | 'z' | 'r' | 'g' | 'b') => createFlockProperty(owner.nodeId, owner.paramKey, component);
    staticByClass[param.invalidation][param.id] = raw;
    switch (param.type) {
      case 'number': {
        const valueIndex = options.drivenParams?.get(param.id);
        bundle.numbers[param.id] = {
          base: typeof raw === 'number' ? raw : Number(param.default),
          ...(param.animatable ? { property: propertyFor() } : {}),
          ...(valueIndex !== undefined ? { valueIndex } : {}),
        };
        if (param.animatable) propertiesByClass[param.invalidation].push(propertyFor());
        if (valueIndex !== undefined) staticByClass[param.invalidation][`${param.id}:driven`] = valueIndex;
        break;
      }
      case 'integer':
        bundle.integers[param.id] = typeof raw === 'number' ? Math.round(raw) : Number(param.default);
        break;
      case 'boolean':
        bundle.booleans[param.id] = raw === true;
        break;
      case 'enum':
        bundle.enums[param.id] = typeof raw === 'string' ? raw : String(param.default);
        break;
      case 'asset':
        bundle.assets[param.id] = typeof raw === 'string' ? raw : '';
        break;
      case 'vec3': {
        const base = (Array.isArray(raw) && raw.length === 3 ? raw : param.default) as FlockVec3;
        const properties = param.animatable
          ? [propertyFor('x'), propertyFor('y'), propertyFor('z')] as [FlockProperty, FlockProperty, FlockProperty]
          : undefined;
        bundle.vectors[param.id] = { base: [base[0], base[1], base[2]], ...(properties ? { properties } : {}) };
        if (properties) propertiesByClass[param.invalidation].push(...properties);
        break;
      }
      case 'color': {
        const base = typeof raw === 'string' ? raw : String(param.default);
        const properties = param.animatable
          ? [propertyFor('r'), propertyFor('g'), propertyFor('b')] as [FlockProperty, FlockProperty, FlockProperty]
          : undefined;
        bundle.colors[param.id] = { base, ...(properties ? { properties } : {}) };
        if (properties) propertiesByClass[param.invalidation].push(...properties);
        break;
      }
    }
  }
  return { bundle, staticByClass, propertiesByClass };
}

export function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

/** Deterministic identity hash in [0,1): shared by CPU reference, GPU shaders and trail slot choice. */
export function flockHash01(index: number, salt: number): number {
  let state = (Math.imul(index >>> 0, 747796405) + Math.imul(salt >>> 0, 2891336453) + 1) >>> 0;
  state = (Math.imul(state ^ (state >>> 16), 0x45d9f3b)) >>> 0;
  state = (Math.imul(state ^ (state >>> 16), 0x45d9f3b)) >>> 0;
  state = (state ^ (state >>> 16)) >>> 0;
  return state / 4294967296;
}

export function selectTrailSlots(capacity: number, fraction: number, maxTrails: number, salt: number): Uint32Array {
  const clampedFraction = Math.max(0, Math.min(1, fraction));
  const slots: number[] = [];
  for (let index = 0; index < capacity && slots.length < maxTrails; index += 1) {
    if (flockHash01(index, salt) < clampedFraction) slots.push(index);
  }
  return Uint32Array.from(slots);
}

export function estimateTrailSlotCount(capacity: number, fraction: number, maxTrails: number): number {
  return Math.min(maxTrails, Math.ceil(capacity * Math.max(0, Math.min(1, fraction))));
}
