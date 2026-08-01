import { assertMotionMediaSourceId } from '../media/sourceReferencePlanner';
import { isMotionAdjustmentStableReference } from './contractLimits';

export type MotionAdjustmentSourceKind =
  | 'timeline-media'
  | 'motion-media'
  | 'title'
  | 'nested-composition';

export function assertMotionAdjustmentSourceIdentity(
  sourceKind: unknown,
  sourceId: unknown,
): asserts sourceId is string {
  if (!isMotionAdjustmentSourceKind(sourceKind)) {
    throw new Error('Invalid motion adjustment source kind');
  }
  if (sourceKind === 'motion-media') {
    assertMotionMediaSourceId(sourceId);
    return;
  }
  if (!isOpaqueStableSourceId(sourceId)) {
    throw new Error(`Invalid ${sourceKind} adjustment source id`);
  }
}

export function isMotionAdjustmentSourceKind(
  value: unknown,
): value is MotionAdjustmentSourceKind {
  return value === 'timeline-media'
    || value === 'motion-media'
    || value === 'title'
    || value === 'nested-composition';
}

function isOpaqueStableSourceId(value: unknown): value is string {
  return isMotionAdjustmentStableReference(value)
    && value.trim() === value
    && !value.includes('\\')
    && !value.includes('/');
}
