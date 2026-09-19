// Split container with two children and resize handle

import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import type { DockSplit } from '../../types/dock';
import { useDockStore } from '../../stores/dockStore';
import { nodeContainsPanelType } from '../../stores/dockStore/layoutTree';
import { useTimelineStore } from '../../stores/timeline';
import { DockNode } from './DockNode';
import { nodeContainsPanel } from '../../utils/dockLayout';
import {
  registerDockResizeHandle,
  registerDockResizeProxyHandle,
  startDockResize,
  type DockResizePointer,
} from './dockResizeSession';
import {
  DOCK_RESIZE_HANDLE_SIZE,
  findDockResizeDelegateId,
  getColorTimelinePanelHeight,
  getDirectChildMinimumSize,
  getDockNodeFixedSize,
} from './dockPanelSizing';

interface DockSplitPaneProps {
  split: DockSplit;
}

const MIN_PANEL_SIZE = 150;
const MIN_PREVIEW_HEIGHT = 200;

export function DockSplitPane({ split }: DockSplitPaneProps) {
  const setSplitRatio = useDockStore((state) => state.setSplitRatio);
  const maximizedPanelId = useDockStore((state) => state.maximizedPanelId);
  const layoutRoot = useDockStore((state) => state.layout.root);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstChildRef = useRef<HTMLDivElement>(null);
  const secondChildRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const liveRatioRef = useRef(split.ratio);
  const liveRatioFrameRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<DockResizePointer | null>(null);

  const isHorizontal = split.direction === 'horizontal';
  const splitDimension = isHorizontal ? 'width' : 'height';
  const containsColorTimeline = nodeContainsPanelType(split, 'color-timeline');
  const colorTimelineTrackCount = useTimelineStore((state) => (
    containsColorTimeline ? state.tracks.filter(track => track.type === 'video').length : 0
  ));
  const fixedSizeOverrides = useMemo(() => (
    containsColorTimeline
      ? { 'color-timeline': { height: getColorTimelinePanelHeight(colorTimelineTrackCount) } }
      : undefined
  ), [colorTimelineTrackCount, containsColorTimeline]);
  const firstMinimumSize = getDirectChildMinimumSize(
    split.children[0],
    splitDimension,
    isHorizontal ? MIN_PANEL_SIZE : MIN_PREVIEW_HEIGHT,
    fixedSizeOverrides,
  );
  const secondMinimumSize = getDirectChildMinimumSize(
    split.children[1],
    splitDimension,
    MIN_PANEL_SIZE,
    fixedSizeOverrides,
  );
  const firstFixedSize = getDockNodeFixedSize(split.children[0], splitDimension, fixedSizeOverrides);
  const secondFixedSize = getDockNodeFixedSize(split.children[1], splitDimension, fixedSizeOverrides);
  const hasFixedChild = firstFixedSize !== null || secondFixedSize !== null;
  const resizeDelegateId = hasFixedChild
    ? findDockResizeDelegateId(layoutRoot, split.id, splitDimension, fixedSizeOverrides)
    : null;
  const isResizeHandleInteractive = !hasFixedChild || resizeDelegateId !== null;
  const maximizedChildIndex = maximizedPanelId
    ? (nodeContainsPanel(split.children[0], maximizedPanelId) ? 0 : nodeContainsPanel(split.children[1], maximizedPanelId) ? 1 : null)
    : null;
  const isMaximizedPath = maximizedChildIndex !== null;

  const applyLiveRatioToDom = useCallback((ratio: number) => {
    if (isMaximizedPath || hasFixedChild) return;
    const firstChild = firstChildRef.current;
    const secondChild = secondChildRef.current;
    if (!firstChild || !secondChild) return;
    const sizeProperty = isHorizontal ? 'width' : 'height';
    firstChild.style.setProperty(sizeProperty, `calc(${ratio * 100}% - 2px)`);
    secondChild.style.setProperty(sizeProperty, `calc(${(1 - ratio) * 100}% - 2px)`);
  }, [hasFixedChild, isHorizontal, isMaximizedPath]);

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

    if (firstMinimumSize + secondMinimumSize > dimension) {
      return firstMinimumSize / (firstMinimumSize + secondMinimumSize);
    }

    const minRatio = firstMinimumSize / dimension;
    const maxRatio = 1 - (secondMinimumSize / dimension);

    // Clamp ratio to respect minimum sizes
    return Math.max(minRatio, Math.min(maxRatio, ratio));
  }, [firstMinimumSize, isHorizontal, secondMinimumSize]);

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

    if (hasFixedChild) {
      if (!resizeDelegateId) return;
      return registerDockResizeProxyHandle({
        id: split.id,
        axis: isHorizontal ? 'x' : 'y',
        element,
        proxyTargetId: resizeDelegateId,
      });
    }

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
    hasFixedChild,
    isHorizontal,
    isMaximizedPath,
    resizeDelegateId,
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
  const sizeProperty = isHorizontal ? 'width' : 'height';
  const minimumProperty = isHorizontal ? 'minWidth' : 'minHeight';
  const maximumProperty = isHorizontal ? 'maxWidth' : 'maxHeight';
  const getFixedChildStyle = (fixedSize: number) => ({
    [sizeProperty]: `${fixedSize}px`,
    [minimumProperty]: fixedSize,
    [maximumProperty]: fixedSize,
    flex: '0 0 auto',
  });
  const getFlexibleChildStyle = (fixedSiblingSize: number, minimumSize: number) => ({
    [sizeProperty]: `calc(100% - ${fixedSiblingSize + DOCK_RESIZE_HANDLE_SIZE}px)`,
    [minimumProperty]: minimumSize,
  });
  const firstChildStyle = isMaximizedPath
    ? {
      [isHorizontal ? 'width' : 'height']: maximizedChildIndex === 0 ? '100%' : '0px',
      [isHorizontal ? 'minWidth' : 'minHeight']: 0,
      opacity: maximizedChildIndex === 0 ? 1 : 0,
      pointerEvents: maximizedChildIndex === 0 ? 'auto' as const : 'none' as const,
    }
    : firstFixedSize !== null
      ? getFixedChildStyle(firstFixedSize)
      : secondFixedSize !== null
        ? getFlexibleChildStyle(secondFixedSize, firstMinimumSize)
        : {
            [isHorizontal ? 'width' : 'height']: `calc(${effectiveRatio * 100}% - 2px)`,
            [isHorizontal ? 'minWidth' : 'minHeight']: firstMinimumSize,
          };

  const secondChildStyle = isMaximizedPath
    ? {
      [isHorizontal ? 'width' : 'height']: maximizedChildIndex === 1 ? '100%' : '0px',
      [isHorizontal ? 'minWidth' : 'minHeight']: 0,
      opacity: maximizedChildIndex === 1 ? 1 : 0,
      pointerEvents: maximizedChildIndex === 1 ? 'auto' as const : 'none' as const,
    }
    : secondFixedSize !== null
      ? getFixedChildStyle(secondFixedSize)
      : firstFixedSize !== null
        ? getFlexibleChildStyle(firstFixedSize, secondMinimumSize)
        : {
            [isHorizontal ? 'width' : 'height']: `calc(${(1 - effectiveRatio) * 100}% - 2px)`,
            [isHorizontal ? 'minWidth' : 'minHeight']: secondMinimumSize,
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
          className={`dock-resize-handle ${isHorizontal ? 'horizontal' : 'vertical'} ${isResizing ? 'active' : ''} ${isResizeHandleInteractive ? '' : 'locked'} ${resizeDelegateId ? 'delegated' : ''}`}
          data-guided-target={`dock-resize:${split.id}`}
          data-guided-resize-handle={isResizeHandleInteractive ? 'true' : undefined}
          data-guided-resize-axis={isResizeHandleInteractive ? isHorizontal ? 'x' : 'y' : undefined}
          onPointerDown={isResizeHandleInteractive ? handlePointerDown : undefined}
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
