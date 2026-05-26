// Root dock container - wraps docked panels and renders floating panels

import { useCallback, useEffect, useRef } from 'react';
import { useDockStore } from '../../stores/dockStore';
import type { DropTarget } from '../../types/dock';
import { calculateRootEdgeDropPosition } from '../../utils/dockLayout';
import { DockNode } from './DockNode';
import { FloatingPanel } from './FloatingPanel';
import { getShortcutRegistry } from '../../services/shortcutRegistry';
import './dock.css';

export function DockContainer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);
  const maximizeAnimationTimeoutRef = useRef<number | null>(null);
  const { layout, dragState, endDrag, cancelDrag, updateDrag, toggleHoveredTabMaximized, maximizedPanelId } = useDockStore();

  const getRootEdgeDropTarget = useCallback((mouseX: number, mouseY: number): DropTarget | null => {
    const container = containerRef.current;
    if (!container) return null;

    const position = calculateRootEdgeDropPosition(container.getBoundingClientRect(), mouseX, mouseY);
    if (!position) return null;

    return {
      groupId: layout.root.id,
      position,
      scope: 'root-edge',
    };
  }, [layout.root.id]);

  const rootEdgeDropPosition = dragState.dropTarget?.scope === 'root-edge'
    ? dragState.dropTarget.position
    : null;

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    container.classList.add('maximize-animating');
    if (maximizeAnimationTimeoutRef.current) {
      window.clearTimeout(maximizeAnimationTimeoutRef.current);
    }
    maximizeAnimationTimeoutRef.current = window.setTimeout(() => {
      container.classList.remove('maximize-animating');
      maximizeAnimationTimeoutRef.current = null;
    }, 320);

    return () => {
      if (maximizeAnimationTimeoutRef.current) {
        window.clearTimeout(maximizeAnimationTimeoutRef.current);
        maximizeAnimationTimeoutRef.current = null;
      }
      container.classList.remove('maximize-animating');
    };
  }, [maximizedPanelId]);

  // Global mouse handlers for drag operations
  useEffect(() => {
    const registry = getShortcutRegistry();

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.isDragging) return;

      const rootEdgeTarget = getRootEdgeDropTarget(e.clientX, e.clientY);
      const nextDropTarget = rootEdgeTarget
        ?? (dragState.dropTarget?.scope === 'root-edge' ? null : dragState.dropTarget);

      updateDrag({ x: e.clientX, y: e.clientY }, nextDropTarget);
    };

    const handleMouseUp = () => {
      if (!dragState.isDragging) return;
      endDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        !!target?.isContentEditable;

      if (!isTextInput && registry.matches('panel.toggleHoveredFullscreen', e)) {
        e.preventDefault();
        e.stopPropagation();
        toggleHoveredTabMaximized();
        return;
      }

      if (e.key === 'Escape') {
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
  }, [dragState.isDragging, dragState.dropTarget, endDrag, cancelDrag, updateDrag, toggleHoveredTabMaximized, getRootEdgeDropTarget]);

  return (
    <div
      ref={containerRef}
      className={`dock-container ${dragState.isDragging ? 'dragging' : ''} ${maximizedPanelId ? 'is-panel-maximized' : ''}`}
    >
      {/* Main docked layout */}
      <div className="dock-root">
        <DockNode node={layout.root} />
      </div>

      {/* Full-root edge target preview */}
      {dragState.isDragging && rootEdgeDropPosition && (
        <div className={`dock-root-drop-overlay ${rootEdgeDropPosition}`} />
      )}

      {/* Floating panels */}
      {layout.floatingPanels.map((floating) => (
        <FloatingPanel key={floating.id} floating={floating} />
      ))}

      {/* Drag preview */}
      {dragState.isDragging && dragState.draggedPanel && (
        <div
          className="dock-drag-preview"
          style={{
            left: dragState.currentPos.x - dragState.dragOffset.x,
            top: dragState.currentPos.y - dragState.dragOffset.y,
          }}
        >
          {dragState.draggedPanel.title}
        </div>
      )}
    </div>
  );
}
