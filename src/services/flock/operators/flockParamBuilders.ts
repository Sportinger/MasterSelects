import type { FlockParamValue, FlockVec3 } from '../../../types/flock';
import type {
  FlockInvalidation,
  FlockParamDescriptor,
  FlockParamOption,
  FlockPortDescriptor,
} from './flockOperatorTypes';

type ParamExtras = Partial<Omit<FlockParamDescriptor, 'id' | 'label' | 'type' | 'default'>>;

export function numberParam(
  id: string,
  label: string,
  value: number,
  invalidation: FlockInvalidation,
  extras: ParamExtras = {},
): FlockParamDescriptor {
  return { id, label, type: 'number', default: value, animatable: true, invalidation, ...extras };
}

export function integerParam(
  id: string,
  label: string,
  value: number,
  invalidation: FlockInvalidation,
  extras: ParamExtras = {},
): FlockParamDescriptor {
  return { id, label, type: 'integer', default: value, animatable: false, step: 1, invalidation, ...extras };
}

export function boolParam(
  id: string,
  label: string,
  value: boolean,
  invalidation: FlockInvalidation,
  extras: ParamExtras = {},
): FlockParamDescriptor {
  return { id, label, type: 'boolean', default: value, animatable: false, invalidation, ...extras };
}

export function enumParam(
  id: string,
  label: string,
  value: string,
  options: Array<string | FlockParamOption>,
  invalidation: FlockInvalidation,
  extras: ParamExtras = {},
): FlockParamDescriptor {
  return {
    id,
    label,
    type: 'enum',
    default: value,
    animatable: false,
    invalidation,
    options: options.map((option) => typeof option === 'string'
      ? { value: option, label: option.charAt(0).toUpperCase() + option.slice(1).replace(/-/g, ' ') }
      : option),
    ...extras,
  };
}

export function vecParam(
  id: string,
  label: string,
  value: FlockVec3,
  invalidation: FlockInvalidation,
  extras: ParamExtras = {},
): FlockParamDescriptor {
  return { id, label, type: 'vec3', default: [...value] as FlockVec3, animatable: true, invalidation, ...extras };
}

export function colorParam(
  id: string,
  label: string,
  value: string,
  extras: ParamExtras = {},
): FlockParamDescriptor {
  return { id, label, type: 'color', default: value, animatable: true, invalidation: 'appearance', ...extras };
}

export function assetParam(
  id: string,
  label: string,
  assetKind: 'model' | 'image' | 'audio',
  invalidation: FlockInvalidation,
  extras: ParamExtras = {},
): FlockParamDescriptor {
  return { id, label, type: 'asset', default: '', animatable: false, assetKind, invalidation, ...extras };
}

export function port(
  id: string,
  label: string,
  type: FlockPortDescriptor['type'],
  extras: Partial<Omit<FlockPortDescriptor, 'id' | 'label' | 'type'>> = {},
): FlockPortDescriptor {
  return { id, label, type, ...extras };
}

export function defaultParamsFor(params: FlockParamDescriptor[]): Record<string, FlockParamValue> {
  const result: Record<string, FlockParamValue> = {};
  for (const param of params) {
    result[param.id] = Array.isArray(param.default)
      ? [...param.default] as FlockVec3
      : param.default;
  }
  return result;
}
