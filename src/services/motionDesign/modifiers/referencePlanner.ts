import { composeReplicatorTransforms } from '../replicator/referenceEvaluator';
import type {
  EvaluatedReplicatorTransform,
  ReplicatorVector2,
} from '../replicator/contracts';
import {
  MOTION_MODIFIER_MAX_INSTANCES,
  MOTION_MODIFIER_MAX_WORK_ITEMS,
  MOTION_MODIFIER_TARGET_PATHS,
  MotionModifierContractError,
  parseMotionModifierStackContract,
  type FieldMotionModifier,
  type MotionModifier,
  type MotionModifierCombineOperation,
  type MotionModifierDiagnostic,
  type MotionModifierStackContractV1,
  type MotionModifierTargetPath,
  type NoiseMotionModifier,
  type OscillatorMotionModifier,
  type RandomMotionModifier,
} from './contracts';

export interface MotionModifierPlanInstanceInput {
  /** Must be the zero-based stable requested index and equal its array position. */
  index: number;
  layoutTransform: EvaluatedReplicatorTransform;
  offsetTransform: EvaluatedReplicatorTransform;
}

export interface MotionModifierShapeReference {
  shapeClipId: string;
  revision: number;
  kind: 'ellipse' | 'rectangle';
  center: ReplicatorVector2;
  size: ReplicatorVector2;
}

export interface MotionModifierPlanContext {
  requestedCount: number;
  effectiveCount: number;
  clipLocalTimeSeconds: number;
  instances: MotionModifierPlanInstanceInput[];
  shapeReferences: MotionModifierShapeReference[];
}

export interface MotionModifierApplication {
  modifierId: string;
  modifierOrder: number;
  targetPath: MotionModifierTargetPath;
  operation: MotionModifierCombineOperation;
  sample: number;
  falloffWeight: number;
  weightedSample: number;
  amount: number;
  valueBefore: number;
  valueAfter: number;
}

export interface MotionModifierPlannedValue {
  path: MotionModifierTargetPath;
  value: number;
}

export interface MotionModifierPlannedInstance {
  index: number;
  normalizedIndex: number;
  falloffWeight: number;
  clipped: boolean;
  layoutTransform: EvaluatedReplicatorTransform;
  /** Per-instance MD3 offset after ordered MD4 applications and opacity clamps. */
  offsetTransform: EvaluatedReplicatorTransform;
  /** Canonical layoutTransform + modified offsetTransform composition. */
  transform: EvaluatedReplicatorTransform;
  values: MotionModifierPlannedValue[];
  applications: MotionModifierApplication[];
}

export interface SuccessfulMotionModifierPlan {
  ok: true;
  revision: number;
  requestedCount: number;
  effectiveCount: number;
  timeBasis: 'clip-local-seconds';
  timeTicks: number;
  instances: MotionModifierPlannedInstance[];
  diagnostics: [];
  cacheKey: string;
}

export interface FailedMotionModifierPlan {
  ok: false;
  requestedCount: 0;
  effectiveCount: 0;
  timeTicks: null;
  instances: [];
  diagnostics: MotionModifierDiagnostic[];
  cacheKey: null;
}

export type MotionModifierPlan = SuccessfulMotionModifierPlan | FailedMotionModifierPlan;

type UnknownRecord = Record<string, unknown>;

interface NormalizedMotionModifierPlanContext extends MotionModifierPlanContext {
  timeTicks: number;
  shapeReferences: MotionModifierShapeReference[];
}

function fail(error: unknown): FailedMotionModifierPlan {
  if (error instanceof MotionModifierContractError) {
    return {
      ok: false,
      requestedCount: 0,
      effectiveCount: 0,
      timeTicks: null,
      instances: [],
      diagnostics: [{
        code: error.code,
        severity: 'error',
        message: error.message,
        ...(error.path === undefined ? {} : { path: error.path }),
        ...(error.limit === undefined ? {} : { limit: error.limit }),
        ...(error.actual === undefined ? {} : { actual: error.actual }),
      }],
      cacheKey: null,
    };
  }
  return {
    ok: false,
    requestedCount: 0,
    effectiveCount: 0,
    timeTicks: null,
    instances: [],
    diagnostics: [{
      code: 'MOTION_MODIFIER_INVALID_CONTRACT',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Unknown modifier planning failure',
    }],
    cacheKey: null,
  };
}

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
        `${path}.${printable} is not part of the planning context`,
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

function finiteResult(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_NON_FINITE_VALUE',
      `${path} produced a non-finite value`,
      { path },
    );
  }
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return 0;
  const nearestInteger = Math.round(value);
  return Math.abs(value - nearestInteger) < 1e-12 ? nearestInteger : value;
}

function requireSafeInteger(value: unknown, path: string, minimum: number): number {
  const finite = requireFinite(value, path);
  if (!Number.isSafeInteger(finite) || finite < minimum) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `${path} must be a safe integer greater than or equal to ${minimum}`,
      { path },
    );
  }
  return finite;
}

function requireVector(value: unknown, path: string): ReplicatorVector2 {
  const vector = requireRecord(value, path);
  assertExactKeys(vector, ['x', 'y'], path);
  return {
    x: requireFinite(vector.x, `${path}.x`),
    y: requireFinite(vector.y, `${path}.y`),
  };
}

function requireStableId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_ID',
      `${path} must be a stable 1..128 character id`,
      { path },
    );
  }
  return value;
}

function normalizeTransform(value: unknown, path: string): EvaluatedReplicatorTransform {
  const transform = requireRecord(value, path);
  assertExactKeys(transform, ['position', 'rotationDegrees', 'scale', 'opacity'], path);
  const opacity = requireFinite(transform.opacity, `${path}.opacity`);
  if (opacity < 0 || opacity > 1) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `${path}.opacity must be in the inclusive range 0..1`,
      { path: `${path}.opacity` },
    );
  }
  return {
    position: requireVector(transform.position, `${path}.position`),
    rotationDegrees: requireFinite(transform.rotationDegrees, `${path}.rotationDegrees`),
    scale: requireVector(transform.scale, `${path}.scale`),
    opacity,
  };
}

function normalizeInstance(value: unknown, index: number): MotionModifierPlanInstanceInput {
  const path = `context.instances[${index}]`;
  const instance = requireRecord(value, path);
  assertExactKeys(instance, ['index', 'layoutTransform', 'offsetTransform'], path);
  const stableIndex = requireSafeInteger(instance.index, `${path}.index`, 0);
  if (stableIndex !== index) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_INDEX',
      `${path}.index must equal its zero-based array position`,
      { path: `${path}.index` },
    );
  }
  return {
    index: stableIndex,
    layoutTransform: normalizeTransform(instance.layoutTransform, `${path}.layoutTransform`),
    offsetTransform: normalizeTransform(instance.offsetTransform, `${path}.offsetTransform`),
  };
}

function normalizeShapeReference(value: unknown, index: number): MotionModifierShapeReference {
  const path = `context.shapeReferences[${index}]`;
  const shape = requireRecord(value, path);
  assertExactKeys(shape, ['shapeClipId', 'revision', 'kind', 'center', 'size'], path);
  if (shape.kind !== 'ellipse' && shape.kind !== 'rectangle') {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `${path}.kind must be ellipse or rectangle`,
      { path: `${path}.kind` },
    );
  }
  const size = requireVector(shape.size, `${path}.size`);
  if (size.x <= 0 || size.y <= 0) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_CONTRACT',
      `${path}.size axes must be greater than zero`,
      { path: `${path}.size` },
    );
  }
  return {
    shapeClipId: requireStableId(shape.shapeClipId, `${path}.shapeClipId`),
    revision: requireSafeInteger(shape.revision, `${path}.revision`, 0),
    kind: shape.kind,
    center: requireVector(shape.center, `${path}.center`),
    size,
  };
}

function collectTargetPaths(contract: MotionModifierStackContractV1): MotionModifierTargetPath[] {
  const used = new Set<MotionModifierTargetPath>();
  for (const modifier of contract.modifiers) {
    for (const target of modifier.targets) used.add(target.path);
  }
  return MOTION_MODIFIER_TARGET_PATHS.filter((path) => used.has(path));
}

function normalizeContext(
  value: unknown,
  contract: MotionModifierStackContractV1,
): NormalizedMotionModifierPlanContext {
  const context = requireRecord(value, 'context');
  assertExactKeys(
    context,
    ['requestedCount', 'effectiveCount', 'clipLocalTimeSeconds', 'instances', 'shapeReferences'],
    'context',
  );
  const requestedCount = requireSafeInteger(context.requestedCount, 'context.requestedCount', 1);
  const effectiveCount = requireSafeInteger(context.effectiveCount, 'context.effectiveCount', 0);
  if (effectiveCount > requestedCount) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_INDEX',
      'context.effectiveCount must not exceed requestedCount',
      { path: 'context.effectiveCount' },
    );
  }
  if (effectiveCount > MOTION_MODIFIER_MAX_INSTANCES) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INSTANCE_BUDGET_EXCEEDED',
      'context.effectiveCount exceeds the hard instance budget',
      {
        path: 'context.effectiveCount',
        limit: MOTION_MODIFIER_MAX_INSTANCES,
        actual: effectiveCount,
      },
    );
  }
  const instanceValues = requireArray(context.instances, 'context.instances');
  if (instanceValues.length !== effectiveCount) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_INDEX',
      'context.instances length must equal effectiveCount',
      { path: 'context.instances' },
    );
  }
  const instances = instanceValues.map(normalizeInstance);

  const clipLocalTimeSeconds = requireFinite(
    context.clipLocalTimeSeconds,
    'context.clipLocalTimeSeconds',
  );
  const scaledTicks = clipLocalTimeSeconds * contract.ticksPerSecond;
  if (!Number.isFinite(scaledTicks) || Math.abs(scaledTicks) > Number.MAX_SAFE_INTEGER) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_INVALID_TIME',
      'context.clipLocalTimeSeconds cannot be represented on the persisted time grid',
      { path: 'context.clipLocalTimeSeconds' },
    );
  }
  const timeTicks = Math.round(scaledTicks);

  const shapeReferences = requireArray(
    context.shapeReferences,
    'context.shapeReferences',
  ).map(normalizeShapeReference);
  const shapeIds = new Set<string>();
  for (const shape of shapeReferences) {
    if (shapeIds.has(shape.shapeClipId)) {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_DUPLICATE_FALLOFF_REFERENCE',
        `Duplicate shape reference ${shape.shapeClipId}`,
        { path: 'context.shapeReferences' },
      );
    }
    shapeIds.add(shape.shapeClipId);
  }
  const canonicalShapeReferences = [...shapeReferences].sort((left, right) => {
    if (left.shapeClipId < right.shapeClipId) return -1;
    if (left.shapeClipId > right.shapeClipId) return 1;
    return 0;
  });

  if (contract.falloff) {
    const shape = shapeReferences.find((candidate) => (
      candidate.shapeClipId === contract.falloff?.shapeClipId
    ));
    if (!shape) {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_MISSING_FALLOFF_REFERENCE',
        `Missing falloff shape ${contract.falloff.shapeClipId}`,
        { path: 'context.shapeReferences' },
      );
    }
    if (shape.revision !== contract.falloff.shapeRevision) {
      throw new MotionModifierContractError(
        'MOTION_MODIFIER_STALE_FALLOFF_REFERENCE',
        `Falloff shape ${shape.shapeClipId} revision is stale`,
        { path: 'context.shapeReferences' },
      );
    }
  }

  const enabledTargets = contract.modifiers.reduce(
    (total, modifier) => total + (modifier.enabled ? modifier.targets.length : 0),
    0,
  );
  const workItems = effectiveCount * enabledTargets;
  if (!Number.isSafeInteger(workItems) || workItems > MOTION_MODIFIER_MAX_WORK_ITEMS) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_WORK_BUDGET_EXCEEDED',
      'effectiveCount times enabled targets exceeds the hard work budget',
      {
        path: 'context.effectiveCount',
        limit: MOTION_MODIFIER_MAX_WORK_ITEMS,
        actual: workItems,
      },
    );
  }

  return {
    requestedCount,
    effectiveCount,
    clipLocalTimeSeconds: timeTicks / contract.ticksPerSecond,
    timeTicks,
    instances,
    shapeReferences: canonicalShapeReferences,
  };
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function hashString32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function combineHash(seed: number, values: readonly number[]): number {
  let hash = seed >>> 0;
  for (const value of values) hash = mix32(hash ^ (value >>> 0));
  return hash;
}

function integerHashWords(value: number, path: string): readonly [number, number] {
  if (!Number.isSafeInteger(value)) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_NON_FINITE_VALUE',
      `${path} must remain a safe integer for deterministic seed mixing`,
      { path },
    );
  }
  return [value >>> 0, Math.floor(value / 0x1_0000_0000) >>> 0];
}

function signedHashSample(
  seed: number,
  modifierId: string,
  targetPath: MotionModifierTargetPath,
  index: number,
  requestedCount: number,
  extraA = 0,
  extraB = 0,
): number {
  const indexWords = integerHashWords(index, `modifier.${modifierId}.stableIndex`);
  const countWords = integerHashWords(requestedCount, `modifier.${modifierId}.requestedCount`);
  const extraAWords = integerHashWords(extraA, `modifier.${modifierId}.latticeX`);
  const extraBWords = integerHashWords(extraB, `modifier.${modifierId}.latticeTime`);
  const hash = combineHash(seed, [
    hashString32(modifierId),
    hashString32(targetPath),
    ...indexWords,
    ...countWords,
    ...extraAWords,
    ...extraBWords,
  ]);
  return hash / 0x1_0000_0000 * 2 - 1;
}

function sampleRandom(
  modifier: RandomMotionModifier,
  targetPath: MotionModifierTargetPath,
  index: number,
  requestedCount: number,
): number {
  return signedHashSample(
    modifier.seed,
    modifier.id,
    targetPath,
    index,
    requestedCount,
  );
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function latticeNoise(
  modifier: NoiseMotionModifier,
  targetPath: MotionModifierTargetPath,
  requestedCount: number,
  x: number,
  time: number,
): number {
  const x0 = Math.floor(x);
  const t0 = Math.floor(time);
  const fx = smoothstep(x - x0);
  const ft = smoothstep(time - t0);
  const corner = (dx: number, dt: number) => signedHashSample(
    modifier.seed,
    modifier.id,
    targetPath,
    0,
    requestedCount,
    x0 + dx,
    t0 + dt,
  );
  const lower = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * fx;
  const upper = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * fx;
  return lower + (upper - lower) * ft;
}

function sampleNoise(
  modifier: NoiseMotionModifier,
  targetPath: MotionModifierTargetPath,
  normalizedIndex: number,
  requestedCount: number,
  timeSeconds: number,
): number {
  let frequency = 1;
  let amplitude = 1;
  let weighted = 0;
  let totalAmplitude = 0;
  for (let octave = 0; octave < modifier.octaves; octave += 1) {
    const x = finiteResult(
      normalizedIndex * modifier.indexFrequency * frequency,
      `modifier.${modifier.id}.noise.x`,
    );
    const time = finiteResult(
      timeSeconds * modifier.timeFrequencyHz * frequency,
      `modifier.${modifier.id}.noise.time`,
    );
    weighted += latticeNoise(modifier, targetPath, requestedCount, x, time) * amplitude;
    totalAmplitude += amplitude;
    frequency *= modifier.lacunarity;
    amplitude *= modifier.persistence;
  }
  return finiteResult(weighted / totalAmplitude, `modifier.${modifier.id}.noise.sample`);
}

function sampleOscillator(
  modifier: OscillatorMotionModifier,
  normalizedIndex: number,
  timeSeconds: number,
): number {
  const cycles = modifier.frequencyHz * timeSeconds
    + modifier.cyclesAcrossInstances * normalizedIndex
    + modifier.phaseDegrees / 360;
  const finiteCycles = finiteResult(cycles, `modifier.${modifier.id}.cycles`);
  const wrappedCycles = finiteCycles - Math.floor(finiteCycles);
  const sine = Math.sin(wrappedCycles * Math.PI * 2);
  if (modifier.waveform === 'sine') return sine;
  if (modifier.waveform === 'triangle') return 2 / Math.PI * Math.asin(sine);
  return sine >= 0 ? 1 : -1;
}

function sampleField(modifier: FieldMotionModifier, position: ReplicatorVector2): number {
  const distance = finiteResult(Math.hypot(
    position.x - modifier.center.x,
    position.y - modifier.center.y,
  ), `modifier.${modifier.id}.field.distance`);
  const distanceRatio = finiteResult(
    distance / modifier.radius,
    `modifier.${modifier.id}.field.distanceRatio`,
  );
  const normalized = Math.max(0, Math.min(1, 1 - distanceRatio));
  return finiteResult(
    Math.pow(normalized, modifier.exponent),
    `modifier.${modifier.id}.field.sample`,
  );
}

function sampleModifier(
  modifier: MotionModifier,
  targetPath: MotionModifierTargetPath,
  instance: MotionModifierPlanInstanceInput,
  normalizedIndex: number,
  context: NormalizedMotionModifierPlanContext,
): number {
  if (modifier.kind === 'random') {
    return sampleRandom(modifier, targetPath, instance.index, context.requestedCount);
  }
  if (modifier.kind === 'noise') {
    return sampleNoise(
      modifier,
      targetPath,
      normalizedIndex,
      context.requestedCount,
      context.clipLocalTimeSeconds,
    );
  }
  if (modifier.kind === 'oscillator') {
    return sampleOscillator(modifier, normalizedIndex, context.clipLocalTimeSeconds);
  }
  return sampleField(
    modifier,
    composeReplicatorTransforms(instance.layoutTransform, instance.offsetTransform).position,
  );
}

function getFalloffWeight(
  contract: MotionModifierStackContractV1,
  context: NormalizedMotionModifierPlanContext,
  position: ReplicatorVector2,
): number {
  const falloff = contract.falloff;
  if (!falloff) return 1;
  const shape = context.shapeReferences.find((candidate) => (
    candidate.shapeClipId === falloff.shapeClipId
  ));
  if (!shape) {
    throw new MotionModifierContractError(
      'MOTION_MODIFIER_MISSING_FALLOFF_REFERENCE',
      `Missing falloff shape ${falloff.shapeClipId}`,
      { path: 'context.shapeReferences' },
    );
  }
  const halfWidth = shape.size.x / 2;
  const halfHeight = shape.size.y / 2;
  const dx = finiteResult(
    Math.abs(position.x - shape.center.x) / halfWidth,
    `falloff.${shape.shapeClipId}.normalizedX`,
  );
  const dy = finiteResult(
    Math.abs(position.y - shape.center.y) / halfHeight,
    `falloff.${shape.shapeClipId}.normalizedY`,
  );
  const normalizedDistance = finiteResult(
    shape.kind === 'ellipse' ? Math.hypot(dx, dy) : Math.max(dx, dy),
    `falloff.${shape.shapeClipId}.normalizedDistance`,
  );
  const baseWeight = falloff.feather === 0
    ? normalizedDistance <= 1 ? 1 : 0
    : Math.max(0, Math.min(1, (1 + falloff.feather - normalizedDistance) / falloff.feather));
  return falloff.invert ? 1 - baseWeight : baseWeight;
}

function getOffsetTransformValue(
  transform: EvaluatedReplicatorTransform,
  path: MotionModifierTargetPath,
): number {
  if (path === 'replicator.offset.position.x') return transform.position.x;
  if (path === 'replicator.offset.position.y') return transform.position.y;
  if (path === 'replicator.offset.rotation') return transform.rotationDegrees;
  if (path === 'replicator.offset.scale.x') return transform.scale.x;
  if (path === 'replicator.offset.scale.y') return transform.scale.y;
  return transform.opacity;
}

function applyOffsetTransformValues(
  base: EvaluatedReplicatorTransform,
  values: ReadonlyMap<MotionModifierTargetPath, number>,
): EvaluatedReplicatorTransform {
  const read = (path: MotionModifierTargetPath, fallback: number) => values.get(path) ?? fallback;
  return {
    position: {
      x: read('replicator.offset.position.x', base.position.x),
      y: read('replicator.offset.position.y', base.position.y),
    },
    rotationDegrees: read('replicator.offset.rotation', base.rotationDegrees),
    scale: {
      x: read('replicator.offset.scale.x', base.scale.x),
      y: read('replicator.offset.scale.y', base.scale.y),
    },
    opacity: Math.max(0, Math.min(1, read('replicator.offset.opacity', base.opacity))),
  };
}

function planInstance(
  contract: MotionModifierStackContractV1,
  context: NormalizedMotionModifierPlanContext,
  instance: MotionModifierPlanInstanceInput,
): MotionModifierPlannedInstance {
  const normalizedIndex = context.requestedCount === 1
    ? 0
    : instance.index / (context.requestedCount - 1);
  const initialTransform = composeReplicatorTransforms(
    instance.layoutTransform,
    instance.offsetTransform,
  );
  const falloffWeight = getFalloffWeight(contract, context, initialTransform.position);
  const clipped = contract.falloff?.clip === true && falloffWeight === 0;
  const targetPaths = collectTargetPaths(contract);
  const values = new Map<MotionModifierTargetPath, number>(
    targetPaths.map((path) => [path, getOffsetTransformValue(instance.offsetTransform, path)]),
  );
  const applications: MotionModifierApplication[] = [];

  if (!clipped) {
    for (const modifier of contract.modifiers) {
      if (!modifier.enabled) continue;
      for (const target of modifier.targets) {
        const sample = finiteResult(
          sampleModifier(modifier, target.path, instance, normalizedIndex, context),
          `modifier.${modifier.id}.sample`,
        );
        const weightedSample = finiteResult(
          sample * falloffWeight,
          `modifier.${modifier.id}.weightedSample`,
        );
        const valueBefore = values.get(target.path);
        if (valueBefore === undefined) {
          throw new MotionModifierContractError(
            'MOTION_MODIFIER_MISSING_BASE_VALUE',
            `Missing base value for ${target.path}`,
            { path: `modifier.${modifier.id}.targets` },
          );
        }
        const contribution = weightedSample * target.amount;
        const combinedValue = finiteResult(
          target.operation === 'add'
            ? valueBefore + contribution
            : valueBefore * (1 + contribution),
          `modifier.${modifier.id}.${target.path}`,
        );
        const valueAfter = target.path === 'replicator.offset.opacity'
          ? Math.max(0, Math.min(1, combinedValue))
          : combinedValue;
        values.set(target.path, valueAfter);
        applications.push({
          modifierId: modifier.id,
          modifierOrder: modifier.order,
          targetPath: target.path,
          operation: target.operation,
          sample,
          falloffWeight,
          weightedSample,
          amount: target.amount,
          valueBefore,
          valueAfter,
        });
      }
    }
  }

  const offsetTransform = applyOffsetTransformValues(instance.offsetTransform, values);
  const transform = composeReplicatorTransforms(instance.layoutTransform, offsetTransform);

  return {
    index: instance.index,
    normalizedIndex,
    falloffWeight,
    clipped,
    layoutTransform: instance.layoutTransform,
    offsetTransform,
    transform,
    values: targetPaths.map((path) => ({
      path,
      value: values.get(path) as number,
    })),
    applications,
  };
}

function hashCanonicalString(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function createCacheKeyFromNormalized(
  contract: MotionModifierStackContractV1,
  context: NormalizedMotionModifierPlanContext,
): string {
  const canonical = JSON.stringify({
    contract,
    context: {
      requestedCount: context.requestedCount,
      effectiveCount: context.effectiveCount,
      timeTicks: context.timeTicks,
      instances: context.instances,
      shapeReferences: context.shapeReferences,
    },
  });
  return `motion-modifiers:v${contract.version}:r${contract.revision}:${hashCanonicalString(canonical)}`;
}

export function createMotionModifierPlanCacheKey(
  contractValue: unknown,
  contextValue: unknown,
): string {
  const contract = parseMotionModifierStackContract(contractValue);
  const context = normalizeContext(contextValue, contract);
  return createCacheKeyFromNormalized(contract, context);
}

/** Pure, fail-closed CPU oracle for ordered MD4 modifier evaluation. */
export function planMotionModifiers(
  contractValue: unknown,
  contextValue: unknown,
): MotionModifierPlan {
  try {
    const contract = parseMotionModifierStackContract(contractValue);
    const context = normalizeContext(contextValue, contract);
    const cacheKey = createCacheKeyFromNormalized(contract, context);
    return {
      ok: true,
      revision: contract.revision,
      requestedCount: context.requestedCount,
      effectiveCount: context.effectiveCount,
      timeBasis: contract.timeBasis,
      timeTicks: context.timeTicks,
      instances: context.instances.map((instance) => planInstance(contract, context, instance)),
      diagnostics: [],
      cacheKey,
    };
  } catch (error) {
    return fail(error);
  }
}
