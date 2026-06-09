import type { DockLayout, DockNode, DockPanel, DockTabGroup, PanelData, PanelType } from '../../types/dock';
import { VALID_PANEL_TYPES } from './panelRegistry';

// Helper: Update a node in the layout tree
export function updateNodeInLayout(
  layout: DockLayout,
  nodeId: string,
  updater: (node: DockNode) => DockNode
): DockLayout {
  return {
    ...layout,
    root: updateNodeRecursive(layout.root, nodeId, updater),
  };
}

function updateNodeRecursive(
  node: DockNode,
  nodeId: string,
  updater: (node: DockNode) => DockNode
): DockNode {
  if (node.id === nodeId) {
    return updater(node);
  }
  if (node.kind === 'split') {
    return {
      ...node,
      children: [
        updateNodeRecursive(node.children[0], nodeId, updater),
        updateNodeRecursive(node.children[1], nodeId, updater),
      ] as [DockNode, DockNode],
    };
  }
  return node;
}

// Helper: Find a panel by ID in the layout
export function findPanelById(layout: DockLayout, panelId: string): DockPanel | null {
  // Check floating panels
  for (const floating of layout.floatingPanels) {
    if (floating.panel.id === panelId) {
      return floating.panel;
    }
  }
  // Check docked panels
  return findPanelInNode(layout.root, panelId);
}

function findPanelInNode(node: DockNode, panelId: string): DockPanel | null {
  if (node.kind === 'tab-group') {
    return node.panels.find((p) => p.id === panelId) || null;
  }
  const left = findPanelInNode(node.children[0], panelId);
  if (left) return left;
  return findPanelInNode(node.children[1], panelId);
}

export function replacePanelInLayout(layout: DockLayout, panelId: string, replacementPanel: DockPanel): DockLayout {
  return {
    ...layout,
    root: replacePanelInNode(layout.root, panelId, replacementPanel),
  };
}

function replacePanelInNode(node: DockNode, panelId: string, replacementPanel: DockPanel): DockNode {
  if (node.kind === 'tab-group') {
    const panelIndex = node.panels.findIndex((panel) => panel.id === panelId);
    if (panelIndex < 0) {
      return node;
    }

    const panels = [...node.panels];
    panels[panelIndex] = replacementPanel;
    return {
      ...node,
      panels,
      activeIndex: panelIndex,
    };
  }

  return {
    ...node,
    children: [
      replacePanelInNode(node.children[0], panelId, replacementPanel),
      replacePanelInNode(node.children[1], panelId, replacementPanel),
    ] as [DockNode, DockNode],
  };
}

// Helper: Collect all panel types in a node
export function collectPanelTypes(node: DockNode, types: PanelType[]): void {
  if (node.kind === 'tab-group') {
    node.panels.forEach((p) => {
      if (VALID_PANEL_TYPES.has(p.type) && !types.includes(p.type)) {
        types.push(p.type);
      }
    });
  } else {
    collectPanelTypes(node.children[0], types);
    collectPanelTypes(node.children[1], types);
  }
}

// Helper: Find a tab group by ID
export function findTabGroupById(node: DockNode, groupId: string): DockTabGroup | null {
  if (node.kind === 'tab-group') {
    return node.id === groupId ? node : null;
  }
  const left = findTabGroupById(node.children[0], groupId);
  if (left) return left;
  return findTabGroupById(node.children[1], groupId);
}

// Helper: Find the first tab group in the tree
export function findFirstTabGroup(node: DockNode): DockTabGroup | null {
  if (node.kind === 'tab-group') {
    return node;
  }
  const left = findFirstTabGroup(node.children[0]);
  if (left) return left;
  return findFirstTabGroup(node.children[1]);
}

// Helper: Find a panel and its group by panel type
export function findPanelAndGroup(
  node: DockNode,
  panelType: PanelType
): { panel: DockPanel; groupId: string } | null {
  if (node.kind === 'tab-group') {
    const panel = node.panels.find((p) => p.type === panelType);
    if (panel) {
      return { panel, groupId: node.id };
    }
    return null;
  }
  const left = findPanelAndGroup(node.children[0], panelType);
  if (left) return left;
  return findPanelAndGroup(node.children[1], panelType);
}

// Helper: Find a panel's group ID by panel ID
export function findGroupIdByPanelId(node: DockNode, panelId: string): string | null {
  if (node.kind === 'tab-group') {
    const panel = node.panels.find((p) => p.id === panelId);
    if (panel) {
      return node.id;
    }
    return null;
  }
  const left = findGroupIdByPanelId(node.children[0], panelId);
  if (left) return left;
  return findGroupIdByPanelId(node.children[1], panelId);
}

// Helper: Update panel data in layout
export function updatePanelDataInLayout(
  layout: DockLayout,
  panelId: string,
  data: Partial<PanelData>
): DockLayout {
  return {
    ...layout,
    root: updatePanelDataInNode(layout.root, panelId, data),
    floatingPanels: layout.floatingPanels.map((f) =>
      f.panel.id === panelId
        ? { ...f, panel: { ...f.panel, data: { ...f.panel.data, ...data } as PanelData } }
        : f
    ),
  };
}

function updatePanelDataInNode(
  node: DockNode,
  panelId: string,
  data: Partial<PanelData>
): DockNode {
  if (node.kind === 'tab-group') {
    const panelIndex = node.panels.findIndex((p) => p.id === panelId);
    if (panelIndex >= 0) {
      const newPanels = [...node.panels];
      newPanels[panelIndex] = {
        ...newPanels[panelIndex],
        data: { ...newPanels[panelIndex].data, ...data } as PanelData,
      };
      return { ...node, panels: newPanels };
    }
    return node;
  }
  return {
    ...node,
    children: [
      updatePanelDataInNode(node.children[0], panelId, data),
      updatePanelDataInNode(node.children[1], panelId, data),
    ] as [DockNode, DockNode],
  };
}
