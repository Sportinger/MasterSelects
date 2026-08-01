export const MOTION_ADJUSTMENT_MAX_LAYERS = 512;
export const MOTION_ADJUSTMENT_MAX_EFFECTS_PER_LAYER = 32;
export const MOTION_ADJUSTMENT_MAX_MASKS_PER_LAYER = 64;
export const MOTION_ADJUSTMENT_MAX_POINTS_PER_MASK = 1_024;
export const MOTION_ADJUSTMENT_MAX_OPERATIONS = 1_024;
export const MOTION_ADJUSTMENT_MAX_JSON_DEPTH = 32;
export const MOTION_ADJUSTMENT_MAX_JSON_NODES = 131_072;
export const MOTION_ADJUSTMENT_MAX_JSON_STRING_LENGTH = 4_096;
/** Keeps the longest generated layer+effect reference below the ref budget. */
export const MOTION_ADJUSTMENT_MAX_ID_LENGTH = 240;
export const MOTION_ADJUSTMENT_MAX_REFERENCE_LENGTH = 512;

/**
 * Descriptor-only traversal rejects accessors before any contract property is
 * read. It also freezes the JSON boundary: finite primitives, dense arrays,
 * plain enumerable data objects, bounded depth, and no cycles/runtime objects.
 */
export function assertMotionAdjustmentJsonData(value: unknown): void {
  visitJsonData(value, 1, new WeakSet<object>(), { nodeCount: 0 });
}

export function isMotionAdjustmentStableId(value: unknown): value is string {
  return isStableBoundedString(value, MOTION_ADJUSTMENT_MAX_ID_LENGTH);
}

export function isMotionAdjustmentStableReference(
  value: unknown,
): value is string {
  return isStableBoundedString(value, MOTION_ADJUSTMENT_MAX_REFERENCE_LENGTH);
}

function isStableBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && !hasControlCharacter(value);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || (codeUnit >= 127 && codeUnit <= 159)) return true;
  }
  return false;
}

interface MotionAdjustmentJsonBudgetState {
  nodeCount: number;
}

function visitJsonData(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  budget: MotionAdjustmentJsonBudgetState,
): void {
  budget.nodeCount += 1;
  if (budget.nodeCount > MOTION_ADJUSTMENT_MAX_JSON_NODES) {
    throw new Error('Motion adjustment contract JSON node count exceeds its hard budget');
  }
  if (
    value === null
    || typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MOTION_ADJUSTMENT_MAX_JSON_STRING_LENGTH) {
      throw new Error('Motion adjustment contract JSON string length exceeds its hard budget');
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Motion adjustment contracts require finite JSON numbers');
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new Error('Motion adjustment contracts require JSON data only');
  }
  if (depth > MOTION_ADJUSTMENT_MAX_JSON_DEPTH) {
    throw new Error('Motion adjustment contract JSON depth exceeds its hard budget');
  }
  if (ancestors.has(value)) {
    throw new Error('Motion adjustment contracts cannot contain cycles');
  }

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    throw new Error('Motion adjustment contracts require plain JSON containers');
  }

  ancestors.add(value);
  if (
    isArray
    && (value as unknown[]).length
      > MOTION_ADJUSTMENT_MAX_JSON_NODES - budget.nodeCount
  ) {
    throw new Error('Motion adjustment contract JSON node count exceeds its hard budget');
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    throw new Error('Motion adjustment contracts cannot contain symbol fields');
  }

  if (isArray) {
    const array = value as unknown[];
    const dataKeys = ownKeys.filter((key) => key !== 'length');
    if (
      dataKeys.length !== array.length
      || dataKeys.some((key, index) => key !== String(index))
    ) {
      throw new Error('Motion adjustment contracts require dense JSON arrays');
    }
  } else if (
    ownKeys.length > MOTION_ADJUSTMENT_MAX_JSON_NODES - budget.nodeCount
  ) {
    throw new Error('Motion adjustment contract JSON node count exceeds its hard budget');
  }

  for (const key of ownKeys) {
    if (isArray && key === 'length') continue;
    if (
      typeof key === 'string'
      && key.length > MOTION_ADJUSTMENT_MAX_JSON_STRING_LENGTH
    ) {
      throw new Error('Motion adjustment contract JSON string length exceeds its hard budget');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor
      || !('value' in descriptor)
      || descriptor.enumerable !== true
    ) {
      throw new Error('Motion adjustment contract accessors are forbidden');
    }
    visitJsonData(descriptor.value, depth + 1, ancestors, budget);
  }
  ancestors.delete(value);
}
