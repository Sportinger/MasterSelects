import type { BrowserWindowPanel, DockLayout, SavedDockLayout, SavedDockTimelineLayout } from '../../types/dock';
import { Logger } from '../../services/logger';
import { DEFAULT_LAYOUT } from './layoutDefaults';
import {
  cleanupPersistedLayout,
  applyFactory3DEditPreviewDefaults,
  cloneDockLayout,
  getLayoutMaxZIndex,
  getMatchingEditableSavedLayout,
  isProtectedFactoryDockLayout,
} from './layoutPersistence';
import { FACTORY_3D_EDIT_LAYOUT_ID } from './panelRegistry';
import { requestDockLayoutTransition } from './layoutTransition';
import {
  applySavedTimelineLayout,
  activate3DEditSceneCamera,
  captureTimelineLayout,
} from './timelineLayoutAdapter';
import { findGroupIdByPanelId } from './layoutTree';
import { collapseSingleChildSplits, removePanel } from '../../utils/dockLayout';
import type { DockSliceCreator, SavedLayoutActions } from './storeTypes';

const log = Logger.create('DockStore');
const LEGACY_DEFAULT_LAYOUT_STORAGE_KEY = 'webvj-dock-layout-default';
const DEFAULT_TIMELINE_LAYOUT_STORAGE_KEY = 'webvj-dock-layout-default-timeline';

function removeBrowserWindowPanelsFromLayout(
  layout: DockLayout,
  windowPanels: readonly BrowserWindowPanel[],
): DockLayout {
  if (windowPanels.length === 0) return layout;

  const panelIds = new Set(windowPanels.map((windowPanel) => windowPanel.panel.id));
  let nextLayout: DockLayout = {
    ...layout,
    floatingPanels: layout.floatingPanels.filter((floating) => !panelIds.has(floating.panel.id)),
  };

  for (const panelId of panelIds) {
    const groupId = findGroupIdByPanelId(nextLayout.root, panelId);
    if (!groupId) continue;
    const layoutWithoutPanel = removePanel(nextLayout, panelId, groupId);
    nextLayout = {
      ...layoutWithoutPanel,
      root: collapseSingleChildSplits(layoutWithoutPanel.root),
    };
  }

  return nextLayout;
}

export const createSavedLayoutActions: DockSliceCreator<SavedLayoutActions> = (set, get) => ({
  saveNamedLayout: (name) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return null;
    }

    const cleanedLayout = cleanupPersistedLayout(cloneDockLayout(get().layout));
    const timelineLayout = captureTimelineLayout();
    const now = Date.now();
    const existingLayout = get().savedLayouts.find((savedLayout) => (
      savedLayout.name.trim().toLowerCase() === trimmedName.toLowerCase()
    ));
    if (isProtectedFactoryDockLayout(existingLayout)) {
      return null;
    }
    const nextSavedLayout: SavedDockLayout = existingLayout
      ? {
          ...existingLayout,
          name: trimmedName,
          layout: cleanedLayout,
          timeline: timelineLayout,
          updatedAt: now,
        }
      : {
          id: `saved-layout-${now}-${Math.random().toString(36).slice(2, 8)}`,
          name: trimmedName,
          layout: cleanedLayout,
          timeline: timelineLayout,
          createdAt: now,
          updatedAt: now,
        };

    set((state) => ({
      savedLayouts: [
        nextSavedLayout,
        ...state.savedLayouts.filter((savedLayout) => savedLayout.id !== nextSavedLayout.id),
      ],
      activeSavedLayoutId: nextSavedLayout.id,
    }));

    return nextSavedLayout;
  },

  saveCurrentNamedLayout: () => {
    const { activeSavedLayoutId, savedLayouts, layout } = get();
    if (!activeSavedLayoutId) {
      return null;
    }

    const existingLayout = savedLayouts.find((savedLayout) => savedLayout.id === activeSavedLayoutId);
    if (!existingLayout) {
      set({ activeSavedLayoutId: null });
      return null;
    }
    if (isProtectedFactoryDockLayout(existingLayout)) {
      return null;
    }

    const nextSavedLayout: SavedDockLayout = {
      ...existingLayout,
      layout: cleanupPersistedLayout(cloneDockLayout(layout)),
      timeline: captureTimelineLayout(),
      updatedAt: Date.now(),
    };

    set((state) => ({
      savedLayouts: [
        nextSavedLayout,
        ...state.savedLayouts.filter((savedLayout) => savedLayout.id !== nextSavedLayout.id),
      ],
      activeSavedLayoutId: nextSavedLayout.id,
    }));

    return nextSavedLayout;
  },

  loadSavedLayout: (layoutId) => {
    const savedLayout = get().savedLayouts.find((candidate) => candidate.id === layoutId);
    if (!savedLayout) {
      return;
    }

    const savedDockLayout = savedLayout.id === FACTORY_3D_EDIT_LAYOUT_ID
      ? applyFactory3DEditPreviewDefaults(savedLayout.layout)
      : savedLayout.layout;
    const nextLayout = cleanupPersistedLayout(cloneDockLayout(savedDockLayout));
    requestDockLayoutTransition();
    set({
      layout: nextLayout,
      browserWindowPanels: [],
      maxZIndex: getLayoutMaxZIndex(nextLayout),
      hoveredTabTarget: null,
      maximizedPanelId: null,
      activeSavedLayoutId: savedLayout.id,
    });
    applySavedTimelineLayout(savedLayout.timeline);
    if (savedLayout.id === FACTORY_3D_EDIT_LAYOUT_ID) activate3DEditSceneCamera();
  },

  setDefaultSavedLayout: (layoutId) => {
    if (layoutId !== null && !get().savedLayouts.some((savedLayout) => savedLayout.id === layoutId)) {
      return;
    }

    set({ defaultSavedLayoutId: layoutId });
  },

  toggleFavoriteSavedLayout: (layoutId) => {
    set((state) => ({
      savedLayouts: state.savedLayouts.map((savedLayout) => (
        savedLayout.id === layoutId
          ? { ...savedLayout, favorite: savedLayout.favorite !== true }
          : savedLayout
      )),
    }));
  },

  resetLayout: () => {
    const { defaultSavedLayoutId, savedLayouts } = get();
    if (defaultSavedLayoutId) {
      const defaultSavedLayout = savedLayouts.find((savedLayout) => savedLayout.id === defaultSavedLayoutId);
      if (defaultSavedLayout) {
        const nextLayout = cleanupPersistedLayout(cloneDockLayout(defaultSavedLayout.layout));
        requestDockLayoutTransition();
        set({
          layout: nextLayout,
          browserWindowPanels: [],
          maxZIndex: getLayoutMaxZIndex(nextLayout),
          hoveredTabTarget: null,
          maximizedPanelId: null,
          activeSavedLayoutId: defaultSavedLayout.id,
        });
        applySavedTimelineLayout(defaultSavedLayout.timeline);
        return;
      }
    }

    const savedDefault = localStorage.getItem(LEGACY_DEFAULT_LAYOUT_STORAGE_KEY);
    if (savedDefault) {
      try {
        const parsed = cleanupPersistedLayout(JSON.parse(savedDefault) as DockLayout);
        const defaultTimeline = localStorage.getItem(DEFAULT_TIMELINE_LAYOUT_STORAGE_KEY);
        requestDockLayoutTransition();
        set({
          layout: parsed,
          browserWindowPanels: [],
          maxZIndex: getLayoutMaxZIndex(parsed),
          hoveredTabTarget: null,
          maximizedPanelId: null,
          activeSavedLayoutId: null,
        });
        if (defaultTimeline) {
          try {
            applySavedTimelineLayout(JSON.parse(defaultTimeline) as SavedDockTimelineLayout);
          } catch (e) {
            log.warn('Failed to parse saved default timeline layout:', e);
          }
        }
        return;
      } catch (e) {
        log.error('Failed to parse saved default layout:', e);
      }
    }
    requestDockLayoutTransition();
    set({
      layout: cloneDockLayout(DEFAULT_LAYOUT),
      browserWindowPanels: [],
      maxZIndex: getLayoutMaxZIndex(DEFAULT_LAYOUT),
      hoveredTabTarget: null,
      maximizedPanelId: null,
      activeSavedLayoutId: null,
    });
  },

  saveLayoutAsDefault: () => {
    const { layout } = get();
    const cleanedLayout = cleanupPersistedLayout(cloneDockLayout(layout));
    const timelineLayout = captureTimelineLayout();
    localStorage.setItem(LEGACY_DEFAULT_LAYOUT_STORAGE_KEY, JSON.stringify(cleanedLayout));
    localStorage.setItem(DEFAULT_TIMELINE_LAYOUT_STORAGE_KEY, JSON.stringify(timelineLayout));

    const matchingSavedLayout = getMatchingEditableSavedLayout(get().savedLayouts, cleanedLayout);
    if (matchingSavedLayout) {
      const updatedLayout: SavedDockLayout = {
        ...matchingSavedLayout,
        layout: cleanedLayout,
        timeline: timelineLayout,
        updatedAt: Date.now(),
      };
      set((state) => ({
        savedLayouts: [
          updatedLayout,
          ...state.savedLayouts.filter((savedLayout) => savedLayout.id !== updatedLayout.id),
        ],
        defaultSavedLayoutId: updatedLayout.id,
        activeSavedLayoutId: state.activeSavedLayoutId === matchingSavedLayout.id
          ? updatedLayout.id
          : state.activeSavedLayoutId,
      }));
      return;
    }

    set({ defaultSavedLayoutId: null });
  },

  getLayoutForProject: () => {
    return cleanupPersistedLayout(cloneDockLayout(get().layout));
  },

  setLayoutFromProject: (layout: DockLayout) => {
    const browserWindowPanels = get().browserWindowPanels;
    const cleanedLayout = removeBrowserWindowPanelsFromLayout(
      cleanupPersistedLayout(layout),
      browserWindowPanels,
    );
    set({
      layout: cleanedLayout,
      browserWindowPanels,
      maxZIndex: getLayoutMaxZIndex(cleanedLayout),
      hoveredTabTarget: null,
      maximizedPanelId: null,
      activeSavedLayoutId: null,
    });
  },
});
