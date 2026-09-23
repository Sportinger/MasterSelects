import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { SurfacePoint, SurfaceQuad } from '../types/planarTracking';

/** Transient authoring selection. Geometry and media stay in their owning stores. */
interface TrackingEditorState {
  assetId: string | null;
  openedAssetId: string | null;
  clipId: string | null;
  trackId: string | null;
  view: 'video' | '3d';
  tool: 'inspect' | 'surface' | 'occlusion' | 'place' | 'object' | 'pick-object';
  draft: SurfaceQuad | null;
  contourDraft: SurfacePoint[] | null;
  objectPaddingDraft: number | null;
  objectPrompts: (SurfacePoint & {label:0|1})[];
  objectSubtract: boolean;
  active: boolean;
  actionBusy: boolean;
  attachMode: 'follow' | 'surface' | null;
  message: string;
  setEditor: (patch: Partial<Omit<TrackingEditorState, 'setEditor'>>) => void;
}

export const useTrackingEditorStore = create<TrackingEditorState>()(subscribeWithSelector(set => ({
  assetId: null, openedAssetId: null, clipId: null, trackId: null, view: 'video', tool: 'inspect',
  draft: null, contourDraft: null, objectPaddingDraft: null, objectPrompts: [], objectSubtract:false, active: false, actionBusy: false, attachMode: null, message: '',
  setEditor: patch => set(patch),
})));
