import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface MediaUrlDownloadDialogState {
  /** Video page URL pasted into the Media panel, or null while the dialog is closed. */
  url: string | null;
  /** Incremented when a queued download should reveal the Media tray download queue. */
  downloadsRevealRequest: number;
  open: (url: string) => void;
  close: () => void;
  revealDownloads: () => void;
}

export const useMediaUrlDownloadDialogStore = create<MediaUrlDownloadDialogState>()(
  subscribeWithSelector((set) => ({
    url: null,
    downloadsRevealRequest: 0,
    open: (url) => set({ url }),
    close: () => set({ url: null }),
    revealDownloads: () => set((state) => ({ downloadsRevealRequest: state.downloadsRevealRequest + 1 })),
  })),
);
