import { useCallback } from 'react';

import type { DockDragState } from '../../../types/dock';

interface UseDockPaneHoverArgs {
  dragState: DockDragState;
  clearHoveredTabTarget: (panelId?: string) => void;
  handlePaneMouseEnter: () => void;
}

// Keeps the hovered-tab target (maximize shortcut) up to date. Drop-target
// hit-testing during a drag lives in useDockContainerGlobalDrag.
export function useDockPaneHover({
  dragState,
  clearHoveredTabTarget,
  handlePaneMouseEnter,
}: UseDockPaneHoverArgs) {
  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (dragState.isDragging) return;

    const target = event.target as HTMLElement | null;
    if (!target?.closest('.dock-tab')) {
      handlePaneMouseEnter();
    }
  }, [dragState.isDragging, handlePaneMouseEnter]);

  const handleMouseLeave = useCallback(() => {
    clearHoveredTabTarget();
  }, [clearHoveredTabTarget]);

  return {
    handleMouseMove,
    handleMouseLeave,
  };
}
