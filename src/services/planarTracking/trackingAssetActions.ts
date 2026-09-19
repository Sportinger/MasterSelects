import type { TrackingAsset } from '../../types/trackingAsset';

export const TRACKING_ASSET_ACTION_EVENT = 'masterselects:tracking-asset-action';

export type TrackingAssetAction = 'open' | 'use' | 'scene-3d';

type TrackingAssetActionTarget = {
  assetId: string;
  sourceVideoClipId?: string;
  allowApproximateCamera?: boolean;
};

export type TrackingAssetActionEventDetail =
  | (TrackingAssetActionTarget & { action: 'open' })
  | (TrackingAssetActionTarget & { action: 'use' })
  | (TrackingAssetActionTarget & { action: 'scene-3d' });

/** Ask the application shell to act on an asset without copying its track geometry. */
export function requestTrackingAssetAction(
  action: TrackingAssetAction,
  asset: Pick<TrackingAsset, 'id' | 'sourceVideoClipId'>,
  options?: {allowApproximateCamera?: boolean},
): void {
  if (typeof window === 'undefined') return;
  const detail = {
    action,
    assetId: asset.id,
    ...(asset.sourceVideoClipId ? { sourceVideoClipId: asset.sourceVideoClipId } : {}),
    ...(options?.allowApproximateCamera ? {allowApproximateCamera:true} : {}),
  } as TrackingAssetActionEventDetail;
  window.dispatchEvent(new CustomEvent<TrackingAssetActionEventDetail>(TRACKING_ASSET_ACTION_EVENT, { detail }));
}
