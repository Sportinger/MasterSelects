// Playhead Snap Effect Hook - handles playhead dragging with snapping

import { useEffect, useLayoutEffect, useRef } from 'react';
import { TIMELINE_END_PADDING_PX } from '../utils/timelineHostConstants';
import { clampValue } from '../utils/timelineHostLayout';

const PLAYHEAD_EDGE_ZONE_PX = 96;
const PLAYHEAD_EDGE_SCROLL_SPEED_PX_PER_SECOND = 1200;

interface UsePlayheadSnapProps {
  isDraggingPlayhead: boolean;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  scrollX: number;
  duration: number;
  snappingEnabled: boolean;
  pixelToTime: (pixel: number) => number;
  getSnapTargetTimes: () => number[];
  setPlayheadPosition: (position: number) => void;
  setScrollX: (scrollX: number) => void;
  setDraggingPlayhead: (dragging: boolean) => void;
  zoom: number;
}

export function usePlayheadSnap({
  isDraggingPlayhead,
  timelineRef,
  scrollX,
  duration,
  snappingEnabled,
  pixelToTime,
  getSnapTargetTimes,
  setPlayheadPosition,
  setScrollX,
  setDraggingPlayhead,
  zoom,
}: UsePlayheadSnapProps) {
  const scrollXRef = useRef(scrollX);
  useLayoutEffect(() => {
    scrollXRef.current = scrollX;
  }, [scrollX]);

  useEffect(() => () => setDraggingPlayhead(false), [setDraggingPlayhead]);

  useEffect(() => {
    if (!isDraggingPlayhead) return;

    let animationFrameId: number | null = null;
    let lastFrameAt: number | null = null;
    let pointer: { clientX: number; altKey: boolean } | null = null;

    const stopAutoScroll = () => {
      pointer = null;
      lastFrameAt = null;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };

    const updatePlayhead = (clientX: number, altKey: boolean) => {
      const timeline = timelineRef.current;
      if (!timeline) return;
      const rect = timeline.getBoundingClientRect();
      const x = clientX - rect.left + scrollXRef.current;
      let time = pixelToTime(x);

      // Snapping with Alt-key toggle:
      // - When snapping enabled: snap by default, Alt temporarily disables
      // - When snapping disabled: don't snap, Alt temporarily enables
      const shouldSnap = snappingEnabled !== altKey;

      if (shouldSnap) {
        const snapTimes = getSnapTargetTimes();
        const snapThreshold = pixelToTime(10);

        let closestSnap: number | null = null;
        let closestDistance = Infinity;

        for (const snapTime of snapTimes) {
          const distance = Math.abs(time - snapTime);
          if (distance < closestDistance && distance < snapThreshold) {
            closestDistance = distance;
            closestSnap = snapTime;
          }
        }

        if (closestSnap !== null) {
          time = closestSnap;
        }
      }

      setPlayheadPosition(Math.max(0, Math.min(time, duration)));
    };

    const getEdgeScroll = () => {
      const timeline = timelineRef.current;
      if (!timeline || !pointer) return null;
      const rect = timeline.getBoundingClientRect();
      if (rect.width <= 0) return null;

      const pointerX = pointer.clientX - rect.left;
      const direction = pointerX < PLAYHEAD_EDGE_ZONE_PX
        ? -1
        : pointerX > rect.width - PLAYHEAD_EDGE_ZONE_PX
          ? 1
          : 0;
      if (!direction) return null;

      const distanceToEdge = direction < 0 ? pointerX : rect.width - pointerX;
      const proximity = clampValue(
        (PLAYHEAD_EDGE_ZONE_PX - distanceToEdge) / PLAYHEAD_EDGE_ZONE_PX,
        0,
        1,
      );
      return { direction, proximity, viewportWidth: rect.width };
    };

    const autoScroll = (timestamp: number) => {
      animationFrameId = null;
      const edge = getEdgeScroll();
      if (!edge) return;

      const elapsedMs = lastFrameAt === null ? 0 : Math.min(timestamp - lastFrameAt, 50);
      lastFrameAt = timestamp;
      const maxScrollX = Math.max(
        0,
        duration * zoom - edge.viewportWidth + TIMELINE_END_PADDING_PX,
      );
      const nextScrollX = clampValue(
        scrollXRef.current + edge.direction * edge.proximity * PLAYHEAD_EDGE_SCROLL_SPEED_PX_PER_SECOND * elapsedMs / 1000,
        0,
        maxScrollX,
      );
      if (nextScrollX !== scrollXRef.current) {
        scrollXRef.current = nextScrollX;
        setScrollX(nextScrollX);
        updatePlayhead(pointer!.clientX, pointer!.altKey);
      }
      animationFrameId = requestAnimationFrame(autoScroll);
    };

    const handleMouseMove = (e: MouseEvent) => {
      // isDraggingPlayhead is also used by right-button timeline scrubbing.
      // Edge auto-scroll belongs only to left-button ruler/playhead drags.
      if ((e.buttons & 1) === 0) return;

      pointer = { clientX: e.clientX, altKey: e.altKey };
      updatePlayhead(e.clientX, e.altKey);
      if (!getEdgeScroll()) {
        stopAutoScroll();
      } else if (animationFrameId === null) {
        animationFrameId = requestAnimationFrame(autoScroll);
      }
    };

    const handleMouseUp = () => {
      stopAutoScroll();
      setDraggingPlayhead(false);
    };

    const handleDragCancel = () => {
      stopAutoScroll();
      setDraggingPlayhead(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('pointercancel', handleDragCancel);
    window.addEventListener('blur', handleDragCancel);
    return () => {
      stopAutoScroll();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('pointercancel', handleDragCancel);
      window.removeEventListener('blur', handleDragCancel);
    };
  }, [
    isDraggingPlayhead,
    duration,
    snappingEnabled,
    setPlayheadPosition,
    setScrollX,
    setDraggingPlayhead,
    pixelToTime,
    getSnapTargetTimes,
    timelineRef,
    zoom,
  ]);
}
