import {
  MOTION_PARENT_GRAPH_BUDGETS,
  MOTION_PARENT_STABLE_ID_POLICY,
} from './contracts';

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

export function isValidMotionParentStableId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MOTION_PARENT_STABLE_ID_POLICY.maxLength &&
    !containsControlCharacter(value)
  );
}

export type MotionParentStableIdArrayInspection =
  | { readonly ok: true; readonly values: readonly string[] }
  | { readonly ok: false; readonly budgetExceeded: boolean };

export function inspectMotionParentStableIdArray(
  value: unknown,
): MotionParentStableIdArrayInspection {
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
  if (length > MOTION_PARENT_GRAPH_BUDGETS.maxNodes) {
    return { ok: false, budgetExceeded: true };
  }
  if (Reflect.ownKeys(value).some((key) => (
    typeof key === 'symbol' ||
    (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
  ))) {
    return { ok: false, budgetExceeded: false };
  }
  const values: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      !isValidMotionParentStableId(descriptor.value)
    ) {
      return { ok: false, budgetExceeded: false };
    }
    values.push(descriptor.value);
  }
  return { ok: true, values };
}
