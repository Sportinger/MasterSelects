import {
  cloneMotionJsonValue,
  type MotionJsonObject,
} from '../presets/jsonSafety';

export const MOTION_MUTATION_BATCH_VERSION = 'motion-mutation-batch/v1' as const;

export const MOTION_SHARED_CONTRACT_LIMITS = Object.freeze({
  maxCapabilities: 128,
  maxLimits: 128,
  maxDiagnostics: 1_024,
  maxEntityRevisions: 10_000,
  maxMutationOperations: 10_000,
  /** Accommodates a legal 10k-node MD6 apply+undo graph plan in one atomic payload. */
  maxMutationPayloadNodes: 500_000,
  maxMutationPayloadDepth: 64,
  maxStableIdLength: 512,
  maxDiagnosticMessageLength: 4_096,
});

export type MotionCapabilitySource =
  | 'contract'
  | 'project'
  | 'device'
  | 'render-target';

export interface MotionCapabilityDescriptor {
  readonly id: string;
  readonly supported: boolean;
  readonly source: MotionCapabilitySource;
  readonly numericLimit?: number;
  readonly detail?: string;
}

export interface MotionLimitDescriptor {
  readonly id: string;
  readonly unit: 'count' | 'bytes' | 'pixels' | 'operations' | 'seconds';
  readonly requested: number;
  readonly effective: number;
  readonly hardLimit: number;
  readonly binding: boolean;
}

export interface MotionStableDiagnostic {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly source:
    | 'aggregate'
    | 'replicator'
    | 'modifier'
    | 'structure'
    | 'adjustment'
    | 'media'
    | 'expression'
    | 'preset'
    | 'template';
  readonly message: string;
  readonly path?: string;
  readonly entityId?: string;
}

export interface MotionEntityRevision {
  readonly kind: string;
  readonly entityId: string;
  readonly revision: string;
}

export type MotionMutationOperationKind =
  | 'create'
  | 'update'
  | 'delete'
  | 'relink'
  | 'instantiate';

export interface MotionMutationOperation {
  readonly kind: MotionMutationOperationKind;
  readonly entity: MotionEntityRevision;
  readonly nextRevision: string;
  readonly payload: MotionJsonObject | null;
}

export interface MotionAtomicMutationBatch {
  readonly contractVersion: typeof MOTION_MUTATION_BATCH_VERSION;
  readonly batchId: string;
  readonly label: string;
  readonly atomic: true;
  readonly expectedRevisions: readonly MotionEntityRevision[];
  readonly operations: readonly MotionMutationOperation[];
  readonly history: {
    readonly mode: 'single-entry';
    readonly undoable: true;
  };
}

type UnknownRecord = Record<string, unknown>;

const FORBIDDEN_MUTATION_RUNTIME_FIELDS = new Set([
  'runtimehandle',
  'renderingcontext',
  'gputexture',
  'videoframe',
  'decoder',
  'filehandle',
  'localpath',
  'objecturl',
]);

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnumerableDataKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is UnknownRecord {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (Object.keys(descriptors).some((key) => !allowed.has(key))) return false;
  for (const key of requiredKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) return false;
  }
  return true;
}

function isStableString(value: unknown, allowEmpty = false): value is string {
  return typeof value === 'string'
    && (allowEmpty || value.length > 0)
    && !value.includes('\u0000')
    && value.length <= MOTION_SHARED_CONTRACT_LIMITS.maxStableIdLength;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function assertDenseDataArray(value: unknown, label: string, maximum: number): asserts value is unknown[] {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum
  ) {
    throw new Error(`${label} must be a bounded dense array`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => (
    typeof key === 'symbol' || (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
  ))) {
    throw new Error(`${label} cannot contain symbols or custom properties`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error(`${label} must not contain holes or accessors`);
    }
  }
}

function assertEntityRevision(value: unknown): asserts value is MotionEntityRevision {
  if (!hasExactEnumerableDataKeys(value, ['kind', 'entityId', 'revision'])) {
    throw new Error('Motion entity revisions require an exact inert envelope');
  }
  if (!isStableString(value.kind) || !isStableString(value.entityId) || !isStableString(value.revision)) {
    throw new Error('Motion entity revision identifiers must be bounded non-empty strings');
  }
}

function inspectMotionMutationPayload(value: unknown): number {
  let count = 0;
  const active = new Set<object>();
  const pending: Array<{ value: unknown; depth: number; exit?: object }> = [{
    value,
    depth: 0,
  }];
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (item.exit) {
      active.delete(item.exit);
      continue;
    }
    const current = item.value;
    count += 1;
    if (count > MOTION_SHARED_CONTRACT_LIMITS.maxMutationPayloadNodes) return count;
    if (item.depth > MOTION_SHARED_CONTRACT_LIMITS.maxMutationPayloadDepth) {
      throw new Error('Motion mutation payload exceeds its depth budget');
    }
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error('Motion mutation payload numbers must be finite');
      continue;
    }
    if (typeof current === 'string') {
      if (current.length > 65_536 || /^data:[^,]+;base64,/i.test(current)) {
        throw new Error('Motion mutation payload string or embedded binary exceeds its boundary');
      }
      continue;
    }
    if (typeof current !== 'object' || current === undefined) {
      throw new Error('Motion mutation payload accepts only JSON values');
    }
    if (active.has(current)) throw new Error('Motion mutation payload cannot contain cycles');
    active.add(current);
    pending.push({ value: null, depth: item.depth, exit: current });
    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) {
        throw new Error('Motion mutation payload arrays require the standard Array prototype');
      }
      if (Object.getOwnPropertySymbols(current).length > 0) {
        throw new Error('Motion mutation payload arrays cannot contain symbols');
      }
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => (
        typeof key === 'symbol' || (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
      ))) {
        throw new Error('Motion mutation payload arrays cannot contain custom properties');
      }
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new Error('Motion mutation payload arrays must be dense data arrays');
        }
        pending.push({ value: descriptor.value, depth: item.depth + 1 });
      }
      continue;
    }
    if (!isPlainRecord(current) || Object.getOwnPropertySymbols(current).length > 0) {
      throw new Error('Motion mutation payload objects must be plain symbol-free data');
    }
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new Error('Motion mutation payload objects cannot contain accessors');
      }
      if (FORBIDDEN_MUTATION_RUNTIME_FIELDS.has(key.toLowerCase())) {
        throw new Error('Motion mutation payload cannot contain runtime-only fields');
      }
      pending.push({ value: descriptor.value, depth: item.depth + 1 });
    }
  }
  return count;
}

export function assertMotionCapabilityDescriptor(
  value: unknown,
): asserts value is MotionCapabilityDescriptor {
  if (!hasExactEnumerableDataKeys(value, ['id', 'supported', 'source'], ['numericLimit', 'detail'])) {
    throw new Error('Motion capability descriptors require an exact inert envelope');
  }
  if (
    !isStableString(value.id)
    || typeof value.supported !== 'boolean'
    || !['contract', 'project', 'device', 'render-target'].includes(String(value.source))
    || (value.numericLimit !== undefined && !isFiniteNonNegative(value.numericLimit))
    || (value.detail !== undefined && !isStableString(value.detail, true))
  ) {
    throw new Error('Motion capability descriptor values are invalid');
  }
}

export function assertMotionLimitDescriptor(value: unknown): asserts value is MotionLimitDescriptor {
  if (!hasExactEnumerableDataKeys(value, [
    'id',
    'unit',
    'requested',
    'effective',
    'hardLimit',
    'binding',
  ])) {
    throw new Error('Motion limit descriptors require an exact inert envelope');
  }
  if (
    !isStableString(value.id)
    || !['count', 'bytes', 'pixels', 'operations', 'seconds'].includes(String(value.unit))
    || !isFiniteNonNegative(value.requested)
    || !isFiniteNonNegative(value.effective)
    || !isFiniteNonNegative(value.hardLimit)
    || value.effective > value.requested
    || value.effective > value.hardLimit
    || typeof value.binding !== 'boolean'
    || value.binding !== (value.effective < value.requested)
  ) {
    throw new Error('Motion limit descriptor values are invalid');
  }
}

export function assertMotionStableDiagnostic(
  value: unknown,
): asserts value is MotionStableDiagnostic {
  if (!hasExactEnumerableDataKeys(
    value,
    ['code', 'severity', 'source', 'message'],
    ['path', 'entityId'],
  )) {
    throw new Error('Motion diagnostics require an exact inert envelope');
  }
  if (
    !isStableString(value.code)
    || !['info', 'warning', 'error'].includes(String(value.severity))
    || ![
      'aggregate',
      'replicator',
      'modifier',
      'structure',
      'adjustment',
      'media',
      'expression',
      'preset',
      'template',
    ].includes(String(value.source))
    || typeof value.message !== 'string'
    || value.message.length === 0
    || value.message.length > MOTION_SHARED_CONTRACT_LIMITS.maxDiagnosticMessageLength
    || (value.path !== undefined && !isStableString(value.path))
    || (value.entityId !== undefined && !isStableString(value.entityId))
  ) {
    throw new Error('Motion diagnostic values are invalid');
  }
}

export function assertMotionAtomicMutationBatch(
  value: unknown,
): asserts value is MotionAtomicMutationBatch {
  if (!hasExactEnumerableDataKeys(value, [
    'contractVersion',
    'batchId',
    'label',
    'atomic',
    'expectedRevisions',
    'operations',
    'history',
  ])) {
    throw new Error('Motion mutation batches require an exact inert envelope');
  }
  assertDenseDataArray(
    value.expectedRevisions,
    'Motion expected revisions',
    MOTION_SHARED_CONTRACT_LIMITS.maxEntityRevisions,
  );
  assertDenseDataArray(
    value.operations,
    'Motion mutation operations',
    MOTION_SHARED_CONTRACT_LIMITS.maxMutationOperations,
  );
  if (!hasExactEnumerableDataKeys(value.history, ['mode', 'undoable'])) {
    throw new Error('Motion mutation history requires an exact inert envelope');
  }
  if (
    value.contractVersion !== MOTION_MUTATION_BATCH_VERSION
    || !isStableString(value.batchId)
    || !isStableString(value.label)
    || value.atomic !== true
    || value.history.mode !== 'single-entry'
    || value.history.undoable !== true
    || value.operations.length === 0
  ) {
    throw new Error('Motion mutation batch values are invalid');
  }

  const expectedKeys = new Set<string>();
  const expectedRevisionsByKey = new Map<string, string>();
  for (const revision of value.expectedRevisions) {
    assertEntityRevision(revision);
    const key = `${revision.kind}\u0000${revision.entityId}`;
    if (expectedKeys.has(key)) throw new Error('Motion expected revisions must be unique');
    expectedKeys.add(key);
    expectedRevisionsByKey.set(key, revision.revision);
  }

  const operationKeys = new Set<string>();
  let totalPayloadNodes = 0;
  for (const operation of value.operations) {
    if (!hasExactEnumerableDataKeys(operation, ['kind', 'entity', 'nextRevision', 'payload'])) {
      throw new Error('Motion mutation operations require an exact inert envelope');
    }
    assertEntityRevision(operation.entity);
    if (
      !['create', 'update', 'delete', 'relink', 'instantiate'].includes(String(operation.kind))
      || !isStableString(operation.nextRevision)
      || operation.nextRevision === operation.entity.revision
    ) {
      throw new Error('Motion mutation operation values are invalid');
    }
    if (operation.payload !== null && !isPlainRecord(operation.payload)) {
      throw new Error('Motion mutation payload must be bounded runtime-free JSON');
    }
    const expectedKey = `${operation.entity.kind}\u0000${operation.entity.entityId}`;
    if (operationKeys.has(expectedKey)) {
      throw new Error('Motion mutation batches allow only one operation per entity');
    }
    operationKeys.add(expectedKey);
    if (
      operation.kind !== 'create'
      && expectedRevisionsByKey.get(expectedKey) !== operation.entity.revision
    ) {
      throw new Error('Motion mutations require the exact expected revision for existing entities');
    }
    totalPayloadNodes += inspectMotionMutationPayload(operation.payload);
    if (totalPayloadNodes > MOTION_SHARED_CONTRACT_LIMITS.maxMutationPayloadNodes) {
      throw new Error('Motion mutation batch exceeds its aggregate payload budget');
    }
  }
}

export function createMotionAtomicMutationBatch(
  value: MotionAtomicMutationBatch,
): MotionAtomicMutationBatch {
  assertMotionAtomicMutationBatch(value);
  return cloneMotionJsonValue(value as unknown as MotionJsonObject) as unknown as MotionAtomicMutationBatch;
}
