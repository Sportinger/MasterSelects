export interface PointerLockDragDeltaInput {
  clientX: number;
  lastClientX: number;
  movementX: number;
  pointerLockRequested: boolean;
  pointerLockActive: boolean;
  pointerLockHandoffPending?: boolean;
}

export interface PointerLockDragDeltaResult {
  deltaX: number;
  nextClientX: number;
  pointerLockHandoffConsumed?: boolean;
}

const POINTER_LOCK_HANDOFF_TOLERANCE_PX = 8;
const POINTER_LOCK_HANDOFF_MAX_MOVEMENT_PX = 96;

/**
 * Resolve a horizontal drag delta while pointer lock is being acquired.
 *
 * Chromium can reposition the cursor during the pointer-lock handoff before
 * `pointerlockchange` fires. In that event, `clientX` may jump across the
 * viewport while `movementX` is zero or contains the real small movement.
 */
export function resolvePointerLockDragDeltaX({
  clientX,
  lastClientX,
  movementX,
  pointerLockRequested,
  pointerLockActive,
  pointerLockHandoffPending = false,
}: PointerLockDragDeltaInput): PointerLockDragDeltaResult {
  const safeMovementX = Number.isFinite(movementX) ? movementX : 0;
  const clientDeltaX = clientX - lastClientX;

  // Chromium may emit the cursor-warp event before `pointerlockchange`.
  // During that short window both clientX and movementX can jump by roughly
  // the viewport width while pointerLockActive is still false. Keep the
  // handoff guard armed so a following active warp event is protected too.
  if (
    pointerLockRequested &&
    pointerLockHandoffPending &&
    !pointerLockActive &&
    (
      Math.abs(clientDeltaX) > POINTER_LOCK_HANDOFF_MAX_MOVEMENT_PX ||
      Math.abs(safeMovementX) > POINTER_LOCK_HANDOFF_MAX_MOVEMENT_PX
    )
  ) {
    return {
      deltaX: 0,
      nextClientX: clientX,
    };
  }

  if (pointerLockActive) {
    if (
      pointerLockHandoffPending &&
      Math.abs(safeMovementX) > POINTER_LOCK_HANDOFF_MAX_MOVEMENT_PX
    ) {
      return {
        deltaX: 0,
        nextClientX: clientX,
        pointerLockHandoffConsumed: true,
      };
    }

    // Chromium may emit an empty locked event before the actual cursor-warp
    // event. Keep the handoff guard armed until the first non-zero movement.
    if (pointerLockHandoffPending && safeMovementX === 0) {
      return {
        deltaX: 0,
        nextClientX: clientX,
      };
    }

    return {
      deltaX: safeMovementX,
      nextClientX: clientX,
      ...(pointerLockHandoffPending
        ? { pointerLockHandoffConsumed: true }
        : {}),
    };
  }

  if (pointerLockRequested) {
    const movementContinuedWhileClientXStayedFixed =
      clientDeltaX === 0 && safeMovementX !== 0;
    const handoffSignalsDisagree =
      Math.abs(clientDeltaX - safeMovementX) >
      Math.max(
        POINTER_LOCK_HANDOFF_TOLERANCE_PX,
        Math.abs(safeMovementX) * 4,
      );

    if (movementContinuedWhileClientXStayedFixed || handoffSignalsDisagree) {
      return {
        deltaX: safeMovementX,
        nextClientX: clientX,
      };
    }
  }

  return {
    deltaX: clientDeltaX,
    nextClientX: clientX,
  };
}
