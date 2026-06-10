import { useCallback } from 'react';

import type { DockDragState, DockTabGroup, DropTarget } from '../../../types/dock';
import { calculateDropPosition } from '../../../utils/dockLayout';
import { TAB_INSERT_HOT_ZONE_PX, calculateTabInsertIndex } from './layoutMath';

interface UseDockPaneDropTargetArgs {
  containerRef: React.RefObject<HTMLDivElement | null>;
  tabBarRef: React.RefObject<HTMLDivElement | null>;
  group: DockTabGroup;
  dragState: DockDragState;
  updateDrag: (pos: { x: number; y: number }, dropTarget: DropTarget | null) => void;
  clearHoveredTabTarget: (panelId?: string) => void;
  handlePaneMouseEnter: () => void;
}

export function useDockPaneDropTarget({
  containerRef,
  tabBarRef,
  group,
  dragState,
  updateDrag,
  clearHoveredTabTarget,
  handlePaneMouseEnter,
}: UseDockPaneDropTargetArgs) {
  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!dragState.isDragging) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.dock-tab')) {
        handlePaneMouseEnter();
      }
      return;
    }
    if (!containerRef.current) return;
    if (dragState.sourceGroupId === group.id && group.panels.length === 1) return;

    const rect = containerRef.current.getBoundingClientRect();
    const tabBarRect = tabBarRef.current?.getBoundingClientRect();
    let position = calculateDropPosition(rect, event.clientX, event.clientY);

    let tabInsertIndex: number | undefined;
    if (tabBarRect && event.clientY >= tabBarRect.top && event.clientY <= tabBarRect.bottom + TAB_INSERT_HOT_ZONE_PX) {
      position = 'center';
      tabInsertIndex = calculateTabInsertIndex(event.clientX, rect, group.panels.length);
    } else if (position === 'center') {
      tabInsertIndex = calculateTabInsertIndex(event.clientX, rect, group.panels.length);
    }

    updateDrag(
      { x: event.clientX, y: event.clientY },
      { groupId: group.id, position, tabInsertIndex },
    );
  }, [
    containerRef,
    dragState.isDragging,
    dragState.sourceGroupId,
    group.id,
    group.panels.length,
    handlePaneMouseEnter,
    tabBarRef,
    updateDrag,
  ]);

  const handleMouseLeave = useCallback(() => {
    clearHoveredTabTarget();
    if (dragState.isDragging && dragState.dropTarget?.scope !== 'root-edge' && dragState.dropTarget?.groupId === group.id) {
      updateDrag(dragState.currentPos, null);
    }
  }, [clearHoveredTabTarget, dragState, group.id, updateDrag]);

  return {
    handleMouseMove,
    handleMouseLeave,
  };
}
