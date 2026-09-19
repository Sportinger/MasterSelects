import { getPanelConfig } from '../../stores/dockStore/panelRegistry';
import type { DockNode, PanelType } from '../../types/dock';

export const DOCK_RESIZE_HANDLE_SIZE = 2;

type DockDimension = 'width' | 'height';
export type DockFixedSizeOverrides = Partial<
  Record<PanelType, Partial<Record<DockDimension, number>>>
>;

const COLOR_TIMELINE_PANEL_CHROME_HEIGHT = 48;
const COLOR_TIMELINE_MINIMUM_TRACK_COUNT = 2;
const COLOR_TIMELINE_TRACK_HEIGHT = 16;

export function getColorTimelinePanelHeight(videoTrackCount: number): number {
  return COLOR_TIMELINE_PANEL_CHROME_HEIGHT
    + Math.max(COLOR_TIMELINE_MINIMUM_TRACK_COUNT, videoTrackCount) * COLOR_TIMELINE_TRACK_HEIGHT;
}

function getConfigSizeKey(dimension: DockDimension): 'fixedWidth' | 'fixedHeight' {
  return dimension === 'width' ? 'fixedWidth' : 'fixedHeight';
}

function getConfigMinimumKey(dimension: DockDimension): 'minWidth' | 'minHeight' {
  return dimension === 'width' ? 'minWidth' : 'minHeight';
}

function splitUsesDimension(node: Extract<DockNode, { kind: 'split' }>, dimension: DockDimension): boolean {
  return (node.direction === 'horizontal' ? 'width' : 'height') === dimension;
}

export function getDockNodeFixedSize(
  node: DockNode,
  dimension: DockDimension,
  overrides?: DockFixedSizeOverrides,
): number | null {
  if (node.kind === 'tab-group') {
    const activePanel = node.panels[node.activeIndex];
    if (!activePanel) return null;
    const override = overrides?.[activePanel.type]?.[dimension];
    if (override !== undefined) return override;
    return getPanelConfig(activePanel.type)[getConfigSizeKey(dimension)] ?? null;
  }

  const firstSize = getDockNodeFixedSize(node.children[0], dimension, overrides);
  const secondSize = getDockNodeFixedSize(node.children[1], dimension, overrides);
  if (firstSize === null || secondSize === null) return null;

  if (splitUsesDimension(node, dimension)) {
    return firstSize + DOCK_RESIZE_HANDLE_SIZE + secondSize;
  }

  return firstSize === secondSize ? firstSize : null;
}

export function getDockNodeFixedFloor(
  node: DockNode,
  dimension: DockDimension,
  overrides?: DockFixedSizeOverrides,
): number {
  if (node.kind === 'tab-group') {
    const activePanel = node.panels[node.activeIndex];
    if (!activePanel) return 0;
    const override = overrides?.[activePanel.type]?.[dimension];
    if (override !== undefined) return override;
    return getPanelConfig(activePanel.type)[getConfigSizeKey(dimension)] ?? 0;
  }

  const firstFloor = getDockNodeFixedFloor(node.children[0], dimension, overrides);
  const secondFloor = getDockNodeFixedFloor(node.children[1], dimension, overrides);
  if (splitUsesDimension(node, dimension)) {
    return firstFloor + secondFloor + (firstFloor > 0 || secondFloor > 0 ? DOCK_RESIZE_HANDLE_SIZE : 0);
  }

  return Math.max(firstFloor, secondFloor);
}

export function getDirectChildMinimumSize(
  node: DockNode,
  dimension: DockDimension,
  fallback: number,
  overrides?: DockFixedSizeOverrides,
): number {
  const fixedFloor = getDockNodeFixedFloor(node, dimension, overrides);
  if (node.kind === 'split') return Math.max(fallback, fixedFloor);

  const configKey = getConfigMinimumKey(dimension);
  const activePanel = node.panels[node.activeIndex];
  const configuredMinimum = activePanel
    ? getPanelConfig(activePanel.type)[configKey] ?? fallback
    : fallback;
  return Math.max(configuredMinimum, fixedFloor);
}

export function findDockResizeDelegateId(
  root: DockNode,
  targetSplitId: string,
  dimension: DockDimension,
  overrides?: DockFixedSizeOverrides,
): string | null {
  const visit = (
    node: DockNode,
    ancestors: Extract<DockNode, { kind: 'split' }>[],
  ): string | null | undefined => {
    if (node.kind !== 'split') return undefined;
    if (node.id === targetSplitId) {
      for (let index = ancestors.length - 1; index >= 0; index -= 1) {
        const candidate = ancestors[index];
        if (!splitUsesDimension(candidate, dimension)) continue;
        const firstFixed = getDockNodeFixedSize(candidate.children[0], dimension, overrides);
        const secondFixed = getDockNodeFixedSize(candidate.children[1], dimension, overrides);
        if (firstFixed === null && secondFixed === null) return candidate.id;
      }
      return null;
    }

    const nextAncestors = [...ancestors, node];
    return visit(node.children[0], nextAncestors)
      ?? visit(node.children[1], nextAncestors);
  };

  return visit(root, []) ?? null;
}
