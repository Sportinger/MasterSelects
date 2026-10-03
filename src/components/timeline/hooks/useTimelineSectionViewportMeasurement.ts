import { useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

interface UseTimelineSectionViewportMeasurementProps {
  scrollWrapperRef: RefObject<HTMLDivElement | null>;
  timelineRef: RefObject<HTMLDivElement | null>;
  timelineBodyRef: RefObject<HTMLDivElement | null>;
  trackHeaderWidth: number;
  setTimelineViewportWidth: Dispatch<SetStateAction<number>>;
}

function getResizeObserverBlockSize(entry: ResizeObserverEntry): number {
  const borderBox = entry.borderBoxSize;
  const borderBoxSize = Array.isArray(borderBox) ? borderBox[0] : borderBox;
  return borderBoxSize?.blockSize ?? entry.contentRect.height;
}

function getResizeObserverInlineSize(entry: ResizeObserverEntry): number {
  const borderBox = entry.borderBoxSize;
  const borderBoxSize = Array.isArray(borderBox) ? borderBox[0] : borderBox;
  return borderBoxSize?.inlineSize ?? entry.contentRect.width;
}

// Section heights follow the panel height through React state, so they land a
// render later. Their height transition must not stretch that lag further.
const VIEWPORT_RESIZING_ATTRIBUTE = 'data-viewport-resizing';
const VIEWPORT_RESIZING_SETTLE_MS = 160;

export function useTimelineSectionViewportMeasurement({
  scrollWrapperRef,
  timelineRef,
  timelineBodyRef,
  trackHeaderWidth,
  setTimelineViewportWidth,
}: UseTimelineSectionViewportMeasurementProps) {
  const videoSectionViewportRef = useRef<HTMLDivElement>(null);
  const audioSectionViewportRef = useRef<HTMLDivElement>(null);
  const [videoViewportHeight, setVideoViewportHeight] = useState(160);
  const [audioViewportHeight, setAudioViewportHeight] = useState(160);
  const [splitViewportHeight, setSplitViewportHeight] = useState(320);

  useLayoutEffect(() => {
    const observedScrollWrapper = scrollWrapperRef.current;
    let lastSplitViewportHeight: number | null = null;
    let viewportResizeSettleTimer: ReturnType<typeof setTimeout> | undefined;
    const markViewportResizing = (scrollWrapper: HTMLDivElement) => {
      scrollWrapper.setAttribute(VIEWPORT_RESIZING_ATTRIBUTE, '');
      clearTimeout(viewportResizeSettleTimer);
      viewportResizeSettleTimer = setTimeout(() => {
        scrollWrapper.removeAttribute(VIEWPORT_RESIZING_ATTRIBUTE);
      }, VIEWPORT_RESIZING_SETTLE_MS);
    };
    const updateViewportHeights = (entryByElement?: Map<Element, ResizeObserverEntry>) => {
      const scrollWrapper = scrollWrapperRef.current;
      const timeline = timelineRef.current;
      const timelineBody = timelineBodyRef.current;
      const videoViewport = videoSectionViewportRef.current;
      const audioViewport = audioSectionViewportRef.current;

      // A child resize must not re-sample its parent's transient layout. The
      // split drives those children, so mixing measurements creates feedback.
      if (scrollWrapper && (!entryByElement || entryByElement.has(scrollWrapper))) {
        const entry = entryByElement?.get(scrollWrapper);
        const nextSplitViewportHeight = entry ? getResizeObserverBlockSize(entry) : scrollWrapper.clientHeight;
        if (lastSplitViewportHeight !== null && nextSplitViewportHeight !== lastSplitViewportHeight) {
          markViewportResizing(scrollWrapper);
        }
        lastSplitViewportHeight = nextSplitViewportHeight;
        setSplitViewportHeight(nextSplitViewportHeight);
      }
      if (videoViewport && (!entryByElement || entryByElement.has(videoViewport))) {
        const entry = entryByElement?.get(videoViewport);
        setVideoViewportHeight(entry ? getResizeObserverBlockSize(entry) : videoViewport.clientHeight);
      }
      if (audioViewport && (!entryByElement || entryByElement.has(audioViewport))) {
        const entry = entryByElement?.get(audioViewport);
        setAudioViewportHeight(entry ? getResizeObserverBlockSize(entry) : audioViewport.clientHeight);
      }

      const timelineEntry = timeline ? entryByElement?.get(timeline) : undefined;
      const timelineBodyEntry = timelineBody ? entryByElement?.get(timelineBody) : undefined;
      const widthSource = timeline ?? timelineBody;
      if (entryByElement && (!widthSource || !entryByElement.has(widthSource))) return;
      const nextTimelineViewportWidth =
        (timelineEntry ? getResizeObserverInlineSize(timelineEntry) : timeline?.clientWidth) ??
        (timelineBody
          ? (timelineBodyEntry ? getResizeObserverInlineSize(timelineBodyEntry) : timelineBody.clientWidth) - trackHeaderWidth
          : null);
      if (nextTimelineViewportWidth && nextTimelineViewportWidth > 0) {
        setTimelineViewportWidth(Math.max(1, nextTimelineViewportWidth));
      }
    };
    updateViewportHeights();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          const entryByElement = new Map<Element, ResizeObserverEntry>();
          entries.forEach((entry) => entryByElement.set(entry.target, entry));
          updateViewportHeights(entryByElement);
        })
      : null;
    [scrollWrapperRef.current, timelineRef.current, timelineBodyRef.current, videoSectionViewportRef.current, audioSectionViewportRef.current]
      .forEach((element) => {
        if (element) observer?.observe(element);
      });
    const handleWindowResize = () => updateViewportHeights();
    window.addEventListener('resize', handleWindowResize);
    return () => {
      clearTimeout(viewportResizeSettleTimer);
      observedScrollWrapper?.removeAttribute(VIEWPORT_RESIZING_ATTRIBUTE);
      observer?.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [scrollWrapperRef, setTimelineViewportWidth, timelineBodyRef, timelineRef, trackHeaderWidth]);

  return {
    videoSectionViewportRef,
    audioSectionViewportRef,
    videoViewportHeight,
    audioViewportHeight,
    splitViewportHeight,
  };
}
