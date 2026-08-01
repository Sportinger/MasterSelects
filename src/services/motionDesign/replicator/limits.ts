import {
  MotionReplicatorContractError,
  migrateMotionReplicatorContract,
  preflightMotionReplicatorLayout,
  preflightReplicatorRuntimeLimits,
  type MotionReplicatorContractV2,
  type MotionReplicatorLayout,
  type ReplicatorCapDiagnosticCode,
  type ReplicatorDiagnostic,
  type ReplicatorRuntimeLimits,
} from './contracts';

export interface ResolvedReplicatorLimits {
  requestedCount: number;
  effectiveCount: number;
  userLimit: number | null;
  deviceLimit: number;
  renderTargetLimit: number;
  diagnostics: ReplicatorDiagnostic[];
}

function requirePositiveSafeLimit(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_NON_FINITE_VALUE',
      `${path} must be finite`,
      path,
    );
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_LIMIT',
      `${path} must be a positive safe integer`,
      path,
    );
  }
  return value;
}

export function getRequestedReplicatorCount(layout: MotionReplicatorLayout): number {
  preflightMotionReplicatorLayout(layout);
  if (layout.mode === 'grid') {
    if (
      !Number.isSafeInteger(layout.count.columns)
      || layout.count.columns < 1
      || !Number.isSafeInteger(layout.count.rows)
      || layout.count.rows < 1
    ) {
      throw new MotionReplicatorContractError(
        'MOTION_REPLICATOR_INVALID_COUNT',
        'layout grid axes must be positive safe integers',
        'layout.count',
      );
    }
    const requested = layout.count.columns * layout.count.rows;
    if (!Number.isSafeInteger(requested) || requested < 1) {
      throw new MotionReplicatorContractError(
        'MOTION_REPLICATOR_INVALID_COUNT',
        'layout grid count product must be a positive safe integer',
        'layout.count',
      );
    }
    return requested;
  }
  if (!Number.isSafeInteger(layout.count) || layout.count < 1) {
    throw new MotionReplicatorContractError(
      'MOTION_REPLICATOR_INVALID_COUNT',
      'layout count must be a positive safe integer',
      'layout.count',
    );
  }
  return layout.count;
}

function createCapDiagnostic(
  code: ReplicatorCapDiagnosticCode,
  label: string,
  requestedCount: number,
  effectiveCount: number,
  limit: number,
): ReplicatorDiagnostic {
  return {
    code,
    severity: 'warning',
    message: `Requested ${requestedCount} instances; ${label} caps this request at ${limit}`,
    requestedCount,
    limit,
    binding: limit === effectiveCount,
  };
}

/**
 * Resolves persisted intent against runtime capabilities. Diagnostics are
 * always ordered user, device, render target. Every cap below the requested
 * count is reported; `binding` identifies the cap(s) that set the result.
 */
export function resolveMotionReplicatorLimits(
  contract: MotionReplicatorContractV2,
  runtimeLimits: ReplicatorRuntimeLimits,
): ResolvedReplicatorLimits {
  const normalizedContract = migrateMotionReplicatorContract(contract);
  preflightReplicatorRuntimeLimits(runtimeLimits);
  const requestedCount = getRequestedReplicatorCount(normalizedContract.layout);
  const userLimit = normalizedContract.userLimit === undefined
    ? null
    : requirePositiveSafeLimit(normalizedContract.userLimit, 'replicator.userLimit');
  const deviceLimit = requirePositiveSafeLimit(
    runtimeLimits.deviceMaxInstances,
    'runtimeLimits.deviceMaxInstances',
  );
  const renderTargetLimit = requirePositiveSafeLimit(
    runtimeLimits.renderTargetMaxInstances,
    'runtimeLimits.renderTargetMaxInstances',
  );
  if (!normalizedContract.enabled) {
    return {
      requestedCount,
      effectiveCount: 0,
      userLimit,
      deviceLimit,
      renderTargetLimit,
      diagnostics: [],
    };
  }
  const effectiveCount = Math.min(
    requestedCount,
    userLimit ?? Number.POSITIVE_INFINITY,
    deviceLimit,
    renderTargetLimit,
  );

  const diagnostics: ReplicatorDiagnostic[] = [];
  if (userLimit !== null && userLimit < requestedCount) {
    diagnostics.push(createCapDiagnostic(
      'MOTION_REPLICATOR_CAPPED_BY_USER_LIMIT',
      'the persisted user limit',
      requestedCount,
      effectiveCount,
      userLimit,
    ));
  }
  if (deviceLimit < requestedCount) {
    diagnostics.push(createCapDiagnostic(
      'MOTION_REPLICATOR_CAPPED_BY_DEVICE_LIMIT',
      'the runtime device limit',
      requestedCount,
      effectiveCount,
      deviceLimit,
    ));
  }
  if (renderTargetLimit < requestedCount) {
    diagnostics.push(createCapDiagnostic(
      'MOTION_REPLICATOR_CAPPED_BY_RENDER_TARGET_LIMIT',
      'the render-target limit',
      requestedCount,
      effectiveCount,
      renderTargetLimit,
    ));
  }

  return {
    requestedCount,
    effectiveCount,
    userLimit,
    deviceLimit,
    renderTargetLimit,
    diagnostics,
  };
}
