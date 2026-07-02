import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { FlashBoardStoreState } from './types';
import { createDefaultFlashBoardComposer } from './defaults';
import { createUiSlice, type UiSliceActions } from './slices/uiSlice';

export type FlashBoardStore = FlashBoardStoreState & UiSliceActions;

export const useFlashBoardStore = create<FlashBoardStore>()(
  subscribeWithSelector((set) => ({
    activeGenerationRecords: [],
    selectedActiveGenerationRecordIds: [],
    composer: createDefaultFlashBoardComposer(),
    promptHistory: [],
    hoveredComposerReference: null,

    ...createUiSlice(set),
  }))
);

export * from './types';
export * from './selectors';
export * from './defaults';
