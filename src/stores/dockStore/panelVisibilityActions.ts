import type { DockPanel, PanelType, PreviewPanelData } from '../../types/dock';
import { MULTI_INSTANCE_PANEL_TYPES } from '../../types/dock';
import {
  collapseSingleChildSplits,
  insertPanelAtTarget,
  removePanel,
} from '../../utils/dockLayout';
import { createPreviewPanelDataPatch, createPreviewPanelSource } from '../../utils/previewPanelSource';
import { getPanelConfig, VALID_PANEL_TYPES } from './panelRegistry';
import {
  collectPanelTypes,
  findFirstTabGroup,
  findPanelAndGroup,
  findTabGroupById,
  updatePanelDataInLayout,
} from './layoutTree';
import type { DockSliceCreator, PanelVisibilityActions } from './storeTypes';

export const createPanelVisibilityActions: DockSliceCreator<PanelVisibilityActions> = (set, get) => ({
  getVisiblePanelTypes: () => {
    const { layout } = get();
    const types: PanelType[] = [];
    collectPanelTypes(layout.root, types);
    layout.floatingPanels.forEach((floating) => {
      if (VALID_PANEL_TYPES.has(floating.panel.type) && !types.includes(floating.panel.type)) {
        types.push(floating.panel.type);
      }
    });
    get().browserWindowPanels.forEach((windowPanel) => {
      if (VALID_PANEL_TYPES.has(windowPanel.panel.type) && !types.includes(windowPanel.panel.type)) {
        types.push(windowPanel.panel.type);
      }
    });
    return types;
  },

  isPanelTypeVisible: (type) => {
    return get().getVisiblePanelTypes().includes(type);
  },

  togglePanelType: (type) => {
    const { isPanelTypeVisible, showPanelType, hidePanelType } = get();
    if (isPanelTypeVisible(type)) {
      hidePanelType(type);
    } else {
      showPanelType(type);
    }
  },

  showPanelType: (type) => {
    if (!VALID_PANEL_TYPES.has(type)) return;
    const { layout, isPanelTypeVisible } = get();
    if (isPanelTypeVisible(type)) return;

    const config = getPanelConfig(type);
    const newPanel: DockPanel = {
      id: type,
      type,
      title: config.title,
    };

    const rightGroup = findTabGroupById(layout.root, 'right-group');
    if (rightGroup) {
      const newLayout = insertPanelAtTarget(layout, newPanel, {
        groupId: 'right-group',
        position: 'center',
      });
      set({ layout: newLayout });
    } else {
      const anyGroup = findFirstTabGroup(layout.root);
      if (anyGroup) {
        const newLayout = insertPanelAtTarget(layout, newPanel, {
          groupId: anyGroup.id,
          position: 'center',
        });
        set({ layout: newLayout });
      }
    }
  },

  hidePanelType: (type) => {
    const { layout } = get();

    const result = findPanelAndGroup(layout.root, type);
    if (result) {
      let newLayout = removePanel(layout, result.panel.id, result.groupId);
      newLayout = {
        ...newLayout,
        root: collapseSingleChildSplits(newLayout.root),
      };
      set((state) => ({
        layout: newLayout,
        hoveredTabTarget: state.hoveredTabTarget?.panelId === result.panel.id ? null : state.hoveredTabTarget,
        maximizedPanelId: state.maximizedPanelId === result.panel.id ? null : state.maximizedPanelId,
      }));
    }

    const floatingIndex = layout.floatingPanels.findIndex((floating) => floating.panel.type === type);
    if (floatingIndex >= 0) {
      set((state) => ({
        layout: {
          ...layout,
          floatingPanels: layout.floatingPanels.filter((_, index) => index !== floatingIndex),
        },
        hoveredTabTarget: state.hoveredTabTarget?.panelId === layout.floatingPanels[floatingIndex]?.panel.id ? null : state.hoveredTabTarget,
        maximizedPanelId: state.maximizedPanelId === layout.floatingPanels[floatingIndex]?.panel.id ? null : state.maximizedPanelId,
      }));
    }

    const browserWindowPanel = get().browserWindowPanels.find((candidate) => candidate.panel.type === type);
    if (browserWindowPanel) {
      set((state) => ({
        browserWindowPanels: state.browserWindowPanels.filter((candidate) => candidate.id !== browserWindowPanel.id),
        hoveredTabTarget: state.hoveredTabTarget?.panelId === browserWindowPanel.panel.id ? null : state.hoveredTabTarget,
        maximizedPanelId: state.maximizedPanelId === browserWindowPanel.panel.id ? null : state.maximizedPanelId,
      }));
    }
  },

  activatePanelType: (type) => {
    if (!VALID_PANEL_TYPES.has(type)) return;
    const { setActiveTab, showPanelType, isPanelTypeVisible, bringToFront } = get();

    if (!isPanelTypeVisible(type)) {
      showPanelType(type);
    }

    const { layout } = get();
    const result = findPanelAndGroup(layout.root, type);
    if (result) {
      const group = findTabGroupById(layout.root, result.groupId);
      if (group) {
        const panelIndex = group.panels.findIndex((panel) => panel.type === type);
        if (panelIndex >= 0) {
          setActiveTab(result.groupId, panelIndex);
        }
      }
    }

    const floatingPanel = layout.floatingPanels.find((floating) => floating.panel.type === type);
    if (floatingPanel) {
      bringToFront(floatingPanel.id);
    }
  },

  addPanelTypeToGroup: (type, groupId) => {
    if (!VALID_PANEL_TYPES.has(type)) return;

    if (MULTI_INSTANCE_PANEL_TYPES.includes(type)) {
      if (type === 'preview') {
        get().addPreviewPanel(null, groupId);
      }
      return;
    }

    const { layout, isPanelTypeVisible, activatePanelType } = get();
    if (isPanelTypeVisible(type)) {
      activatePanelType(type);
      return;
    }

    const config = getPanelConfig(type);
    const newPanel: DockPanel = {
      id: type,
      type,
      title: config.title,
    };

    const targetGroupId = findTabGroupById(layout.root, groupId)
      ? groupId
      : findFirstTabGroup(layout.root)?.id;
    if (!targetGroupId) return;

    const newLayout = insertPanelAtTarget(layout, newPanel, {
      groupId: targetGroupId,
      position: 'center',
    });
    set({ layout: newLayout });
  },

  addPreviewPanel: (compositionId, targetGroupId) => {
    const { layout } = get();

    const newPanelId = `preview-${Date.now()}`;
    const newPanel: DockPanel = {
      id: newPanelId,
      type: 'preview',
      title: 'Preview',
      data: createPreviewPanelDataPatch(createPreviewPanelSource(compositionId)) as PreviewPanelData,
    };

    const resolvedGroupId =
      (targetGroupId && findTabGroupById(layout.root, targetGroupId) ? targetGroupId : null)
      ?? (findTabGroupById(layout.root, 'preview-group') ? 'preview-group' : null)
      ?? findFirstTabGroup(layout.root)?.id;
    if (!resolvedGroupId) return;

    const newLayout = insertPanelAtTarget(layout, newPanel, {
      groupId: resolvedGroupId,
      position: 'right',
    });
    set({ layout: newLayout });
  },

  updatePanelData: (panelId, data) => {
    set((state) => ({
      layout: updatePanelDataInLayout(state.layout, panelId, data),
    }));
  },
});
