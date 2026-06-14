import type { BrowserWindowPanel, DockPanel, DropTarget, FloatingPanel } from '../../types/dock';
import {
  adjustDropTargetForMovedPanel,
  collapseSingleChildSplits,
  insertPanelAtTarget,
  removePanel,
} from '../../utils/dockLayout';
import { getPanelConfig, VALID_PANEL_TYPES } from './panelRegistry';
import {
  findGroupIdByPanelId,
  findFirstTabGroup,
  findPanelAndGroup,
  findPanelById,
  findTabGroupById,
  replacePanelInLayout,
  updateNodeInLayout,
} from './layoutTree';
import type { DockSliceCreator, LayoutMutationActions } from './storeTypes';

export const createLayoutMutationActions: DockSliceCreator<LayoutMutationActions> = (set, get) => ({
  setActiveTab: (groupId, index) => {
    set((state) => ({
      layout: updateNodeInLayout(state.layout, groupId, (node) => {
        if (node.kind === 'tab-group') {
          return { ...node, activeIndex: Math.min(index, node.panels.length - 1) };
        }
        return node;
      }),
    }));
  },

  setSplitRatio: (splitId, ratio) => {
    set((state) => ({
      layout: updateNodeInLayout(state.layout, splitId, (node) => {
        if (node.kind === 'split') {
          return { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
        }
        return node;
      }),
    }));
  },

  movePanel: (panelId, sourceGroupId, target) => {
    const { layout } = get();
    const targetAfterRemoval = adjustDropTargetForMovedPanel(layout.root, panelId, sourceGroupId, target);
    let newLayout = removePanel(layout, panelId, sourceGroupId);

    const panel = findPanelById(layout, panelId);
    if (panel) {
      newLayout = insertPanelAtTarget(newLayout, panel, targetAfterRemoval);
    }

    newLayout = {
      ...newLayout,
      root: collapseSingleChildSplits(newLayout.root),
    };

    set({ layout: newLayout });
  },

  closePanel: (panelId, groupId) => {
    const { layout } = get();
    let newLayout = removePanel(layout, panelId, groupId);
    newLayout = {
      ...newLayout,
      root: collapseSingleChildSplits(newLayout.root),
    };
    set((state) => ({
      layout: newLayout,
      hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
      maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
    }));
  },

  closePanelById: (panelId) => {
    const { layout } = get();
    const browserWindowPanel = get().browserWindowPanels.find((candidate) => candidate.panel.id === panelId);
    if (browserWindowPanel) {
      set((state) => ({
        browserWindowPanels: state.browserWindowPanels.filter((candidate) => candidate.id !== browserWindowPanel.id),
        hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
        maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
      }));
      return;
    }

    const floating = layout.floatingPanels.find((f) => f.panel.id === panelId);
    if (floating) {
      set((state) => ({
        layout: {
          ...layout,
          floatingPanels: layout.floatingPanels.filter((f) => f.panel.id !== panelId),
        },
        hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
        maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
      }));
      return;
    }

    const groupId = findGroupIdByPanelId(layout.root, panelId);
    if (groupId) {
      let newLayout = removePanel(layout, panelId, groupId);
      newLayout = {
        ...newLayout,
        root: collapseSingleChildSplits(newLayout.root),
      };
      set((state) => ({
        layout: newLayout,
        hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
        maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
      }));
    }
  },

  changePanelType: (panelId, type) => {
    if (!VALID_PANEL_TYPES.has(type)) return;

    const { layout } = get();
    const sourceGroupId = findGroupIdByPanelId(layout.root, panelId);
    if (!sourceGroupId) return;
    const sourcePanel = findPanelById(layout, panelId);
    if (!sourcePanel || sourcePanel.type === type) return;

    let nextLayout = layout;
    let replacementPanel: DockPanel | null = null;

    const existingDockedPanel = findPanelAndGroup(nextLayout.root, type);
    if (existingDockedPanel && existingDockedPanel.panel.id !== panelId) {
      replacementPanel = existingDockedPanel.panel;
      nextLayout = removePanel(nextLayout, existingDockedPanel.panel.id, existingDockedPanel.groupId);
      nextLayout = {
        ...nextLayout,
        root: collapseSingleChildSplits(nextLayout.root),
      };
    }

    if (!replacementPanel) {
      const floatingPanel = nextLayout.floatingPanels.find((floating) => floating.panel.type === type);
      if (floatingPanel && floatingPanel.panel.id !== panelId) {
        replacementPanel = floatingPanel.panel;
        nextLayout = {
          ...nextLayout,
          floatingPanels: nextLayout.floatingPanels.filter((floating) => floating.id !== floatingPanel.id),
        };
      }
    }

    if (!replacementPanel) {
      const config = getPanelConfig(type);
      replacementPanel = {
        id: type,
        type,
        title: config.title,
      };
    }

    nextLayout = replacePanelInLayout(nextLayout, panelId, replacementPanel);
    const nextPanelId = replacementPanel.id;
    set((state) => ({
      layout: nextLayout,
      hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId || state.hoveredTabTarget?.panelId === nextPanelId
        ? null
        : state.hoveredTabTarget,
      maximizedPanelId: state.maximizedPanelId === panelId ? nextPanelId : state.maximizedPanelId,
    }));
  },

  floatPanel: (panelId, groupId, position) => {
    const { layout, maxZIndex } = get();
    const panel = findPanelById(layout, panelId);
    if (!panel) return;

    let newLayout = removePanel(layout, panelId, groupId);
    newLayout = {
      ...newLayout,
      root: collapseSingleChildSplits(newLayout.root),
    };

    const floatingPanel: FloatingPanel = {
      id: `floating-${panelId}-${Date.now()}`,
      panel,
      position,
      size: { width: 400, height: 300 },
      zIndex: maxZIndex + 1,
    };

    set((state) => ({
      layout: {
        ...newLayout,
        floatingPanels: [...newLayout.floatingPanels, floatingPanel],
      },
      maxZIndex: maxZIndex + 1,
      hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
      maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
    }));
  },

  dockFloatingPanel: (floatingId, target) => {
    const { layout } = get();
    const floating = layout.floatingPanels.find((f) => f.id === floatingId);
    if (!floating) return;

    const newFloating = layout.floatingPanels.filter((f) => f.id !== floatingId);
    const newLayout = insertPanelAtTarget(
      { ...layout, floatingPanels: newFloating },
      floating.panel,
      target
    );

    set((state) => ({
      layout: newLayout,
      hoveredTabTarget: state.hoveredTabTarget?.panelId === floating.panel.id ? null : state.hoveredTabTarget,
    }));
  },

  detachPanelToBrowserWindow: (panelId, groupId) => {
    const { layout } = get();
    const sourceGroup = findTabGroupById(layout.root, groupId);
    const panel = sourceGroup?.panels.find((candidate) => candidate.id === panelId) ?? null;
    if (!panel) return null;

    let newLayout = removePanel(layout, panelId, groupId);
    newLayout = {
      ...newLayout,
      root: collapseSingleChildSplits(newLayout.root),
    };

    const windowPanel: BrowserWindowPanel = {
      id: `window-${panelId}-${Date.now()}`,
      panel,
      returnGroupId: groupId,
    };

    set((state) => ({
      layout: newLayout,
      browserWindowPanels: [...state.browserWindowPanels, windowPanel],
      hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
      maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
    }));

    return windowPanel;
  },

  dockBrowserWindowPanel: (windowPanelId, target) => {
    const { browserWindowPanels, layout } = get();
    const windowPanel = browserWindowPanels.find((candidate) => candidate.id === windowPanelId);
    if (!windowPanel) return;

    const { panel } = windowPanel;
    let nextLayout = layout;

    const dockedGroupId = findGroupIdByPanelId(nextLayout.root, panel.id);
    if (dockedGroupId) {
      nextLayout = removePanel(nextLayout, panel.id, dockedGroupId);
      nextLayout = {
        ...nextLayout,
        root: collapseSingleChildSplits(nextLayout.root),
      };
    }

    nextLayout = {
      ...nextLayout,
      floatingPanels: nextLayout.floatingPanels.filter((floating) => floating.panel.id !== panel.id),
    };

    const fallbackGroup =
      (windowPanel.returnGroupId ? findTabGroupById(nextLayout.root, windowPanel.returnGroupId) : null)
      ?? findTabGroupById(nextLayout.root, 'right-group')
      ?? findFirstTabGroup(nextLayout.root);
    if (!fallbackGroup && !target) return;

    const resolvedTarget: DropTarget = target ?? {
      groupId: fallbackGroup!.id,
      position: 'center',
      tabInsertIndex: fallbackGroup!.panels.length,
    };

    const newLayout = insertPanelAtTarget(nextLayout, panel, resolvedTarget);
    set((state) => ({
      layout: newLayout,
      browserWindowPanels: state.browserWindowPanels.filter((candidate) => candidate.id !== windowPanelId),
      hoveredTabTarget: state.hoveredTabTarget?.panelId === panel.id ? null : state.hoveredTabTarget,
      maximizedPanelId: state.maximizedPanelId === panel.id ? null : state.maximizedPanelId,
    }));
  },

  updateFloatingPosition: (floatingId, position) => {
    set((state) => ({
      layout: {
        ...state.layout,
        floatingPanels: state.layout.floatingPanels.map((f) =>
          f.id === floatingId ? { ...f, position } : f
        ),
      },
    }));
  },

  updateFloatingSize: (floatingId, size) => {
    set((state) => ({
      layout: {
        ...state.layout,
        floatingPanels: state.layout.floatingPanels.map((f) =>
          f.id === floatingId ? { ...f, size } : f
        ),
      },
    }));
  },

  bringToFront: (floatingId) => {
    const { maxZIndex } = get();
    set((state) => ({
      layout: {
        ...state.layout,
        floatingPanels: state.layout.floatingPanels.map((f) =>
          f.id === floatingId ? { ...f, zIndex: maxZIndex + 1 } : f
        ),
      },
      maxZIndex: maxZIndex + 1,
    }));
  },
});
