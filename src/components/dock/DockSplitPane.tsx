// Split container with two children and resize handle

import { useCallback, useState, useEffect, useRef } from 'react';
import type { DockSplit } from '../../types/dock';
import { useDockStore } from '../../stores/dockStore';
import { startBatch, endBatch } from '../../stores/historyStore';
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
  const [liveRatio, setLiveRatio] = useState(split.ratio);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const liveRatioRef = useRef(split.ratio);
  const pendingLiveRatioRef = useRef<number | null>(null);
  const liveRatioFrameRef = useRef<number | null>(null);
  const resizeBatchActiveRef = useRef(false);
  const pendingPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const isHorizontal = split.direction === 'horizontal';
  const maximizedChildIndex = maximizedPanelId
    ? (nodeContainsPanel(split.children[0], maximizedPanelId) ? 0 : nodeContainsPanel(split.children[1], maximizedPanelId) ? 1 : null)
    : null;
  const isMaximizedPath = maximizedChildIndex !== null;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startBatch('Resize dock split');
    resizeBatchActiveRef.current = true;
    liveRatioRef.current = split.ratio;
    pendingLiveRatioRef.current = null;
    setLiveRatio(split.ratio);
    setIsResizing(true);
  }, [split.ratio]);

  useEffect(() => {
    if (isResizing) return;
    liveRatioRef.current = split.ratio;
    pendingLiveRatioRef.current = null;
  }, [isResizing, split.ratio]);

  useEffect(() => {
    if (!isResizing) return;

    const readRatioFromPointer = (pointer: { clientX: number; clientY: number }): number | null => {
      const container = containerRef.current;
      if (!container) return null;

      const rect = container.getBoundingClientRect();
      const dimension = isHorizontal ? rect.width : rect.height;
      let ratio: number;

      if (isHorizontal) {
        ratio = (pointer.clientX - rect.left) / rect.width;
      } else {
        ratio = (pointer.clientY - rect.top) / rect.height;
      }

      // Calculate min ratios based on pixel constraints
      const minSize = isHorizontal ? MIN_PANEL_SIZE : MIN_PREVIEW_HEIGHT;
      const minRatio = minSize / dimension;
      const maxRatio = 1 - (MIN_PANEL_SIZE / dimension);

      // Clamp ratio to respect minimum sizes
      return Math.max(minRatio, Math.min(maxRatio, ratio));
    };

    const commitLiveRatioFrame = () => {
      liveRatioFrameRef.current = null;
      const pointer = pendingPointerRef.current;
      pendingPointerRef.current = null;
      const nextRatio = pointer ? readRatioFromPointer(pointer) : pendingLiveRatioRef.current;
      if (nextRatio === null) return;
      pendingLiveRatioRef.current = null;
      liveRatioRef.current = nextRatio;
      setLiveRatio(nextRatio);
    };

    const scheduleLiveRatio = (ratio: number) => {
      pendingLiveRatioRef.current = ratio;
      if (liveRatioFrameRef.current !== null) return;
      liveRatioFrameRef.current = window.requestAnimationFrame(commitLiveRatioFrame);
    };

    const flushLiveRatio = (): number => {
      if (liveRatioFrameRef.current !== null) {
        window.cancelAnimationFrame(liveRatioFrameRef.current);
        liveRatioFrameRef.current = null;
      }
      const pointer = pendingPointerRef.current;
      const finalRatio = (pointer ? readRatioFromPointer(pointer) : pendingLiveRatioRef.current) ?? liveRatioRef.current;
      pendingPointerRef.current = null;
      pendingLiveRatioRef.current = null;
      liveRatioRef.current = finalRatio;
      setLiveRatio(finalRatio);
      return finalRatio;
    };

    const handleMouseMove = (e: MouseEvent) => {
      pendingPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
      scheduleLiveRatio(liveRatioRef.current);
    };

    const handleMouseUp = () => {
      const finalRatio = flushLiveRatio();
      setSplitRatio(split.id, finalRatio);
      setIsResizing(false);
      if (resizeBatchActiveRef.current) {
        resizeBatchActiveRef.current = false;
        endBatch();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (liveRatioFrameRef.current !== null) {
        window.cancelAnimationFrame(liveRatioFrameRef.current);
        liveRatioFrameRef.current = null;
      }
      pendingPointerRef.current = null;
      if (resizeBatchActiveRef.current) {
        resizeBatchActiveRef.current = false;
        endBatch();
      }
    };
  }, [isResizing, isHorizontal, split.id, setSplitRatio]);

  const effectiveRatio = isResizing ? liveRatio : split.ratio;
  const firstChildStyle = isMaximizedPath
    ? {
      [isHorizontal ? 'width' : 'height']: maximizedChildIndex === 0 ? '100%' : '0px',
      [isHorizontal ? 'minWidth' : 'minHeight']: 0,
      opacity: maximizedChildIndex === 0 ? 1 : 0,
      pointerEvents: maximizedChildIndex === 0 ? 'auto' as const : 'none' as const,
    }
    : {
      [isHorizontal ? 'width' : 'height']: `calc(${effectiveRatio * 100}% - 2px)`,
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
      [isHorizontal ? 'width' : 'height']: `calc(${(1 - effectiveRatio) * 100}% - 2px)`,
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
