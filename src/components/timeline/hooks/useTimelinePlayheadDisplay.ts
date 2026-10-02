import { useLayoutEffect, useRef } from 'react';
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
  const playheadInlineStyle = isPlaying || isDraggingPlayhead ? undefined : { left: playheadLeft };
  // Keep the live element mounted when it is outside the viewport; its RAF
  // updates visibility as playback/looping crosses the header without React.
  const showPlayhead = isPlaying || isDraggingPlayhead || playheadLeft >= trackHeaderWidth;
  const playheadMetricsRef = useRef({
    timeToPixel,
    scrollX,
    trackHeaderWidth,
    playheadLeft,
  });

  useLayoutEffect(() => {
    playheadMetricsRef.current = {
      timeToPixel,
      scrollX,
      trackHeaderWidth,
      playheadLeft,
    };
  }, [playheadLeft, scrollX, timeToPixel, trackHeaderWidth]);

  useLayoutEffect(() => {
    const playhead = playheadRef.current;
    if (!playhead) return;

    if (!isPlaying && !isDraggingPlayhead) {
      playhead.style.left = `${playheadMetricsRef.current.playheadLeft}px`;
      playhead.classList.remove('playhead-live-transform');
      playhead.style.transform = '';
      playhead.style.willChange = '';
      playhead.style.visibility = '';
      playhead.style.removeProperty('--timeline-switch-base-x');
      delete playhead.dataset.liveLeft;
      delete playhead.dataset.liveBaseLeft;
      return;
    }

    let rafId = 0;
    let previousPosition = Number.NaN;
    playhead.classList.add('playhead-live-transform');
    playhead.style.transform = '';
    playhead.style.willChange = 'transform';

    const drawPlayhead = () => {
      const timelineState = useTimelineStore.getState();
      const storePosition = timelineState.playheadPosition;
      const livePosition = timelineState.isDraggingPlayhead ? storePosition : getPlayheadPosition(storePosition);
      const metrics = playheadMetricsRef.current;
      const nextLeft = metrics.timeToPixel(livePosition) - metrics.scrollX + metrics.trackHeaderWidth;
      const previousLeft = Number.parseFloat(playhead.dataset.liveLeft ?? '');
      const left = (
        !timelineState.isDraggingPlayhead && timelineState.playbackSpeed >= 0 &&
        livePosition >= previousPosition - 0.005 &&
        Number.isFinite(previousLeft) &&
        nextLeft < previousLeft &&
        previousLeft - nextLeft <= 2
      )
        ? previousLeft
        : nextLeft;
      playhead.dataset.liveLeft = String(left);
      previousPosition = livePosition;
      const baseLeft = metrics.trackHeaderWidth;
      playhead.style.visibility = left >= baseLeft ? '' : 'hidden';
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
    };

    const updateLivePlayhead = () => {
      drawPlayhead();
      rafId = requestAnimationFrame(updateLivePlayhead);
    };
    // Drag coordinates reach the DOM in the pointer's store update, before
    // React commits or the video decoder can finish the requested seek.
    const unsubscribe = isDraggingPlayhead
      ? useTimelineStore.subscribe(state => state.playheadPosition, drawPlayhead)
      : undefined;
    if (isDraggingPlayhead) drawPlayhead();
    else updateLivePlayhead();

    return () => {
      cancelAnimationFrame(rafId);
      unsubscribe?.();
      delete playhead.dataset.liveLeft;
      delete playhead.dataset.liveBaseLeft;
      playhead.classList.remove('playhead-live-transform');
      playhead.style.transform = '';
      playhead.style.willChange = '';
      playhead.style.visibility = '';
      playhead.style.removeProperty('--timeline-switch-base-x');
    };
  }, [isPlaying, isDraggingPlayhead, playheadRef, scrollX, timeToPixel, trackHeaderWidth]);

  return {
    playheadInlineStyle,
    showPlayhead,
  };
}
