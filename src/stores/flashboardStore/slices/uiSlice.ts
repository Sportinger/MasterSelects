import type { FlashBoardStoreState } from '../types';

type Set = (partial: Partial<FlashBoardStoreState> | ((state: FlashBoardStoreState) => Partial<FlashBoardStoreState>)) => void;

export interface UiSliceActions {
  openComposer: (draftNodeId: string) => void;
  closeComposer: () => void;
}

export const createUiSlice = (set: Set): UiSliceActions => ({
  openComposer: (draftNodeId: string): void => {
    set({ composer: { draftNodeId, isOpen: true } });
  },

  closeComposer: (): void => {
    set({ composer: { draftNodeId: null, isOpen: false } });
  },
});
