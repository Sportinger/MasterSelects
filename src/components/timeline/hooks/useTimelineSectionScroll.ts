import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction, WheelEvent as ReactWheelEvent } from 'react';

import {
  TRACK_SCROLL_RELEASE_SETTLE_MS,
  TRACK_SCROLL_SNAP_ANIMATION_MS,
} from '../utils/timelineHostConstants';
import type {
  SectionScrollGestureState,
  TrackSectionKind,
  TrackSectionMetrics,
} from '../utils/timelineHostTypes';
import {
  clampScrollY,
  easeOutCubic,
  getLiveSectionScrollY,
  getNormalizedWheelDeltaY,
  getSectionScrollGlideDuration,
  getSettledSectionScrollSnapPosition,
} from '../utils/timelineHostLayout';

interface UseTimelineSectionScrollProps {
  isSectionCollapsed: (sectionKind: TrackSectionKind) => boolean;
  videoSectionMetrics: TrackSectionMetrics;
  audioSectionMetrics: TrackSectionMetrics;
  videoViewportHeight: number;
  audioViewportHeight: number;
  videoScrollSnapPositions: readonly number[];
  audioScrollSnapPositions: readonly number[];
  audioScrollableContentHeight: number;
  setForceVideoBottomScroll: Dispatch<SetStateAction<boolean>>;
}

interface UseTimelineSectionScrollReturn {
  scrollY: number;
  setScrollY: Dispatch<SetStateAction<number>>;
  videoScrollY: number;
  setVideoScrollY: Dispatch<SetStateAction<number>>;
  audioScrollY: number;
  setAudioScrollY: Dispatch<SetStateAction<number>>;
  audioScrollYRef: React.MutableRefObject<number>;
  sectionScrollAnimationTargetRef: React.MutableRefObject<Record<TrackSectionKind, number | null>>;
  animateSectionScrollTo: (
    sectionKind: TrackSectionKind,
    targetScrollY: number,
    contentHeight: number,
    viewportHeight: number,
    durationMs?: number,
  ) => void;
  handleSectionWheel: (event: ReactWheelEvent, sectionKind: TrackSectionKind) => void;
}

export function useTimelineSectionScroll({
  isSectionCollapsed,
  videoSectionMetrics,
  audioSectionMetrics,
  videoViewportHeight,
  audioViewportHeight,
  videoScrollSnapPositions,
  audioScrollSnapPositions,
  audioScrollableContentHeight,
  setForceVideoBottomScroll,
}: UseTimelineSectionScrollProps): UseTimelineSectionScrollReturn {
  const [scrollY, setScrollY] = useState(0);
  const [videoScrollY, setVideoScrollY] = useState(0);
  const [audioScrollY, setAudioScrollY] = useState(0);
  const videoScrollYRef = useRef(videoScrollY);
  const audioScrollYRef = useRef(audioScrollY);
  const sectionScrollAnimationFrameRef = useRef<Record<TrackSectionKind, number | null>>({
    video: null,
    audio: null,
  });
  const sectionScrollAnimationTargetRef = useRef<Record<TrackSectionKind, number | null>>({
    video: null,
    audio: null,
  });
  const sectionScrollGestureRef = useRef<Record<TrackSectionKind, SectionScrollGestureState | null>>({
    video: null,
    audio: null,
  });

  useEffect(() => {
    videoScrollYRef.current = videoScrollY;
  }, [videoScrollY]);

  useEffect(() => {
    audioScrollYRef.current = audioScrollY;
  }, [audioScrollY]);

  const setSectionScrollY = useCallback((sectionKind: TrackSectionKind, nextScrollY: number) => {
    if (sectionKind === 'video') {
      videoScrollYRef.current = nextScrollY;
      setVideoScrollY(nextScrollY);
    } else {
      audioScrollYRef.current = nextScrollY;
      setAudioScrollY(nextScrollY);
    }
  }, []);

  const cancelSectionScrollAnimation = useCallback((sectionKind: TrackSectionKind, clearTarget = true) => {
    const frameId = sectionScrollAnimationFrameRef.current[sectionKind];
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
      sectionScrollAnimationFrameRef.current[sectionKind] = null;
    }
    if (clearTarget) {
      sectionScrollAnimationTargetRef.current[sectionKind] = null;
    }
  }, []);

  const cancelSectionScrollGesture = useCallback((sectionKind: TrackSectionKind) => {
    const gesture = sectionScrollGestureRef.current[sectionKind];
    if (gesture?.settleTimerId !== null && gesture?.settleTimerId !== undefined) {
      window.clearTimeout(gesture.settleTimerId);
    }
    sectionScrollGestureRef.current[sectionKind] = null;
  }, []);

  const animateSectionScrollTo = useCallback((
    sectionKind: TrackSectionKind,
    targetScrollY: number,
    contentHeight: number,
    viewportHeight: number,
    durationMs = TRACK_SCROLL_SNAP_ANIMATION_MS,
  ) => {
    cancelSectionScrollGesture(sectionKind);

    const startScrollY = sectionKind === 'video'
      ? videoScrollYRef.current
      : audioScrollYRef.current;
    const target = clampScrollY(targetScrollY, contentHeight, viewportHeight);

    cancelSectionScrollAnimation(sectionKind, false);
    sectionScrollAnimationTargetRef.current[sectionKind] = target;

    if (Math.abs(startScrollY - target) < 0.5) {
      sectionScrollAnimationTargetRef.current[sectionKind] = null;
      setSectionScrollY(sectionKind, target);
      return;
    }

    const startTime = window.performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / Math.max(1, durationMs));
      const easedProgress = easeOutCubic(progress);
      const nextScrollY = startScrollY + (target - startScrollY) * easedProgress;

      setSectionScrollY(sectionKind, nextScrollY);

      if (progress < 1) {
        sectionScrollAnimationFrameRef.current[sectionKind] = window.requestAnimationFrame(step);
        return;
      }

      sectionScrollAnimationFrameRef.current[sectionKind] = null;
      sectionScrollAnimationTargetRef.current[sectionKind] = null;
      setSectionScrollY(sectionKind, target);
    };

    sectionScrollAnimationFrameRef.current[sectionKind] = window.requestAnimationFrame(step);
  }, [cancelSectionScrollAnimation, cancelSectionScrollGesture, setSectionScrollY]);

  useEffect(() => () => {
    cancelSectionScrollGesture('video');
    cancelSectionScrollGesture('audio');
    cancelSectionScrollAnimation('video');
    cancelSectionScrollAnimation('audio');
  }, [cancelSectionScrollAnimation, cancelSectionScrollGesture]);

  const handleSectionWheel = useCallback((
    event: ReactWheelEvent,
    sectionKind: TrackSectionKind,
  ) => {
    // Bail without preventDefault on any modifier so it falls through to the body
    // wheel handler (useTimelineZoom): Ctrl/Alt = zoom, Shift = scroll. Ctrl+wheel
    // is the only zoom Linux users can rely on (WMs eat Alt+wheel) — never swallow it.
    if (event.deltaY === 0 || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (isSectionCollapsed(sectionKind)) return;

    const metrics = sectionKind === 'video' ? videoSectionMetrics : audioSectionMetrics;
    const measuredViewportHeight = sectionKind === 'video' ? videoViewportHeight : audioViewportHeight;
    const scrollableContentHeight = sectionKind === 'audio'
      ? audioScrollableContentHeight
      : metrics.contentHeight;
    if (scrollableContentHeight <= measuredViewportHeight) return;

    event.preventDefault();
    event.stopPropagation();

    const deltaY = getNormalizedWheelDeltaY(event, measuredViewportHeight);
    const snapPositions = sectionKind === 'video'
      ? videoScrollSnapPositions
      : audioScrollSnapPositions;

    if (sectionKind === 'video') {
      setForceVideoBottomScroll(false);
    }

    const previousGesture = sectionScrollGestureRef.current[sectionKind];
    if (previousGesture?.settleTimerId !== null && previousGesture?.settleTimerId !== undefined) {
      window.clearTimeout(previousGesture.settleTimerId);
    }
    const previousDirection = previousGesture ? Math.sign(previousGesture.accumulatedDeltaY) : 0;
    const nextDirection = Math.sign(deltaY);
    const continuingGesture = previousGesture && previousDirection === nextDirection
      ? previousGesture
      : null;

    cancelSectionScrollAnimation(sectionKind);

    const currentScrollY = sectionKind === 'video'
      ? videoScrollYRef.current
      : audioScrollYRef.current;
    const rawNextScrollY = clampScrollY(
      currentScrollY + deltaY,
      scrollableContentHeight,
      measuredViewportHeight,
    );
    const startScrollY = continuingGesture?.startScrollY ?? currentScrollY;
    const accumulatedDeltaY = (continuingGesture?.accumulatedDeltaY ?? 0) + deltaY;
    const targetScrollY = getSettledSectionScrollSnapPosition(
      startScrollY,
      accumulatedDeltaY,
      snapPositions,
      scrollableContentHeight,
      measuredViewportHeight,
    );
    const nextScrollY = getLiveSectionScrollY(
      currentScrollY,
      rawNextScrollY,
      targetScrollY,
      nextDirection,
    );

    setSectionScrollY(sectionKind, nextScrollY);

    const settleTimerId = window.setTimeout(() => {
      const activeGesture = sectionScrollGestureRef.current[sectionKind];
      if (!activeGesture || activeGesture.settleTimerId !== settleTimerId) return;

      const latestScrollY = sectionKind === 'video'
        ? videoScrollYRef.current
        : audioScrollYRef.current;
      const settledScrollY = getSettledSectionScrollSnapPosition(
        activeGesture.startScrollY,
        activeGesture.accumulatedDeltaY,
        activeGesture.snapPositions,
        activeGesture.contentHeight,
        activeGesture.viewportHeight,
      );

      sectionScrollGestureRef.current[sectionKind] = null;
      const glideDurationMs = getSectionScrollGlideDuration(settledScrollY - latestScrollY);
      animateSectionScrollTo(
        sectionKind,
        settledScrollY,
        activeGesture.contentHeight,
        activeGesture.viewportHeight,
        glideDurationMs,
      );
    }, TRACK_SCROLL_RELEASE_SETTLE_MS);

    sectionScrollGestureRef.current[sectionKind] = {
      startScrollY,
      accumulatedDeltaY,
      settleTimerId,
      snapPositions,
      contentHeight: scrollableContentHeight,
      viewportHeight: measuredViewportHeight,
    };
  }, [
    animateSectionScrollTo,
    audioScrollSnapPositions,
    audioScrollableContentHeight,
    audioSectionMetrics,
    audioViewportHeight,
    cancelSectionScrollAnimation,
    isSectionCollapsed,
    setForceVideoBottomScroll,
    setSectionScrollY,
    videoScrollSnapPositions,
    videoSectionMetrics,
    videoViewportHeight,
  ]);

  return {
    scrollY,
    setScrollY,
    videoScrollY,
    setVideoScrollY,
    audioScrollY,
    setAudioScrollY,
    audioScrollYRef,
    sectionScrollAnimationTargetRef,
    animateSectionScrollTo,
    handleSectionWheel,
  };
}
