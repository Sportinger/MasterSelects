import { create } from 'zustand';

/** The clip whose Color tab is open; its selected correction node's window shows in the preview. */
export const useColorWindowTarget = create<{ clipId: string | null; setClipId(clipId: string | null): void }>(set => ({
  clipId: null,
  setClipId: clipId => set({ clipId }),
}));
