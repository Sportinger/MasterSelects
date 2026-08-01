import { MOTION_JSON_BUDGETS } from '../presets/jsonSafety';
import {
  MOTION_TEMPLATE_MAX_OCCUPIED_TARGET_IDS,
  MOTION_TEMPLATE_PLAN_BUDGETS,
  type MotionTemplateDependencyResolution,
} from './contracts';

export interface ExactDataRecordInspection {
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>;
}

export function inspectExactDataRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: ReadonlySet<string> = allowedKeys,
): ExactDataRecordInspection | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (!keys.every((key) => allowedKeys.has(key))) return null;
  if (![...requiredKeys].every((key) => Object.hasOwn(descriptors, key))) return null;
  if (!keys.every((key) => descriptors[key].enumerable && 'value' in descriptors[key])) return null;
  return { descriptors };
}

export type DenseDataArrayInspection =
  | { readonly ok: true; readonly values: readonly unknown[] }
  | { readonly ok: false; readonly budgetExceeded: boolean };

export function inspectDenseDataArray(
  value: unknown,
  maxLength: number,
): DenseDataArrayInspection {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return { ok: false, budgetExceeded: false };
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor
  >;
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && 'value' in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    return { ok: false, budgetExceeded: false };
  }
  if (length > maxLength) return { ok: false, budgetExceeded: true };
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => (
    typeof key === 'symbol' ||
    (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
  ))) {
    return { ok: false, budgetExceeded: false };
  }
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      return { ok: false, budgetExceeded: false };
    }
    values.push(descriptor.value);
  }
  return { ok: true, values };
}

const RESOLUTION_KEYS = new Set(['dependencyId', 'resolvedProjectId']);

export type ResolutionCollectionInspection =
  | { readonly ok: true; readonly values: readonly MotionTemplateDependencyResolution[] }
  | { readonly ok: false; readonly budgetExceeded: boolean };

export function inspectMotionTemplateDependencyResolutions(
  value: unknown,
): ResolutionCollectionInspection {
  const array = inspectDenseDataArray(
    value,
    MOTION_TEMPLATE_PLAN_BUDGETS.maxDependencyResolutions,
  );
  if (!array.ok) return array;
  const values: MotionTemplateDependencyResolution[] = [];
  for (const rawResolution of array.values) {
    const resolution = inspectExactDataRecord(rawResolution, RESOLUTION_KEYS);
    if (!resolution) return { ok: false, budgetExceeded: false };
    const dependencyId = resolution.descriptors.dependencyId.value;
    const resolvedProjectId = resolution.descriptors.resolvedProjectId.value;
    if (
      typeof dependencyId !== 'string' ||
      !dependencyId ||
      dependencyId.length > MOTION_JSON_BUDGETS.maxStringLength ||
      typeof resolvedProjectId !== 'string' ||
      !resolvedProjectId ||
      resolvedProjectId.length > MOTION_JSON_BUDGETS.maxStringLength
    ) {
      return { ok: false, budgetExceeded: false };
    }
    values.push({ dependencyId, resolvedProjectId });
  }
  return { ok: true, values };
}

export type OccupiedTargetIdCollectionInspection =
  | { readonly ok: true; readonly values: readonly string[] }
  | { readonly ok: false; readonly budgetExceeded: boolean };

export function inspectMotionTemplateOccupiedTargetIds(
  value: unknown,
): OccupiedTargetIdCollectionInspection {
  const array = inspectDenseDataArray(value, MOTION_TEMPLATE_MAX_OCCUPIED_TARGET_IDS);
  if (!array.ok) return array;
  const values: string[] = [];
  const uniqueValues = new Set<string>();
  for (const rawId of array.values) {
    if (typeof rawId !== 'string' || !rawId || rawId.length > 512 || uniqueValues.has(rawId)) {
      return { ok: false, budgetExceeded: false };
    }
    uniqueValues.add(rawId);
    values.push(rawId);
  }
  return { ok: true, values };
}
