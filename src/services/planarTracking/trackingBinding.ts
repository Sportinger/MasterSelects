import { useTimelineStore } from '../../stores/timeline';
import type { PlanarTrack } from '../../types/planarTracking';
import type { TrackingBinding } from '../../types/trackingBinding';
import type { TimelineClip } from '../../types/timeline';
import { getTrackingAsset } from './trackingAssets';
import { getTerrainSurfaceReconstruction } from './terrainSurfaceMesh';

function clipMediaId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

function sameCompositionTarget(
  clips: readonly TimelineClip[],
  sourceMediaId: string,
  preferredId: string | undefined,
  boundClipId: string,
): TimelineClip | undefined {
  const eligible = (clip: TimelineClip) => clip.id !== boundClipId
    && clip.source?.type === 'video'
    && clipMediaId(clip) === sourceMediaId;
  return clips.find((clip) => clip.id === preferredId && eligible(clip))
    ?? clips.find(eligible);
}

function defaultPlacement(track: PlanarTrack): TrackingBinding['placement'] {
  const terrain = track.terrain ? getTerrainSurfaceReconstruction(track.terrain) : undefined;
  const mesh = terrain?.denseMesh ?? terrain?.footsteps?.find((step) => step.mesh)?.mesh;
  if (mesh) {
    const authored = track.placement;
    let center = { x: 0, y: 0 };
    if (!authored) {
      let largestAreaSquared = -1;
      for (let cursor = 0; cursor + 2 < mesh.indices.length; cursor += 3) {
        const ia = mesh.indices[cursor]! * 3;
        const ib = mesh.indices[cursor + 1]! * 3;
        const ic = mesh.indices[cursor + 2]! * 3;
        const a = [mesh.positions[ia]!, mesh.positions[ia + 1]!, mesh.positions[ia + 2]!];
        const ab = [mesh.positions[ib]! - a[0], mesh.positions[ib + 1]! - a[1], mesh.positions[ib + 2]! - a[2]];
        const ac = [mesh.positions[ic]! - a[0], mesh.positions[ic + 1]! - a[1], mesh.positions[ic + 2]! - a[2]];
        const cross = [
          ab[1]! * ac[2]! - ab[2]! * ac[1]!,
          ab[2]! * ac[0]! - ab[0]! * ac[2]!,
          ab[0]! * ac[1]! - ab[1]! * ac[0]!,
        ];
        const areaSquared = cross.reduce((sum, value) => sum + value * value, 0);
        if (!(areaSquared > largestAreaSquared)) continue;
        largestAreaSquared = areaSquared;
        const centroid = [
          (a[0] + mesh.positions[ib]! + mesh.positions[ic]!) / 3,
          (a[1] + mesh.positions[ib + 1]! + mesh.positions[ic + 1]!) / 3,
          (a[2] + mesh.positions[ib + 2]! + mesh.positions[ic + 2]!) / 3,
        ];
        const delta = centroid.map((value, index) => value - mesh.origin[index]!);
        center = {
          x: delta.reduce((sum, value, index) => sum + value * mesh.axisX[index]!, 0),
          y: delta.reduce((sum, value, index) => sum + value * mesh.axisY[index]!, 0),
        };
      }
    }
    return {
      x: authored?.x ?? center.x,
      y: authored?.y ?? center.y,
      width: mesh.size[0] * 0.2,
      height: mesh.size[1] * 0.2,
      rotation: authored?.rotation ?? 0,
    };
  }
  return track.placement
    ? structuredClone(track.placement)
    : { x: 0.5, y: 0.5, width: 1, height: 1, rotation: 0 };
}

const UNSUPPORTED_TRACKING_SOURCES = new Set([
  'audio', 'midi', 'model', 'camera', 'light', 'gaussian-avatar',
  'gaussian-splat', 'splat-effector', 'motion-null', 'motion-adjustment', 'flock',
]);

/** Shared picker/authoring eligibility for ordinary composited 2D clips. */
export function isTrackingBindingEligibleClip(clip: TimelineClip): boolean {
  return !clip.is3D
    && !!clip.source?.type
    && !UNSUPPORTED_TRACKING_SOURCES.has(clip.source.type);
}

/** Bind an existing ordinary clip without copying any tracking geometry into it. */
export function bindClipToTrackingAsset(
  clipId: string,
  assetId: string,
  mode: TrackingBinding['mode'],
): TrackingBinding {
  const asset = getTrackingAsset(assetId);
  if (!asset) throw new Error('The selected tracking asset is no longer available.');
  const timeline = useTimelineStore.getState();
  const clip = timeline.clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error('Select a timeline clip before applying tracking.');
  if (timeline.isExporting || timeline.tracks.find((track) => track.id === clip.trackId)?.locked) {
    throw new Error('The selected clip is locked or the timeline is being exported.');
  }
  if (!isTrackingBindingEligibleClip(clip)) {
    throw new Error('This clip type cannot use a 2D tracking binding. Choose a 2D visual clip.');
  }
  const existing = clip.trackingBinding?.assetId === assetId
    ? clip.trackingBinding
    : undefined;
  if (existing) {
    const binding: TrackingBinding = {
      ...structuredClone(existing),
      mode,
      ...((mode === 'surface' || asset.track.terrain) && !existing.placement
        ? { placement: defaultPlacement(asset.track) }
        : {}),
    };
    timeline.updateClip(clipId, { trackingBinding: binding });
    return binding;
  }
  const target = sameCompositionTarget(
    timeline.clips,
    asset.sourceMediaId,
    asset.sourceVideoClipId,
    clipId,
  );
  const binding: TrackingBinding = {
    version: 1,
    assetId,
    ...(target ? { targetVideoClipId: target.id } : { sourceStart: asset.track.referenceTime }),
    mode,
    point: { x: 0.5, y: 0.5 },
    offset: { x: 0, y: 0 },
    ...(mode === 'surface' || asset.track.terrain ? { placement: defaultPlacement(asset.track) } : {}),
  };
  timeline.updateClip(clipId, { trackingBinding: binding });
  return binding;
}
