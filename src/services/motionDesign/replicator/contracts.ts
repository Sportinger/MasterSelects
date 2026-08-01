import {
  InertDescriptorPreflightError,
  preflightDenseArray,
  preflightExactRecord,
  readInertOwnValue,
  type InertRecord,
} from './descriptorPreflight';

export const MOTION_REPLICATOR_CONTRACT_ID = 'masterselects.motion-replicator' as const;
export const MOTION_REPLICATOR_CONTRACT_VERSION = 2 as const;

export interface ReplicatorVector2 {
  x: number;
  y: number;
}

export interface ReplicatorBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GridReplicatorLayout {
  mode: 'grid';
  count: {
    columns: number;
    rows: number;
  };
  spacing: ReplicatorVector2;
  /** Applied to odd, zero-based rows. */
  patternOffset: ReplicatorVector2;
}

export interface LinearReplicatorLayout {
  mode: 'linear';
  count: number;
  /** Exact per-index translation. It is intentionally not normalized. */
  step: ReplicatorVector2;
}

export interface RadialReplicatorLayout {
  mode: 'radial';
  count: number;
  center: ReplicatorVector2;
  radius: number;
  startAngleDegrees: number;
  /** A single item always uses the start angle. */
  endAngleDegrees: number;
  /**
   * Inclusive reaches the end angle; exclusive samples the half-open arc and
   * prevents a full revolution from duplicating its first position.
   */
  angleSampling: 'inclusive-end' | 'exclusive-end';
  /** Rotates the source x-axis to point away from the radial center. */
  autoOrient: boolean;
}

export type MotionReplicatorLayout =
  | GridReplicatorLayout
  | LinearReplicatorLayout
  | RadialReplicatorLayout;

/**
 * The transform reached by the final requested instance. Index zero remains at
 * identity; intermediate instances use a stable normalized requested index.
 */
export interface ReplicatorTerminalTransform {
  /**
   * `cumulative` distributes identity-to-terminal over requested stable index.
   * `absolute` applies the configured transform unchanged to every instance.
   */
  mode: 'cumulative' | 'absolute';
  position: ReplicatorVector2;
  rotationDegrees: number;
  /** Terminal scale factors. Evaluation accumulates per-index deltas from 1. */
  scale: ReplicatorVector2;
  /** Terminal opacity in the inclusive range 0..1. */
  opacity: number;
}

interface MotionReplicatorContractBase {
  contract: typeof MOTION_REPLICATOR_CONTRACT_ID;
  enabled: boolean;
  revision: number;
  layout: MotionReplicatorLayout;
  terminalTransform: ReplicatorTerminalTransform;
}

export interface MotionReplicatorContractV2 extends MotionReplicatorContractBase {
  version: typeof MOTION_REPLICATOR_CONTRACT_VERSION;
  /** Persisted author choice; hardware and render-target limits are never persisted here. */
  userLimit?: number;
}

/** Pure mirror of the production, unversioned ReplicatorDefinition persistence shape. */
export interface LegacyMotionReplicatorDefinition {
  enabled: boolean;
  layout:
    | {
        mode: 'grid';
        count: { x: number; y: number };
        spacing: ReplicatorVector2;
        patternOffset?: ReplicatorVector2;
      }
    | {
        mode: 'linear';
        count: number;
        spacing: number;
        direction: ReplicatorVector2;
      }
    | {
        mode: 'radial';
        count: number;
        radius: number;
        startAngle: number;
        endAngle: number;
        autoOrient: boolean;
      };
  offset: {
    position: ReplicatorVector2;
    rotation: number;
    scale: ReplicatorVector2;
    opacity: number;
    mode: 'cumulative' | 'absolute';
  };
  distribution?: unknown;
  modifiers: unknown[];
  falloff?: unknown;
  /** Legacy persisted user cap. Missing explicitly means no user cap. */
  maxInstances?: number;
}

export interface ReplicatorRuntimeLimits {
  /** Runtime capability reported by the active device/adapter. */
  deviceMaxInstances: number;
  /** Runtime capacity for the concrete preview/export render target. */
  renderTargetMaxInstances: number;
}

export type ReplicatorCapDiagnosticCode =
  | 'MOTION_REPLICATOR_CAPPED_BY_USER_LIMIT'
  | 'MOTION_REPLICATOR_CAPPED_BY_DEVICE_LIMIT'
  | 'MOTION_REPLICATOR_CAPPED_BY_RENDER_TARGET_LIMIT';

export type ReplicatorValidationDiagnosticCode =
  | 'MOTION_REPLICATOR_INVALID_CONTRACT'
  | 'MOTION_REPLICATOR_INVALID_COUNT'
  | 'MOTION_REPLICATOR_INVALID_LIMIT'
  | 'MOTION_REPLICATOR_NON_FINITE_VALUE'
  | 'MOTION_REPLICATOR_INVALID_BOUNDS'
  | 'MOTION_REPLICATOR_UNSUPPORTED_LEGACY_DATA'
  | 'MOTION_REPLICATOR_REFERENCE_CAPACITY_EXCEEDED';

export type ReplicatorDiagnosticCode =
  | ReplicatorCapDiagnosticCode
  | ReplicatorValidationDiagnosticCode;

export interface ReplicatorDiagnostic {
  code: ReplicatorDiagnosticCode;
  severity: 'warning' | 'error';
  message: string;
  path?: string;
  requestedCount?: number;
  limit?: number;
  binding?: boolean;
}

export type ReplicatorStableLayoutIndex =
  | { mode: 'grid'; row: number; column: number }
  | { mode: 'linear'; item: number }
  | { mode: 'radial'; item: number; angleDegrees: number };

export interface EvaluatedReplicatorTransform {
  position: ReplicatorVector2;
  rotationDegrees: number;
  scale: ReplicatorVector2;
  opacity: number;
}

export interface EvaluatedReplicatorInstance {
  /** Stable zero-based index in the requested sequence. */
  index: number;
  /** Stable normalization against requested count, never the capped effective count. */
  normalizedIndex: number;
  layoutIndex: ReplicatorStableLayoutIndex;
  /** Layout-only contribution before terminal offset distribution. */
  layoutTransform: EvaluatedReplicatorTransform;
  /** Offset-only contribution, preserving cumulative/absolute semantics. */
  offsetTransform: EvaluatedReplicatorTransform;
  /** Exact composition of layoutTransform and offsetTransform. */
  transform: EvaluatedReplicatorTransform;
  bounds: ReplicatorBounds;
}

export interface SuccessfulReplicatorEvaluation {
  ok: true;
  enabled: boolean;
  contractVersion: typeof MOTION_REPLICATOR_CONTRACT_VERSION;
  revision: number;
  requestedCount: number;
  effectiveCount: number;
  sourceBounds: ReplicatorBounds;
  /** Null only for a valid disabled Replicator, which emits no instances. */
  contentBounds: ReplicatorBounds | null;
  instances: EvaluatedReplicatorInstance[];
  diagnostics: ReplicatorDiagnostic[];
  cacheKey: string;
}

export interface FailedReplicatorEvaluation {
  ok: false;
  requestedCount: 0;
  effectiveCount: 0;
  sourceBounds: null;
  contentBounds: null;
  instances: [];
  diagnostics: ReplicatorDiagnostic[];
  cacheKey: null;
}

export type ReplicatorEvaluation =
  | SuccessfulReplicatorEvaluation
  | FailedReplicatorEvaluation;

export class MotionReplicatorContractError extends Error {
  readonly code: ReplicatorValidationDiagnosticCode;
  readonly path?: string;

  constructor(
    code: ReplicatorValidationDiagnosticCode,
    message: string,
    path?: string,
  ) {
    super(message);
    this.name = 'MotionReplicatorContractError';
    this.code = code;
    this.path = path;
  }
}

type UnknownRecord = Record<string, unknown>;

const VECTOR_REQUIRED_FIELDS = ['x', 'y'] as const;

function asReplicatorPreflightError(
  error: unknown,
  code: ReplicatorValidationDiagnosticCode = 'MOTION_REPLICATOR_INVALID_CONTRACT',
): never {
  if (error instanceof InertDescriptorPreflightError) {
    throw new MotionReplicatorContractError(code, error.message, error.path);
  }
  throw error;
}

function preflightVector(value: unknown, path: string): void {
  preflightExactRecord(value, path, VECTOR_REQUIRED_FIELDS);
}

function preflightV2LayoutUnsafe(value: unknown, path: string): InertRecord {
  const envelope = preflightExactRecord(
    value,
    path,
    ['mode'],
    [
      'count', 'spacing', 'patternOffset', 'step', 'center', 'radius',
      'startAngleDegrees', 'endAngleDegrees', 'angleSampling', 'autoOrient',
    ],
  );
  const mode = readInertOwnValue(envelope, 'mode');
  if (mode === 'grid') {
    const layout = preflightExactRecord(
      envelope,
      path,
      ['mode', 'count', 'spacing', 'patternOffset'],
    );
    preflightExactRecord(
      readInertOwnValue(layout, 'count'),
      `${path}.count`,
      ['columns', 'rows'],
    );
    preflightVector(readInertOwnValue(layout, 'spacing'), `${path}.spacing`);
    preflightVector(readInertOwnValue(layout, 'patternOffset'), `${path}.patternOffset`);
    return layout;
  }
  if (mode === 'linear') {
    const layout = preflightExactRecord(envelope, path, ['mode', 'count', 'step']);
    preflightVector(readInertOwnValue(layout, 'step'), `${path}.step`);
    return layout;
  }
  if (mode === 'radial') {
    const layout = preflightExactRecord(
      envelope,
      path,
      [
        'mode', 'count', 'center', 'radius', 'startAngleDegrees',
        'endAngleDegrees', 'angleSampling', 'autoOrient',
      ],
    );
    preflightVector(readInertOwnValue(layout, 'center'), `${path}.center`);
    return layout;
  }
  throw new MotionReplicatorContractError(
    'MOTION_REPLICATOR_INVALID_CONTRACT',
    `${path}.mode must be grid, linear, or radial`,
    `${path}.mode`,
  );
}

function preflightLegacyLayoutUnsafe(value: unknown, path: string): InertRecord {
  const envelope = preflightExactRecord(
    value,
    path,
    ['mode'],
    [
      'count', 'spacing', 'patternOffset', 'direction', 'radius',
      'startAngle', 'endAngle', 'autoOrient',
    ],
  );
  const mode = readInertOwnValue(envelope, 'mode');
  if (mode === 'grid') {
    const layout = preflightExactRecord(
      envelope,
      path,
      ['mode', 'count', 'spacing'],
      ['patternOffset'],
    );
    preflightExactRecord(
      readInertOwnValue(layout, 'count'),
      `${path}.count`,
      VECTOR_REQUIRED_FIELDS,
    );
    preflightVector(readInertOwnValue(layout, 'spacing'), `${path}.spacing`);
    const patternOffset = readInertOwnValue(layout, 'patternOffset');
    if (patternOffset !== undefined) preflightVector(patternOffset, `${path}.patternOffset`);
    return layout;
  }
  if (mode === 'linear') {
    const layout = preflightExactRecord(
      envelope,
      path,
      ['mode', 'count', 'spacing', 'direction'],
    );
    preflightVector(readInertOwnValue(layout, 'direction'), `${path}.direction`);
    return layout;
  }
  if (mode === 'radial') {
    return preflightExactRecord(
      envelope,
      path,
      ['mode', 'count', 'radius', 'startAngle', 'endAngle', 'autoOrient'],
    );
  }
  throw new MotionReplicatorContractError(
    'MOTION_REPLICATOR_INVALID_CONTRACT',
    `${path}.mode must be grid, linear, or radial`,
    `${path}.mode`,
  );
}

function preflightTerminalTransformUnsafe(value: unknown, path: string): void {
  const transform = preflightExactRecord(
    value,
    path,
    ['mode', 'position', 'rotationDegrees', 'scale', 'opacity'],
  );
  preflightVector(readInertOwnValue(transform, 'position'), `${path}.position`);
  preflightVector(readInertOwnValue(transform, 'scale'), `${path}.scale`);
}

function preflightLegacyOffsetUnsafe(value: unknown, path: string): void {
  const offset = preflightExactRecord(
    value,
    path,
    ['position', 'rotation', 'scale', 'opacity', 'mode'],
  );
  preflightVector(readInertOwnValue(offset, 'position'), `${path}.position`);
  preflightVector(readInertOwnValue(offset, 'scale'), `${path}.scale`);
}

function preflightLegacyDefinitionUnsafe(value: unknown): InertRecord {
  const record = preflightExactRecord(
    value,
    'replicator',
    ['enabled', 'layout', 'offset', 'modifiers'],
    ['distribution', 'falloff', 'maxInstances'],
  );
  preflightLegacyLayoutUnsafe(readInertOwnValue(record, 'layout'), 'replicator.layout');
  preflightLegacyOffsetUnsafe(readInertOwnValue(record, 'offset'), 'replicator.offset');
  preflightDenseArray(readInertOwnValue(record, 'modifiers'), 'replicator.modifiers', 16);
  return record;
}

function preflightV2ContractUnsafe(value: unknown): InertRecord {
  const record = preflightExactRecord(
    value,
    'replicator',
    ['contract', 'version', 'enabled', 'revision', 'layout', 'terminalTransform'],
    ['userLimit'],
  );
  preflightV2LayoutUnsafe(readInertOwnValue(record, 'layout'), 'layout');
  preflightTerminalTransformUnsafe(
    readInertOwnValue(record, 'terminalTransform'),
    'terminalTransform',
  );
  return record;
}

function preflightMotionReplicatorInput(value: unknown): InertRecord {
  try {
    const envelope = preflightExactRecord(
      value,
      'replicator',
      [],
      [
        'contract', 'version', 'enabled', 'revision', 'layout', 'terminalTransform',
        'userLimit', 'offset', 'distribution', 'modifiers', 'falloff', 'maxInstances',
      ],
    );
    return readInertOwnValue(envelope, 'contract') === undefined
      ? preflightLegacyDefinitionUnsafe(envelope)
      : preflightV2ContractUnsafe(envelope);
  } catch (error) {
    return asReplicatorPreflightError(error);
  }
}

export function preflightMotionReplicatorLayout(value: unknown): void {
  try {
    preflightV2LayoutUnsafe(value, 'layout');
  } catch (error) {
    asReplicatorPreflightError(error);
  }
}

export function preflightReplicatorRuntimeLimits(value: unknown): void {
  try {
    preflightExactRecord(
      value,
      'runtimeLimits',
      ['deviceMaxInstances', 'renderTargetMaxInstances'],
    );
  } catch (error) {
    asReplicatorPreflightError(error, 'MOTION_REPLICATOR_INVALID_LIMIT');
  }
}

export function preflightReplicatorBounds(value: unknown): void {
  try {
    preflightExactRecord(value, 'sourceBounds', ['minX', 'minY', 'maxX', 'maxY']);
  } catch (error) {
    asReplicatorPreflightError(error, 'MOTION_REPLICATOR_INVALID_BOUNDS');
  }
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_CONTRACT',
      `${path} must be an object`,
      path,
    );
  }
  return value as UnknownRecord;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_NON_FINITE_VALUE',
      `${path} must be a finite number`,
      path,
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_CONTRACT',
      `${path} must be a boolean`,
      path,
    );
  }
  return value;
}

function requireSafeInteger(
  value: unknown,
  path: string,
  options: { minimum: number; code: ReplicatorValidationDiagnosticCode },
): number {
  const finite = requireFiniteNumber(value, path);
  if (!Number.isSafeInteger(finite) || finite < options.minimum) {
    throw new MotionReplicatorContractError(
      options.code,
      `${path} must be a safe integer greater than or equal to ${options.minimum}`,
      path,
    );
  }
  return finite;
}

function readVector(value: unknown, path: string): ReplicatorVector2 {
  const record = requireRecord(value, path);
  return {
    x: requireFiniteNumber(record.x, `${path}.x`),
    y: requireFiniteNumber(record.y, `${path}.y`),
  };
}

function readLayout(value: unknown): MotionReplicatorLayout {
  const layout = requireRecord(value, 'layout');
  if (layout.mode === 'grid') {
    const count = requireRecord(layout.count, 'layout.count');
    return {
      mode: 'grid',
      count: {
        columns: requireSafeInteger(count.columns, 'layout.count.columns', {
          minimum: 1,
          code: 'MOTION_REPLICATOR_INVALID_COUNT',
        }),
        rows: requireSafeInteger(count.rows, 'layout.count.rows', {
          minimum: 1,
          code: 'MOTION_REPLICATOR_INVALID_COUNT',
        }),
      },
      spacing: readVector(layout.spacing, 'layout.spacing'),
      patternOffset: readVector(layout.patternOffset, 'layout.patternOffset'),
    };
  }

  if (layout.mode === 'linear') {
    return {
      mode: 'linear',
      count: requireSafeInteger(layout.count, 'layout.count', {
        minimum: 1,
        code: 'MOTION_REPLICATOR_INVALID_COUNT',
      }),
      step: readVector(layout.step, 'layout.step'),
    };
  }

  if (layout.mode === 'radial') {
    const radius = requireFiniteNumber(layout.radius, 'layout.radius');
    if (radius < 0) {
      throw new MotionReplicatorContractError(
        'MOTION_REPLICATOR_INVALID_CONTRACT',
        'layout.radius must be greater than or equal to 0',
        'layout.radius',
      );
    }
    if (typeof layout.autoOrient !== 'boolean') {
      throw new MotionReplicatorContractError(
        'MOTION_REPLICATOR_INVALID_CONTRACT',
        'layout.autoOrient must be a boolean',
        'layout.autoOrient',
      );
    }
    if (layout.angleSampling !== 'inclusive-end' && layout.angleSampling !== 'exclusive-end') {
      throw new MotionReplicatorContractError(
        'MOTION_REPLICATOR_INVALID_CONTRACT',
        'layout.angleSampling must be inclusive-end or exclusive-end',
        'layout.angleSampling',
      );
    }
    return {
      mode: 'radial',
      count: requireSafeInteger(layout.count, 'layout.count', {
        minimum: 1,
        code: 'MOTION_REPLICATOR_INVALID_COUNT',
      }),
      center: readVector(layout.center, 'layout.center'),
      radius,
      startAngleDegrees: requireFiniteNumber(
        layout.startAngleDegrees,
        'layout.startAngleDegrees',
      ),
      endAngleDegrees: requireFiniteNumber(
        layout.endAngleDegrees,
        'layout.endAngleDegrees',
      ),
      angleSampling: layout.angleSampling,
      autoOrient: layout.autoOrient,
    };
  }

  throw new MotionReplicatorContractError(
    'MOTION_REPLICATOR_INVALID_CONTRACT',
    'layout.mode must be grid, linear, or radial',
    'layout.mode',
  );
}

function readTerminalTransform(value: unknown): ReplicatorTerminalTransform {
  const transform = requireRecord(value, 'terminalTransform');
  if (transform.mode !== 'cumulative' && transform.mode !== 'absolute') {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_CONTRACT',
      'terminalTransform.mode must be cumulative or absolute',
      'terminalTransform.mode',
    );
  }
  const opacity = requireFiniteNumber(transform.opacity, 'terminalTransform.opacity');
  if (opacity < 0 || opacity > 1) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_CONTRACT',
      'terminalTransform.opacity must be in the inclusive range 0..1',
      'terminalTransform.opacity',
    );
  }
  return {
    mode: transform.mode,
    position: readVector(transform.position, 'terminalTransform.position'),
    rotationDegrees: requireFiniteNumber(
      transform.rotationDegrees,
      'terminalTransform.rotationDegrees',
    ),
    scale: readVector(transform.scale, 'terminalTransform.scale'),
    opacity,
  };
}

function requireFiniteProduct(left: number, right: number, path: string): number {
  const product = left * right;
  if (!Number.isFinite(product)) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_NON_FINITE_VALUE',
      `${path} produced a non-finite result`,
      path,
    );
  }
  return Object.is(product, -0) ? 0 : product;
}

function readLegacyLayout(value: unknown): MotionReplicatorLayout {
  const layout = requireRecord(value, 'replicator.layout');
  if (layout.mode === 'grid') {
    const count = requireRecord(layout.count, 'replicator.layout.count');
    return {
      mode: 'grid',
      count: {
        columns: requireSafeInteger(count.x, 'replicator.layout.count.x', {
          minimum: 1,
          code: 'MOTION_REPLICATOR_INVALID_COUNT',
        }),
        rows: requireSafeInteger(count.y, 'replicator.layout.count.y', {
          minimum: 1,
          code: 'MOTION_REPLICATOR_INVALID_COUNT',
        }),
      },
      spacing: readVector(layout.spacing, 'replicator.layout.spacing'),
      patternOffset: layout.patternOffset === undefined
        ? { x: 0, y: 0 }
        : readVector(layout.patternOffset, 'replicator.layout.patternOffset'),
    };
  }

  if (layout.mode === 'linear') {
    const spacing = requireFiniteNumber(layout.spacing, 'replicator.layout.spacing');
    const direction = readVector(layout.direction, 'replicator.layout.direction');
    return {
      mode: 'linear',
      count: requireSafeInteger(layout.count, 'replicator.layout.count', {
        minimum: 1,
        code: 'MOTION_REPLICATOR_INVALID_COUNT',
      }),
      step: {
        x: requireFiniteProduct(spacing, direction.x, 'replicator.layout.step.x'),
        y: requireFiniteProduct(spacing, direction.y, 'replicator.layout.step.y'),
      },
    };
  }

  if (layout.mode === 'radial') {
    const radius = requireFiniteNumber(layout.radius, 'replicator.layout.radius');
    if (radius < 0) {
      throw new MotionReplicatorContractError(
        'MOTION_REPLICATOR_INVALID_CONTRACT',
        'replicator.layout.radius must be greater than or equal to 0',
        'replicator.layout.radius',
      );
    }
    const startAngleDegrees = requireFiniteNumber(
      layout.startAngle,
      'replicator.layout.startAngle',
    );
    const endAngleDegrees = requireFiniteNumber(
      layout.endAngle,
      'replicator.layout.endAngle',
    );
    const span = endAngleDegrees - startAngleDegrees;
    if (!Number.isFinite(span)) {
      throw new MotionReplicatorContractError(
        'MOTION_REPLICATOR_NON_FINITE_VALUE',
        'replicator.layout angle span produced a non-finite result',
        'replicator.layout.endAngle',
      );
    }
    return {
      mode: 'radial',
      count: requireSafeInteger(layout.count, 'replicator.layout.count', {
        minimum: 1,
        code: 'MOTION_REPLICATOR_INVALID_COUNT',
      }),
      center: { x: 0, y: 0 },
      radius,
      startAngleDegrees,
      endAngleDegrees,
      angleSampling: span !== 0 && span % 360 === 0
        ? 'exclusive-end'
        : 'inclusive-end',
      autoOrient: requireBoolean(layout.autoOrient, 'replicator.layout.autoOrient'),
    };
  }

  throw new MotionReplicatorContractError(
    'MOTION_REPLICATOR_INVALID_CONTRACT',
    'replicator.layout.mode must be grid, linear, or radial',
    'replicator.layout.mode',
  );
}

function readLegacyOffset(value: unknown): ReplicatorTerminalTransform {
  const offset = requireRecord(value, 'replicator.offset');
  if (offset.mode !== 'cumulative' && offset.mode !== 'absolute') {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_CONTRACT',
      'replicator.offset.mode must be cumulative or absolute',
      'replicator.offset.mode',
    );
  }
  const opacity = requireFiniteNumber(offset.opacity, 'replicator.offset.opacity');
  if (opacity < 0 || opacity > 1) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_CONTRACT',
      'replicator.offset.opacity must be in the inclusive range 0..1',
      'replicator.offset.opacity',
    );
  }
  return {
    mode: offset.mode,
    position: readVector(offset.position, 'replicator.offset.position'),
    rotationDegrees: requireFiniteNumber(offset.rotation, 'replicator.offset.rotation'),
    scale: readVector(offset.scale, 'replicator.offset.scale'),
    opacity,
  };
}

function readUserLimit(value: unknown, path: string): number {
  return requireSafeInteger(value, path, {
    minimum: 1,
    code: 'MOTION_REPLICATOR_INVALID_LIMIT',
  });
}

/** Adapts the actual unversioned production persistence shape to pure V2. */
export function migrateLegacyMotionReplicatorDefinition(
  value: unknown,
  revisionValue: unknown = 0,
): MotionReplicatorContractV2 {
  let record: InertRecord;
  try {
    record = preflightLegacyDefinitionUnsafe(value);
  } catch (error) {
    return asReplicatorPreflightError(error);
  }
  const modifiers = record.modifiers;
  if (!Array.isArray(modifiers)) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_CONTRACT',
      'replicator.modifiers must be an array',
      'replicator.modifiers',
    );
  }
  if (
    modifiers.length > 0
    || record.falloff !== undefined
    || record.distribution !== undefined
  ) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_UNSUPPORTED_LEGACY_DATA',
      'Legacy modifiers, falloff, and distribution require the MD4 contract and cannot be dropped',
      modifiers.length > 0
        ? 'replicator.modifiers'
        : record.falloff !== undefined
          ? 'replicator.falloff'
          : 'replicator.distribution',
    );
  }
  const revision = requireSafeInteger(revisionValue, 'replicator.revision', {
    minimum: 0,
    code: 'MOTION_REPLICATOR_INVALID_CONTRACT',
  });
  const userLimit = record.maxInstances === undefined
    ? undefined
    : readUserLimit(record.maxInstances, 'replicator.maxInstances');

  return {
    contract: MOTION_REPLICATOR_CONTRACT_ID,
    version: MOTION_REPLICATOR_CONTRACT_VERSION,
    enabled: requireBoolean(record.enabled, 'replicator.enabled'),
    revision,
    layout: readLegacyLayout(record.layout),
    terminalTransform: readLegacyOffset(record.offset),
    ...(userLimit === undefined ? {} : { userLimit }),
  };
}

/**
 * Returns a normalized, JSON-only V2 value. It accepts V2 or the actual
 * unversioned production ReplicatorDefinition; no nested input is retained.
 */
export function migrateMotionReplicatorContract(value: unknown): MotionReplicatorContractV2 {
  const record = preflightMotionReplicatorInput(value);
  if (record.contract === undefined) {
    return migrateLegacyMotionReplicatorDefinition(record);
  }
  if (record.contract !== MOTION_REPLICATOR_CONTRACT_ID) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_CONTRACT',
      `replicator.contract must equal ${MOTION_REPLICATOR_CONTRACT_ID}`,
      'replicator.contract',
    );
  }
  if (record.version !== MOTION_REPLICATOR_CONTRACT_VERSION) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_CONTRACT',
      `replicator.version must equal ${MOTION_REPLICATOR_CONTRACT_VERSION}`,
      'replicator.version',
    );
  }
  if (record.maxInstances !== undefined) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_CONTRACT',
      'V2 must use userLimit instead of maxInstances',
      'replicator.maxInstances',
    );
  }

  const userLimit = record.userLimit === undefined
    ? undefined
    : readUserLimit(record.userLimit, 'replicator.userLimit');
  return {
    contract: MOTION_REPLICATOR_CONTRACT_ID,
    version: MOTION_REPLICATOR_CONTRACT_VERSION,
    enabled: requireBoolean(record.enabled, 'replicator.enabled'),
    revision: requireSafeInteger(record.revision, 'replicator.revision', {
      minimum: 0,
      code: 'MOTION_REPLICATOR_INVALID_CONTRACT',
    }),
    layout: readLayout(record.layout),
    terminalTransform: readTerminalTransform(record.terminalTransform),
    ...(userLimit === undefined ? {} : { userLimit }),
  };
}
