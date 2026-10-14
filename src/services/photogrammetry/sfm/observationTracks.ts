import { reprojectionError } from './geometry';
import type { CameraPose, FrameFeatures, Point2, SparsePoint } from './types';

export type FeatureAssignments = Map<number, Map<number, number>>;
export const MAX_TRACK_ERROR = 3.5;

export function featurePoint(frame: FrameFeatures, featureIndex: number): Point2 {
  return { x: frame.points[featureIndex * 2], y: frame.points[featureIndex * 2 + 1] };
}

export function assignmentMap(assignments: FeatureAssignments, frameIndex: number): Map<number, number> {
  let map = assignments.get(frameIndex);
  if (!map) { map = new Map(); assignments.set(frameIndex, map); }
  return map;
}

/** Both directions must stay unique: one point per feature, one feature per view. */
export function canAttachObservation(point: SparsePoint, pointIndex: number, frame: FrameFeatures,
  pose: CameraPose, featureIndex: number, assignments: FeatureAssignments, focal: number, principal: Point2): boolean {
  const owner = assignments.get(frame.sourceIndex)?.get(featureIndex);
  if (owner !== undefined && owner !== pointIndex) return false;
  const existing = point.observations.find(observation => observation.frameIndex === frame.sourceIndex);
  if (existing && existing.featureIndex !== featureIndex) return false;
  const error = reprojectionError(pose, point.position, featurePoint(frame, featureIndex), focal, principal);
  return Number.isFinite(error) && error <= MAX_TRACK_ERROR;
}

export function attachObservation(point: SparsePoint, pointIndex: number, frame: FrameFeatures,
  pose: CameraPose, featureIndex: number, assignments: FeatureAssignments, focal: number, principal: Point2): boolean {
  if (!canAttachObservation(point, pointIndex, frame, pose, featureIndex, assignments, focal, principal)) return false;
  assignmentMap(assignments, frame.sourceIndex).set(featureIndex, pointIndex);
  if (!point.observations.some(observation => observation.frameIndex === frame.sourceIndex)) {
    const count = point.observations.length;
    const error = reprojectionError(pose, point.position, featurePoint(frame, featureIndex), focal, principal);
    point.error = (point.error * count + error) / (count + 1);
    point.observations.push({ frameIndex: frame.sourceIndex, featureIndex });
  }
  return true;
}
