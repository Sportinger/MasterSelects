// View state of the phone output editor: which target is selected, the stage zoom/pan and the open
// edit session (a plain-data snapshot). No runtime handles: targets stay in the render target store.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { OutputMappingSnapshot } from './phoneOutputSession';

export const PHONE_OUTPUT_MIN_ZOOM = 0.5;
export const PHONE_OUTPUT_MAX_ZOOM = 6;

export interface PhoneOutputView {
  zoom: number;
  panX: number;
  panY: number;
}

interface PhoneOutputState {
  selectedTargetId: string | null;
  view: PhoneOutputView;
  session: OutputMappingSnapshot | null;
  selectTarget: (id: string | null) => void;
  setView: (view: PhoneOutputView) => void;
  resetView: () => void;
  setSession: (session: OutputMappingSnapshot | null) => void;
}

export const FIT_VIEW: PhoneOutputView = { zoom: 1, panX: 0, panY: 0 };

export function clampOutputZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(PHONE_OUTPUT_MAX_ZOOM, Math.max(PHONE_OUTPUT_MIN_ZOOM, zoom));
}

export const usePhoneOutputStore = create<PhoneOutputState>()(subscribeWithSelector((set) => ({
  selectedTargetId: null,
  view: FIT_VIEW,
  session: null,
  selectTarget: (id) => set({ selectedTargetId: id }),
  setView: (view) => set({ view: { ...view, zoom: clampOutputZoom(view.zoom) } }),
  resetView: () => set({ view: FIT_VIEW }),
  setSession: (session) => set({ session }),
})));
