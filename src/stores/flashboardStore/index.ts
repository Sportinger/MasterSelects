import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { FlashBoardStoreState } from './types';
import { createBoardSlice, type BoardSliceActions } from './slices/boardSlice';
import { createNodeSlice, type NodeSliceActions } from './slices/nodeSlice';
import { createUiSlice, type UiSliceActions } from './slices/uiSlice';

export type FlashBoardStore = FlashBoardStoreState & BoardSliceActions & NodeSliceActions & UiSliceActions;

export const useFlashBoardStore = create<FlashBoardStore>()(
  subscribeWithSelector((set, get) => ({
    activeBoardId: null,
    boards: [],
    selectedNodeIds: [],
    viewMode: 'board' as const,
    composer: {
      draftNodeId: null,
      isOpen: false,
      generateAudio: false,
      multiShots: false,
      multiPrompt: [],
      referenceMediaFileIds: [],
    },
    hoveredComposerReference: null,

    ...createBoardSlice(set as any, get as any),
    ...createNodeSlice(set as any, get as any),
    ...createUiSlice(set as any),
  }))
);

export * from './types';
export * from './selectors';
