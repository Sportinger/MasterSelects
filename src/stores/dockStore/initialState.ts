import { DEFAULT_DRAG_STATE, DEFAULT_LAYOUT } from './layoutDefaults';
import { cloneDockLayout, getFactoryDockLayouts } from './layoutPersistence';
import { FACTORY_VIDEO_EDIT_LAYOUT_ID } from './panelRegistry';
import type { DockStoreState } from './storeTypes';

export type DockStoreInitialState = Pick<
  DockStoreState,
  | 'layout'
  | 'browserWindowPanels'
  | 'dragState'
  | 'maxZIndex'
  | 'hoveredTabTarget'
  | 'maximizedPanelId'
  | 'savedLayouts'
  | 'defaultSavedLayoutId'
  | 'activeSavedLayoutId'
>;

export function createDockStoreInitialState(): DockStoreInitialState {
  return {
    layout: cloneDockLayout(DEFAULT_LAYOUT),
    browserWindowPanels: [],
    dragState: DEFAULT_DRAG_STATE,
    maxZIndex: 1000,
    hoveredTabTarget: null,
    maximizedPanelId: null,
    savedLayouts: getFactoryDockLayouts(),
    defaultSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
    activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
  };
}
