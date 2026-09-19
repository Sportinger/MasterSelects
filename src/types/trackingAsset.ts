import type { PlanarTrack } from './planarTracking';

/** A reusable, project-owned surface track. Runtime media and GPU handles never belong here. */
export interface TrackingAsset {
  id: string;
  type: 'tracking';
  name: string;
  parentId: string | null;
  createdAt: number;
  sourceMediaId: string;
  sourceVideoClipId?: string;
  sourceCompositionId?: string;
  track: PlanarTrack;
  revision: number;
}

export type TrackingAssetId = TrackingAsset['id'];
