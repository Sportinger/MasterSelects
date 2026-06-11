import { useEffect, useRef } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { getPlayheadPosition } from '../../../services/layerBuilder';
import { useTimelineStore } from '../../../stores/timeline';

interface UseTimelinePlayheadDisplayProps {
  playheadRef: RefObject<HTMLDivElement | null>;
  isPlaying: boolean;
  isDraggingPlayhead: boolean;
  playheadPosition: number;
  scrollX: number;
  trackHeaderWidth: number;
  timeToPixel: (time: number) => number;
}

interface UseTimelinePlayheadDisplayReturn {
  playheadInlineStyle: CSSProperties | undefined;
  showPlayhead: boolean;
}

export function useTimelinePlayheadDisplay({
  playheadRef,
  isPlaying,
  isDraggingPlayhead,
  playheadPosition,
  scrollX,
  trackHeaderWidth,
  timeToPixel,
}: UseTimelinePlayheadDisplayProps): UseTimelinePlayheadDisplayReturn {
  const visualPlayheadPosition = isPlaying && !isDraggingPlayhead
    ? getPlayheadPosition(playheadPosition)
    : playheadPosition;
  const playheadLeft = timeToPixel(visualPlayheadPosition) - scrollX + trackHeaderWidth;
  const playheadInlineStyle = isPlaying && !isDraggingPlayhead ? undefined : { left: playheadLeft };
  const showPlayhead = playheadLeft >= trackHeaderWidth;
  const playheadMetricsRef = useRef({
    timeToPixel,
    scrollX,
    trackHeaderWidth,
    playheadLeft,
  });

  useEffect(() => {
    playheadMetricsRef.current = {
      timeToPixel,
      scrollX,
      trackHeaderWidth,
      playheadLeft,
    };
  }, [playheadLeft, scrollX, timeToPixel, trackHeaderWidth]);

  useEffect(() => {
    const playhead = playheadRef.current;
    if (!playhead) return;

    if (!isPlaying || isDraggingPlayhead) {
      playhead.style.left = `${playheadMetricsRef.current.playheadLeft}px`;
      playhead.classList.remove('playhead-live-transform');
      playhead.style.transform = '';
      playhead.style.willChange = '';
      delete playhead.dataset.liveLeft;
      return;
    }

    let rafId = 0;
    playhead.classList.add('playhead-live-transform');
    playhead.style.transform = '';
    playhead.style.willChange = 'left';

    const updateLivePlayhead = () => {
      const timelineState = useTimelineStore.getState();
      const storePosition = timelineState.playheadPosition;
      const livePosition = getPlayheadPosition(storePosition);
      const metrics = playheadMetricsRef.current;
      const nextLeft = metrics.timeToPixel(livePosition) - metrics.scrollX + metrics.trackHeaderWidth;
      const previousLeft = Number.parseFloat(playhead.dataset.liveLeft ?? '');
      const left = (
        timelineState.playbackSpeed >= 0 &&
        Number.isFinite(previousLeft) &&
        nextLeft < previousLeft &&
        previousLeft - nextLeft <= 2
      )
        ? previousLeft
        : nextLeft;
      playhead.dataset.liveLeft = String(left);
      playhead.style.left = `${left}px`;
      rafId = requestAnimationFrame(updateLivePlayhead);
    };

    updateLivePlayhead();

    return () => {
      cancelAnimationFrame(rafId);
      delete playhead.dataset.liveLeft;
      playhead.classList.remove('playhead-live-transform');
      playhead.style.transform = '';
      playhead.style.willChange = '';
    };
  }, [isPlaying, isDraggingPlayhead, playheadRef]);

  return {
    playheadInlineStyle,
    showPlayhead,
  };
}
