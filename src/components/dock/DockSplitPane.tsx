// Split container with two children and resize handle

import { useCallback, useState, useEffect, useRef } from 'react';
import type { DockSplit } from '../../types/dock';
import { useDockStore } from '../../stores/dockStore';
import { DockNode } from './DockNode';
import { nodeContainsPanel } from '../../utils/dockLayout';
import {
  registerDockResizeHandle,
  startDockResize,
  type DockResizePointer,
} from './dockResizeSession';

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
  const firstChildRef = useRef<HTMLDivElement>(null);
  const secondChildRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const liveRatioRef = useRef(split.ratio);
  const liveRatioFrameRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<DockResizePointer | null>(null);

  const isHorizontal = split.direction === 'horizontal';
  const maximizedChildIndex = maximizedPanelId
    ? (nodeContainsPanel(split.children[0], maximizedPanelId) ? 0 : nodeContainsPanel(split.children[1], maximizedPanelId) ? 1 : null)
    : null;
  const isMaximizedPath = maximizedChildIndex !== null;

  const applyLiveRatioToDom = useCallback((ratio: number) => {
    if (isMaximizedPath) return;
    const firstChild = firstChildRef.current;
    const secondChild = secondChildRef.current;
    if (!firstChild || !secondChild) return;
    const sizeProperty = isHorizontal ? 'width' : 'height';
    firstChild.style.setProperty(sizeProperty, `calc(${ratio * 100}% - 2px)`);
    secondChild.style.setProperty(sizeProperty, `calc(${(1 - ratio) * 100}% - 2px)`);
  }, [isHorizontal, isMaximizedPath]);

  useEffect(() => {
    if (isResizing) return;
    liveRatioRef.current = split.ratio;
  }, [isResizing, split.ratio]);

  const readRatioFromPointer = useCallback((pointer: DockResizePointer): number | null => {
    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const dimension = isHorizontal ? rect.width : rect.height;
    if (dimension <= 0) return null;

    const ratio = isHorizontal
      ? (pointer.clientX - rect.left) / rect.width
      : (pointer.clientY - rect.top) / rect.height;

    // Calculate min ratios based on pixel constraints
    const minSize = isHorizontal ? MIN_PANEL_SIZE : MIN_PREVIEW_HEIGHT;
    const minRatio = minSize / dimension;
    const maxRatio = 1 - (MIN_PANEL_SIZE / dimension);

    // Clamp ratio to respect minimum sizes
    return Math.max(minRatio, Math.min(maxRatio, ratio));
  }, [isHorizontal]);

  const commitLiveRatioFrame = useCallback(() => {
    liveRatioFrameRef.current = null;
    const pointer = pendingPointerRef.current;
    pendingPointerRef.current = null;
    if (!pointer) return;

    const nextRatio = readRatioFromPointer(pointer);
    if (nextRatio === null) return;
    liveRatioRef.current = nextRatio;
    applyLiveRatioToDom(nextRatio);
  }, [applyLiveRatioToDom, readRatioFromPointer]);

  const scheduleLiveRatio = useCallback((pointer: DockResizePointer) => {
    pendingPointerRef.current = pointer;
    if (liveRatioFrameRef.current !== null) return;
    liveRatioFrameRef.current = window.requestAnimationFrame(commitLiveRatioFrame);
  }, [commitLiveRatioFrame]);

  const flushLiveRatio = useCallback((pointer: DockResizePointer): number => {
    if (liveRatioFrameRef.current !== null) {
      window.cancelAnimationFrame(liveRatioFrameRef.current);
      liveRatioFrameRef.current = null;
    }

    pendingPointerRef.current = null;
    const finalRatio = readRatioFromPointer(pointer) ?? liveRatioRef.current;
    liveRatioRef.current = finalRatio;
    applyLiveRatioToDom(finalRatio);
    return finalRatio;
  }, [applyLiveRatioToDom, readRatioFromPointer]);

  const handleResizeStart = useCallback(() => {
    liveRatioRef.current = split.ratio;
    pendingPointerRef.current = null;
    applyLiveRatioToDom(split.ratio);
    setIsResizing(true);
  }, [applyLiveRatioToDom, split.ratio]);

  const handleResizeMove = useCallback((pointer: DockResizePointer) => {
    scheduleLiveRatio(pointer);
  }, [scheduleLiveRatio]);

  const handleResizeEnd = useCallback((pointer: DockResizePointer) => {
    const finalRatio = flushLiveRatio(pointer);
    setSplitRatio(split.id, finalRatio);
    setIsResizing(false);
  }, [flushLiveRatio, setSplitRatio, split.id]);

  useEffect(() => {
    const element = handleRef.current;
    if (!element || isMaximizedPath) return;

    return registerDockResizeHandle({
      id: split.id,
      axis: isHorizontal ? 'x' : 'y',
      element,
      onStart: handleResizeStart,
      onMove: handleResizeMove,
      onEnd: handleResizeEnd,
    });
  }, [
    handleResizeEnd,
    handleResizeMove,
    handleResizeStart,
    isHorizontal,
    isMaximizedPath,
    split.id,
  ]);

  useEffect(() => () => {
    if (liveRatioFrameRef.current !== null) {
      window.cancelAnimationFrame(liveRatioFrameRef.current);
      liveRatioFrameRef.current = null;
    }
    pendingPointerRef.current = null;
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (!startDockResize(event.nativeEvent, split.id)) return;

    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window-level capture listeners keep the resize session alive if capture is unavailable.
    }
  }, [split.id]);

  const effectiveRatio = split.ratio;
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
      data-guided-target={`dock-split:${split.id}`}
    >
      <div ref={firstChildRef} className={`dock-split-child ${isMaximizedPath && maximizedChildIndex !== 0 ? 'is-collapsed' : ''}`} style={firstChildStyle}>
        <DockNode node={split.children[0]} />
      </div>
      {!isMaximizedPath && (
        <div
          ref={handleRef}
          className={`dock-resize-handle ${isHorizontal ? 'horizontal' : 'vertical'} ${isResizing ? 'active' : ''}`}
          data-guided-target={`dock-resize:${split.id}`}
          data-guided-resize-handle="true"
          data-guided-resize-axis={isHorizontal ? 'x' : 'y'}
          onPointerDown={handlePointerDown}
        >
          <span
            aria-hidden="true"
            className="dock-guided-resize-corner dock-guided-resize-corner--start"
            data-guided-resize-corner="start"
            data-guided-target={`dock-resize-corner:${split.id}:start`}
          />
          <span
            aria-hidden="true"
            className="dock-guided-resize-corner dock-guided-resize-corner--end"
            data-guided-resize-corner="end"
            data-guided-target={`dock-resize-corner:${split.id}:end`}
          />
        </div>
      )}
      <div ref={secondChildRef} className={`dock-split-child ${isMaximizedPath && maximizedChildIndex !== 1 ? 'is-collapsed' : ''}`} style={secondChildStyle}>
        <DockNode node={split.children[1]} />
      </div>
    </div>
  );
}
