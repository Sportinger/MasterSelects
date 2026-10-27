// Whether the phone preview fills the whole screen. Serializable view state only: the preview keeps
// its one canvas and render-target registration, it only changes how it is laid out.
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface PhonePreviewModeState {
  fullscreen: boolean;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
}

export const usePhonePreviewModeStore = create<PhonePreviewModeState>()(
  subscribeWithSelector((set) => ({
    fullscreen: false,
    enterFullscreen: () => set({ fullscreen: true }),
    exitFullscreen: () => set({ fullscreen: false }),
  })),
);

export const PHONE_PREVIEW_TEST_IDS = {
  fullscreenButton: 'phone-transport-fullscreen',
  fullscreenPlay: 'phone-fullscreen-play',
  fullscreenExit: 'phone-fullscreen-exit',
  fullscreenTime: 'phone-fullscreen-time',
} as const;
