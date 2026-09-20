import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

interface UseTimelinePlaybackAutoScrollProps {
  duration: number;
  isDraggingPlayhead: boolean;
  isPlaying: boolean;
  playheadPosition: number;
  scrollX: number;
  setScrollX: (scrollX: number) => void;
  timeToPixel: (time: number) => number;
  timelineRef: RefObject<HTMLDivElement | null>;
  zoom: number;
}

export function useTimelinePlaybackAutoScroll({
  duration,
  isDraggingPlayhead,
  isPlaying,
  playheadPosition,
  scrollX,
  setScrollX,
  timeToPixel,
  timelineRef,
  zoom,
}: UseTimelinePlaybackAutoScrollProps) {
  const widthRef = useRef(0);
  useEffect(() => {
    const element = timelineRef.current;
    if (!element) return;
    const measure = () => { widthRef.current = element.clientWidth; };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [timelineRef]);
  useEffect(() => {
    if (!isPlaying || isDraggingPlayhead) return;

    // Reading layout after each playhead update forces all pending UI work to
    // finish synchronously. The viewport changes on resize, not on playback.
    const viewportWidth = widthRef.current;
    if (!viewportWidth || viewportWidth <= 0) return;

    const endPadding = 100;
    const playheadPixel = timeToPixel(playheadPosition);
    const viewportStart = scrollX;
    const viewportEnd = scrollX + viewportWidth;
    const maxScrollX = Math.max(0, duration * zoom - viewportWidth + endPadding);

    if (playheadPixel > viewportEnd) {
      const nextScrollX = Math.max(
        0,
        Math.min(maxScrollX, playheadPixel)
      );
      if (nextScrollX !== scrollX) {
        setScrollX(nextScrollX);
      }
      return;
    }

    if (playheadPixel < viewportStart) {
      const nextScrollX = Math.max(
        0,
        Math.min(maxScrollX, playheadPixel)
      );
      if (nextScrollX !== scrollX) {
        setScrollX(nextScrollX);
      }
    }
  }, [isPlaying, isDraggingPlayhead, playheadPosition, scrollX, zoom, duration, setScrollX, timeToPixel, timelineRef]);
}
