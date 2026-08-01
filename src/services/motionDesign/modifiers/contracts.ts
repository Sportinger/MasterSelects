import type { ReplicatorVector2 } from '../replicator/contracts';

export const MOTION_MODIFIER_CONTRACT_ID = 'masterselects.motion-modifier-stack' as const;
export const MOTION_MODIFIER_CONTRACT_VERSION = 1 as const;

export const MOTION_MODIFIER_MAX_MODIFIERS = 16;
export const MOTION_MODIFIER_MAX_TARGETS_PER_MODIFIER = 6;
export const MOTION_MODIFIER_MAX_TOTAL_TARGETS = 64;
export const MOTION_MODIFIER_MAX_INSTANCES = 100_000;
export const MOTION_MODIFIER_MAX_WORK_ITEMS = 1_000_000;
export const MOTION_MODIFIER_MAX_ABS_AMOUNT = 10_000;
export const MOTION_MODIFIER_MAX_TICKS_PER_SECOND = 1_000_000;

export const MOTION_MODIFIER_TARGET_PATHS = [
  'replicator.offset.position.x',
  'replicator.offset.position.y',
  'replicator.offset.rotation',
  'replicator.offset.scale.x',
  'replicator.offset.scale.y',
  'replicator.offset.opacity',
] as const;

export type MotionModifierTargetPath = typeof MOTION_MODIFIER_TARGET_PATHS[number];
export type MotionModifierCombineOperation = 'add' | 'multiply';

export interface MotionModifierTarget {
  path: MotionModifierTargetPath;
  operation: MotionModifierCombineOperation;
  amount: number;
}

interface MotionModifierBase {
  id: string;
  /** Must equal this modifier's zero-based array position. */
  order: number;
  enabled: boolean;
  targets: MotionModifierTarget[];
}

export interface RandomMotionModifier extends MotionModifierBase {
  kind: 'random';
  /** Uint32 seed mixed with id, target path, stable index, and requested count. */
  seed: number;
  distribution: 'uniform-signed';
}

export interface NoiseMotionModifier extends MotionModifierBase {
  kind: 'noise';
  /** Seeds smoothstep-interpolated 2D value-noise lattice corners. */
  seed: number;
  /** Frequency over normalized zero-based requested instance index. */
  indexFrequency: number;
  timeFrequencyHz: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
}

export interface OscillatorMotionModifier extends MotionModifierBase {
  kind: 'oscillator';
  waveform: 'sine' | 'triangle' | 'square';
  /** Samples persisted quantized time; instance phase uses normalized requested index. */
  frequencyHz: number;
  cyclesAcrossInstances: number;
  phaseDegrees: number;
}

export interface FieldMotionModifier extends MotionModifierBase {
  kind: 'field';
  field: 'radial-distance';
  center: ReplicatorVector2;
  radius: number;
  /** Sample is pow(clamp(1 - distance/radius, 0, 1), exponent). */
  exponent: number;
}

export type MotionModifier =
  | RandomMotionModifier
  | NoiseMotionModifier
  | OscillatorMotionModifier
  | FieldMotionModifier;

export interface MotionModifierFalloff {
  shapeClipId: string;
  shapeRevision: number;
  /**
   * Normalized outward feather distance. Weight is 1 inside; outside it is
   * clamp((1 + feather - normalizedDistance) / feather). Zero is a hard edge.
   */
  feather: number;
  /** Replaces the normalized weight with 1 - weight. */
  invert: boolean;
  /** When true, a final zero weight marks the instance clipped. */
  clip: boolean;
}

export interface MotionModifierStackContractV1 {
  contract: typeof MOTION_MODIFIER_CONTRACT_ID;
  version: typeof MOTION_MODIFIER_CONTRACT_VERSION;
  revision: number;
  /** MD4 samples only clip-local timeline time in V1. */
  timeBasis: 'clip-local-seconds';
  /** All temporal modifiers sample time rounded to this persisted tick grid. */
  ticksPerSecond: number;
  /** Evaluation order is this array order and is mirrored by each `order`. */
  modifiers: MotionModifier[];
  falloff?: MotionModifierFalloff;
}

export type MotionModifierDiagnosticCode =
  | 'MOTION_MODIFIER_INVALID_CONTRACT'
  | 'MOTION_MODIFIER_UNKNOWN_FIELD'
  | 'MOTION_MODIFIER_NON_FINITE_VALUE'
  | 'MOTION_MODIFIER_INVALID_ID'
  | 'MOTION_MODIFIER_DUPLICATE_ID'
  | 'MOTION_MODIFIER_INVALID_ORDER'
  | 'MOTION_MODIFIER_INVALID_TARGET'
  | 'MOTION_MODIFIER_DUPLICATE_TARGET'
  | 'MOTION_MODIFIER_MODIFIER_BUDGET_EXCEEDED'
  | 'MOTION_MODIFIER_TARGET_BUDGET_EXCEEDED'
  | 'MOTION_MODIFIER_INSTANCE_BUDGET_EXCEEDED'
  | 'MOTION_MODIFIER_WORK_BUDGET_EXCEEDED'
  | 'MOTION_MODIFIER_INVALID_INDEX'
  | 'MOTION_MODIFIER_INVALID_TIME'
  | 'MOTION_MODIFIER_MISSING_BASE_VALUE'
  | 'MOTION_MODIFIER_DUPLICATE_BASE_VALUE'
  | 'MOTION_MODIFIER_MISSING_FALLOFF_REFERENCE'
  | 'MOTION_MODIFIER_STALE_FALLOFF_REFERENCE'
  | 'MOTION_MODIFIER_DUPLICATE_FALLOFF_REFERENCE';

export interface MotionModifierDiagnostic {
  code: MotionModifierDiagnosticCode;
  severity: 'error';
  message: string;
  path?: string;
  limit?: number;
  actual?: number;
}

export class MotionModifierContractError extends Error {
  readonly code: MotionModifierDiagnosticCode;
  readonly path?: string;
  readonly limit?: number;
  readonly actual?: number;

  constructor(
    code: MotionModifierDiagnosticCode,
    message: string,
    options: { path?: string; limit?: number; actual?: number } = {},
  ) {
    super(message);
    this.name = 'MotionModifierContractError';
    this.code = code;
    this.path = options.path;
    this.limit = options.limit;
    this.actual = options.actual;
  }
}

type UnknownRecord = Record<string, unknown>;

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `${path} must be a plain JSON object`,
      { path },
    );
  }
  return value as UnknownRecord;
}

function assertExactKeys(record: UnknownRecord, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string' || !allowedSet.has(key)) {
      const printable = typeof key === 'string' ? key : String(key);
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_UNKNOWN_FIELD',
        `${path}.${printable} is not part of the persisted contract`,
        { path: `${path}.${printable}` },
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_UNKNOWN_FIELD',
        `${path}.${key} must be an enumerable plain JSON data property`,
        { path: `${path}.${key}` },
      );
    }
  }
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `${path} must be an array`,
      { path },
    );
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `${path} must use the plain Array prototype`,
      { path },
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_UNKNOWN_FIELD',
        `${path}.${String(key)} is not JSON array data`,
        { path: `${path}.${String(key)}` },
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_UNKNOWN_FIELD',
        `${path}.${key} must be an enumerable plain JSON array value`,
        { path: `${path}.${key}` },
      );
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_INVALID_CONTRACT',
        `${path} must not contain sparse entries`,
        { path: `${path}[${index}]` },
      );
    }
  }
  return value;
}

function requireFinite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_NON_FINITE_VALUE',
      `${path} must be a finite number`,
      { path },
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function requireSafeInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const finite = requireFinite(value, path);
  if (!Number.isSafeInteger(finite) || finite < minimum || finite > maximum) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `${path} must be a safe integer in ${minimum}..${maximum}`,
      { path },
    );
  }
  return finite;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `${path} must be a boolean`,
      { path },
    );
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `${path} must be a string`,
      { path },
    );
  }
  return value;
}

function requireId(value: unknown, path: string): string {
  const id = requireString(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_ID',
      `${path} must be 1..128 stable id characters`,
      { path },
    );
  }
  return id;
}

function requireVector(value: unknown, path: string): ReplicatorVector2 {
  const record = requireRecord(value, path);
  assertExactKeys(record, ['x', 'y'], path);
  return {
    x: requireFinite(record.x, `${path}.x`),
    y: requireFinite(record.y, `${path}.y`),
  };
}

function requireRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  const finite = requireFinite(value, path);
  if (finite < minimum || finite > maximum) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `${path} must be in ${minimum}..${maximum}`,
      { path },
    );
  }
  return finite;
}

function readTarget(value: unknown, path: string): MotionModifierTarget {
  const target = requireRecord(value, path);
  assertExactKeys(target, ['path', 'operation', 'amount'], path);
  if (!MOTION_MODIFIER_TARGET_PATHS.includes(target.path as MotionModifierTargetPath)) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_TARGET',
      `${path}.path is not a numeric Motion Replicator registry path`,
      { path: `${path}.path` },
    );
  }
  if (target.operation !== 'add' && target.operation !== 'multiply') {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_TARGET',
      `${path}.operation must be add or multiply`,
      { path: `${path}.operation` },
    );
  }
  return {
    path: target.path as MotionModifierTargetPath,
    operation: target.operation,
    amount: requireRange(
      target.amount,
      `${path}.amount`,
      -MOTION_MODIFIER_MAX_ABS_AMOUNT,
      MOTION_MODIFIER_MAX_ABS_AMOUNT,
    ),
  };
}

function readTargets(value: unknown, path: string): MotionModifierTarget[] {
  const targetValues = requireArray(value, path);
  if (targetValues.length < 1) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_TARGET',
      `${path} must contain at least one target`,
      { path },
    );
  }
  if (targetValues.length > MOTION_MODIFIER_MAX_TARGETS_PER_MODIFIER) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_TARGET_BUDGET_EXCEEDED',
      `${path} exceeds the per-modifier target budget`,
      { path, limit: MOTION_MODIFIER_MAX_TARGETS_PER_MODIFIER, actual: targetValues.length },
    );
  }
  const targets = targetValues.map((target, index) => readTarget(target, `${path}[${index}]`));
  const paths = new Set<MotionModifierTargetPath>();
  for (const target of targets) {
    if (paths.has(target.path)) {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_DUPLICATE_TARGET',
        `${path} contains duplicate path ${target.path}`,
        { path },
      );
    }
    paths.add(target.path);
  }
  return targets;
}

function readCommonModifier(
  modifier: UnknownRecord,
  index: number,
): Pick<MotionModifierBase, 'id' | 'order' | 'enabled' | 'targets'> {
  const path = `modifiers[${index}]`;
  const order = requireSafeInteger(modifier.order, `${path}.order`, 0);
  if (order !== index) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_ORDER',
      `${path}.order must equal its array index ${index}`,
      { path: `${path}.order` },
    );
  }
  return {
    id: requireId(modifier.id, `${path}.id`),
    order,
    enabled: requireBoolean(modifier.enabled, `${path}.enabled`),
    targets: readTargets(modifier.targets, `${path}.targets`),
  };
}

function readModifier(value: unknown, index: number): MotionModifier {
  const path = `modifiers[${index}]`;
  const modifier = requireRecord(value, path);
  assertExactKeys(
    modifier,
    [
      'id', 'order', 'enabled', 'kind', 'targets', 'seed', 'distribution',
      'indexFrequency', 'timeFrequencyHz', 'octaves', 'lacunarity', 'persistence',
      'waveform', 'frequencyHz', 'cyclesAcrossInstances', 'phaseDegrees',
      'field', 'center', 'radius', 'exponent',
    ],
    path,
  );

  if (modifier.kind === 'random') {
    assertExactKeys(
      modifier,
      ['id', 'order', 'enabled', 'kind', 'targets', 'seed', 'distribution'],
      path,
    );
    const common = readCommonModifier(modifier, index);
    if (modifier.distribution !== 'uniform-signed') {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_INVALID_CONTRACT',
        `${path}.distribution must be uniform-signed`,
        { path: `${path}.distribution` },
      );
    }
    return {
      ...common,
      kind: 'random',
      seed: requireSafeInteger(modifier.seed, `${path}.seed`, 0, 0xffff_ffff),
      distribution: modifier.distribution,
    };
  }

  if (modifier.kind === 'noise') {
    assertExactKeys(
      modifier,
      [
        'id', 'order', 'enabled', 'kind', 'targets', 'seed', 'indexFrequency',
        'timeFrequencyHz', 'octaves', 'lacunarity', 'persistence',
      ],
      path,
    );
    const common = readCommonModifier(modifier, index);
    return {
      ...common,
      kind: 'noise',
      seed: requireSafeInteger(modifier.seed, `${path}.seed`, 0, 0xffff_ffff),
      indexFrequency: requireRange(modifier.indexFrequency, `${path}.indexFrequency`, 0, 1_000),
      timeFrequencyHz: requireRange(
        modifier.timeFrequencyHz,
        `${path}.timeFrequencyHz`,
        0,
        1_000,
      ),
      octaves: requireSafeInteger(modifier.octaves, `${path}.octaves`, 1, 8),
      lacunarity: requireRange(modifier.lacunarity, `${path}.lacunarity`, 1, 8),
      persistence: requireRange(modifier.persistence, `${path}.persistence`, 0, 1),
    };
  }

  if (modifier.kind === 'oscillator') {
    assertExactKeys(
      modifier,
      [
        'id', 'order', 'enabled', 'kind', 'targets', 'waveform', 'frequencyHz',
        'cyclesAcrossInstances', 'phaseDegrees',
      ],
      path,
    );
    const common = readCommonModifier(modifier, index);
    if (
      modifier.waveform !== 'sine'
      && modifier.waveform !== 'triangle'
      && modifier.waveform !== 'square'
    ) {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_INVALID_CONTRACT',
        `${path}.waveform must be sine, triangle, or square`,
        { path: `${path}.waveform` },
      );
    }
    return {
      ...common,
      kind: 'oscillator',
      waveform: modifier.waveform,
      frequencyHz: requireRange(modifier.frequencyHz, `${path}.frequencyHz`, 0, 1_000),
      cyclesAcrossInstances: requireRange(
        modifier.cyclesAcrossInstances,
        `${path}.cyclesAcrossInstances`,
        -1_000,
        1_000,
      ),
      phaseDegrees: requireFinite(modifier.phaseDegrees, `${path}.phaseDegrees`),
    };
  }

  if (modifier.kind === 'field') {
    assertExactKeys(
      modifier,
      ['id', 'order', 'enabled', 'kind', 'targets', 'field', 'center', 'radius', 'exponent'],
      path,
    );
    const common = readCommonModifier(modifier, index);
    if (modifier.field !== 'radial-distance') {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_INVALID_CONTRACT',
        `${path}.field must be radial-distance`,
        { path: `${path}.field` },
      );
    }
    return {
      ...common,
      kind: 'field',
      field: modifier.field,
      center: requireVector(modifier.center, `${path}.center`),
      radius: requireRange(modifier.radius, `${path}.radius`, Number.MIN_VALUE, 1_000_000),
      exponent: requireRange(modifier.exponent, `${path}.exponent`, 0.01, 32),
    };
  }

  throw new MotionModifierContractError(
    'MOTION_MODIFIER_INVALID_CONTRACT',
    `${path}.kind must be random, noise, oscillator, or field`,
    { path: `${path}.kind` },
  );
}

function readFalloff(value: unknown): MotionModifierFalloff {
  const falloff = requireRecord(value, 'falloff');
  assertExactKeys(
    falloff,
    ['shapeClipId', 'shapeRevision', 'feather', 'invert', 'clip'],
    'falloff',
  );
  return {
    shapeClipId: requireId(falloff.shapeClipId, 'falloff.shapeClipId'),
    shapeRevision: requireSafeInteger(falloff.shapeRevision, 'falloff.shapeRevision', 0),
    feather: requireRange(falloff.feather, 'falloff.feather', 0, 10),
    invert: requireBoolean(falloff.invert, 'falloff.invert'),
    clip: requireBoolean(falloff.clip, 'falloff.clip'),
  };
}

export function parseMotionModifierStackContract(value: unknown): MotionModifierStackContractV1 {
  const contract = requireRecord(value, 'modifierStack');
  assertExactKeys(
    contract,
    ['contract', 'version', 'revision', 'timeBasis', 'ticksPerSecond', 'modifiers', 'falloff'],
    'modifierStack',
  );
  if (contract.contract !== MOTION_MODIFIER_CONTRACT_ID) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `modifierStack.contract must equal ${MOTION_MODIFIER_CONTRACT_ID}`,
      { path: 'modifierStack.contract' },
    );
  }
  if (contract.version !== MOTION_MODIFIER_CONTRACT_VERSION) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `modifierStack.version must equal ${MOTION_MODIFIER_CONTRACT_VERSION}`,
      { path: 'modifierStack.version' },
    );
  }
  if (contract.timeBasis !== 'clip-local-seconds') {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      'modifierStack.timeBasis must be clip-local-seconds in V1',
      { path: 'modifierStack.timeBasis' },
    );
  }
  const modifierValues = requireArray(contract.modifiers, 'modifierStack.modifiers');
  if (modifierValues.length > MOTION_MODIFIER_MAX_MODIFIERS) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_MODIFIER_BUDGET_EXCEEDED',
      'modifierStack.modifiers exceeds its hard budget',
      {
        path: 'modifierStack.modifiers',
        limit: MOTION_MODIFIER_MAX_MODIFIERS,
        actual: modifierValues.length,
      },
    );
  }

  const modifiers = modifierValues.map(readModifier);
  const ids = new Set<string>();
  let totalTargets = 0;
  for (const modifier of modifiers) {
    if (ids.has(modifier.id)) {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_DUPLICATE_ID',
        `Duplicate modifier id ${modifier.id}`,
        { path: 'modifierStack.modifiers' },
      );
    }
    ids.add(modifier.id);
    totalTargets += modifier.targets.length;
  }
  if (totalTargets > MOTION_MODIFIER_MAX_TOTAL_TARGETS) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_TARGET_BUDGET_EXCEEDED',
      'modifierStack exceeds its total target budget',
      {
        path: 'modifierStack.modifiers',
        limit: MOTION_MODIFIER_MAX_TOTAL_TARGETS,
        actual: totalTargets,
      },
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(contract, 'falloff')
    && contract.falloff === undefined
  ) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      'modifierStack.falloff must be omitted rather than undefined',
      { path: 'modifierStack.falloff' },
    );
  }

  return {
    contract: MOTION_MODIFIER_CONTRACT_ID,
    version: MOTION_MODIFIER_CONTRACT_VERSION,
    revision: requireSafeInteger(contract.revision, 'modifierStack.revision', 0),
    timeBasis: contract.timeBasis,
    ticksPerSecond: requireSafeInteger(
      contract.ticksPerSecond,
      'modifierStack.ticksPerSecond',
      1,
      MOTION_MODIFIER_MAX_TICKS_PER_SECOND,
    ),
    modifiers,
    ...(contract.falloff === undefined ? {} : { falloff: readFalloff(contract.falloff) }),
  };
}
