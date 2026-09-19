import { isRetainedTerrainMesh } from './immutableTerrainMesh';
import type { PlanarTrack } from '../../types/planarTracking';
import type { TrackingAsset } from '../../types/trackingAsset';

function areTrackingValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;

  // Dense meshes are immutable and retained across clip, asset, history, and
  // package projections. Their identity is their equality token; never scan
  // millions of numeric entries just to decide whether an edit was a no-op.
  if (isRetainedTerrainMesh(left) || isRetainedTerrainMesh(right)) return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!areTrackingValuesEqual(left[index], right[index])) return false;
    }
    return true;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) return false;
    if (!areTrackingValuesEqual(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

export function arePlanarTracksEqual(left: PlanarTrack, right: PlanarTrack): boolean {
  return areTrackingValuesEqual(left, right);
}

export function areTrackingAssetsEqual(left: TrackingAsset, right: TrackingAsset): boolean {
  return left.id === right.id
    && left.type === right.type
    && left.name === right.name
    && left.parentId === right.parentId
    && left.createdAt === right.createdAt
    && left.sourceMediaId === right.sourceMediaId
    && left.sourceVideoClipId === right.sourceVideoClipId
    && left.sourceCompositionId === right.sourceCompositionId
    && left.revision === right.revision
    && arePlanarTracksEqual(left.track, right.track);
}
