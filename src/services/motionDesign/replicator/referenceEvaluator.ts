import {
  MOTION_REPLICATOR_CONTRACT_VERSION,
  MotionReplicatorContractError,
  migrateMotionReplicatorContract,
  preflightReplicatorBounds,
  preflightReplicatorRuntimeLimits,
  type EvaluatedReplicatorInstance,
  type EvaluatedReplicatorTransform,
  type MotionReplicatorContractV2,
  type ReplicatorBounds,
  type ReplicatorDiagnostic,
  type ReplicatorEvaluation,
  type ReplicatorRuntimeLimits,
  type ReplicatorStableLayoutIndex,
} from './contracts';
import { resolveMotionReplicatorLimits } from './limits';

type UnknownRecord = Record<string, unknown>;

/** Prevents the pure object-heavy CPU oracle from becoming an allocation attack. */
export const MOTION_REPLICATOR_REFERENCE_MAX_INSTANCES = 100_000;

function fail(
  code: ReplicatorDiagnostic['code'],
  message: string,
  path?: string,
): ReplicatorEvaluation {
  return {
    ok: false,
    requestedCount: 0,
    effectiveCount: 0,
    sourceBounds: null,
    contentBounds: null,
    instances: [],
    diagnostics: [{ code, severity: 'error', message, ...(path ? { path } : {}) }],
    cacheKey: null,
  };
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

function readRuntimeLimits(value: unknown): ReplicatorRuntimeLimits {
  preflightReplicatorRuntimeLimits(value);
  const limits = requireRecord(value, 'runtimeLimits');
  return {
    deviceMaxInstances: requireFiniteNumber(
      limits.deviceMaxInstances,
      'runtimeLimits.deviceMaxInstances',
    ),
    renderTargetMaxInstances: requireFiniteNumber(
      limits.renderTargetMaxInstances,
      'runtimeLimits.renderTargetMaxInstances',
    ),
  };
}

export function validateReplicatorBounds(value: unknown): ReplicatorBounds {
  preflightReplicatorBounds(value);
  const bounds = requireRecord(value, 'sourceBounds');
  const normalized: ReplicatorBounds = {
    minX: requireFiniteNumber(bounds.minX, 'sourceBounds.minX'),
    minY: requireFiniteNumber(bounds.minY, 'sourceBounds.minY'),
    maxX: requireFiniteNumber(bounds.maxX, 'sourceBounds.maxX'),
    maxY: requireFiniteNumber(bounds.maxY, 'sourceBounds.maxY'),
  };
  if (normalized.minX > normalized.maxX || normalized.minY > normalized.maxY) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_BOUNDS',
      'sourceBounds minimums must not exceed maximums',
      'sourceBounds',
    );
  }
  return normalized;
}

function requireFiniteResult(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_NON_FINITE_VALUE',
      `${path} produced a non-finite result`,
      path,
    );
  }
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return 0;
  const nearestInteger = Math.round(value);
  if (Math.abs(value - nearestInteger) < 1e-12) return nearestInteger;
  return value;
}

function getNormalizedIndex(index: number, requestedCount: number): number {
  return requestedCount === 1 ? 0 : index / (requestedCount - 1);
}

interface EvaluatedLayout {
  transform: EvaluatedReplicatorTransform;
  layoutIndex: ReplicatorStableLayoutIndex;
}

function evaluateLayout(
  contract: MotionReplicatorContractV2,
  index: number,
): EvaluatedLayout {
  const { layout } = contract;
  if (layout.mode === 'grid') {
    const row = Math.floor(index / layout.count.columns);
    const column = index % layout.count.columns;
    const oddRow = row % 2 === 1;
    return {
      transform: {
        position: {
          x: requireFiniteResult(
            (column - (layout.count.columns - 1) / 2) * layout.spacing.x
              + (oddRow ? layout.patternOffset.x : 0),
            `instances[${index}].layout.position.x`,
          ),
          y: requireFiniteResult(
            (row - (layout.count.rows - 1) / 2) * layout.spacing.y
              + (oddRow ? layout.patternOffset.y : 0),
            `instances[${index}].layout.position.y`,
          ),
        },
        rotationDegrees: 0,
        scale: { x: 1, y: 1 },
        opacity: 1,
      },
      layoutIndex: { mode: 'grid', row, column },
    };
  }

  if (layout.mode === 'linear') {
    return {
      transform: {
        position: {
          x: requireFiniteResult(layout.step.x * index, `instances[${index}].layout.position.x`),
          y: requireFiniteResult(layout.step.y * index, `instances[${index}].layout.position.y`),
        },
        rotationDegrees: 0,
        scale: { x: 1, y: 1 },
        opacity: 1,
      },
      layoutIndex: { mode: 'linear', item: index },
    };
  }

  const angleNormalizedIndex = layout.count === 1
    ? 0
    : layout.angleSampling === 'inclusive-end'
      ? index / (layout.count - 1)
      : index / layout.count;
  const angleDegrees = requireFiniteResult(
    layout.startAngleDegrees
      + (layout.endAngleDegrees - layout.startAngleDegrees) * angleNormalizedIndex,
    `instances[${index}].layout.angleDegrees`,
  );
  const angleRadians = requireFiniteResult(
    angleDegrees * (Math.PI / 180),
    `instances[${index}].layout.angleRadians`,
  );
  return {
    transform: {
      position: {
        x: requireFiniteResult(
          layout.center.x + Math.cos(angleRadians) * layout.radius,
          `instances[${index}].layout.position.x`,
        ),
        y: requireFiniteResult(
          layout.center.y + Math.sin(angleRadians) * layout.radius,
          `instances[${index}].layout.position.y`,
        ),
      },
      rotationDegrees: layout.autoOrient ? angleDegrees : 0,
      scale: { x: 1, y: 1 },
      opacity: 1,
    },
    layoutIndex: { mode: 'radial', item: index, angleDegrees },
  };
}

function evaluateOffsetTransform(
  contract: MotionReplicatorContractV2,
  index: number,
  requestedCount: number,
  normalizedIndex: number,
): EvaluatedReplicatorTransform {
  const terminal = contract.terminalTransform;
  if (terminal.mode === 'absolute') {
    return {
      position: { ...terminal.position },
      rotationDegrees: terminal.rotationDegrees,
      scale: {
        x: terminal.scale.x,
        y: terminal.scale.y,
      },
      opacity: terminal.opacity,
    };
  }
  const denominator = requestedCount === 1 ? 1 : requestedCount - 1;
  const scaleDeltaX = (terminal.scale.x - 1) / denominator;
  const scaleDeltaY = (terminal.scale.y - 1) / denominator;
  const opacityDelta = (terminal.opacity - 1) / denominator;

  return {
    position: {
      x: requireFiniteResult(terminal.position.x * normalizedIndex, `instances[${index}].offset.position.x`),
      y: requireFiniteResult(terminal.position.y * normalizedIndex, `instances[${index}].offset.position.y`),
    },
    rotationDegrees: requireFiniteResult(terminal.rotationDegrees * normalizedIndex, `instances[${index}].offset.rotationDegrees`),
    scale: {
      x: requireFiniteResult(1 + scaleDeltaX * index, `instances[${index}].offset.scale.x`),
      y: requireFiniteResult(1 + scaleDeltaY * index, `instances[${index}].offset.scale.y`),
    },
    opacity: requireFiniteResult(
      1 + opacityDelta * index,
      `instances[${index}].offset.opacity`,
    ),
  };
}

/** Canonical MD3/MD4 transform composition seam. */
export function composeReplicatorTransforms(
  layoutTransform: EvaluatedReplicatorTransform,
  offsetTransform: EvaluatedReplicatorTransform,
): EvaluatedReplicatorTransform {
  return {
    position: {
      x: requireFiniteResult(
        layoutTransform.position.x + offsetTransform.position.x,
        'composedTransform.position.x',
      ),
      y: requireFiniteResult(
        layoutTransform.position.y + offsetTransform.position.y,
        'composedTransform.position.y',
      ),
    },
    rotationDegrees: requireFiniteResult(
      layoutTransform.rotationDegrees + offsetTransform.rotationDegrees,
      'composedTransform.rotationDegrees',
    ),
    scale: {
      x: requireFiniteResult(
        layoutTransform.scale.x * offsetTransform.scale.x,
        'composedTransform.scale.x',
      ),
      y: requireFiniteResult(
        layoutTransform.scale.y * offsetTransform.scale.y,
        'composedTransform.scale.y',
      ),
    },
    opacity: Math.max(0, Math.min(1, requireFiniteResult(
      layoutTransform.opacity * offsetTransform.opacity,
      'composedTransform.opacity',
    ))),
  };
}

function transformBounds(
  sourceBounds: ReplicatorBounds,
  transform: EvaluatedReplicatorTransform,
  index: number,
): ReplicatorBounds {
  const radians = requireFiniteResult(
    transform.rotationDegrees * (Math.PI / 180),
    `instances[${index}].bounds.rotationRadians`,
  );
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners: ReadonlyArray<readonly [number, number]> = [
    [sourceBounds.minX, sourceBounds.minY],
    [sourceBounds.maxX, sourceBounds.minY],
    [sourceBounds.maxX, sourceBounds.maxY],
    [sourceBounds.minX, sourceBounds.maxY],
  ];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [sourceX, sourceY] of corners) {
    const scaledX = sourceX * transform.scale.x;
    const scaledY = sourceY * transform.scale.y;
    const x = requireFiniteResult(
      scaledX * cos - scaledY * sin + transform.position.x,
      `instances[${index}].bounds.x`,
    );
    const y = requireFiniteResult(
      scaledX * sin + scaledY * cos + transform.position.y,
      `instances[${index}].bounds.y`,
    );
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    minX: requireFiniteResult(minX, `instances[${index}].bounds.minX`),
    minY: requireFiniteResult(minY, `instances[${index}].bounds.minY`),
    maxX: requireFiniteResult(maxX, `instances[${index}].bounds.maxX`),
    maxY: requireFiniteResult(maxY, `instances[${index}].bounds.maxY`),
  };
}

function unionBounds(left: ReplicatorBounds, right: ReplicatorBounds): ReplicatorBounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
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

export function createMotionReplicatorCacheKey(
  contract: MotionReplicatorContractV2,
  runtimeLimits: ReplicatorRuntimeLimits,
  sourceBounds: ReplicatorBounds,
): string {
  const normalizedContract = migrateMotionReplicatorContract(contract);
  const normalizedRuntimeLimits = readRuntimeLimits(runtimeLimits);
  const normalizedSourceBounds = validateReplicatorBounds(sourceBounds);
  resolveMotionReplicatorLimits(normalizedContract, normalizedRuntimeLimits);
  const canonical = JSON.stringify({
    contract: normalizedContract.contract,
    version: normalizedContract.version,
    enabled: normalizedContract.enabled,
    revision: normalizedContract.revision,
    layout: normalizedContract.layout,
    terminalTransform: normalizedContract.terminalTransform,
    userLimit: normalizedContract.userLimit ?? null,
    runtimeLimits: {
      deviceMaxInstances: normalizedRuntimeLimits.deviceMaxInstances,
      renderTargetMaxInstances: normalizedRuntimeLimits.renderTargetMaxInstances,
    },
    sourceBounds: normalizedSourceBounds,
  });
  return `motion-replicator:v${normalizedContract.version}:r${normalizedContract.revision}:${hashCanonicalString(canonical)}`;
}

/**
 * CPU reference evaluator. Invalid input always fails closed with zero output;
 * it never silently substitutes defaults or emits a partial instance array.
 */
export function evaluateMotionReplicatorReference(
  persistedContract: unknown,
  runtimeLimitsValue: unknown,
  sourceBoundsValue: unknown,
): ReplicatorEvaluation {
  try {
    const contract = migrateMotionReplicatorContract(persistedContract);
    const runtimeLimits = readRuntimeLimits(runtimeLimitsValue);
    const sourceBounds = validateReplicatorBounds(sourceBoundsValue);
    const limits = resolveMotionReplicatorLimits(contract, runtimeLimits);
    const cacheKey = createMotionReplicatorCacheKey(contract, runtimeLimits, sourceBounds);
    if (!contract.enabled) {
      return {
        ok: true,
        enabled: false,
        contractVersion: MOTION_REPLICATOR_CONTRACT_VERSION,
        revision: contract.revision,
        requestedCount: limits.requestedCount,
        effectiveCount: 0,
        sourceBounds,
        contentBounds: null,
        instances: [],
        diagnostics: [],
        cacheKey,
      };
    }
    if (limits.effectiveCount > MOTION_REPLICATOR_REFERENCE_MAX_INSTANCES) {
      throw new MotionReplicatorContractError(
        'MOTION_REPLICATOR_REFERENCE_CAPACITY_EXCEEDED',
        `CPU reference evaluation refuses ${limits.effectiveCount} instances; maximum is ${MOTION_REPLICATOR_REFERENCE_MAX_INSTANCES}`,
        'effectiveCount',
      );
    }
    const instances: EvaluatedReplicatorInstance[] = [];
    let contentBounds: ReplicatorBounds | null = null;

    for (let index = 0; index < limits.effectiveCount; index += 1) {
      const normalizedIndex = getNormalizedIndex(index, limits.requestedCount);
      const layout = evaluateLayout(contract, index);
      const offsetTransform = evaluateOffsetTransform(
        contract,
        index,
        limits.requestedCount,
        normalizedIndex,
      );
      const transform = composeReplicatorTransforms(layout.transform, offsetTransform);
      const bounds = transformBounds(sourceBounds, transform, index);
      contentBounds = contentBounds === null ? bounds : unionBounds(contentBounds, bounds);
      instances.push({
        index,
        normalizedIndex,
        layoutIndex: layout.layoutIndex,
        layoutTransform: layout.transform,
        offsetTransform,
        transform,
        bounds,
      });
    }

    if (contentBounds === null) {
      throw new MotionReplicatorContractError(
        'MOTION_REPLICATOR_INVALID_LIMIT',
        'effective count must produce at least one instance',
        'effectiveCount',
      );
    }

    return {
      ok: true,
      enabled: true,
      contractVersion: MOTION_REPLICATOR_CONTRACT_VERSION,
      revision: contract.revision,
      requestedCount: limits.requestedCount,
      effectiveCount: limits.effectiveCount,
      sourceBounds,
      contentBounds,
      instances,
      diagnostics: limits.diagnostics,
      cacheKey,
    };
  } catch (error) {
    if (error instanceof MotionReplicatorContractError) {
      return fail(error.code, error.message, error.path);
    }
    return fail(
      'MOTION_REPLICATOR_INVALID_CONTRACT',
      error instanceof Error ? error.message : 'Unknown Replicator contract failure',
    );
  }
}
