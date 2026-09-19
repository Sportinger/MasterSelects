import type { MouseEvent, PointerEvent } from 'react';

import { requestTrackingAssetAction, type TrackingAssetAction } from '../../../services/planarTracking/trackingAssetActions';
import { useTrackingStore } from '../../../stores/trackingStore';
import type { TrackingAsset } from '../../../types/trackingAsset';
import { getTrackingAssetCoverageLabel, getTrackingAssetStateLabel } from './trackingAssetPresentation';

function stopPointer(event: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>): void {
  event.stopPropagation();
}

export function TrackingAssetActions({ asset }: { asset: TrackingAsset }) {
  const requestAction = (event: MouseEvent<HTMLButtonElement>, action: TrackingAssetAction) => {
    event.stopPropagation();
    useTrackingStore.getState().selectAsset(asset.id);
    requestTrackingAssetAction(action, asset);
    if (event.detail > 0) event.currentTarget.blur();
  };

  return (
    <div
      className="tracking-asset-actions"
      onMouseDown={stopPointer}
      onPointerDown={stopPointer}
      onDoubleClick={stopPointer}
    >
      <span
        className="tracking-asset-badge"
        title={[getTrackingAssetStateLabel(asset), getTrackingAssetCoverageLabel(asset)].filter(Boolean).join('\n')}
      >Track</span>
      <button type="button" onClick={(event) => requestAction(event, 'use')}>Use</button>
      <button type="button" onClick={(event) => requestAction(event, 'scene-3d')}>3D</button>
    </div>
  );
}
