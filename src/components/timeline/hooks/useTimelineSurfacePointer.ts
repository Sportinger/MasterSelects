import { useCallback, useRef, useState } from 'react';
import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import { MIN_ZOOM, MAX_ZOOM } from '../../../stores/timeline/constants';
import { TIMELINE_END_PADDING_PX } from '../utils/timelineHostConstants';
import type { TimelineSurfaceDragState } from '../utils/timelineHostTypes';
import {
  clampValue,
  shouldIgnoreTimelineSurfaceToolTarget,
} from '../utils/timelineHostLayout';
import { calculateTimelineZoomScrollX } from '../utils/timelineZoomAnchor';

interface UseTimelineSurfacePointerProps {
  trackLanesRef: RefObject<HTMLDivElement | null>;
  timelineBodyRef: RefObject<HTMLDivElement | null>;
  activeTimelineToolId: string | undefined;
  timelineToolCursor: string | undefined;
  duration: number;
  scrollX: number;
  zoom: number;
  trackHeaderWidth: number;
  isClipInteractionActive: boolean;
  setZoom: (zoom: number) => void;
  setScrollX: (scrollX: number) => void;
}

interface UseTimelineSurfacePointerReturn {
  timelinePointerX: number | null;
  timelineSurfaceCursor: string | undefined;
  handleTimelinePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleTimelinePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleTimelinePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleTimelinePointerLeave: () => void;
}

export function useTimelineSurfacePointer({
  trackLanesRef,
  timelineBodyRef,
  activeTimelineToolId,
  timelineToolCursor,
  duration,
  scrollX,
  zoom,
  trackHeaderWidth,
  isClipInteractionActive,
  setZoom,
  setScrollX,
}: UseTimelineSurfacePointerProps): UseTimelineSurfacePointerReturn {
  const timelineSurfaceDragRef = useRef<TimelineSurfaceDragState | null>(null);
  const [isTimelineSurfacePanning, setIsTimelineSurfacePanning] = useState(false);
  const [timelinePointerX, setTimelinePointerX] = useState<number | null>(null);

  const getTimelineViewportWidth = useCallback(() => {
    const laneWidth = trackLanesRef.current?.clientWidth;
    if (laneWidth && laneWidth > 0) return laneWidth;

    const bodyWidth = timelineBodyRef.current?.clientWidth;
    if (bodyWidth && bodyWidth > 0) return Math.max(1, bodyWidth - trackHeaderWidth);

    return 800;
  }, [timelineBodyRef, trackHeaderWidth, trackLanesRef]);

  const getTimelineMaxScrollX = useCallback((zoomValue: number) => {
    return Math.max(
      0,
      duration * zoomValue - getTimelineViewportWidth() + TIMELINE_END_PADDING_PX,
    );
  }, [duration, getTimelineViewportWidth]);

  const getTimelineSurfacePointerX = useCallback((clientX: number) => {
    const rect = trackLanesRef.current?.getBoundingClientRect() ??
      timelineBodyRef.current?.getBoundingClientRect();
    const viewportWidth = getTimelineViewportWidth();
    if (!rect) return 0;
    return clampValue(clientX - rect.left, 0, viewportWidth);
  }, [getTimelineViewportWidth, timelineBodyRef, trackLanesRef]);

  const handleTimelinePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (activeTimelineToolId !== 'hand' && activeTimelineToolId !== 'zoom') return;
    if (shouldIgnoreTimelineSurfaceToolTarget(event.target)) return;

    event.preventDefault();
    event.stopPropagation();

    if (activeTimelineToolId === 'zoom') {
      const viewportWidth = getTimelineViewportWidth();
      const pointerX = getTimelineSurfacePointerX(event.clientX);
      const dynamicMinZoom = Math.max(MIN_ZOOM, (viewportWidth - TIMELINE_END_PADDING_PX) / Math.max(0.001, duration));
      const zoomMultiplier = event.altKey || event.shiftKey ? 1 / 1.35 : 1.35;
      const nextZoom = clampValue(zoom * zoomMultiplier, dynamicMinZoom, MAX_ZOOM);
      const nextMaxScrollX = Math.max(0, duration * nextZoom - viewportWidth + TIMELINE_END_PADDING_PX);
      const nextScrollX = calculateTimelineZoomScrollX({
        scrollX,
        zoom,
        nextZoom,
        pointerX,
        viewportWidth,
        maxScrollX: nextMaxScrollX,
      });

      setZoom(nextZoom);
      setScrollX(nextScrollX);
      return;
    }

    timelineSurfaceDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollX: scrollX,
      maxScrollX: getTimelineMaxScrollX(zoom),
    };
    setIsTimelineSurfacePanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [
    activeTimelineToolId,
    duration,
    getTimelineMaxScrollX,
    getTimelineSurfacePointerX,
    getTimelineViewportWidth,
    scrollX,
    setScrollX,
    setZoom,
    zoom,
  ]);

  const handleTimelinePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = timelineSurfaceDragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const deltaX = event.clientX - drag.startClientX;
      setScrollX(clampValue(drag.startScrollX - deltaX, 0, drag.maxScrollX));
      event.preventDefault();
    }

    if (isClipInteractionActive) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const nextPointerX = Math.round(event.clientX - rect.left);
    setTimelinePointerX(previousPointerX => previousPointerX === nextPointerX ? previousPointerX : nextPointerX);
  }, [isClipInteractionActive, setScrollX]);

  const handleTimelinePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = timelineSurfaceDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    timelineSurfaceDragRef.current = null;
    setIsTimelineSurfacePanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleTimelinePointerLeave = useCallback(() => {
    if (!timelineSurfaceDragRef.current) {
      setTimelinePointerX(null);
    }
  }, []);

  return {
    timelinePointerX,
    timelineSurfaceCursor: isTimelineSurfacePanning ? 'grabbing' : timelineToolCursor,
    handleTimelinePointerDown,
    handleTimelinePointerMove,
    handleTimelinePointerUp,
    handleTimelinePointerLeave,
  };
}
