import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { SurfaceQuad } from '../types/planarTracking';

/** Transient authoring selection. Geometry and media stay in their owning stores. */
interface TrackingEditorState {
  assetId: string | null;
  openedAssetId: string | null;
  clipId: string | null;
  trackId: string | null;
  view: 'video' | '3d';
  tool: 'inspect' | 'surface' | 'occlusion' | 'place';
  draft: SurfaceQuad | null;
  active: boolean;
  actionBusy: boolean;
  attachMode: 'follow' | 'surface' | null;
  message: string;
  setEditor: (patch: Partial<Omit<TrackingEditorState, 'setEditor'>>) => void;
}

export const useTrackingEditorStore = create<TrackingEditorState>()(subscribeWithSelector(set => ({
  assetId: null, openedAssetId: null, clipId: null, trackId: null, view: 'video', tool: 'inspect',
  draft: null, active: false, actionBusy: false, attachMode: null, message: '',
  setEditor: patch => set(patch),
})));
