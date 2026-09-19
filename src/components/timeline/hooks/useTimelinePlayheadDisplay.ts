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

const PLAYHEAD_CENTER_OFFSET_PX = -1;

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
      playhead.style.removeProperty('--timeline-switch-base-x');
      delete playhead.dataset.liveLeft;
      delete playhead.dataset.liveBaseLeft;
      return;
    }

    let rafId = 0;
    playhead.classList.add('playhead-live-transform');
    playhead.style.transform = '';
    playhead.style.willChange = 'transform';

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
      const baseLeft = metrics.trackHeaderWidth;
      const previousBaseLeft = Number.parseFloat(playhead.dataset.liveBaseLeft ?? '');
      if (!Number.isFinite(previousBaseLeft) || Math.abs(previousBaseLeft - baseLeft) > 0.01) {
        playhead.dataset.liveBaseLeft = String(baseLeft);
        playhead.style.left = `${baseLeft}px`;
      }
      const transformX = left - baseLeft + PLAYHEAD_CENTER_OFFSET_PX;
      playhead.style.setProperty('--timeline-switch-base-x', `${transformX}px`);
      // Keep the custom property for timeline-switch animations, but apply the
      // live transform inline as well. Some Chromium compositing paths keep the
      // CSS-variable-backed transform at its fallback value during playback.
      playhead.style.transform = `translate3d(${transformX}px, 0, 0)`;
      rafId = requestAnimationFrame(updateLivePlayhead);
    };

    updateLivePlayhead();

    return () => {
      cancelAnimationFrame(rafId);
      delete playhead.dataset.liveLeft;
      delete playhead.dataset.liveBaseLeft;
      playhead.classList.remove('playhead-live-transform');
      playhead.style.transform = '';
      playhead.style.willChange = '';
      playhead.style.removeProperty('--timeline-switch-base-x');
    };
  }, [isPlaying, isDraggingPlayhead, playheadRef]);

  return {
    playheadInlineStyle,
    showPlayhead,
  };
}
