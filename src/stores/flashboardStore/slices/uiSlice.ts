import type { FlashBoardComposerState, FlashBoardStoreState } from '../types';

type Set = (partial: Partial<FlashBoardStoreState> | ((state: FlashBoardStoreState) => Partial<FlashBoardStoreState>)) => void;

export interface UiSliceActions {
  openComposer: (draftNodeId: string) => void;
  closeComposer: () => void;
  updateComposer: (patch: Partial<FlashBoardComposerState>) => void;
}

export const createUiSlice = (set: Set): UiSliceActions => ({
  openComposer: (draftNodeId: string): void => {
    set((state) => ({
      composer: { ...state.composer, draftNodeId, isOpen: true },
    }));
  },

  closeComposer: (): void => {
    set((state) => ({
      composer: { ...state.composer, draftNodeId: null, isOpen: false },
    }));
  },

  updateComposer: (patch: Partial<FlashBoardComposerState>): void => {
    set((state) => ({
      composer: {
        ...state.composer,
        ...patch,
        generateAudio: patch.generateAudio ?? state.composer.generateAudio ?? false,
        multiShots: patch.multiShots ?? state.composer.multiShots ?? false,
        multiPrompt: patch.multiPrompt ?? state.composer.multiPrompt ?? [],
        referenceMediaFileIds: patch.referenceMediaFileIds ?? state.composer.referenceMediaFileIds ?? [],
      },
    }));
  },
});
