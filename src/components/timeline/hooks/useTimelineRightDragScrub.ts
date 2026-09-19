import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  RefObject,
} from 'react';
import type { TimelineEmptyContextMenuState } from '../types';
import type { TimelineRightDragScrubState } from '../utils/timelineHostTypes';

const TIMELINE_RIGHT_DRAG_SCRUB_THRESHOLD_PX = 4;
const TIMELINE_RIGHT_DRAG_CONTEXT_MENU_SUPPRESS_MS = 700;

interface UseTimelineRightDragScrubProps {
  timelineRef: RefObject<HTMLDivElement | null>;
  scrollX: number;
  duration: number;
  isExporting: boolean;
  isPlaying: boolean;
  isRamPreviewing: boolean;
  pixelToTime: (pixel: number) => number;
  pause: () => void;
  cancelRamPreview: () => void;
  setDraggingPlayhead: (dragging: boolean) => void;
  setPlayheadPosition: (time: number) => void;
  closeTimelineContextMenus: () => void;
  setEmptyContextMenu: (menu: TimelineEmptyContextMenuState | null) => void;
  openClipContextMenu: (e: ReactMouseEvent, clipId: string) => void;
  handleClipMouseDown: (e: ReactMouseEvent, clipId: string) => void;
}

interface UseTimelineRightDragScrubReturn {
  handleEmptyTimelineMouseDown: (e: ReactMouseEvent, trackId: string, time: number) => void;
  handleEmptyTimelineContextMenu: (e: ReactMouseEvent, trackId: string, time: number) => void;
  handleClipContextMenu: (e: ReactMouseEvent, clipId: string) => void;
  handleTimelineClipMouseDown: (e: ReactMouseEvent, clipId: string) => void;
}

export function useTimelineRightDragScrub({
  timelineRef,
  scrollX,
  duration,
  isExporting,
  isPlaying,
  isRamPreviewing,
  pixelToTime,
  pause,
  cancelRamPreview,
  setDraggingPlayhead,
  setPlayheadPosition,
  closeTimelineContextMenus,
  setEmptyContextMenu,
  openClipContextMenu,
  handleClipMouseDown,
}: UseTimelineRightDragScrubProps): UseTimelineRightDragScrubReturn {
  const timelineRightDragScrubRef = useRef<TimelineRightDragScrubState | null>(null);
  const timelineRightDragScrubCleanupRef = useRef<(() => void) | null>(null);
  const suppressTimelineContextMenuUntilRef = useRef(0);

  const getTimelineTimeFromClientX = useCallback((clientX: number) => {
    if (!timelineRef.current) return null;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = clientX - rect.left + scrollX;
    return Math.max(0, Math.min(duration, pixelToTime(x)));
  }, [duration, pixelToTime, scrollX, timelineRef]);

  const cleanupTimelineRightDragScrub = useCallback(() => {
    timelineRightDragScrubCleanupRef.current?.();
    timelineRightDragScrubCleanupRef.current = null;

    const drag = timelineRightDragScrubRef.current;
    timelineRightDragScrubRef.current = null;
    if (drag?.dragging) {
      setDraggingPlayhead(false);
    }
  }, [setDraggingPlayhead]);

  useEffect(() => cleanupTimelineRightDragScrub, [cleanupTimelineRightDragScrub]);

  const handleTimelineRightDragScrubMouseDown = useCallback((
    e: ReactMouseEvent,
    startTime: number,
    source: Pick<TimelineRightDragScrubState, 'source' | 'trackId' | 'clipId'>,
  ) => {
    if (e.button !== 2 || isExporting) return;

    e.stopPropagation();
    cleanupTimelineRightDragScrub();
    timelineRightDragScrubRef.current = {
      ...source,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startTime,
      dragging: false,
    };

    const handleDocumentContextMenu = (event: MouseEvent) => {
      const drag = timelineRightDragScrubRef.current;
      if (!drag?.dragging && Date.now() >= suppressTimelineContextMenuUntilRef.current) return;

      event.preventDefault();
      event.stopPropagation();
    };

    const handleMouseMove = (event: MouseEvent) => {
      const drag = timelineRightDragScrubRef.current;
      if (!drag) return;

      const movedPx = Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      );
      if (!drag.dragging && movedPx < TIMELINE_RIGHT_DRAG_SCRUB_THRESHOLD_PX) return;

      if (!drag.dragging) {
        drag.dragging = true;
        closeTimelineContextMenus();

        if (isPlaying) {
          pause();
        }
        if (isRamPreviewing) {
          cancelRamPreview();
        }

        setDraggingPlayhead(true);
        setPlayheadPosition(drag.startTime);
      }

      event.preventDefault();
      const nextTime = getTimelineTimeFromClientX(event.clientX);
      if (nextTime !== null) {
        setPlayheadPosition(nextTime);
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      const drag = timelineRightDragScrubRef.current;
      if (drag?.dragging) {
        event.preventDefault();
        suppressTimelineContextMenuUntilRef.current = Date.now() + TIMELINE_RIGHT_DRAG_CONTEXT_MENU_SUPPRESS_MS;
        const suppressReleasedContextMenu = (contextMenuEvent: MouseEvent) => {
          if (Date.now() >= suppressTimelineContextMenuUntilRef.current) return;
          contextMenuEvent.preventDefault();
          contextMenuEvent.stopPropagation();
        };
        document.addEventListener('contextmenu', suppressReleasedContextMenu, true);
        window.setTimeout(() => {
          document.removeEventListener('contextmenu', suppressReleasedContextMenu, true);
        }, TIMELINE_RIGHT_DRAG_CONTEXT_MENU_SUPPRESS_MS);
      }
      cleanupTimelineRightDragScrub();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp, { once: true });
    document.addEventListener('contextmenu', handleDocumentContextMenu, true);
    timelineRightDragScrubCleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('contextmenu', handleDocumentContextMenu, true);
    };
  }, [
    cancelRamPreview,
    cleanupTimelineRightDragScrub,
    closeTimelineContextMenus,
    getTimelineTimeFromClientX,
    isExporting,
    isPlaying,
    isRamPreviewing,
    pause,
    setDraggingPlayhead,
    setPlayheadPosition,
  ]);

  const mouseDownCallbacksRef = useRef({
    getTimelineTimeFromClientX,
    handleClipMouseDown,
    handleTimelineRightDragScrubMouseDown,
  });
  useLayoutEffect(() => {
    mouseDownCallbacksRef.current = {
      getTimelineTimeFromClientX,
      handleClipMouseDown,
      handleTimelineRightDragScrubMouseDown,
    };
  }, [getTimelineTimeFromClientX, handleClipMouseDown, handleTimelineRightDragScrubMouseDown]);

  const handleEmptyTimelineMouseDown = useCallback((e: ReactMouseEvent, trackId: string, time: number) => {
    mouseDownCallbacksRef.current.handleTimelineRightDragScrubMouseDown(
      e,
      time,
      { source: 'empty', trackId },
    );
  }, []);

  const handleEmptyTimelineContextMenu = useCallback((e: ReactMouseEvent, trackId: string, time: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      timelineRightDragScrubRef.current?.dragging ||
      Date.now() < suppressTimelineContextMenuUntilRef.current
    ) {
      return;
    }
    if (isExporting) return;

    closeTimelineContextMenus();
    setEmptyContextMenu({
      x: e.clientX,
      y: e.clientY,
      time,
      trackId,
    });
  }, [closeTimelineContextMenus, isExporting, setEmptyContextMenu]);

  const handleClipContextMenu = useCallback((e: ReactMouseEvent, clipId: string) => {
    if (
      timelineRightDragScrubRef.current?.dragging ||
      Date.now() < suppressTimelineContextMenuUntilRef.current
    ) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    openClipContextMenu(e, clipId);
  }, [openClipContextMenu]);

  const handleTimelineClipMouseDown = useCallback((e: ReactMouseEvent, clipId: string) => {
    const callbacks = mouseDownCallbacksRef.current;
    if (e.button === 2) {
      const time = callbacks.getTimelineTimeFromClientX(e.clientX);
      if (time !== null) {
        callbacks.handleTimelineRightDragScrubMouseDown(e, time, { source: 'clip', clipId });
      }
      return;
    }

    callbacks.handleClipMouseDown(e, clipId);
  }, []);

  return {
    handleEmptyTimelineMouseDown,
    handleEmptyTimelineContextMenu,
    handleClipContextMenu,
    handleTimelineClipMouseDown,
  };
}
