import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import {
  MAX_TRACK_HEIGHT,
  MIN_TRACK_HEIGHT,
} from '../../../stores/timeline/constants';
import type { TimelineTrack as TimelineTrackType } from '../../../types';
import type { TrackResizeDragState } from '../utils/timelineHostTypes';

interface UseTimelineTrackResizeProps {
  isExporting: boolean;
  trackMap: Map<string, TimelineTrackType>;
  isVideoBottomVisible: () => boolean;
}

interface UseTimelineTrackResizeReturn {
  activeTrackResizeId: string | null;
  trackResizePinsVideoBottom: boolean;
  handleTrackResizeStart: (event: ReactPointerEvent, trackId: string) => void;
}

export function useTimelineTrackResize({
  isExporting,
  trackMap,
  isVideoBottomVisible,
}: UseTimelineTrackResizeProps): UseTimelineTrackResizeReturn {
  const trackResizeDragRef = useRef<TrackResizeDragState | null>(null);
  const trackResizeFrameRef = useRef<number | null>(null);
  const trackResizePendingClientYRef = useRef<number | null>(null);
  const [activeTrackResizeId, setActiveTrackResizeId] = useState<string | null>(null);
  const [trackResizePinsVideoBottom, setTrackResizePinsVideoBottom] = useState(false);
  const videoBottomVisibleRef = useRef(isVideoBottomVisible);
  useLayoutEffect(() => { videoBottomVisibleRef.current = isVideoBottomVisible; }, [isVideoBottomVisible]);

  const handleTrackResizeStart = useCallback((event: ReactPointerEvent, trackId: string) => {
    if (isExporting) return;

    const currentTrack = useTimelineStore.getState().tracks.find(candidate => candidate.id === trackId)
      ?? trackMap.get(trackId);
    if (!currentTrack) return;

    event.preventDefault();
    event.stopPropagation();

    const pinVideoBottom = currentTrack.type === 'video' && videoBottomVisibleRef.current();
    trackResizeDragRef.current = {
      trackId,
      startY: event.clientY,
      startHeight: currentTrack.height,
      pinVideoBottom,
    };
    setTrackResizePinsVideoBottom(pinVideoBottom);
    setActiveTrackResizeId(trackId);
  }, [isExporting, trackMap]);

  useEffect(() => {
    if (!activeTrackResizeId) return undefined;

    const applyTrackResize = (clientY: number) => {
      const drag = trackResizeDragRef.current;
      if (!drag) return;

      const nextHeight = Math.max(
        MIN_TRACK_HEIGHT,
        Math.min(MAX_TRACK_HEIGHT, drag.startHeight + clientY - drag.startY),
      );
      useTimelineStore.getState().setTrackHeight(drag.trackId, nextHeight);
    };

    const handlePointerMove = (event: PointerEvent) => {
      trackResizePendingClientYRef.current = event.clientY;
      if (trackResizeFrameRef.current !== null) return;

      trackResizeFrameRef.current = window.requestAnimationFrame(() => {
        trackResizeFrameRef.current = null;
        const pendingClientY = trackResizePendingClientYRef.current;
        trackResizePendingClientYRef.current = null;
        if (pendingClientY !== null) {
          applyTrackResize(pendingClientY);
        }
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (Number.isFinite(event.clientY)) {
        applyTrackResize(event.clientY);
      }
      if (trackResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(trackResizeFrameRef.current);
        trackResizeFrameRef.current = null;
      }
      trackResizePendingClientYRef.current = null;
      trackResizeDragRef.current = null;
      setTrackResizePinsVideoBottom(false);
      setActiveTrackResizeId(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    window.addEventListener('pointercancel', handlePointerUp, { once: true });

    return () => {
      if (trackResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(trackResizeFrameRef.current);
        trackResizeFrameRef.current = null;
      }
      trackResizePendingClientYRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [activeTrackResizeId]);

  return {
    activeTrackResizeId,
    trackResizePinsVideoBottom,
    handleTrackResizeStart,
  };
}
