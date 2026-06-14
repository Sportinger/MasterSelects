// Floating panel wrapper - draggable and resizable

import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import type { FloatingPanel as FloatingPanelType } from '../../types/dock';
import { useDockStore } from '../../stores/dockStore';
import { findFirstTabGroup } from '../../stores/dockStore/layoutTree';
import { startBatch, endBatch } from '../../stores/historyStore';
import { DockPanelContent } from './DockPanelContent';

interface FloatingPanelProps {
  floating: FloatingPanelType;
}

export function FloatingPanel({ floating }: FloatingPanelProps) {
  const {
    layout,
    startDrag,
    dockFloatingPanel,
    updateFloatingPosition,
    updateFloatingSize,
    bringToFront,
  } = useDockStore();
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const defaultDockTarget = useMemo(() => {
    const group = findFirstTabGroup(layout.root);
    if (!group) return null;
    return {
      groupId: group.id,
      position: 'center' as const,
      tabInsertIndex: group.panels.length,
    };
  }, [layout.root]);

  // Handle drag
  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startBatch('Move floating panel');
    bringToFront(floating.id);
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - floating.position.x,
      y: e.clientY - floating.position.y,
    };
  }, [floating.id, floating.position, bringToFront]);

  // Handle resize
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startBatch('Resize floating panel');
    bringToFront(floating.id);
    setIsResizing(true);
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: floating.size.width,
      height: floating.size.height,
    };
  }, [floating.id, floating.size, bringToFront]);

  const handleFloatingTabMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    bringToFront(floating.id);
    startDrag(
      floating.panel,
      null,
      { x: 0, y: 0 },
      { x: e.clientX, y: e.clientY },
      floating.id
    );
  }, [bringToFront, floating.id, floating.panel, startDrag]);

  const handleDockClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!defaultDockTarget) return;
    dockFloatingPanel(floating.id, defaultDockTarget);
  }, [defaultDockTarget, dockFloatingPanel, floating.id]);

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const x = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOffset.current.x));
        const y = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffset.current.y));
        updateFloatingPosition(floating.id, { x, y });
      }
      if (isResizing) {
        const dx = e.clientX - resizeStart.current.x;
        const dy = e.clientY - resizeStart.current.y;
        const width = Math.max(200, resizeStart.current.width + dx);
        const height = Math.max(100, resizeStart.current.height + dy);
        updateFloatingSize(floating.id, { width, height });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      endBatch();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      endBatch();
    };
  }, [isDragging, isResizing, floating.id, updateFloatingPosition, updateFloatingSize]);

  const handleClick = useCallback(() => {
    bringToFront(floating.id);
  }, [floating.id, bringToFront]);

  return (
    <div
      className={`floating-panel ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''}`}
      data-guided-panel={floating.panel.type}
      data-panel-type={floating.panel.type}
      data-dock-layout-anim-id={`panel:${floating.panel.id}`}
      data-dock-layout-anim-title={floating.panel.title}
      style={{
        left: floating.position.x,
        top: floating.position.y,
        width: floating.size.width,
        height: floating.size.height,
        zIndex: floating.zIndex,
      }}
      onClick={handleClick}
    >
      <div className="floating-panel-header" onMouseDown={handleHeaderMouseDown}>
        <span className="floating-panel-drag-handle">⋮⋮</span>
        <button
          className="floating-panel-title-tab"
          type="button"
          onMouseDown={handleFloatingTabMouseDown}
          title="Drag into a dock area to dock this panel"
        >
          {floating.panel.title}
        </button>
        <button
          className="floating-panel-dock-button"
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={handleDockClick}
          disabled={!defaultDockTarget}
          title="Dock panel back into the main layout"
        >
          Dock
        </button>
      </div>
      <div className="floating-panel-content">
        <DockPanelContent panel={floating.panel} />
      </div>
      <div className="floating-panel-resize" onMouseDown={handleResizeMouseDown} />
    </div>
  );
}
