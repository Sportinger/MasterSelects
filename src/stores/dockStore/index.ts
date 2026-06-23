// Zustand store for dock layout state management

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import { FACTORY_VIDEO_EDIT_LAYOUT_ID } from './panelRegistry';
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
import { DOCK_LAYOUT_TRANSITION_EVENT } from './layoutTransition';
import type { DockStoreState } from './storeTypes';

export {
  FACTORY_AUDIO_EDIT_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  CAN_EDIT_FACTORY_DOCK_LAYOUTS,
} from './panelRegistry';
export {
  getFactoryDockLayouts,
  isFactoryDockLayout,
  isFactoryDockLayoutId,
  isProtectedFactoryDockLayout,
} from './layoutPersistence';
export { DOCK_LAYOUT_TRANSITION_EVENT };

export const useDockStore = create<DockStoreState>()(
  subscribeWithSelector(
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
          const activeSavedLayoutId = persistedActiveSavedLayoutId
            ?? (persisted?.layout ? null : FACTORY_VIDEO_EDIT_LAYOUT_ID);

          if (persisted?.layout) {
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
);
