import {
  MotionReplicatorContractError,
  migrateLegacyMotionReplicatorDefinition,
  type MotionReplicatorContractV2,
} from './contracts';
import {
  MOTION_MODIFIER_CONTRACT_ID,
  MOTION_MODIFIER_CONTRACT_VERSION,
  MOTION_MODIFIER_MAX_MODIFIERS,
  MOTION_MODIFIER_MAX_TARGETS_PER_MODIFIER,
  MOTION_MODIFIER_MAX_TOTAL_TARGETS,
  MotionModifierContractError,
  parseMotionModifierStackContract,
  type MotionModifier,
  type MotionModifierCombineOperation,
  type MotionModifierStackContractV1,
  type MotionModifierTargetPath,
} from '../modifiers/contracts';

export const MOTION_LEGACY_BUNDLE_REPLICATOR_REVISION = 0;
export const MOTION_LEGACY_BUNDLE_MODIFIER_REVISION = 0;
export const MOTION_LEGACY_BUNDLE_TICKS_PER_SECOND = 1_000;
export const MOTION_LEGACY_BUNDLE_FALLOFF_SHAPE_REVISION = 0;
export const MOTION_LEGACY_BUNDLE_MAX_NODES = 4_096;
export const MOTION_LEGACY_BUNDLE_MAX_DEPTH = 32;
export const MOTION_LEGACY_BUNDLE_MAX_STRING_LENGTH = 4_096;

export type MotionLegacyBundleDiagnosticCode =
  | 'MOTION_LEGACY_BUNDLE_INVALID_DATA'
  | 'MOTION_LEGACY_BUNDLE_UNSUPPORTED_DISTRIBUTION'
  | 'MOTION_LEGACY_BUNDLE_UNSUPPORTED_MODIFIER_PARAMS'
  | 'MOTION_LEGACY_BUNDLE_MISSING_SEED'
  | 'MOTION_LEGACY_BUNDLE_BUDGET_EXCEEDED'
  | 'MOTION_LEGACY_BUNDLE_CONTRACT_REJECTED';

export interface MotionLegacyBundleDiagnostic {
  code: MotionLegacyBundleDiagnosticCode;
  severity: 'error';
  message: string;
  path?: string;
}

export interface SuccessfulMotionLegacyBundleMigration {
  ok: true;
  replicator: MotionReplicatorContractV2;
  modifierStack: MotionModifierStackContractV1;
  diagnostics: [];
}

export interface FailedMotionLegacyBundleMigration {
  ok: false;
  replicator: null;
  modifierStack: null;
  diagnostics: MotionLegacyBundleDiagnostic[];
}

export type MotionLegacyBundleMigration =
  | SuccessfulMotionLegacyBundleMigration
  | FailedMotionLegacyBundleMigration;

class MotionLegacyBundleError extends Error {
  readonly code: MotionLegacyBundleDiagnosticCode;
  readonly path?: string;

  constructor(code: MotionLegacyBundleDiagnosticCode, message: string, path?: string) {
    super(message);
    this.name = 'MotionLegacyBundleError';
    this.code = code;
    this.path = path;
  }
}

type UnknownRecord = Record<string, unknown>;

interface JsonPreflightEntry {
  value: unknown;
  path: string;
  depth: number;
}

function budgetExceeded(message: string, path: string): never {
  throw new MotionLegacyBundleError(
    'MOTION_LEGACY_BUNDLE_BUDGET_EXCEEDED',
    message,
    path,
  );
}

/** Iterative total preflight; no user-shaped recursion occurs before migration. */
function assertJsonData(value: unknown, path: string): void {
  const pending: JsonPreflightEntry[] = [{ value, path, depth: 0 }];
  const seen = new Set<object>();
  let nodeCount = 0;

  while (pending.length > 0) {
    const current = pending.pop() as JsonPreflightEntry;
    nodeCount += 1;
    if (nodeCount > MOTION_LEGACY_BUNDLE_MAX_NODES) {
      budgetExceeded(
        `Legacy bundle exceeds ${MOTION_LEGACY_BUNDLE_MAX_NODES} total nodes`,
        current.path,
      );
    }
    if (current.depth > MOTION_LEGACY_BUNDLE_MAX_DEPTH) {
      budgetExceeded(
        `Legacy bundle exceeds maximum depth ${MOTION_LEGACY_BUNDLE_MAX_DEPTH}`,
        current.path,
      );
    }

    const currentType = typeof current.value;
    if (current.value === null || currentType === 'boolean') continue;
    if (currentType === 'string') {
      if ((current.value as string).length > MOTION_LEGACY_BUNDLE_MAX_STRING_LENGTH) {
        budgetExceeded(
          `String exceeds ${MOTION_LEGACY_BUNDLE_MAX_STRING_LENGTH} characters`,
          current.path,
        );
      }
      continue;
    }
    if (currentType === 'number') {
      if (!Number.isFinite(current.value)) {
        throw new MotionLegacyBundleError(
          'MOTION_LEGACY_BUNDLE_INVALID_DATA',
          `${current.path} must be finite`,
          current.path,
        );
      }
      continue;
    }
    if (currentType !== 'object') {
      throw new MotionLegacyBundleError(
        'MOTION_LEGACY_BUNDLE_INVALID_DATA',
        `${current.path} must contain only JSON data`,
        current.path,
      );
    }

    const objectValue = current.value as object;
    if (seen.has(objectValue)) {
      throw new MotionLegacyBundleError(
        'MOTION_LEGACY_BUNDLE_INVALID_DATA',
        `${current.path} must not contain cycles or shared object references`,
        current.path,
      );
    }
    seen.add(objectValue);

    if (Array.isArray(current.value)) {
      if (Object.getPrototypeOf(current.value) !== Array.prototype) {
        throw new MotionLegacyBundleError(
          'MOTION_LEGACY_BUNDLE_INVALID_DATA',
          `${current.path} must use the plain Array prototype`,
          current.path,
        );
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(current.value, 'length');
      const length = lengthDescriptor?.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new MotionLegacyBundleError(
          'MOTION_LEGACY_BUNDLE_INVALID_DATA',
          `${current.path}.length must be a safe array length`,
          `${current.path}.length`,
        );
      }
      if (length > MOTION_LEGACY_BUNDLE_MAX_NODES - nodeCount) {
        budgetExceeded(
          `Array cannot fit within ${MOTION_LEGACY_BUNDLE_MAX_NODES} total nodes`,
          current.path,
        );
      }
      const keys = Reflect.ownKeys(current.value);
      const present = new Set<number>();
      for (const key of keys) {
        if (key === 'length') continue;
        if (
          typeof key !== 'string'
          || !/^(0|[1-9][0-9]*)$/.test(key)
          || Number(key) >= length
        ) {
          throw new MotionLegacyBundleError(
            'MOTION_LEGACY_BUNDLE_INVALID_DATA',
            `${current.path}.${String(key)} is not JSON array data`,
            current.path,
          );
        }
        const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
        if (
          !descriptor
          || descriptor.enumerable !== true
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ) {
          throw new MotionLegacyBundleError(
            'MOTION_LEGACY_BUNDLE_INVALID_DATA',
            `${current.path}[${key}] must be an enumerable data property`,
            `${current.path}[${key}]`,
          );
        }
        present.add(Number(key));
        pending.push({
          value: descriptor.value,
          path: `${current.path}[${key}]`,
          depth: current.depth + 1,
        });
      }
      for (let index = 0; index < length; index += 1) {
        if (!present.has(index)) {
          throw new MotionLegacyBundleError(
            'MOTION_LEGACY_BUNDLE_INVALID_DATA',
            `${current.path} must not contain sparse entries`,
            `${current.path}[${index}]`,
          );
        }
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(objectValue);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new MotionLegacyBundleError(
        'MOTION_LEGACY_BUNDLE_INVALID_DATA',
        `${current.path} must be a plain JSON object`,
        current.path,
      );
    }
    const keys = Reflect.ownKeys(objectValue);
    if (keys.length > MOTION_LEGACY_BUNDLE_MAX_NODES - nodeCount) {
      budgetExceeded(
        `Object cannot fit within ${MOTION_LEGACY_BUNDLE_MAX_NODES} total nodes`,
        current.path,
      );
    }
    for (const key of keys) {
      if (typeof key !== 'string') {
        throw new MotionLegacyBundleError(
          'MOTION_LEGACY_BUNDLE_INVALID_DATA',
          `${current.path} must not contain symbol keys`,
          current.path,
        );
      }
      if (key.length > MOTION_LEGACY_BUNDLE_MAX_STRING_LENGTH) {
        budgetExceeded(
          `Property name exceeds ${MOTION_LEGACY_BUNDLE_MAX_STRING_LENGTH} characters`,
          current.path,
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        throw new MotionLegacyBundleError(
          'MOTION_LEGACY_BUNDLE_INVALID_DATA',
          `${current.path}.${key} must be an enumerable data property`,
          `${current.path}.${key}`,
        );
      }
      pending.push({
        value: descriptor.value,
        path: `${current.path}.${key}`,
        depth: current.depth + 1,
      });
    }
  }
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new MotionLegacyBundleError(
      'MOTION_LEGACY_BUNDLE_INVALID_DATA',
      `${path} must be a plain object`,
      path,
    );
  }
  return value as UnknownRecord;
}

function requirePlainArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new MotionLegacyBundleError(
      'MOTION_LEGACY_BUNDLE_INVALID_DATA',
      `${path} must use the plain Array prototype`,
      path,
    );
  }
  return value;
}

function assertExactKeys(record: UnknownRecord, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string' || !allowedSet.has(key)) {
      throw new MotionLegacyBundleError(
        'MOTION_LEGACY_BUNDLE_INVALID_DATA',
        `${path}.${String(key)} is not supported`,
        `${path}.${String(key)}`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      throw new MotionLegacyBundleError(
        'MOTION_LEGACY_BUNDLE_INVALID_DATA',
        `${path}.${key} must be an enumerable data property`,
        `${path}.${key}`,
      );
    }
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new MotionLegacyBundleError(
      'MOTION_LEGACY_BUNDLE_INVALID_DATA',
      `${path} must be a string`,
      path,
    );
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new MotionLegacyBundleError(
      'MOTION_LEGACY_BUNDLE_INVALID_DATA',
      `${path} must be a boolean`,
      path,
    );
  }
  return value;
}

function requireFinite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MotionLegacyBundleError(
      'MOTION_LEGACY_BUNDLE_INVALID_DATA',
      `${path} must be finite`,
      path,
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function requireSafeInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  const finite = requireFinite(value, path);
  if (!Number.isSafeInteger(finite) || finite < minimum || finite > maximum) {
    throw new MotionLegacyBundleError(
      'MOTION_LEGACY_BUNDLE_INVALID_DATA',
      `${path} must be a safe integer in ${minimum}..${maximum}`,
      path,
    );
  }
  return finite;
}

function requireOperation(value: unknown, path: string): MotionModifierCombineOperation {
  if (value !== 'add' && value !== 'multiply') {
    throw new MotionLegacyBundleError(
      'MOTION_LEGACY_BUNDLE_UNSUPPORTED_MODIFIER_PARAMS',
      `${path} must be add or multiply`,
      path,
    );
  }
  return value;
}

function requireTargetPaths(value: unknown, path: string): MotionModifierTargetPath[] {
  const targets = requirePlainArray(value, path);
  if (targets.length < 1) {
    throw new MotionLegacyBundleError(
      'MOTION_LEGACY_BUNDLE_INVALID_DATA',
      `${path} must be a non-empty array`,
      path,
    );
  }
  return targets.map((target, index) => requireString(
    target,
    `${path}[${index}]`,
  ) as MotionModifierTargetPath);
}

function assertLegacyModifierBudgets(value: unknown): unknown[] {
  const modifiers = requirePlainArray(value, 'replicator.modifiers');
  if (modifiers.length > MOTION_MODIFIER_MAX_MODIFIERS) {
    budgetExceeded(
      `replicator.modifiers exceeds the limit of ${MOTION_MODIFIER_MAX_MODIFIERS}`,
      'replicator.modifiers',
    );
  }

  let totalTargets = 0;
  for (let index = 0; index < modifiers.length; index += 1) {
    const path = `replicator.modifiers[${index}]`;
    const modifier = requireRecord(modifiers[index], path);
    const targets = requirePlainArray(modifier.targetProperties, `${path}.targetProperties`);
    if (targets.length > MOTION_MODIFIER_MAX_TARGETS_PER_MODIFIER) {
      budgetExceeded(
        `${path}.targetProperties exceeds the limit of ${MOTION_MODIFIER_MAX_TARGETS_PER_MODIFIER}`,
        `${path}.targetProperties`,
      );
    }
    totalTargets += targets.length;
    if (totalTargets > MOTION_MODIFIER_MAX_TOTAL_TARGETS) {
      budgetExceeded(
        `Legacy modifier targets exceed the total limit of ${MOTION_MODIFIER_MAX_TOTAL_TARGETS}`,
        'replicator.modifiers',
      );
    }
  }
  return modifiers;
}

interface DistributionState {
  seed?: number;
  seedConsumed: boolean;
}

function assertLegacyReplicatorCoreShape(legacy: UnknownRecord): void {
  const layout = requireRecord(legacy.layout, 'replicator.layout');
  if (layout.mode === 'grid') {
    assertExactKeys(
      layout,
      ['mode', 'count', 'spacing', 'patternOffset'],
      'replicator.layout',
    );
    assertExactKeys(
      requireRecord(layout.count, 'replicator.layout.count'),
      ['x', 'y'],
      'replicator.layout.count',
    );
    assertExactKeys(
      requireRecord(layout.spacing, 'replicator.layout.spacing'),
      ['x', 'y'],
      'replicator.layout.spacing',
    );
    if (layout.patternOffset !== undefined) {
      assertExactKeys(
        requireRecord(layout.patternOffset, 'replicator.layout.patternOffset'),
        ['x', 'y'],
        'replicator.layout.patternOffset',
      );
    }
  } else if (layout.mode === 'linear') {
    assertExactKeys(
      layout,
      ['mode', 'count', 'spacing', 'direction'],
      'replicator.layout',
    );
    assertExactKeys(
      requireRecord(layout.direction, 'replicator.layout.direction'),
      ['x', 'y'],
      'replicator.layout.direction',
    );
  } else if (layout.mode === 'radial') {
    assertExactKeys(
      layout,
      ['mode', 'count', 'radius', 'startAngle', 'endAngle', 'autoOrient'],
      'replicator.layout',
    );
  } else {
    throw new MotionLegacyBundleError(
      'MOTION_LEGACY_BUNDLE_INVALID_DATA',
      'replicator.layout.mode must be grid, linear, or radial',
      'replicator.layout.mode',
    );
  }

  const offset = requireRecord(legacy.offset, 'replicator.offset');
  assertExactKeys(
    offset,
    ['position', 'rotation', 'scale', 'opacity', 'mode'],
    'replicator.offset',
  );
  for (const [value, path] of [
    [offset.position, 'replicator.offset.position'],
    [offset.scale, 'replicator.offset.scale'],
  ] as const) {
    assertExactKeys(requireRecord(value, path), ['x', 'y'], path);
  }
}

function readDistribution(value: unknown): DistributionState {
  if (value === undefined) return { seedConsumed: false };
  const distribution = requireRecord(value, 'replicator.distribution');
  assertExactKeys(distribution, ['seed', 'randomizeOrder'], 'replicator.distribution');
  if (distribution.randomizeOrder === true) {
    throw new MotionLegacyBundleError(
      'MOTION_LEGACY_BUNDLE_UNSUPPORTED_DISTRIBUTION',
      'distribution.randomizeOrder cannot preserve stable instance ordering',
      'replicator.distribution.randomizeOrder',
    );
  }
  if (distribution.randomizeOrder !== undefined) {
    requireBoolean(distribution.randomizeOrder, 'replicator.distribution.randomizeOrder');
  }
  return {
    ...(distribution.seed === undefined ? {} : {
      seed: requireSafeInteger(distribution.seed, 'replicator.distribution.seed', 0, 0xffff_ffff),
    }),
    seedConsumed: false,
  };
}

function resolveModifierSeed(
  modifier: UnknownRecord,
  path: string,
  distribution: DistributionState,
): number {
  if (modifier.seed !== undefined) {
    return requireSafeInteger(modifier.seed, `${path}.seed`, 0, 0xffff_ffff);
  }
  if (distribution.seed !== undefined) {
    distribution.seedConsumed = true;
    return distribution.seed;
  }
  throw new MotionLegacyBundleError(
    'MOTION_LEGACY_BUNDLE_MISSING_SEED',
    `${path} needs an explicit seed or distribution.seed`,
    `${path}.seed`,
  );
}

function commonTargets(
  modifier: UnknownRecord,
  params: UnknownRecord,
  path: string,
) {
  const operation = requireOperation(params.operation, `${path}.params.operation`);
  const amount = requireFinite(params.amount, `${path}.params.amount`);
  return requireTargetPaths(modifier.targetProperties, `${path}.targetProperties`).map((targetPath) => ({
    path: targetPath,
    operation,
    amount,
  }));
}

function migrateLegacyModifier(
  value: unknown,
  order: number,
  distribution: DistributionState,
): MotionModifier {
  const path = `replicator.modifiers[${order}]`;
  const modifier = requireRecord(value, path);
  assertExactKeys(
    modifier,
    ['id', 'kind', 'enabled', 'seed', 'targetProperties', 'params'],
    path,
  );
  const id = requireString(modifier.id, `${path}.id`);
  const enabled = requireBoolean(modifier.enabled, `${path}.enabled`);
  const params = requireRecord(modifier.params, `${path}.params`);

  if (modifier.kind === 'random') {
    assertExactKeys(params, ['operation', 'amount'], `${path}.params`);
    return {
      id,
      order,
      enabled,
      kind: 'random',
      seed: resolveModifierSeed(modifier, path, distribution),
      distribution: 'uniform-signed',
      targets: commonTargets(modifier, params, path),
    };
  }
  if (modifier.kind === 'noise') {
    assertExactKeys(
      params,
      [
        'operation', 'amount', 'indexFrequency', 'timeFrequencyHz', 'octaves',
        'lacunarity', 'persistence',
      ],
      `${path}.params`,
    );
    return {
      id,
      order,
      enabled,
      kind: 'noise',
      seed: resolveModifierSeed(modifier, path, distribution),
      indexFrequency: requireFinite(params.indexFrequency, `${path}.params.indexFrequency`),
      timeFrequencyHz: requireFinite(params.timeFrequencyHz, `${path}.params.timeFrequencyHz`),
      octaves: requireSafeInteger(params.octaves, `${path}.params.octaves`, 1, 8),
      lacunarity: requireFinite(params.lacunarity, `${path}.params.lacunarity`),
      persistence: requireFinite(params.persistence, `${path}.params.persistence`),
      targets: commonTargets(modifier, params, path),
    };
  }
  if (modifier.kind === 'oscillator') {
    if (modifier.seed !== undefined) {
      throw new MotionLegacyBundleError(
        'MOTION_LEGACY_BUNDLE_UNSUPPORTED_MODIFIER_PARAMS',
        `${path}.seed has no oscillator meaning in MD4 V1`,
        `${path}.seed`,
      );
    }
    assertExactKeys(
      params,
      [
        'operation', 'amount', 'waveform', 'frequencyHz', 'cyclesAcrossInstances',
        'phaseDegrees',
      ],
      `${path}.params`,
    );
    const waveform = requireString(params.waveform, `${path}.params.waveform`);
    if (waveform !== 'sine' && waveform !== 'triangle' && waveform !== 'square') {
      throw new MotionLegacyBundleError(
        'MOTION_LEGACY_BUNDLE_UNSUPPORTED_MODIFIER_PARAMS',
        `${path}.params.waveform is unsupported`,
        `${path}.params.waveform`,
      );
    }
    return {
      id,
      order,
      enabled,
      kind: 'oscillator',
      waveform,
      frequencyHz: requireFinite(params.frequencyHz, `${path}.params.frequencyHz`),
      cyclesAcrossInstances: requireFinite(
        params.cyclesAcrossInstances,
        `${path}.params.cyclesAcrossInstances`,
      ),
      phaseDegrees: requireFinite(params.phaseDegrees, `${path}.params.phaseDegrees`),
      targets: commonTargets(modifier, params, path),
    };
  }
  if (modifier.kind === 'field') {
    if (modifier.seed !== undefined) {
      throw new MotionLegacyBundleError(
        'MOTION_LEGACY_BUNDLE_UNSUPPORTED_MODIFIER_PARAMS',
        `${path}.seed has no field meaning in MD4 V1`,
        `${path}.seed`,
      );
    }
    assertExactKeys(
      params,
      ['operation', 'amount', 'field', 'centerX', 'centerY', 'radius', 'exponent'],
      `${path}.params`,
    );
    if (params.field !== 'radial-distance') {
      throw new MotionLegacyBundleError(
        'MOTION_LEGACY_BUNDLE_UNSUPPORTED_MODIFIER_PARAMS',
        `${path}.params.field must be radial-distance`,
        `${path}.params.field`,
      );
    }
    return {
      id,
      order,
      enabled,
      kind: 'field',
      field: 'radial-distance',
      center: {
        x: requireFinite(params.centerX, `${path}.params.centerX`),
        y: requireFinite(params.centerY, `${path}.params.centerY`),
      },
      radius: requireFinite(params.radius, `${path}.params.radius`),
      exponent: requireFinite(params.exponent, `${path}.params.exponent`),
      targets: commonTargets(modifier, params, path),
    };
  }
  throw new MotionLegacyBundleError(
    'MOTION_LEGACY_BUNDLE_UNSUPPORTED_MODIFIER_PARAMS',
    `${path}.kind is unsupported`,
    `${path}.kind`,
  );
}

function fail(error: unknown): FailedMotionLegacyBundleMigration {
  if (error instanceof MotionLegacyBundleError) {
    return {
      ok: false,
      replicator: null,
      modifierStack: null,
      diagnostics: [{
        code: error.code,
        severity: 'error',
        message: error.message,
        ...(error.path === undefined ? {} : { path: error.path }),
      }],
    };
  }
  if (error instanceof MotionReplicatorContractError || error instanceof MotionModifierContractError) {
    return {
      ok: false,
      replicator: null,
      modifierStack: null,
      diagnostics: [{
        code: 'MOTION_LEGACY_BUNDLE_CONTRACT_REJECTED',
        severity: 'error',
        message: error.message,
        ...(error.path === undefined ? {} : { path: error.path }),
      }],
    };
  }
  return {
    ok: false,
    replicator: null,
    modifierStack: null,
    diagnostics: [{
      code: 'MOTION_LEGACY_BUNDLE_INVALID_DATA',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Unknown legacy bundle migration failure',
    }],
  };
}

/** Production migration seam that splits the unversioned ReplicatorDefinition into MD3 and MD4. */
export function migrateLegacyMotionDesignBundle(value: unknown): MotionLegacyBundleMigration {
  try {
    assertJsonData(value, 'replicator');
    const legacy = requireRecord(value, 'replicator');
    assertExactKeys(
      legacy,
      ['enabled', 'layout', 'offset', 'distribution', 'modifiers', 'falloff', 'maxInstances'],
      'replicator',
    );
    assertLegacyReplicatorCoreShape(legacy);
    const legacyModifiers = assertLegacyModifierBudgets(legacy.modifiers);
    const distribution = readDistribution(legacy.distribution);
    const modifiers = legacyModifiers.map((modifier, order) => (
      migrateLegacyModifier(modifier, order, distribution)
    ));
    if (distribution.seed !== undefined && !distribution.seedConsumed) {
      throw new MotionLegacyBundleError(
        'MOTION_LEGACY_BUNDLE_UNSUPPORTED_DISTRIBUTION',
        'distribution.seed is present but no seedless Random/Noise modifier consumes it',
        'replicator.distribution.seed',
      );
    }

    const legacyFalloff = legacy.falloff === undefined
      ? undefined
      : requireRecord(legacy.falloff, 'replicator.falloff');
    if (legacyFalloff !== undefined) {
      assertExactKeys(
        legacyFalloff,
        ['shapeClipId', 'feather', 'invert', 'clip'],
        'replicator.falloff',
      );
    }

    const modifierStack = parseMotionModifierStackContract({
      contract: MOTION_MODIFIER_CONTRACT_ID,
      version: MOTION_MODIFIER_CONTRACT_VERSION,
      revision: MOTION_LEGACY_BUNDLE_MODIFIER_REVISION,
      timeBasis: 'clip-local-seconds',
      ticksPerSecond: MOTION_LEGACY_BUNDLE_TICKS_PER_SECOND,
      modifiers,
      ...(legacyFalloff === undefined ? {} : {
        falloff: {
          shapeClipId: requireString(
            legacyFalloff.shapeClipId,
            'replicator.falloff.shapeClipId',
          ),
          shapeRevision: MOTION_LEGACY_BUNDLE_FALLOFF_SHAPE_REVISION,
          feather: requireFinite(
            legacyFalloff.feather,
            'replicator.falloff.feather',
          ),
          invert: requireBoolean(
            legacyFalloff.invert,
            'replicator.falloff.invert',
          ),
          clip: requireBoolean(
            legacyFalloff.clip,
            'replicator.falloff.clip',
          ),
        },
      }),
    });

    const replicator = migrateLegacyMotionReplicatorDefinition({
      enabled: legacy.enabled,
      layout: legacy.layout,
      offset: legacy.offset,
      modifiers: [],
      ...(legacy.maxInstances === undefined ? {} : { maxInstances: legacy.maxInstances }),
    }, MOTION_LEGACY_BUNDLE_REPLICATOR_REVISION);

    return {
      ok: true,
      replicator,
      modifierStack,
      diagnostics: [],
    };
  } catch (error) {
    return fail(error);
  }
}
