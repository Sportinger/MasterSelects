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
    const updateViewportHeights = (entryByElement?: Map<Element, ResizeObserverEntry>) => {
      const scrollWrapper = scrollWrapperRef.current;
      const timeline = timelineRef.current;
      const timelineBody = timelineBodyRef.current;
      const videoViewport = videoSectionViewportRef.current;
      const audioViewport = audioSectionViewportRef.current;

      if (scrollWrapper) {
        const entry = entryByElement?.get(scrollWrapper);
        setSplitViewportHeight(entry ? getResizeObserverBlockSize(entry) : scrollWrapper.clientHeight);
      }
      if (videoViewport) {
        const entry = entryByElement?.get(videoViewport);
        setVideoViewportHeight(entry ? getResizeObserverBlockSize(entry) : videoViewport.clientHeight);
      }
      if (audioViewport) {
        const entry = entryByElement?.get(audioViewport);
        setAudioViewportHeight(entry ? getResizeObserverBlockSize(entry) : audioViewport.clientHeight);
      }

      const timelineEntry = timeline ? entryByElement?.get(timeline) : undefined;
      const timelineBodyEntry = timelineBody ? entryByElement?.get(timelineBody) : undefined;
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
