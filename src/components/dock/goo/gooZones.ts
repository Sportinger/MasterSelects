// Screen-space rects for drop zones. The pure helpers mirror the geometry of
// the rectangular CSS overlays in dock.css (which are hidden while the goo
// overlay runs) — if those insets change, change them here too.

import type { DropPosition, DropTarget } from '../../../types/dock';
import { TAB_SLOT_GAP_PX, TAB_SLOT_SIZE_PX } from '../tabPane/layoutMath';

export interface GooZone {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  radius: number;
}

export interface PlainRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const ZONE_RADIUS = 9;
const TAB_BAR_INSET = 34;

const toZone = (
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number = ZONE_RADIUS,
): GooZone => ({
  cx: left + width / 2,
  cy: top + height / 2,
  hw: Math.max(width / 2, 1),
  hh: Math.max(height / 2, 1),
  radius,
});

export const computePaneZone = (pane: PlainRect, position: DropPosition): GooZone => {
  switch (position) {
    case 'left':
      return toZone(
        pane.left + 12,
        pane.top + TAB_BAR_INSET,
        pane.width / 2 - 18,
        pane.height - TAB_BAR_INSET - 12,
      );
    case 'right':
      return toZone(
        pane.left + pane.width / 2 + 6,
        pane.top + TAB_BAR_INSET,
        pane.width / 2 - 18,
        pane.height - TAB_BAR_INSET - 12,
      );
    case 'top':
      return toZone(
        pane.left + 12,
        pane.top + TAB_BAR_INSET,
        pane.width - 24,
        pane.height / 2 - 40,
      );
    case 'bottom':
      return toZone(
        pane.left + 12,
        pane.top + pane.height / 2 + 8,
        pane.width - 24,
        pane.height / 2 - 20,
      );
    case 'center': {
      const width = Math.max(
        Math.min(pane.width * 0.56, 460),
        Math.min(220, pane.width - 32),
      );
      const height = Math.max(
        Math.min(pane.height * 0.42, 260),
        Math.min(110, pane.height - 64),
      );
      return toZone(
        pane.left + (pane.width - width) / 2,
        pane.top + (pane.height - height) / 2,
        width,
        height,
      );
    }
  }
};

export const computeTabSlotZone = (
  pane: PlainRect,
  panelCount: number,
  slotIndex: number,
): GooZone => {
  const slotCount = panelCount + 1;
  const rowWidth = slotCount * TAB_SLOT_SIZE_PX + (slotCount - 1) * TAB_SLOT_GAP_PX;
  const slotStep = TAB_SLOT_SIZE_PX + TAB_SLOT_GAP_PX;
  const clampedIndex = Math.max(0, Math.min(slotCount - 1, slotIndex));
  const left = pane.left + pane.width / 2 - rowWidth / 2 + clampedIndex * slotStep;
  const top = pane.top + pane.height / 2 - TAB_SLOT_SIZE_PX / 2;
  return toZone(left, top, TAB_SLOT_SIZE_PX, TAB_SLOT_SIZE_PX, 7);
};

export const computeRootEdgeZone = (container: PlainRect, position: DropPosition): GooZone => {
  const stripWidth = Math.min(container.width * 0.28, 340);
  const stripHeight = Math.min(container.height * 0.28, 230);
  switch (position) {
    case 'left':
      return toZone(container.left + 8, container.top + 8, stripWidth, container.height - 16);
    case 'right':
      return toZone(
        container.left + container.width - 8 - stripWidth,
        container.top + 8,
        stripWidth,
        container.height - 16,
      );
    case 'top':
      return toZone(container.left + 8, container.top + 8, container.width - 16, stripHeight);
    case 'bottom':
      return toZone(
        container.left + 8,
        container.top + container.height - 8 - stripHeight,
        container.width - 16,
        stripHeight,
      );
    case 'center':
      return computePaneZone(container, 'center');
  }
};

const toPlainRect = (rect: DOMRect): PlainRect => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
});

export const resolveDropTargetZone = (
  dropTarget: DropTarget,
  getPanelCount: (groupId: string) => number | null,
): GooZone | null => {
  if (dropTarget.scope === 'root-edge') {
    const container = document.querySelector('.dock-container');
    if (!container) return null;
    return computeRootEdgeZone(toPlainRect(container.getBoundingClientRect()), dropTarget.position);
  }

  const paneElement = document.querySelector(
    `.dock-tab-pane[data-group-id="${CSS.escape(dropTarget.groupId)}"]`,
  );
  if (!paneElement) return null;
  const pane = toPlainRect(paneElement.getBoundingClientRect());

  if (dropTarget.position === 'center' && dropTarget.tabInsertIndex !== undefined) {
    const panelCount = getPanelCount(dropTarget.groupId);
    if (panelCount !== null) {
      return computeTabSlotZone(pane, panelCount, dropTarget.tabInsertIndex);
    }
  }

  return computePaneZone(pane, dropTarget.position);
};
