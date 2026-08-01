import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { FlashBoardStoreState } from './types';
import { createDefaultFlashBoardComposer } from './defaults';
import { createUiSlice, type UiSliceActions } from './slices/uiSlice';
import { withExclusiveHistorySnapshotMutationLease } from '../timeline/exclusiveMutationLease';

export type FlashBoardStore = FlashBoardStoreState & UiSliceActions;

export const useFlashBoardStore = create<FlashBoardStore>()(
  subscribeWithSelector(withExclusiveHistorySnapshotMutationLease((set) => ({
    activeGenerationRecords: [],
    selectedActiveGenerationRecordIds: [],
    composer: createDefaultFlashBoardComposer(),
    promptHistory: [],
    chatMessages: [],
    hoveredComposerReference: null,

    ...createUiSlice(set),
  })))
);

export * from './types';
export * from './selectors';
export * from './defaults';
