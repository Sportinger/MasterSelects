import type { TrackingAsset } from '../../../types/trackingAsset';
import type { PlanarTrack } from '../../../types/planarTracking';
import { sourceStabilization, type SourceStabilizationSettings } from '../../../services/planarTracking/sourceStabilization';

export interface SlitScanStabilization {
  identity: string;
  track: PlanarTrack;
  settings: SourceStabilizationSettings;
  width: number;
  height: number;
}

export class SlitScanTrackingGap extends Error {}

/** Resolve once from the canonical asset; cached source pixels depend on its revision. */
export function slitScanStabilization(params: Record<string, unknown>, assets: readonly TrackingAsset[],
  mediaId: string, width: number, height: number): SlitScanStabilization | undefined {
  const id = params.stabilizationAssetId;
  if (typeof id !== 'string' || !id) return undefined;
  const asset = assets.find(item => item.id === id);
  if (!asset) throw new Error('Stabilization tracking is missing. Choose a tracking result or Off.');
  if (asset.sourceMediaId !== mediaId || asset.track.sourceId !== mediaId) {
    throw new Error('Stabilization tracking belongs to a different source video.');
  }
  const settings: SourceStabilizationSettings = {
    referenceTime: Number(params.stabilizationReference ?? asset.track.referenceTime),
    strength: Number(params.stabilizationStrength ?? 1), position: true,
    rotation: params.stabilizationRotation !== 'off', scale: params.stabilizationScale !== 'off',
  };
  if (!Number.isFinite(settings.referenceTime) || !Number.isFinite(settings.strength)) {
    throw new Error('Invalid stabilization reference time or strength.');
  }
  // The legacy track toggle controls its visible marker. Choosing it here is
  // independent: do not require or enable an unwanted marker in the video.
  return { identity: JSON.stringify([id, asset.revision, settings, width, height]), track: { ...asset.track, enabled: true }, settings, width, height };
}

export function slitScanSourceTransform(stabilization: SlitScanStabilization, sourceTime: number): number[] {
  const result = sourceStabilization(stabilization.track, sourceTime, stabilization.settings,
    stabilization.width, stabilization.height);
  if (!result.valid) throw new SlitScanTrackingGap(`Stabilization ${result.reason} at source ${sourceTime.toFixed(3)} s. Track the full delay window or choose Off.`);
  return result.outputToSource;
}
