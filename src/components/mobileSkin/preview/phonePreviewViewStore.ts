// View options of the phone preview: the transform handles and their snapping, pixel rulers and the
// fit / actual-pixels zoom with its pan offset. Serializable view state of this viewer only (no
// project data, no runtime handles); guides and the split compare live in the editor's own stores.
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type PhonePreviewZoom = 'fit' | 'actual';

export interface PhonePreviewViewState {
  /** Move / pinch / rotate handles on the selected clip (on by default, like the desktop edit mode). */
  handles: boolean;
  /** Handles snap to the frame edges, its centre and the composition's guides. */
  snap: boolean;
  rulers: boolean;
  zoom: PhonePreviewZoom;
  /** Pan offset of the actual-pixels view in CSS pixels (0,0 = centred). */
  pan: { x: number; y: number };
  setHandles: (on: boolean) => void;
  setSnap: (on: boolean) => void;
  setRulers: (on: boolean) => void;
  setZoom: (zoom: PhonePreviewZoom) => void;
  setPan: (pan: { x: number; y: number }) => void;
}

export const usePhonePreviewViewStore = create<PhonePreviewViewState>()(
  subscribeWithSelector((set) => ({
    handles: true,
    snap: true,
    rulers: false,
    zoom: 'fit',
    pan: { x: 0, y: 0 },
    setHandles: (handles) => set({ handles }),
    setSnap: (snap) => set({ snap }),
    setRulers: (rulers) => set({ rulers }),
    setZoom: (zoom) => set({ zoom, pan: { x: 0, y: 0 } }),
    setPan: (pan) => set({ pan }),
  })),
);
