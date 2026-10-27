// Serializable phone view state: zoom, notices, toast, the open sheet id and the desktop panel type
// a panel sheet shows. Never clips,
// tracks, files or media elements (those stay in the shared editor stores).
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  PHONE_TIMELINE_DEFAULT_ZOOM,
  PHONE_TIMELINE_MAX_ZOOM,
  PHONE_TIMELINE_MIN_ZOOM,
  type PhoneUiState,
} from '../contracts';

let toastCounter = 0;

export function clampPhoneTimelineZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return PHONE_TIMELINE_DEFAULT_ZOOM;
  return Math.min(PHONE_TIMELINE_MAX_ZOOM, Math.max(PHONE_TIMELINE_MIN_ZOOM, zoom));
}

export const usePhoneUiStore = create<PhoneUiState>()(
  subscribeWithSelector((set) => ({
    timelineZoom: PHONE_TIMELINE_DEFAULT_ZOOM,
    unavailableNotice: null,
    toast: null,
    activeSheet: null,
    panelSheet: null,
    setTimelineZoom: (zoom) => set({ timelineZoom: clampPhoneTimelineZoom(zoom) }),
    showUnavailable: (notice) => set({ unavailableNotice: notice }),
    dismissUnavailable: () => set({ unavailableNotice: null }),
    showToast: (message, tone = 'info') => {
      toastCounter += 1;
      set({ toast: { id: toastCounter, message, tone } });
    },
    dismissToast: () => set({ toast: null }),
    openSheet: (sheetId) => set({ activeSheet: sheetId, panelSheet: null }),
    openPanelSheet: (type, title) => set({ activeSheet: 'panel', panelSheet: { type, title } }),
    closeSheet: () => set({ activeSheet: null, panelSheet: null }),
  })),
);
