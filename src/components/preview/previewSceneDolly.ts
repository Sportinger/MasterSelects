const SCENE_DOLLY_WHEEL_SENSITIVITY = 0.00065;
const SCENE_DOLLY_MAX_WHEEL_DELTA_PX = 240;
const SCENE_DOLLY_SMOOTHING_TIME_MS = 42;
const SCENE_DOLLY_STOP_DISTANCE = 0.001;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY)) return 0;
  const pixelDelta = deltaMode === DOM_DELTA_LINE
    ? deltaY * 16
    : deltaMode === DOM_DELTA_PAGE
      ? deltaY * 120
      : deltaY;
  return Math.max(
    -SCENE_DOLLY_MAX_WHEEL_DELTA_PX,
    Math.min(SCENE_DOLLY_MAX_WHEEL_DELTA_PX, pixelDelta),
  );
}

/**
 * Converts one wheel event into scene units along the camera's forward axis.
 * Positive values move toward the orbit target; negative values move away.
 */
export function resolveSceneDollyImpulse(
  currentDistance: number,
  pendingDistance: number,
  deltaY: number,
  deltaMode = 0,
): number {
  const safeCurrentDistance = Number.isFinite(currentDistance)
    ? Math.max(0.001, currentDistance)
    : 1;
  const safePendingDistance = Number.isFinite(pendingDistance) ? pendingDistance : 0;
  const projectedDistance = Math.max(0.001, safeCurrentDistance - safePendingDistance);
  const normalizedDelta = normalizeWheelDelta(deltaY, deltaMode);
  if (normalizedDelta === 0) return 0;

  const targetDistance = projectedDistance * Math.exp(
    normalizedDelta * SCENE_DOLLY_WHEEL_SENSITIVITY,
  );
  return projectedDistance - targetDistance;
}

/** Returns the time-based portion of a pending dolly distance to apply now. */
export function resolveSceneDollyAnimationStep(
  remainingDistance: number,
  elapsedMs: number,
): number {
  if (!Number.isFinite(remainingDistance)) return 0;
  if (Math.abs(remainingDistance) <= SCENE_DOLLY_STOP_DISTANCE) return remainingDistance;

  const safeElapsedMs = Number.isFinite(elapsedMs)
    ? Math.max(0, Math.min(64, elapsedMs))
    : 1000 / 60;
  const smoothingFraction = 1 - Math.exp(-safeElapsedMs / SCENE_DOLLY_SMOOTHING_TIME_MS);
  const step = remainingDistance * smoothingFraction;
  return Math.abs(remainingDistance - step) <= SCENE_DOLLY_STOP_DISTANCE
    ? remainingDistance
    : step;
}
