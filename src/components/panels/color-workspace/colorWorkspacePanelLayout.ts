import type { DockLayout, DockNode, DockPanel, DockTabGroup } from '../../../types/dock';
import { collapseSingleChildSplits, insertPanelAtTarget, removePanel } from '../../../utils/dockLayout';
import { findPanelAndGroup } from '../../../stores/dockStore/layoutTree';
import { getPanelConfig } from '../../../stores/dockStore/panelRegistry';
import {
  DOCK_RESIZE_HANDLE_SIZE,
  getColorTimelinePanelHeight,
} from '../../dock/dockPanelSizing';

export type ColorWorkspaceTogglePanel =
  | 'media'
  | 'color-clips'
  | 'color-timeline'
  | 'color-nodes'
  | 'clip-properties';

export interface ColorWorkspacePanelToggleContext {
  rootHeight?: number;
  videoTrackCount?: number;
}

interface PanelPlacement {
  groupId: string;
  panelId: string;
  position: 'left' | 'right' | 'top' | 'bottom';
  ratio: number;
  splitId: string;
  targetIds: string[];
}

const PANEL_PLACEMENTS: Record<ColorWorkspaceTogglePanel, PanelPlacement> = {
  media: {
    groupId: 'color-media-group',
    panelId: 'color-media',
    position: 'left',
    ratio: 0.28,
    splitId: 'color-media-restore-split',
    targetIds: ['color-preview-group'],
  },
  'color-clips': {
    groupId: 'color-clips-group',
    panelId: 'color-clips',
    position: 'top',
    ratio: 0.38,
    splitId: 'color-clips-restore-split',
    targetIds: ['color-timeline-group', 'color-tools-split'],
  },
  'color-timeline': {
    groupId: 'color-timeline-group',
    panelId: 'color-timeline',
    position: 'bottom',
    ratio: 0.62,
    splitId: 'color-timeline-restore-split',
    targetIds: ['color-clips-group', 'color-tools-split'],
  },
  'color-nodes': {
    groupId: 'color-nodes-group',
    panelId: 'color-nodes',
    position: 'right',
    ratio: 0.62,
    splitId: 'color-nodes-restore-split',
    targetIds: ['color-preview-group'],
  },
  'clip-properties': {
    groupId: 'color-properties-group',
    panelId: 'color-properties',
    position: 'right',
    ratio: 0.55,
    splitId: 'color-properties-restore-split',
    targetIds: ['color-nodes-group', 'color-preview-group'],
  },
};

const TOP_ROW_OPTIONAL_PANELS = [
  'media',
  'color-nodes',
  'clip-properties',
] as const satisfies readonly ColorWorkspaceTogglePanel[];

const TOP_ROW_EVICTION_ORDER: Record<
  (typeof TOP_ROW_OPTIONAL_PANELS)[number],
  readonly (typeof TOP_ROW_OPTIONAL_PANELS)[number][]
> = {
  media: ['clip-properties', 'color-nodes'],
  'color-nodes': ['clip-properties', 'media'],
  'clip-properties': ['media', 'color-nodes'],
};

const COMPACT_VERTICAL_PANELS = [
  'color-clips',
  'color-timeline',
] as const satisfies readonly ColorWorkspaceTogglePanel[];

function updateColorRootSplitRatio(
  node: DockNode,
  delta: number,
): DockNode {
  if (node.kind === 'tab-group') return node;
  if (node.id === 'color-root-split' && node.direction === 'vertical') {
    return {
      ...node,
      ratio: Math.max(0.1, Math.min(0.9, node.ratio + delta)),
    };
  }

  const first = updateColorRootSplitRatio(node.children[0], delta);
  const second = updateColorRootSplitRatio(node.children[1], delta);
  return first === node.children[0] && second === node.children[1]
    ? node
    : { ...node, children: [first, second] };
}

function preserveLowerToolPosition(
  layout: DockLayout,
  type: ColorWorkspaceTogglePanel,
  wasVisible: boolean,
  wasDocked: boolean,
  context: ColorWorkspacePanelToggleContext,
): DockLayout {
  if (!COMPACT_VERTICAL_PANELS.includes(
    type as (typeof COMPACT_VERTICAL_PANELS)[number],
  )) return layout;
  if (wasVisible && !wasDocked) return layout;

  const rootHeight = context.rootHeight ?? 0;
  if (!Number.isFinite(rootHeight) || rootHeight <= 0) return layout;

  const panelHeight = type === 'color-clips'
    ? getPanelConfig('color-clips').fixedHeight ?? 0
    : getColorTimelinePanelHeight(context.videoTrackCount ?? 0);
  const panelExtent = panelHeight + DOCK_RESIZE_HANDLE_SIZE;
  const direction = wasVisible ? 1 : -1;

  return {
    ...layout,
    root: updateColorRootSplitRatio(
      layout.root,
      direction * (panelExtent / rootHeight),
    ),
  };
}

function createPanelGroup(type: ColorWorkspaceTogglePanel): DockTabGroup {
  const placement = PANEL_PLACEMENTS[type];
  const panel: DockPanel = {
    id: placement.panelId,
    type,
    title: getPanelConfig(type).title,
  };

  return {
    kind: 'tab-group',
    id: placement.groupId,
    panels: [panel],
    activeIndex: 0,
  };
}

function insertGroupBesideNode(
  node: DockNode,
  targetId: string,
  group: DockTabGroup,
  placement: PanelPlacement,
): { inserted: boolean; node: DockNode } {
  if (node.id === targetId) {
    const isFirst = placement.position === 'left' || placement.position === 'top';
    return {
      inserted: true,
      node: {
        kind: 'split',
        id: placement.splitId,
        direction: placement.position === 'left' || placement.position === 'right'
          ? 'horizontal'
          : 'vertical',
        ratio: placement.ratio,
        children: isFirst ? [group, node] : [node, group],
      },
    };
  }

  if (node.kind === 'tab-group') return { inserted: false, node };

  const first = insertGroupBesideNode(node.children[0], targetId, group, placement);
  if (first.inserted) {
    return {
      inserted: true,
      node: { ...node, children: [first.node, node.children[1]] },
    };
  }

  const second = insertGroupBesideNode(node.children[1], targetId, group, placement);
  return second.inserted
    ? { inserted: true, node: { ...node, children: [node.children[0], second.node] } }
    : { inserted: false, node };
}

function showEmbeddedPanel(
  layout: DockLayout,
  type: ColorWorkspaceTogglePanel,
): DockLayout {
  const placement = PANEL_PLACEMENTS[type];
  const group = createPanelGroup(type);

  for (const targetId of placement.targetIds) {
    const result = insertGroupBesideNode(layout.root, targetId, group, placement);
    if (result.inserted) return { ...layout, root: result.node };
  }

  const fallbackPosition = placement.position === 'left' || placement.position === 'right'
    ? placement.position
    : 'bottom';
  return insertPanelAtTarget(layout, group.panels[0], {
    groupId: layout.root.id,
    position: fallbackPosition,
    scope: 'root-edge',
  });
}

function removeVisiblePanel(
  layout: DockLayout,
  type: ColorWorkspaceTogglePanel,
): DockLayout {
  const docked = findPanelAndGroup(layout.root, type);
  if (docked) {
    const withoutPanel = removePanel(layout, docked.panel.id, docked.groupId);
    return {
      ...withoutPanel,
      root: collapseSingleChildSplits(withoutPanel.root),
    };
  }

  return {
    ...layout,
    floatingPanels: layout.floatingPanels.filter(floating => floating.panel.type !== type),
  };
}

function makeTopRowSpace(
  layout: DockLayout,
  openingType: (typeof TOP_ROW_OPTIONAL_PANELS)[number],
): DockLayout {
  const visibleOptionalPanels = TOP_ROW_OPTIONAL_PANELS.filter(type => (
    type !== openingType && isColorWorkspacePanelVisible(layout, type)
  ));
  if (visibleOptionalPanels.length < 2) return layout;

  const panelToClose = TOP_ROW_EVICTION_ORDER[openingType]
    .find(type => visibleOptionalPanels.includes(type));
  return panelToClose ? removeVisiblePanel(layout, panelToClose) : layout;
}

export function isColorWorkspacePanelVisible(
  layout: DockLayout,
  type: ColorWorkspaceTogglePanel,
): boolean {
  return Boolean(findPanelAndGroup(layout.root, type))
    || layout.floatingPanels.some(floating => floating.panel.type === type);
}

export function toggleColorWorkspacePanel(
  layout: DockLayout,
  type: ColorWorkspaceTogglePanel,
  context: ColorWorkspacePanelToggleContext = {},
): DockLayout {
  const wasVisible = isColorWorkspacePanelVisible(layout, type);
  const wasDocked = Boolean(findPanelAndGroup(layout.root, type));
  if (wasVisible) {
    return preserveLowerToolPosition(
      removeVisiblePanel(layout, type),
      type,
      wasVisible,
      wasDocked,
      context,
    );
  }

  const layoutWithCapacity = TOP_ROW_OPTIONAL_PANELS.includes(
    type as (typeof TOP_ROW_OPTIONAL_PANELS)[number],
  )
    ? makeTopRowSpace(layout, type as (typeof TOP_ROW_OPTIONAL_PANELS)[number])
    : layout;
  return preserveLowerToolPosition(
    showEmbeddedPanel(layoutWithCapacity, type),
    type,
    wasVisible,
    wasDocked,
    context,
  );
}
