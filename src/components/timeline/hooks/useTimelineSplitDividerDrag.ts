import { useCallback, useEffect, useRef } from 'react';
import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineTrackFocusMode } from '../../../stores/timeline/types';
import {
  SPLIT_DIVIDER_HEIGHT,
  SPLIT_FULL_CONTENT_SNAP_PX,
} from '../utils/timelineHostConstants';
import {
  clampScrollY,
  getTrackFocusModeForSplitPosition,
} from '../utils/timelineHostLayout';

interface UseTimelineSplitDividerDragProps {
  scrollWrapperRef: React.RefObject<HTMLDivElement | null>;
  trackFocusMode: TimelineTrackFocusMode;
  clampSplitDragVideoHeight: (nextVideoHeight: number, availableHeight: number) => number;
  expandedVideoSectionContentHeight: number;
  videoSectionContentHeight: number;
  isVideoBottomVisible: () => boolean;
  setTimelineSplitRatio: (ratio: number) => void;
  setTrackFocusMode: (mode: TimelineTrackFocusMode) => void;
  setVideoScrollY: Dispatch<SetStateAction<number>>;
  setSplitDragVideoHeight: Dispatch<SetStateAction<number | null>>;
  setSplitDragSmoothing: Dispatch<SetStateAction<boolean>>;
  setSplitDragPinVideoBottom: Dispatch<SetStateAction<boolean>>;
  setForceVideoBottomScroll: Dispatch<SetStateAction<boolean>>;
}

export function useTimelineSplitDividerDrag({
  scrollWrapperRef,
  trackFocusMode,
  clampSplitDragVideoHeight,
  expandedVideoSectionContentHeight,
  videoSectionContentHeight,
  isVideoBottomVisible,
  setTimelineSplitRatio,
  setTrackFocusMode,
  setVideoScrollY,
  setSplitDragVideoHeight,
  setSplitDragSmoothing,
  setSplitDragPinVideoBottom,
  setForceVideoBottomScroll,
}: UseTimelineSplitDividerDragProps): (event: ReactPointerEvent) => void {
  const splitDragAnchorVideoBottomRef = useRef(false);
  const splitDragStartedInAudioFocusRef = useRef(false);
  const splitDragStartedInVideoFocusRef = useRef(false);
  const splitDragAudioFocusJumpDoneRef = useRef(false);
  const splitDragSmoothingTimerRef = useRef<number | null>(null);
  const splitDragFrameRef = useRef<number | null>(null);
  const splitDragPendingClientYRef = useRef<number | null>(null);
  const splitDragCleanupRef = useRef<(() => void) | null>(null);

  const clearSmoothingTimer = useCallback(() => {
    if (splitDragSmoothingTimerRef.current !== null) {
      window.clearTimeout(splitDragSmoothingTimerRef.current);
      splitDragSmoothingTimerRef.current = null;
    }
  }, []);

  const scheduleSmoothingStop = useCallback((clearVideoHeight: boolean) => {
    clearSmoothingTimer();
    splitDragSmoothingTimerRef.current = window.setTimeout(() => {
      splitDragSmoothingTimerRef.current = null;
      setSplitDragSmoothing(false);
      if (clearVideoHeight) {
        setSplitDragVideoHeight(null);
      }
    }, 200);
  }, [clearSmoothingTimer, setSplitDragSmoothing, setSplitDragVideoHeight]);

  const applySplitDragPosition = useCallback((clientY: number) => {
    const wrapper = scrollWrapperRef.current;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const availableHeight = Math.max(0, rect.height - SPLIT_DIVIDER_HEIGHT);
    if (availableHeight <= 0) return;

    const rawVideoHeight = clientY - rect.top;
    const clampedRawVideoHeight = clampSplitDragVideoHeight(rawVideoHeight, availableHeight);
    const nextMode = getTrackFocusModeForSplitPosition(clampedRawVideoHeight, availableHeight);
    const canShowAllVideoTracks = videoSectionContentHeight > 0 && videoSectionContentHeight < availableHeight;
    const isLeavingVideoFocusDrag = splitDragStartedInVideoFocusRef.current && nextMode !== 'video';
    const isLeavingAudioFocusDrag = splitDragStartedInAudioFocusRef.current && nextMode !== 'audio';

    if (isLeavingAudioFocusDrag && !splitDragAudioFocusJumpDoneRef.current) {
      splitDragAudioFocusJumpDoneRef.current = true;
      setSplitDragPinVideoBottom(true);
      setForceVideoBottomScroll(true);
      setSplitDragSmoothing(true);
      scheduleSmoothingStop(false);
    } else if (isLeavingAudioFocusDrag) {
      setSplitDragPinVideoBottom(true);
      setForceVideoBottomScroll(true);
    }

    const shouldHoldAtFullVideoHeight =
      !isLeavingAudioFocusDrag &&
      isLeavingVideoFocusDrag &&
      canShowAllVideoTracks &&
      rawVideoHeight >= videoSectionContentHeight - SPLIT_FULL_CONTENT_SNAP_PX;
    const nextVideoHeight = shouldHoldAtFullVideoHeight
      ? videoSectionContentHeight
      : isLeavingAudioFocusDrag
        ? Math.max(clampedRawVideoHeight, availableHeight / 2)
        : clampedRawVideoHeight;

    setSplitDragVideoHeight(nextVideoHeight);
    if (splitDragAnchorVideoBottomRef.current || isLeavingVideoFocusDrag || isLeavingAudioFocusDrag) {
      const videoScrollContentHeight = isLeavingAudioFocusDrag
        ? expandedVideoSectionContentHeight
        : videoSectionContentHeight;
      const nextVideoScrollY = clampScrollY(
        videoScrollContentHeight - nextVideoHeight,
        videoScrollContentHeight,
        nextVideoHeight,
      );
      setVideoScrollY((current) => Math.abs(current - nextVideoScrollY) > 0.5 ? nextVideoScrollY : current);
    }
    if (nextMode === 'balanced') {
      setTimelineSplitRatio(nextVideoHeight / availableHeight);
    }
    if (useTimelineStore.getState().trackFocusMode !== nextMode) {
      setTrackFocusMode(nextMode);
    }
  }, [
    clampSplitDragVideoHeight,
    expandedVideoSectionContentHeight,
    scheduleSmoothingStop,
    scrollWrapperRef,
    setForceVideoBottomScroll,
    setSplitDragPinVideoBottom,
    setSplitDragSmoothing,
    setSplitDragVideoHeight,
    setTimelineSplitRatio,
    setTrackFocusMode,
    setVideoScrollY,
    videoSectionContentHeight,
  ]);

  const scheduleSplitDragPosition = useCallback((clientY: number) => {
    splitDragPendingClientYRef.current = clientY;
    if (splitDragFrameRef.current !== null) return;

    splitDragFrameRef.current = window.requestAnimationFrame(() => {
      splitDragFrameRef.current = null;
      const pendingClientY = splitDragPendingClientYRef.current;
      if (pendingClientY !== null) {
        applySplitDragPosition(pendingClientY);
      }
    });
  }, [applySplitDragPosition]);

  useEffect(() => () => {
    splitDragCleanupRef.current?.();
    splitDragCleanupRef.current = null;
    if (splitDragFrameRef.current !== null) {
      window.cancelAnimationFrame(splitDragFrameRef.current);
      splitDragFrameRef.current = null;
    }
    clearSmoothingTimer();
  }, [clearSmoothingTimer]);

  return useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    splitDragCleanupRef.current?.();
    const activePointerId = event.pointerId;
    const captureTarget = event.currentTarget as HTMLElement;
    let lastClientY = event.clientY;
    let finished = false;

    splitDragStartedInAudioFocusRef.current = trackFocusMode === 'audio';
    splitDragStartedInVideoFocusRef.current = trackFocusMode === 'video';
    splitDragAudioFocusJumpDoneRef.current = false;
    setSplitDragSmoothing(false);
    setSplitDragPinVideoBottom(false);
    if (trackFocusMode !== 'audio') {
      setForceVideoBottomScroll(false);
    }
    clearSmoothingTimer();
    splitDragAnchorVideoBottomRef.current = isVideoBottomVisible() || splitDragStartedInVideoFocusRef.current;
    applySplitDragPosition(event.clientY);

    function cleanupPointerSession() {
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('pointercancel', handlePointerCancel, true);
      document.removeEventListener('lostpointercapture', handleLostPointerCapture, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange, true);
      window.removeEventListener('blur', handleWindowAbort, true);
      window.removeEventListener('pagehide', handleWindowAbort, true);
      try {
        if (captureTarget.hasPointerCapture(activePointerId)) {
          captureTarget.releasePointerCapture(activePointerId);
        }
      } catch {
        // Window-level terminal listeners still close the drag on Safari.
      }
      if (splitDragCleanupRef.current === cleanupPointerSession) {
        splitDragCleanupRef.current = null;
      }
    }

    function handlePointerMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== activePointerId) return;
      moveEvent.preventDefault();
      lastClientY = moveEvent.clientY;
      scheduleSplitDragPosition(moveEvent.clientY);
    }

    function finishPointerSession(clientY: number) {
      if (finished) return;
      finished = true;
      cleanupPointerSession();
      if (splitDragFrameRef.current !== null) {
        window.cancelAnimationFrame(splitDragFrameRef.current);
        splitDragFrameRef.current = null;
      }
      splitDragPendingClientYRef.current = null;
      applySplitDragPosition(clientY);
      const wrapper = scrollWrapperRef.current;
      let shouldSnapBalancedReleaseToVideoBottom = false;
      let releaseSnapVideoHeight = 0;
      let releaseAvailableHeight = 0;
      if (
        wrapper &&
        !splitDragStartedInAudioFocusRef.current &&
        !splitDragStartedInVideoFocusRef.current
      ) {
        const rect = wrapper.getBoundingClientRect();
        releaseAvailableHeight = Math.max(0, rect.height - SPLIT_DIVIDER_HEIGHT);
        if (releaseAvailableHeight > 0) {
          const rawVideoHeight = clientY - rect.top;
          const clampedRawVideoHeight = clampSplitDragVideoHeight(rawVideoHeight, releaseAvailableHeight);
          const releaseMode = getTrackFocusModeForSplitPosition(clampedRawVideoHeight, releaseAvailableHeight);
          const canShowAllVideoTracks =
            videoSectionContentHeight > 0 &&
            videoSectionContentHeight < releaseAvailableHeight;
          shouldSnapBalancedReleaseToVideoBottom =
            releaseMode === 'balanced' &&
            canShowAllVideoTracks &&
            clampedRawVideoHeight > videoSectionContentHeight + 1;
          releaseSnapVideoHeight = videoSectionContentHeight;
        }
      }

      splitDragAnchorVideoBottomRef.current = false;
      splitDragStartedInAudioFocusRef.current = false;
      splitDragStartedInVideoFocusRef.current = false;
      splitDragAudioFocusJumpDoneRef.current = false;
      setSplitDragPinVideoBottom(false);
      clearSmoothingTimer();
      if (shouldSnapBalancedReleaseToVideoBottom) {
        setSplitDragSmoothing(true);
        setSplitDragVideoHeight(releaseSnapVideoHeight);
        setTimelineSplitRatio(releaseSnapVideoHeight / releaseAvailableHeight);
        if (useTimelineStore.getState().trackFocusMode !== 'balanced') {
          setTrackFocusMode('balanced');
        }
        scheduleSmoothingStop(true);
      } else {
        setSplitDragSmoothing(false);
        setSplitDragVideoHeight(null);
      }
    }

    function handlePointerUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== activePointerId) return;
      lastClientY = upEvent.clientY;
      finishPointerSession(lastClientY);
    }

    function handlePointerCancel(cancelEvent: PointerEvent) {
      if (cancelEvent.pointerId !== activePointerId) return;
      finishPointerSession(lastClientY);
    }

    function handleLostPointerCapture(lostEvent: PointerEvent) {
      if (lostEvent.pointerId !== activePointerId) return;
      finishPointerSession(lastClientY);
    }

    function handleWindowAbort() {
      finishPointerSession(lastClientY);
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') finishPointerSession(lastClientY);
    }

    splitDragCleanupRef.current = cleanupPointerSession;
    document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', handlePointerCancel, true);
    document.addEventListener('lostpointercapture', handleLostPointerCapture, true);
    document.addEventListener('visibilitychange', handleVisibilityChange, true);
    window.addEventListener('blur', handleWindowAbort, true);
    window.addEventListener('pagehide', handleWindowAbort, true);
    try {
      captureTarget.setPointerCapture(activePointerId);
    } catch {
      // The capture-phase document listeners are the fallback on older Safari.
    }
  }, [
    applySplitDragPosition,
    clampSplitDragVideoHeight,
    clearSmoothingTimer,
    isVideoBottomVisible,
    scheduleSmoothingStop,
    scheduleSplitDragPosition,
    scrollWrapperRef,
    setForceVideoBottomScroll,
    setSplitDragPinVideoBottom,
    setSplitDragSmoothing,
    setSplitDragVideoHeight,
    setTimelineSplitRatio,
    setTrackFocusMode,
    trackFocusMode,
    videoSectionContentHeight,
  ]);
}
