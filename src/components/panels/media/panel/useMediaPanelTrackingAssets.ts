import { useCallback, useMemo } from 'react';

import { requestTrackingAssetAction, type TrackingAssetAction } from '../../../../services/planarTracking/trackingAssetActions';
import { useTrackingStore } from '../../../../stores/trackingStore';
import type { TrackingAsset } from '../../../../types/trackingAsset';

export function useMediaPanelTrackingAssets(
  moveMediaItemsToFolder: (ids: string[], parentId: string | null) => void,
) {
  const trackingAssets = useTrackingStore(state => state.assets);
  const trackingAssetIds = useMemo(
    () => new Set(trackingAssets.map(asset => asset.id)),
    [trackingAssets],
  );

  const moveProjectItemsToFolder = useCallback((ids: readonly string[], parentId: string | null) => {
    const mediaItemIds: string[] = [];
    const trackingStore = useTrackingStore.getState();
    ids.forEach((id) => {
      if (trackingAssetIds.has(id)) trackingStore.moveAsset(id, parentId);
      else mediaItemIds.push(id);
    });
    if (mediaItemIds.length > 0) moveMediaItemsToFolder(mediaItemIds, parentId);
  }, [moveMediaItemsToFolder, trackingAssetIds]);

  const selectTrackingAssetForProjectItem = useCallback((id: string, preserveExistingSelection = false) => {
    const trackingStore = useTrackingStore.getState();
    if (trackingAssetIds.has(id)) trackingStore.selectAsset(id);
    else if (!preserveExistingSelection) trackingStore.selectAsset(null);
  }, [trackingAssetIds]);

  const requestAction = useCallback((action: TrackingAssetAction, asset: TrackingAsset) => {
    useTrackingStore.getState().selectAsset(asset.id);
    requestTrackingAssetAction(action, asset);
  }, []);

  return {
    trackingAssets,
    trackingAssetIds,
    moveProjectItemsToFolder,
    selectTrackingAssetForProjectItem,
    requestTrackingAssetAction: requestAction,
    renameTrackingAsset: useTrackingStore.getState().renameAsset,
    removeTrackingAsset: useTrackingStore.getState().removeAsset,
    moveTrackingAsset: useTrackingStore.getState().moveAsset,
  };
}
