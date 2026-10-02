import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { readTimelinePlaybackPosition } from './useTimelineEditorPlaybackState';

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
    let currentScrollX = scrollX;
    const followPosition = (position: number) => {
      // The viewport changes on resize, not on playback. Never measure layout
      // after a clock update, which would flush pending UI work synchronously.
      const viewportWidth = widthRef.current;
      if (!viewportWidth || viewportWidth <= 0) return;

      const playheadPixel = timeToPixel(position);
      if (playheadPixel < currentScrollX || playheadPixel > currentScrollX + viewportWidth) {
        const maxScrollX = Math.max(0, duration * zoom - viewportWidth + 100);
        const nextScrollX = Math.max(0, Math.min(maxScrollX, playheadPixel));
        if (nextScrollX !== currentScrollX) {
          currentScrollX = nextScrollX;
          setScrollX(nextScrollX);
        }
      }
    };
    followPosition(readTimelinePlaybackPosition(playheadPosition));
    // Only an actual viewport crossing wakes React. Ordinary clock updates
    // and loop/reverse movement are handled without rendering the Timeline.
    return useTimelineStore.subscribe(state => state.playheadPosition, position => {
      const state = useTimelineStore.getState();
      if (state.isPlaying && !state.isDraggingPlayhead) followPosition(position);
    });
  }, [isPlaying, isDraggingPlayhead, playheadPosition, scrollX, zoom, duration, setScrollX, timeToPixel, timelineRef]);
}
