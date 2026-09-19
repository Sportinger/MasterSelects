import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { clonePlanarTracks } from '../services/planarTracking/clonePlanarTracks';
import { areTrackingAssetsEqual } from '../services/planarTracking/trackingAssetEquality';
import type { PlanarTrack } from '../types/planarTracking';
import type { TrackingAsset } from '../types/trackingAsset';

export interface TrackingStoreState {
  assets: TrackingAsset[];
  selectedAssetId: string | null;
}

export interface TrackingStoreActions {
  upsertAsset(asset: TrackingAsset): void;
  removeAsset(id: string): void;
  renameAsset(id: string, name: string): void;
  moveAsset(id: string, parentId: string | null): void;
  selectAsset(id: string | null): void;
  hydrateAssets(assets: readonly TrackingAsset[], selectedAssetId?: string | null): void;
  reset(): void;
}

export type TrackingStore = TrackingStoreState & TrackingStoreActions;

const initialState = (): TrackingStoreState => ({ assets: [], selectedAssetId: null });

function isPlanarTrack(value: unknown): value is PlanarTrack {
  if (!value || typeof value !== 'object') return false;
  const track = value as Partial<PlanarTrack>;
  return typeof track.id === 'string'
    && track.id.length > 0
    && typeof track.sourceId === 'string'
    && Array.isArray(track.samples)
    && Array.isArray(track.occlusions);
}

export function normalizeTrackingAssets(assets: readonly TrackingAsset[] | undefined): TrackingAsset[] {
  if (!Array.isArray(assets)) return [];
  const normalized = new Map<string, TrackingAsset>();
  for (const value of assets) {
    if (!value || value.type !== 'tracking' || typeof value.id !== 'string' || !value.id) continue;
    if (typeof value.name !== 'string' || typeof value.sourceMediaId !== 'string' || !value.sourceMediaId) continue;
    if (!isPlanarTrack(value.track)) continue;
    normalized.set(value.id, {
      id: value.id,
      type: 'tracking',
      name: value.name.trim() || value.track.name || 'Tracking',
      parentId: typeof value.parentId === 'string' ? value.parentId : null,
      createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
      sourceMediaId: value.sourceMediaId,
      ...(typeof value.sourceVideoClipId === 'string' ? { sourceVideoClipId: value.sourceVideoClipId } : {}),
      ...(typeof value.sourceCompositionId === 'string' ? { sourceCompositionId: value.sourceCompositionId } : {}),
      track: clonePlanarTracks([value.track])![0]!,
      revision: Number.isInteger(value.revision) && value.revision > 0 ? value.revision : 1,
    });
  }
  return [...normalized.values()];
}

export function cloneTrackingAssets(assets: readonly TrackingAsset[] | undefined): TrackingAsset[] {
  return normalizeTrackingAssets(assets);
}

export const useTrackingStore = create<TrackingStore>()(subscribeWithSelector((set) => ({
  ...initialState(),
  upsertAsset: (asset) => set((state) => {
    const current = state.assets.find((candidate) => candidate.id === asset.id);
    if (current && areTrackingAssetsEqual(current, asset)) return state;
    const [normalized] = normalizeTrackingAssets([asset]);
    if (!normalized) return state;
    const index = state.assets.findIndex((candidate) => candidate.id === normalized.id);
    if (index < 0) return { assets: [...state.assets, normalized] };
    if (areTrackingAssetsEqual(state.assets[index]!, normalized)) return state;
    const assets = [...state.assets];
    assets[index] = normalized;
    return { assets };
  }),
  removeAsset: (id) => set((state) => {
    if (!state.assets.some((asset) => asset.id === id)) return state;
    return {
      assets: state.assets.filter((asset) => asset.id !== id),
      selectedAssetId: state.selectedAssetId === id ? null : state.selectedAssetId,
    };
  }),
  renameAsset: (id, name) => set((state) => {
    const normalizedName = name.trim();
    if (!normalizedName) return state;
    const asset = state.assets.find((candidate) => candidate.id === id);
    if (!asset || asset.name === normalizedName) return state;
    return {
      assets: state.assets.map((candidate) => candidate.id === id
        ? { ...candidate, name: normalizedName, revision: candidate.revision + 1 }
        : candidate),
    };
  }),
  moveAsset: (id, parentId) => set((state) => {
    const asset = state.assets.find((candidate) => candidate.id === id);
    if (!asset || asset.parentId === parentId) return state;
    return {
      assets: state.assets.map((candidate) => candidate.id === id
        ? { ...candidate, parentId, revision: candidate.revision + 1 }
        : candidate),
    };
  }),
  selectAsset: (id) => set((state) => ({
    selectedAssetId: id && state.assets.some((asset) => asset.id === id) ? id : null,
  })),
  hydrateAssets: (assets, selectedAssetId = null) => set(() => {
    const normalized = normalizeTrackingAssets(assets);
    return {
      assets: normalized,
      selectedAssetId: selectedAssetId && normalized.some((asset) => asset.id === selectedAssetId)
        ? selectedAssetId
        : null,
    };
  }),
  reset: () => set(initialState()),
})));

export function getTrackingStoreSnapshot(): TrackingStoreState {
  const state = useTrackingStore.getState();
  return {
    assets: cloneTrackingAssets(state.assets),
    selectedAssetId: state.selectedAssetId,
  };
}
