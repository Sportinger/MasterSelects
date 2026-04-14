// Split container with two children and resize handle

import { useCallback, useState, useEffect, useRef } from 'react';
import type { DockSplit } from '../../types/dock';
import { useDockStore } from '../../stores/dockStore';
import { DockNode } from './DockNode';
import { nodeContainsPanel } from '../../utils/dockLayout';

interface DockSplitPaneProps {
  split: DockSplit;
}

// Minimum sizes for panels (in pixels)
const MIN_PANEL_SIZE = 150;
const MIN_PREVIEW_HEIGHT = 200; // Preview needs more height for video

export function DockSplitPane({ split }: DockSplitPaneProps) {
  const setSplitRatio = useDockStore((state) => state.setSplitRatio);
  const maximizedPanelId = useDockStore((state) => state.maximizedPanelId);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  const isHorizontal = split.direction === 'horizontal';
  const maximizedChildIndex = maximizedPanelId
    ? (nodeContainsPanel(split.children[0], maximizedPanelId) ? 0 : nodeContainsPanel(split.children[1], maximizedPanelId) ? 1 : null)
    : null;
  const isMaximizedPath = maximizedChildIndex !== null;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const dimension = isHorizontal ? rect.width : rect.height;
      let ratio: number;

      if (isHorizontal) {
        ratio = (e.clientX - rect.left) / rect.width;
      } else {
        ratio = (e.clientY - rect.top) / rect.height;
      }

      // Calculate min ratios based on pixel constraints
      const minSize = isHorizontal ? MIN_PANEL_SIZE : MIN_PREVIEW_HEIGHT;
      const minRatio = minSize / dimension;
      const maxRatio = 1 - (MIN_PANEL_SIZE / dimension);

      // Clamp ratio to respect minimum sizes
      ratio = Math.max(minRatio, Math.min(maxRatio, ratio));

      setSplitRatio(split.id, ratio);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, isHorizontal, split.id, setSplitRatio]);

  const firstChildStyle = isMaximizedPath
    ? {
      [isHorizontal ? 'width' : 'height']: maximizedChildIndex === 0 ? '100%' : '0px',
      [isHorizontal ? 'minWidth' : 'minHeight']: 0,
      opacity: maximizedChildIndex === 0 ? 1 : 0,
      pointerEvents: maximizedChildIndex === 0 ? 'auto' as const : 'none' as const,
    }
    : {
      [isHorizontal ? 'width' : 'height']: `calc(${split.ratio * 100}% - 2px)`,
      [isHorizontal ? 'minWidth' : 'minHeight']: isHorizontal ? MIN_PANEL_SIZE : MIN_PREVIEW_HEIGHT,
    };

  const secondChildStyle = isMaximizedPath
    ? {
      [isHorizontal ? 'width' : 'height']: maximizedChildIndex === 1 ? '100%' : '0px',
      [isHorizontal ? 'minWidth' : 'minHeight']: 0,
      opacity: maximizedChildIndex === 1 ? 1 : 0,
      pointerEvents: maximizedChildIndex === 1 ? 'auto' as const : 'none' as const,
    }
    : {
      [isHorizontal ? 'width' : 'height']: `calc(${(1 - split.ratio) * 100}% - 2px)`,
      [isHorizontal ? 'minWidth' : 'minHeight']: MIN_PANEL_SIZE,
    };

  return (
    <div
      ref={containerRef}
      className={`dock-split ${isHorizontal ? 'horizontal' : 'vertical'} ${isResizing ? 'resizing' : ''} ${isMaximizedPath ? 'maximized-path' : ''}`}
      data-split-id={split.id}
    >
      <div className={`dock-split-child ${isMaximizedPath && maximizedChildIndex !== 0 ? 'is-collapsed' : ''}`} style={firstChildStyle}>
        <DockNode node={split.children[0]} />
      </div>
      {!isMaximizedPath && (
        <div
          ref={handleRef}
          className={`dock-resize-handle ${isHorizontal ? 'horizontal' : 'vertical'} ${isResizing ? 'active' : ''}`}
          onMouseDown={handleMouseDown}
        />
      )}
      <div className={`dock-split-child ${isMaximizedPath && maximizedChildIndex !== 1 ? 'is-collapsed' : ''}`} style={secondChildStyle}>
        <DockNode node={split.children[1]} />
      </div>
    </div>
  );
}
