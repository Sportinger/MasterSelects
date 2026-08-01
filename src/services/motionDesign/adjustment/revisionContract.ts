export const MOTION_ADJUSTMENT_DEFAULT_REVISION = 0;

/** Legacy persisted stacks without a revision migrate explicitly to revision 0. */
export function migrateMotionAdjustmentRevision(value: unknown): number {
  if (value === undefined) return MOTION_ADJUSTMENT_DEFAULT_REVISION;
  assertMotionAdjustmentRevision(value);
  return value;
}

export function assertMotionAdjustmentRevision(
  value: unknown,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('Motion adjustment revision must be a non-negative safe integer');
  }
}
