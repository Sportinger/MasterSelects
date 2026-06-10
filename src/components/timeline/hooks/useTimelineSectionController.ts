import { useCallback, useMemo, useState } from 'react';
import type { RefObject } from 'react';

import type { AnimatableProperty, Keyframe, TimelineClip as TimelineClipType, TimelineTrack as TimelineTrackType } from '../../../types';
import type { TimelineAudioDisplayMode, TimelinePropertiesSelection, TimelineTrackFocusMode } from '../../../stores/timeline/types';
import type { ClipDragState, ExternalDragState } from '../types';
import { TIMELINE_VIEWPORT_FALLBACK_PX } from '../utils/timelineHostConstants';
import { useTimelineSectionLayout } from './useTimelineSectionLayout';
import { useTimelineSectionViewportMeasurement } from './useTimelineSectionViewportMeasurement';
import { useTimelineSectionReveal } from './useTimelineSectionReveal';
import { useTimelineSectionScroll } from './useTimelineSectionScroll';
import { useTimelineSectionScrollPinning } from './useTimelineSectionScrollPinning';
import { useTimelineSplitDividerDrag } from './useTimelineSplitDividerDrag';
import { useTimelineTrackFocusStep } from './useTimelineTrackFocusStep';
import { useTimelineTrackResize } from './useTimelineTrackResize';

interface UseTimelineSectionControllerProps {
  audioDisplayMode: TimelineAudioDisplayMode;
  audioFocusMode: boolean;
  clipDrag: ClipDragState | null;
  clipKeyframes: Map<string, Keyframe[]>;
  clips: TimelineClipType[];
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  externalDrag: ExternalDragState | null;
  getExpandedTrackHeight: (trackId: string, baseHeight: number) => number;
  getRenderedTrackBaseHeight: (track: TimelineTrackType) => number;
  isExporting: boolean;
  isTrackExpandedForRender: (trackId: string) => boolean;
  keyframeLayoutInputs: unknown;
  propertiesSelection: TimelinePropertiesSelection;
  scrollWrapperRef: RefObject<HTMLDivElement | null>;
  selectedClipIds: Set<string>;
  setTimelineSplitRatio: (ratio: number) => void;
  setTrackFocusMode: (mode: TimelineTrackFocusMode) => void;
  timelineBodyRef: RefObject<HTMLDivElement | null>;
  timelineRef: RefObject<HTMLDivElement | null>;
  timelineSplitRatio: number | null;
  timelineViewTrackMap: Map<string, TimelineTrackType>;
  timelineViewTracks: TimelineTrackType[];
  trackFocusMode: TimelineTrackFocusMode;
  trackHeaderWidth: number;
  trackMap: Map<string, TimelineTrackType>;
  tracks: TimelineTrackType[];
}

export function useTimelineSectionController({
  audioDisplayMode,
  audioFocusMode,
  clipDrag,
  clipKeyframes,
  clips,
  expandedCurveProperties,
  externalDrag,
  getExpandedTrackHeight,
  getRenderedTrackBaseHeight,
  isExporting,
  isTrackExpandedForRender,
  keyframeLayoutInputs,
  propertiesSelection,
  scrollWrapperRef,
  selectedClipIds,
  setTimelineSplitRatio,
  setTrackFocusMode,
  timelineBodyRef,
  timelineRef,
  timelineSplitRatio,
  timelineViewTrackMap,
  timelineViewTracks,
  trackFocusMode,
  trackHeaderWidth,
  trackMap,
  tracks,
}: UseTimelineSectionControllerProps) {
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(TIMELINE_VIEWPORT_FALLBACK_PX);
  const [splitDragVideoHeight, setSplitDragVideoHeight] = useState<number | null>(null);
  const [splitDragSmoothing, setSplitDragSmoothing] = useState(false);
  const [splitDragPinVideoBottom, setSplitDragPinVideoBottom] = useState(false);
  const [forceVideoBottomScroll, setForceVideoBottomScroll] = useState(false);

  const {
    videoSectionViewportRef,
    audioSectionViewportRef,
    videoViewportHeight,
    audioViewportHeight,
    splitViewportHeight,
  } = useTimelineSectionViewportMeasurement({
    scrollWrapperRef,
    timelineRef,
    timelineBodyRef,
    trackHeaderWidth,
    setTimelineViewportWidth,
  });

  const clipDragNewTrackType = clipDrag?.newTrackType ?? null;
  const {
    timelineViewVideoTracks,
    timelineViewAudioTracks,
    displayedVideoTracks,
    displayedAudioTracks,
    isVideoSectionCollapsed,
    isAudioSectionCollapsed,
    isSectionCollapsed,
    getFocusContextTrackHeight,
    getSectionTrackBaseHeight,
    getSectionTrackHeight,
    clampSplitDragVideoHeight,
    videoSectionMetrics,
    audioSectionMetrics,
    expandedVideoSectionContentHeight,
    audioScrollableContentHeight,
    audioNewTrackPreviewHeight,
    videoScrollSnapPositions,
    audioScrollSnapPositions,
    videoSectionHeight,
    audioSectionHeight,
  } = useTimelineSectionLayout({
    timelineViewTracks,
    trackFocusMode,
    timelineSplitRatio,
    splitDragVideoHeight,
    videoViewportHeight,
    audioViewportHeight,
    splitViewportHeight,
    audioDisplayMode,
    audioFocusMode,
    clipDragNewTrackType,
    externalDragNewTrackType: externalDrag?.newTrackType,
    externalDragAudioTrackId: externalDrag?.audioTrackId,
    keyframeLayoutInputs,
    getRenderedTrackBaseHeight,
    getExpandedTrackHeight,
    isTrackExpandedForRender,
  });

  const {
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
  } = useTimelineSectionScroll({
    isSectionCollapsed,
    videoSectionMetrics,
    audioSectionMetrics,
    videoViewportHeight,
    audioViewportHeight,
    videoScrollSnapPositions,
    audioScrollSnapPositions,
    audioScrollableContentHeight,
    setForceVideoBottomScroll,
  });

  const contentHeight = Math.max(videoSectionMetrics.contentHeight, audioSectionMetrics.contentHeight);
  const trackSnapPositions = useMemo(() => [0], []);
  const viewportHeight = Math.max(videoViewportHeight, audioViewportHeight, 1);

  const isVideoBottomVisible = useCallback(() => {
    const videoContentHeight = videoSectionMetrics.contentHeight;
    if (isVideoSectionCollapsed || videoContentHeight <= 0 || timelineViewVideoTracks.length === 0) {
      return false;
    }

    return videoSectionHeight >= videoContentHeight - 1
      || videoScrollY + videoSectionHeight >= videoContentHeight - 1;
  }, [
    isVideoSectionCollapsed,
    timelineViewVideoTracks.length,
    videoScrollY,
    videoSectionHeight,
    videoSectionMetrics.contentHeight,
  ]);

  const {
    activeTrackResizeId,
    trackResizePinsVideoBottom,
    handleTrackResizeStart,
  } = useTimelineTrackResize({
    isExporting,
    trackMap,
    isVideoBottomVisible,
  });

  useTimelineSectionScrollPinning({
    activeTrackResizeId,
    audioScrollableContentHeight,
    audioViewportHeight,
    expandedVideoSectionContentHeight,
    forceVideoBottomScroll,
    isAudioSectionCollapsed,
    isVideoSectionCollapsed,
    splitDragPinVideoBottom,
    splitDragVideoHeight,
    trackFocusMode,
    trackResizePinsVideoBottom,
    videoSectionContentHeight: videoSectionMetrics.contentHeight,
    videoSectionHeight,
    videoViewportHeight,
    setAudioScrollY,
    setForceVideoBottomScroll,
    setVideoScrollY,
  });

  useTimelineSectionReveal({
    clips,
    tracks,
    selectedClipIds,
    clipKeyframes,
    expandedCurveProperties,
    timelineViewTrackMap,
    trackMap,
    displayedVideoTracks,
    displayedAudioTracks,
    isAudioSectionCollapsed,
    isVideoSectionCollapsed,
    isSectionCollapsed,
    isTrackExpandedForRender,
    getSectionTrackBaseHeight,
    getSectionTrackHeight,
    videoSectionHeight,
    audioSectionHeight,
    videoSectionContentHeight: videoSectionMetrics.contentHeight,
    audioSectionContentHeight: audioSectionMetrics.contentHeight,
    audioScrollableContentHeight,
    audioViewportHeight,
    externalDrag,
    clipDrag,
    clipDragNewTrackType,
    propertiesSelection,
    audioScrollYRef,
    sectionScrollAnimationTargetRef,
    setVideoScrollY,
    setAudioScrollY,
    animateSectionScrollTo,
  });

  const handleTrackFocusStep = useTimelineTrackFocusStep({
    trackFocusMode,
    setTrackFocusMode,
  });

  const handleSplitDividerMouseDown = useTimelineSplitDividerDrag({
    scrollWrapperRef,
    trackFocusMode,
    clampSplitDragVideoHeight,
    expandedVideoSectionContentHeight,
    videoSectionContentHeight: videoSectionMetrics.contentHeight,
    isVideoBottomVisible,
    setTimelineSplitRatio,
    setTrackFocusMode,
    setVideoScrollY,
    setSplitDragVideoHeight,
    setSplitDragSmoothing,
    setSplitDragPinVideoBottom,
    setForceVideoBottomScroll,
  });

  return {
    activeTrackResizeId,
    audioNewTrackPreviewHeight,
    audioScrollY,
    audioSectionHeight,
    audioSectionViewportRef,
    audioScrollableContentHeight,
    clipDragNewTrackType,
    contentHeight,
    displayedAudioTracks,
    displayedVideoTracks,
    expandedVideoSectionContentHeight,
    forceVideoBottomScroll,
    getFocusContextTrackHeight,
    getSectionTrackBaseHeight,
    getSectionTrackHeight,
    handleSectionWheel,
    handleSplitDividerMouseDown,
    handleTrackFocusStep,
    handleTrackResizeStart,
    isAudioSectionCollapsed,
    isSectionCollapsed,
    isVideoSectionCollapsed,
    scrollY,
    setScrollY,
    splitDragPinVideoBottom,
    splitDragSmoothing,
    splitDragVideoHeight,
    timelineViewAudioTracks,
    timelineViewVideoTracks,
    timelineViewportWidth,
    trackSnapPositions,
    videoScrollY,
    videoSectionHeight,
    videoSectionViewportRef,
    viewportHeight,
  };
}
