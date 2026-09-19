import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { FlashBoardStoreState } from './types';
import { createDefaultFlashBoardAIWorkspace } from './defaults';
import { createUiSlice, type UiSliceActions } from './slices/uiSlice';
import { withExclusiveHistorySnapshotMutationLease } from '../timeline/exclusiveMutationLease';

export type FlashBoardStore = FlashBoardStoreState & UiSliceActions;

export const useFlashBoardStore = create<FlashBoardStore>()(
  subscribeWithSelector(withExclusiveHistorySnapshotMutationLease((set) => {
    const initialWorkspace = createDefaultFlashBoardAIWorkspace();
    return {
      activeGenerationRecords: [],
      selectedActiveGenerationRecordIds: [],
      composer: initialWorkspace.composer,
      promptHistory: [],
      chatMessages: [],
      aiWorkspaces: [initialWorkspace],
      activeAIWorkspaceId: initialWorkspace.id,
      hoveredComposerReference: null,

      ...createUiSlice(set),
    };
  }))
);

export * from './types';
export * from './selectors';
export * from './defaults';
