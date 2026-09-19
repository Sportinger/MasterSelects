import { useEffect } from 'react';

import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import { claimShortcut } from '../../../services/shortcutFocusPolicy';
import { useDockStore } from '../../../stores/dockStore';
import { findTabGroupById } from '../../../stores/dockStore/layoutTree';
import type { DockLayout, DropTarget } from '../../../types/dock';
import { calculateDropPosition } from '../../../utils/dockLayout';
import { TAB_INSERT_HOT_ZONE_PX, calculateTabInsertIndex } from '../tabPane/layoutMath';

interface UseDockContainerGlobalDragArgs {
  getRootEdgeDropTarget: (mouseX: number, mouseY: number) => DropTarget | null;
}

// Drop targets are hit-tested here instead of in per-pane mouse handlers:
// touch pointers are implicitly captured by the tab that started the drag,
// so pane-level pointermove handlers never fire during a touch drag.
function resolvePaneDropTarget(
  clientX: number,
  clientY: number,
  sourceGroupId: string | null,
  layout: DockLayout,
  draggedPanelType: string | null,
): DropTarget | null {
  const paneElement = document.elementFromPoint(clientX, clientY)?.closest('.dock-tab-pane') as HTMLElement | null;
  const groupId = paneElement?.dataset.groupId;
  if (!paneElement || !groupId) return null;

  const group = findTabGroupById(layout.root, groupId);
  if (!group) return null;
  if (sourceGroupId === groupId && group.panels.length === 1) return null;

  const rect = paneElement.getBoundingClientRect();
  const tabBarRect = paneElement.querySelector('.dock-tab-bar')?.getBoundingClientRect();
  let position = calculateDropPosition(rect, clientX, clientY);

  let tabInsertIndex: number | undefined;
  if (tabBarRect && clientY >= tabBarRect.top && clientY <= tabBarRect.bottom + TAB_INSERT_HOT_ZONE_PX) {
    position = 'center';
    tabInsertIndex = calculateTabInsertIndex(clientX, rect, group.panels.length);
  } else if (position === 'center') {
    tabInsertIndex = calculateTabInsertIndex(clientX, rect, group.panels.length);
  }

  // The timeline group's tab strip belongs to the composition tabs: it never
  // accepts other panels as tabs, and the timeline panel itself always lands
  // as its own group. Split drops on the pane edges stay available.
  if (position === 'center') {
    const timelineInvolved = draggedPanelType === 'timeline'
      || group.panels.some((panel) => panel.type === 'timeline');
    if (timelineInvolved) return null;
  }

  return { groupId, position, tabInsertIndex };
}

export function useDockContainerGlobalDrag({
  getRootEdgeDropTarget,
}: UseDockContainerGlobalDragArgs): void {
  useEffect(() => {
    const registry = getShortcutRegistry();

    const handlePointerMove = (event: PointerEvent) => {
      const state = useDockStore.getState();
      const currentDragState = state.dragState;
      if (!currentDragState.isDragging || !event.isPrimary) return;

      const dropTarget = getRootEdgeDropTarget(event.clientX, event.clientY)
        ?? resolvePaneDropTarget(
          event.clientX,
          event.clientY,
          currentDragState.sourceGroupId,
          state.layout,
          currentDragState.draggedPanel?.type ?? null,
        );

      state.updateDrag({ x: event.clientX, y: event.clientY }, dropTarget);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const state = useDockStore.getState();
      if (!state.dragState.isDragging || !event.isPrimary) return;
      state.endDrag();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const state = useDockStore.getState();
      if (!state.dragState.isDragging || !event.isPrimary) return;
      state.cancelDrag();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        registry.matches('panel.toggleHoveredFullscreen', event) &&
        claimShortcut(event, 'panel.toggleHoveredFullscreen', { stopPropagation: true })
      ) {
        useDockStore.getState().toggleHoveredTabMaximized();
        return;
      }

      if (event.key === 'Escape') {
        useDockStore.getState().cancelDrag();
      }
    };

    // Capture keeps touch drops reliable when a resize or panel gesture stops
    // the event before it can bubble back to the window. Without this, the
    // drag stays active until the next tap, which feels like a confirmation
    // step on iPad and Android.
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [getRootEdgeDropTarget]);
}
