// Zustand store for dock layout state management

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import {
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
} from './panelRegistry';
import {
  cleanupPersistedBrowserWindowPanels,
  cleanupRestoredCurrentLayout,
  cleanupSavedLayout,
  mergeFactoryDockLayouts,
} from './layoutPersistence';
import { createDockStoreInitialState } from './initialState';
import { createLayoutMutationActions } from './layoutMutationActions';
import { createDragAndPanelStateActions } from './dragAndPanelStateActions';
import { createPanelVisibilityActions } from './panelVisibilityActions';
import { createSavedLayoutActions } from './savedLayoutActions';
import { nodeContainsPanelType } from './layoutTree';
import {
  DOCK_LAYOUT_TRANSITION_EVENT,
  START_CHROME_TRANSITION_EVENT,
} from './layoutTransition';
import type { DockStoreState } from './storeTypes';
import { withExclusiveHistorySnapshotMutationLease } from '../timeline/exclusiveMutationLease';

export {
  FACTORY_3D_EDIT_LAYOUT_ID,
  FACTORY_AUDIO_EDIT_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  START_CHAT_EXIT_DURATION_MS,
  START_CHROME_EXIT_DELAY_MS,
  START_CHROME_TRANSITION_DURATION_MS,
  START_EDITOR_REVEAL_DURATION_MS,
  START_LAYOUT_OUTRO_DURATION_MS,
  START_LAYOUT_REVEAL_DURATION_MS,
  CAN_EDIT_FACTORY_DOCK_LAYOUTS,
} from './panelRegistry';
export {
  getFactoryDockLayouts,
  isFactoryDockLayout,
  isFactoryDockLayoutId,
  isProtectedFactoryDockLayout,
} from './layoutPersistence';
export {
  DOCK_LAYOUT_TRANSITION_EVENT,
  START_CHROME_TRANSITION_EVENT,
};

export const useDockStore = create<DockStoreState>()(
  subscribeWithSelector(
    withExclusiveHistorySnapshotMutationLease(
      persist(
        (set, get) => ({
        ...createDockStoreInitialState(),
        ...createLayoutMutationActions(set, get),
        ...createDragAndPanelStateActions(set, get),
        ...createPanelVisibilityActions(set, get),
        ...createSavedLayoutActions(set, get),
        }),
        {
        name: 'webvj-dock-layout',
        partialize: (state) => ({
          layout: state.layout,
          browserWindowPanels: state.browserWindowPanels,
          maxZIndex: state.maxZIndex,
          savedLayouts: state.savedLayouts,
          defaultSavedLayoutId: state.defaultSavedLayoutId,
          activeSavedLayoutId: state.activeSavedLayoutId,
        }),
        merge: (persistedState, currentState) => {
          const persisted = persistedState as Partial<DockStoreState> | undefined;
          const savedLayouts = Array.isArray(persisted?.savedLayouts)
            ? mergeFactoryDockLayouts(persisted.savedLayouts.map(cleanupSavedLayout))
            : mergeFactoryDockLayouts(currentState.savedLayouts);
          const browserWindowPanels = cleanupPersistedBrowserWindowPanels(persisted?.browserWindowPanels);
          const defaultSavedLayoutId = (
            typeof persisted?.defaultSavedLayoutId === 'string'
            && savedLayouts.some((savedLayout) => savedLayout.id === persisted.defaultSavedLayoutId)
          )
            ? persisted.defaultSavedLayoutId
            : FACTORY_VIDEO_EDIT_LAYOUT_ID;
          const persistedActiveSavedLayoutId = (
            typeof persisted?.activeSavedLayoutId === 'string'
            && savedLayouts.some((savedLayout) => savedLayout.id === persisted.activeSavedLayoutId)
          )
            ? persisted.activeSavedLayoutId
            : null;
          const persistedLayoutIsStart = (
            persistedActiveSavedLayoutId === FACTORY_START_LAYOUT_ID
            || (
              persisted?.layout != null
              && nodeContainsPanelType(persisted.layout.root, 'start')
            )
          );
          const activeSavedLayoutId = persistedLayoutIsStart
            ? FACTORY_VIDEO_EDIT_LAYOUT_ID
            : persistedActiveSavedLayoutId
              ?? (persisted?.layout ? null : FACTORY_VIDEO_EDIT_LAYOUT_ID);

          if (persisted?.layout && !persistedLayoutIsStart) {
            // Clean up any invalid panel types from persisted layout
            const cleanedLayout = cleanupRestoredCurrentLayout(persisted.layout);
            return {
              ...currentState,
              layout: cleanedLayout,
              browserWindowPanels,
              maxZIndex: persisted.maxZIndex ?? currentState.maxZIndex,
              savedLayouts,
              defaultSavedLayoutId,
              activeSavedLayoutId,
            };
          }
          return {
            ...currentState,
            browserWindowPanels,
            savedLayouts,
            defaultSavedLayoutId,
            activeSavedLayoutId,
          };
        },
        }
      )
    )
  )
);
