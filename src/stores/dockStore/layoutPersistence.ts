import type {
  BrowserWindowPanel,
  DockLayout,
  DockNode,
  DockPanel,
  FloatingPanel,
  PanelType,
  SavedDockLayout,
} from '../../types/dock';
import { DEFAULT_LAYOUT, FACTORY_3D_EDIT_PREVIEW_DEFAULTS, FACTORY_SAVED_DOCK_LAYOUTS } from './layoutDefaults';
import { cleanupSavedTimelineLayout } from './timelineLayoutPersistence';
import {
  CAN_EDIT_FACTORY_DOCK_LAYOUTS,
  FACTORY_3D_EDIT_LAYOUT_ID,
  FACTORY_DOCK_LAYOUT_IDS,
  FACTORY_DOCK_LAYOUT_NAMES,
  FACTORY_DOCK_LAYOUT_NAME_TO_ID,
  VALID_PANEL_TYPES,
} from './panelRegistry';
import { findTabGroupById } from './layoutTree';

interface NormalizedDockPanel {
  panel: DockPanel;
}

interface NormalizedFloatingPanel {
  floatingPanel: FloatingPanel;
}

interface NormalizedBrowserWindowPanel {
  browserWindowPanel: BrowserWindowPanel;
}


function normalizeDockPanel(panel: DockPanel): NormalizedDockPanel | null {
  const normalizedType = panel.type;
  if (!VALID_PANEL_TYPES.has(normalizedType)) {
    return null;
  }

  return {
    panel: {
      ...panel,
      type: normalizedType,
    },
  };
}

function normalizeFloatingPanel(floatingPanel: FloatingPanel): NormalizedFloatingPanel | null {
  const normalizedDockPanel = normalizeDockPanel(floatingPanel.panel);
  if (!normalizedDockPanel) {
    return null;
  }

  return {
    floatingPanel: {
      ...floatingPanel,
      panel: normalizedDockPanel.panel,
    },
  };
}

function normalizeBrowserWindowPanel(windowPanel: BrowserWindowPanel): NormalizedBrowserWindowPanel | null {
  const normalizedDockPanel = normalizeDockPanel(windowPanel.panel);
  if (!normalizedDockPanel) {
    return null;
  }

  const width = windowPanel.size?.width;
  const height = windowPanel.size?.height;
  const size = typeof width === 'number' && typeof height === 'number' && Number.isFinite(width) && Number.isFinite(height)
    ? {
        width: Math.max(320, Math.round(width)),
        height: Math.max(240, Math.round(height)),
      }
    : undefined;
  const left = windowPanel.position?.left;
  const top = windowPanel.position?.top;
  const position = typeof left === 'number' && typeof top === 'number' && Number.isFinite(left) && Number.isFinite(top)
    ? { left: Math.round(left), top: Math.round(top) }
    : undefined;

  return {
    browserWindowPanel: {
      ...windowPanel,
      panel: normalizedDockPanel.panel,
      returnGroupId: typeof windowPanel.returnGroupId === 'string' ? windowPanel.returnGroupId : null,
      size,
      position,
    },
  };
}

// Normalize legacy aliases and filter out invalid panel types from a layout node
function filterInvalidPanels(node: DockNode): DockNode | null {
  if (node.kind === 'tab-group') {
    const validPanels = node.panels
      .map(normalizeDockPanel)
      .filter((panel): panel is NormalizedDockPanel => panel !== null)
      .map((candidate) => candidate.panel);
    if (validPanels.length === 0) return null;
    return {
      ...node,
      panels: validPanels,
      activeIndex: Math.min(node.activeIndex, validPanels.length - 1),
    };
  } else {
    const [left, right] = node.children;
    const filteredLeft = filterInvalidPanels(left);
    const filteredRight = filterInvalidPanels(right);
    if (!filteredLeft && !filteredRight) return null;
    if (!filteredLeft) return filteredRight;
    if (!filteredRight) return filteredLeft;
    return { ...node, children: [filteredLeft, filteredRight] };
  }
}

// Clean up a persisted layout by removing invalid panels
export function cleanupPersistedLayout(layout: DockLayout): DockLayout {
  const cleanedRoot = filterInvalidPanels(layout.root);
  return {
    ...layout,
    root: cleanedRoot || DEFAULT_LAYOUT.root,
    floatingPanels: layout.floatingPanels
      .map(normalizeFloatingPanel)
      .filter((panel): panel is NormalizedFloatingPanel => panel !== null)
      .map((candidate) => candidate.floatingPanel),
  };
}

export function cleanupPersistedBrowserWindowPanels(windowPanels: BrowserWindowPanel[] | undefined): BrowserWindowPanel[] {
  if (!Array.isArray(windowPanels)) return [];
  return windowPanels
    .map(normalizeBrowserWindowPanel)
    .filter((panel): panel is NormalizedBrowserWindowPanel => panel !== null)
    .map((candidate) => candidate.browserWindowPanel);
}

export function cloneDockLayout(layout: DockLayout): DockLayout {
  return JSON.parse(JSON.stringify(layout)) as DockLayout;
}

export function getLayoutMaxZIndex(layout: DockLayout): number {
  return layout.floatingPanels.reduce((maxZIndex, floatingPanel) => (
    Math.max(maxZIndex, floatingPanel.zIndex)
  ), 1000);
}
export function cleanupSavedLayout(savedLayout: SavedDockLayout): SavedDockLayout {
  return {
    ...savedLayout,
    layout: cleanupPersistedLayout(savedLayout.layout),
    favorite: savedLayout.favorite === true,
    factory: savedLayout.factory === true || isFactoryDockLayoutId(savedLayout.id),
    timeline: cleanupSavedTimelineLayout(savedLayout.timeline),
  };
}

function areDockLayoutsEqual(left: DockLayout, right: DockLayout): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getMatchingEditableSavedLayout(
  savedLayouts: SavedDockLayout[],
  layout: DockLayout,
): SavedDockLayout | null {
  return savedLayouts.find((savedLayout) => (
    areDockLayoutsEqual(savedLayout.layout, layout) && !isProtectedFactoryDockLayout(savedLayout)
  )) ?? null;
}

export function isFactoryDockLayoutId(layoutId: string | null | undefined): boolean {
  return typeof layoutId === 'string' && FACTORY_DOCK_LAYOUT_IDS.has(layoutId);
}

export function isFactoryDockLayout(savedLayout: SavedDockLayout | null | undefined): boolean {
  return savedLayout?.factory === true || isFactoryDockLayoutId(savedLayout?.id);
}

export function isProtectedFactoryDockLayout(savedLayout: SavedDockLayout | null | undefined): boolean {
  return isFactoryDockLayout(savedLayout) && !CAN_EDIT_FACTORY_DOCK_LAYOUTS;
}

export function getFactoryDockLayoutIdByName(name: string): string | null {
  return FACTORY_DOCK_LAYOUT_NAME_TO_ID.get(name.trim().toLowerCase()) ?? null;
}

export function getFactoryDockLayoutIdForSavedLayout(savedLayout: SavedDockLayout): string | null {
  return isFactoryDockLayoutId(savedLayout.id)
    ? savedLayout.id
    : getFactoryDockLayoutIdByName(savedLayout.name);
}

export function cloneSavedDockLayout(savedLayout: SavedDockLayout): SavedDockLayout {
  return JSON.parse(JSON.stringify(savedLayout)) as SavedDockLayout;
}

export function getFactoryDockLayouts(): SavedDockLayout[] {
  return FACTORY_SAVED_DOCK_LAYOUTS.map(cloneSavedDockLayout);
}

export function applyFactory3DEditPreviewDefaults(layout: DockLayout): DockLayout {
  const positions: Array<{ id: string; x: number; y: number }> = [];
  const visit = (node: DockNode, x: number, y: number, width: number, height: number) => {
    if (node.kind === 'tab-group') {
      node.panels.forEach((panel) => {
        if (panel.type === 'preview') positions.push({ id: panel.id, x, y });
      });
      return;
    }
    const ratio = Math.min(1, Math.max(0, node.ratio));
    if (node.direction === 'horizontal') {
      visit(node.children[0], x, y, width * ratio, height);
      visit(node.children[1], x + width * ratio, y, width * (1 - ratio), height);
    } else {
      visit(node.children[0], x, y, width, height * ratio);
      visit(node.children[1], x, y + height * ratio, width, height * (1 - ratio));
    }
  };
  visit(layout.root, 0, 0, 1, 1);
  const defaultsById = new Map(
    positions
      .toSorted((left, right) => left.y - right.y || left.x - right.x)
      .slice(0, 4)
      .map((position, index) => [position.id, Object.values(FACTORY_3D_EDIT_PREVIEW_DEFAULTS)[index]]),
  );
  const apply = (node: DockNode): DockNode => node.kind === 'tab-group'
    ? {
        ...node,
        panels: node.panels.map((panel) => {
          const defaults = defaultsById.get(panel.id);
          return defaults ? { ...panel, data: { ...panel.data, ...defaults } } : panel;
        }),
      }
    : { ...node, children: [apply(node.children[0]), apply(node.children[1])] };
  return { ...layout, root: apply(layout.root) };
}

export function mergeFactoryDockLayouts(savedLayouts: SavedDockLayout[]): SavedDockLayout[] {
  const devOverrides = new Map<string, SavedDockLayout>();
  const factoryFavoriteOverrides = new Map<string, boolean>();
  const userLayouts: SavedDockLayout[] = [];

  for (const savedLayout of savedLayouts) {
    const factoryId = getFactoryDockLayoutIdForSavedLayout(savedLayout);
    if (factoryId) {
      factoryFavoriteOverrides.set(factoryId, savedLayout.favorite === true);
      if (CAN_EDIT_FACTORY_DOCK_LAYOUTS) {
        devOverrides.set(factoryId, {
          ...savedLayout,
          id: factoryId,
          name: FACTORY_DOCK_LAYOUT_NAMES.get(factoryId) ?? savedLayout.name,
          layout: factoryId === FACTORY_3D_EDIT_LAYOUT_ID
            ? applyFactory3DEditPreviewDefaults(savedLayout.layout)
            : savedLayout.layout,
          factory: true,
          favorite: savedLayout.favorite === true,
        });
      }
      continue;
    }

    userLayouts.push(savedLayout);
  }

  const factoryLayouts = FACTORY_SAVED_DOCK_LAYOUTS.map((factoryLayout) => {
    const override = devOverrides.get(factoryLayout.id);
    if (override) {
      return cloneSavedDockLayout({
        ...override,
        factory: true,
      });
    }

    return cloneSavedDockLayout({
      ...factoryLayout,
      favorite: factoryFavoriteOverrides.get(factoryLayout.id) ?? factoryLayout.favorite,
    });
  });

  return [...factoryLayouts, ...userLayouts];
}

function panelTypesForGroup(layout: DockLayout, groupId: string): PanelType[] | null {
  const group = findTabGroupById(layout.root, groupId);
  if (!group) {
    return null;
  }
  return group.panels.map((panel) => panel.type);
}

function arePanelTypeListsEqual(left: PanelType[] | null, right: PanelType[]): boolean {
  return left !== null
    && left.length === right.length
    && left.every((type, index) => type === right[index]);
}

function isLegacyFactoryDefaultLayout(layout: DockLayout): boolean {
  if (layout.floatingPanels.length > 0 || Object.keys(layout.panelZoom ?? {}).length > 0) {
    return false;
  }
  const root = layout.root;
  if (root.kind !== 'split' || root.id !== 'root-split' || root.direction !== 'vertical' || root.ratio !== 0.6) {
    return false;
  }
  const top = root.children[0];
  if (top.kind !== 'split' || top.id !== 'top-split' || top.direction !== 'horizontal' || top.ratio !== 0.15) {
    return false;
  }
  const centerRight = top.children[1];
  if (
    centerRight.kind !== 'split'
    || centerRight.id !== 'center-right-split'
    || centerRight.direction !== 'horizontal'
    || centerRight.ratio !== 0.67
  ) {
    return false;
  }

  const leftGroup = findTabGroupById(layout.root, 'left-group');
  const previewGroup = findTabGroupById(layout.root, 'preview-group');
  const rightGroup = findTabGroupById(layout.root, 'right-group');
  const timelineGroup = findTabGroupById(layout.root, 'timeline-group');
  const leftPanelTypes = panelTypesForGroup(layout, 'left-group');
  return (
    arePanelTypeListsEqual(leftPanelTypes, ['media'])
    && arePanelTypeListsEqual(panelTypesForGroup(layout, 'preview-group'), ['preview'])
    && arePanelTypeListsEqual(panelTypesForGroup(layout, 'timeline-group'), ['timeline'])
    && leftGroup?.activeIndex === 0
    && previewGroup?.activeIndex === 0
    && rightGroup?.activeIndex === 3
    && timelineGroup?.activeIndex === 0
    && arePanelTypeListsEqual(panelTypesForGroup(layout, 'right-group'), [
      'export',
      'clip-properties',
      'node-workspace',
      'scope-waveform',
      'scope-histogram',
      'scope-vectorscope',
    ])
  );
}

export function cleanupRestoredCurrentLayout(layout: DockLayout): DockLayout {
  const cleanedLayout = cleanupPersistedLayout(layout);
  return isLegacyFactoryDefaultLayout(cleanedLayout)
    ? cloneDockLayout(DEFAULT_LAYOUT)
    : cleanedLayout;
}

