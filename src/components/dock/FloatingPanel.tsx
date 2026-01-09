// Floating panel wrapper - draggable and resizable

import { useCallback, useState, useRef, useEffect } from 'react';
import type { FloatingPanel as FloatingPanelType } from '../../types/dock';
import { useDockStore } from '../../stores/dockStore';
import { DockPanelContent } from './DockPanelContent';

interface FloatingPanelProps {
  floating: FloatingPanelType;
}

export function FloatingPanel({ floating }: FloatingPanelProps) {
  const { updateFloatingPosition, updateFloatingSize, bringToFront } = useDockStore();
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Handle drag
  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
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
    bringToFront(floating.id);
    setIsResizing(true);
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      width: floating.size.width,
      height: floating.size.height,
    };
  }, [floating.id, floating.size, bringToFront]);

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
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, floating.id, updateFloatingPosition, updateFloatingSize]);

  const handleClick = useCallback(() => {
    bringToFront(floating.id);
  }, [floating.id, bringToFront]);

  return (
    <div
      className={`floating-panel ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''}`}
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
        <span className="floating-panel-title">{floating.panel.title}</span>
      </div>
      <div className="floating-panel-content">
        <DockPanelContent panel={floating.panel} />
      </div>
      <div className="floating-panel-resize" onMouseDown={handleResizeMouseDown} />
    </div>
  );
}
