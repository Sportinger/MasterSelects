export type MotionJsonPrimitive = string | number | boolean | null;
export type MotionJsonValue = MotionJsonPrimitive | MotionJsonObject | MotionJsonValue[];
export interface MotionJsonObject {
  readonly [key: string]: MotionJsonValue;
}

export const MOTION_JSON_BUDGETS = {
  /** Root included. */
  maxNodes: 10_000,
  /** Root is depth zero. */
  maxDepth: 32,
  maxStringLength: 65_536,
  maxFailures: 64,
} as const;

export interface MotionJsonSafetyFailure {
  readonly code:
    | 'MD8_JSON_NOT_SAFE'
    | 'MD8_JSON_NON_FINITE'
    | 'MD8_JSON_CYCLE'
    | 'MD8_JSON_BUDGET_EXCEEDED'
    | 'MD8_JSON_RUNTIME_FIELD_FORBIDDEN'
    | 'MD8_JSON_EMBEDDED_BINARY_FORBIDDEN';
  readonly path: string;
  readonly message: string;
}

export type MotionJsonSafetyResult =
  | { readonly ok: true; readonly value: MotionJsonValue }
  | { readonly ok: false; readonly failures: readonly MotionJsonSafetyFailure[] };

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const FORBIDDEN_RUNTIME_FIELD_NAMES = new Set([
  'runtimehandle',
  'renderingcontext',
  'gputexture',
  'videoframe',
  'decoder',
  'filehandle',
  'localpath',
  'objecturl',
]);

export function inspectMotionJsonSafety(value: unknown): MotionJsonSafetyResult {
  const failures: MotionJsonSafetyFailure[] = [];
  const active = new Set<object>();
  let nodeCount = 0;
  let stopped = false;

  const report = (
    item: MotionJsonSafetyFailure,
    stopTraversal = false,
  ): void => {
    if (failures.length < MOTION_JSON_BUDGETS.maxFailures) failures.push(item);
    if (stopTraversal || failures.length >= MOTION_JSON_BUDGETS.maxFailures) stopped = true;
  };

  const visit = (candidate: unknown, path: string, depth: number): void => {
    if (stopped) return;
    nodeCount += 1;
    if (nodeCount > MOTION_JSON_BUDGETS.maxNodes || depth > MOTION_JSON_BUDGETS.maxDepth) {
      report({
        code: 'MD8_JSON_BUDGET_EXCEEDED',
        path,
        message: 'JSON value exceeds the Motion content depth or node budget.',
      }, true);
      return;
    }
    if (candidate === null || typeof candidate === 'boolean') return;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        report({
          code: 'MD8_JSON_NON_FINITE',
          path,
          message: 'Motion content numbers must be finite.',
        });
      }
      return;
    }
    if (typeof candidate === 'string') {
      if (candidate.length > MOTION_JSON_BUDGETS.maxStringLength) {
        report({
          code: 'MD8_JSON_BUDGET_EXCEEDED',
          path,
          message: 'Motion content string exceeds the string budget.',
        });
      }
      if (/^data:[^,]+;base64,/i.test(candidate)) {
        report({
          code: 'MD8_JSON_EMBEDDED_BINARY_FORBIDDEN',
          path,
          message: 'Preset and template content cannot embed binary data URLs.',
        });
      }
      return;
    }
    if (typeof candidate !== 'object' || candidate === undefined) {
      report({
        code: 'MD8_JSON_NOT_SAFE',
        path,
        message: 'Motion content accepts only JSON-safe values.',
      });
      return;
    }
    if (active.has(candidate)) {
      report({
        code: 'MD8_JSON_CYCLE',
        path,
        message: 'Motion content cannot contain cyclic objects.',
      });
      return;
    }
    if (!Array.isArray(candidate) && !isPlainObject(candidate)) {
      report({
        code: 'MD8_JSON_NOT_SAFE',
        path,
        message: 'Motion content objects must use plain JSON prototypes.',
      });
      return;
    }

    active.add(candidate);
    if (Array.isArray(candidate)) {
      if (Object.getPrototypeOf(candidate) !== Array.prototype) {
        report({
          code: 'MD8_JSON_NOT_SAFE',
          path,
          message: 'JSON arrays must use the native array prototype.',
        });
        active.delete(candidate);
        return;
      }
      const remainingNodeBudget = MOTION_JSON_BUDGETS.maxNodes - nodeCount;
      if (candidate.length > remainingNodeBudget) {
        report({
          code: 'MD8_JSON_BUDGET_EXCEEDED',
          path,
          message: 'JSON array exceeds the Motion content node budget.',
        }, true);
        active.delete(candidate);
        return;
      }
      const ownKeys = Reflect.ownKeys(candidate);
      const hasUnexpectedKey = ownKeys.some((key) => (
        typeof key === 'symbol' ||
        (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
      ));
      if (hasUnexpectedKey) {
        report({
          code: 'MD8_JSON_NOT_SAFE',
          path,
          message: 'JSON arrays cannot carry symbol or custom properties.',
        });
      }
      for (let index = 0; index < candidate.length && !stopped; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          report({
            code: 'MD8_JSON_NOT_SAFE',
            path: `${path}[${index}]`,
            message: 'JSON arrays must be dense enumerable data arrays without accessors.',
          });
          continue;
        }
        visit(descriptor.value, `${path}[${index}]`, depth + 1);
      }
    } else {
      const ownKeys = Reflect.ownKeys(candidate);
      const remainingNodeBudget = MOTION_JSON_BUDGETS.maxNodes - nodeCount;
      if (ownKeys.length > remainingNodeBudget) {
        report({
          code: 'MD8_JSON_BUDGET_EXCEEDED',
          path,
          message: 'JSON object exceeds the Motion content key/node budget.',
        }, true);
        active.delete(candidate);
        return;
      }
      const descriptors = Object.getOwnPropertyDescriptors(candidate);
      if (ownKeys.some((key) => typeof key === 'symbol')) {
        report({
          code: 'MD8_JSON_NOT_SAFE',
          path,
          message: 'JSON objects cannot carry symbol properties.',
        });
      }
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (stopped) break;
        if (key.length > MOTION_JSON_BUDGETS.maxStringLength) {
          report({
            code: 'MD8_JSON_BUDGET_EXCEEDED',
            path: `${path}.${key}`,
            message: 'JSON object key exceeds the Motion content string budget.',
          });
        }
        if (FORBIDDEN_RUNTIME_FIELD_NAMES.has(key.toLowerCase())) {
          report({
            code: 'MD8_JSON_RUNTIME_FIELD_FORBIDDEN',
            path: `${path}.${key}`,
            message: 'Persisted Motion content cannot contain runtime-only fields.',
          });
        }
        if (!descriptor.enumerable || !('value' in descriptor)) {
          report({
            code: 'MD8_JSON_NOT_SAFE',
            path: `${path}.${key}`,
            message: 'JSON objects require enumerable data properties without accessors.',
          });
          continue;
        }
        visit(descriptor.value, `${path}.${key}`, depth + 1);
      }
    }
    active.delete(candidate);
  };

  try {
    visit(value, '$', 0);
  } catch {
    report({
      code: 'MD8_JSON_NOT_SAFE',
      path: '$',
      message: 'Motion content could not be inspected as inert plain JSON.',
    });
  }
  return failures.length > 0
    ? { ok: false, failures }
    : { ok: true, value: value as MotionJsonValue };
}

export function cloneMotionJsonValue<T extends MotionJsonValue>(value: T): T {
  const safety = inspectMotionJsonSafety(value);
  if (!safety.ok) throw new TypeError('Motion JSON cloning requires an inert value within budget.');
  return JSON.parse(JSON.stringify(value)) as T;
}
