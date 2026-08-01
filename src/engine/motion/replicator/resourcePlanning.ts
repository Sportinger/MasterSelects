import {
  MOTION_REPLICATOR_DEFAULT_MAX_BUFFER_CAPACITY,
  MOTION_REPLICATOR_MIN_BUFFER_CAPACITY,
  type ReplicatorRuntimeDiagnostic,
  type ReplicatorSourceTexturePlan,
  type ReplicatorViewport,
} from './runtimeContracts';

export interface ReplicatorCapacityRequest {
  currentCapacity: number;
  requiredInstances: number;
  maxCapacity?: number;
  minimumCapacity?: number;
}

export interface ReplicatorCapacityPlan {
  ok: boolean;
  capacity: number;
  reallocated: boolean;
  diagnostic: ReplicatorRuntimeDiagnostic | null;
}

function requireNonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function requireFiniteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number greater than or equal to zero`);
  }
  return Object.is(value, -0) ? 0 : value;
}

export function planReplicatorInstanceCapacity(
  request: ReplicatorCapacityRequest,
): ReplicatorCapacityPlan {
  const currentCapacity = requireNonNegativeSafeInteger(
    request.currentCapacity,
    'currentCapacity',
  );
  const requiredInstances = requireNonNegativeSafeInteger(
    request.requiredInstances,
    'requiredInstances',
  );
  const maxCapacity = requirePositiveSafeInteger(
    request.maxCapacity ?? MOTION_REPLICATOR_DEFAULT_MAX_BUFFER_CAPACITY,
    'maxCapacity',
  );
  const minimumCapacity = requirePositiveSafeInteger(
    request.minimumCapacity ?? MOTION_REPLICATOR_MIN_BUFFER_CAPACITY,
    'minimumCapacity',
  );
  if (minimumCapacity > maxCapacity) {
    throw new RangeError('minimumCapacity must not exceed maxCapacity');
  }
  if (currentCapacity > maxCapacity) {
    throw new RangeError('currentCapacity must not exceed maxCapacity');
  }
  if (requiredInstances > maxCapacity) {
    return {
      ok: false,
      capacity: currentCapacity,
      reallocated: false,
      diagnostic: {
        code: 'MOTION_REPLICATOR_BUFFER_CAPACITY_EXCEEDED',
        severity: 'error',
        message: `Required ${requiredInstances} instances exceed buffer capacity ${maxCapacity}`,
        limit: maxCapacity,
        actual: requiredInstances,
      },
    };
  }
  if (requiredInstances <= currentCapacity) {
    return { ok: true, capacity: currentCapacity, reallocated: false, diagnostic: null };
  }

  let capacity = currentCapacity === 0 ? Math.min(minimumCapacity, maxCapacity) : currentCapacity;
  while (capacity < requiredInstances) {
    const doubled = capacity * 2;
    capacity = doubled > maxCapacity ? maxCapacity : doubled;
  }
  return { ok: true, capacity, reallocated: true, diagnostic: null };
}

export function validateReplicatorViewport(value: ReplicatorViewport): ReplicatorViewport {
  const coordinates = [value.minX, value.minY, value.maxX, value.maxY];
  for (let index = 0; index < coordinates.length; index += 1) {
    if (!Number.isFinite(coordinates[index])) {
      throw new RangeError('viewport coordinates must be finite');
    }
  }
  if (value.minX > value.maxX || value.minY > value.maxY) {
    throw new RangeError('viewport minimums must not exceed maximums');
  }
  return {
    minX: Object.is(value.minX, -0) ? 0 : value.minX,
    minY: Object.is(value.minY, -0) ? 0 : value.minY,
    maxX: Object.is(value.maxX, -0) ? 0 : value.maxX,
    maxY: Object.is(value.maxY, -0) ? 0 : value.maxY,
  };
}

export interface ReplicatorSourceTextureRequest {
  sourceWidth: number;
  sourceHeight: number;
  strokePadding: number;
  maxTextureDimension2D: number;
  maxTexturePixels: number;
}

/**
 * Plans a full-resolution source texture. An unsupported size fails closed;
 * this layer never silently scales or crops a source because either changes
 * preview/export semantics.
 */
export function planReplicatorSourceTexture(
  request: ReplicatorSourceTextureRequest,
): ReplicatorSourceTexturePlan {
  const sourceWidth = requireFiniteNonNegative(request.sourceWidth, 'sourceWidth');
  const sourceHeight = requireFiniteNonNegative(request.sourceHeight, 'sourceHeight');
  const strokePadding = requireFiniteNonNegative(request.strokePadding, 'strokePadding');
  const maxTextureDimension2D = requirePositiveSafeInteger(
    request.maxTextureDimension2D,
    'maxTextureDimension2D',
  );
  const maxTexturePixels = requirePositiveSafeInteger(request.maxTexturePixels, 'maxTexturePixels');
  const width = Math.max(1, Math.ceil(sourceWidth + strokePadding * 2));
  const height = Math.max(1, Math.ceil(sourceHeight + strokePadding * 2));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new RangeError('padded texture dimensions must be safe integers');
  }
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount)) {
    throw new RangeError('texture pixel count must be a safe integer');
  }

  const diagnostics: ReplicatorRuntimeDiagnostic[] = [];
  if (width > maxTextureDimension2D || height > maxTextureDimension2D) {
    diagnostics.push({
      code: 'MOTION_REPLICATOR_TEXTURE_DIMENSION_EXCEEDED',
      severity: 'error',
      message: `Padded texture ${width}x${height} exceeds maximum dimension ${maxTextureDimension2D}`,
      limit: maxTextureDimension2D,
      actual: Math.max(width, height),
    });
  }
  if (pixelCount > maxTexturePixels) {
    diagnostics.push({
      code: 'MOTION_REPLICATOR_TEXTURE_PIXEL_BUDGET_EXCEEDED',
      severity: 'error',
      message: `Padded texture uses ${pixelCount} pixels; maximum is ${maxTexturePixels}`,
      limit: maxTexturePixels,
      actual: pixelCount,
    });
  }
  return {
    ok: diagnostics.length === 0,
    width,
    height,
    strokePadding,
    pixelCount,
    diagnostics,
  };
}
