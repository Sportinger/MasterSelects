import { useEffect } from 'react';

import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import type { DockDragState, DropTarget } from '../../../types/dock';

interface UseDockContainerGlobalDragArgs {
  dragState: DockDragState;
  endDrag: () => void;
  cancelDrag: () => void;
  updateDrag: (pos: { x: number; y: number }, dropTarget: DropTarget | null) => void;
  toggleHoveredTabMaximized: () => void;
  getRootEdgeDropTarget: (mouseX: number, mouseY: number) => DropTarget | null;
}

export function useDockContainerGlobalDrag({
  dragState,
  endDrag,
  cancelDrag,
  updateDrag,
  toggleHoveredTabMaximized,
  getRootEdgeDropTarget,
}: UseDockContainerGlobalDragArgs): void {
  useEffect(() => {
    const registry = getShortcutRegistry();

    const handleMouseMove = (event: MouseEvent) => {
      if (!dragState.isDragging) return;

      const rootEdgeTarget = getRootEdgeDropTarget(event.clientX, event.clientY);
      const nextDropTarget = rootEdgeTarget
        ?? (dragState.dropTarget?.scope === 'root-edge' ? null : dragState.dropTarget);

      updateDrag({ x: event.clientX, y: event.clientY }, nextDropTarget);
    };

    const handleMouseUp = () => {
      if (!dragState.isDragging) return;
      endDrag();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInput =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        !!target?.isContentEditable;

      if (!isTextInput && registry.matches('panel.toggleHoveredFullscreen', event)) {
        event.preventDefault();
        event.stopPropagation();
        toggleHoveredTabMaximized();
        return;
      }

      if (event.key === 'Escape') {
        cancelDrag();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [
    dragState.isDragging,
    dragState.dropTarget,
    endDrag,
    cancelDrag,
    updateDrag,
    toggleHoveredTabMaximized,
    getRootEdgeDropTarget,
  ]);
}
