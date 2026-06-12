import type { ComponentProps } from 'react';
import type { TimelineBodySurface } from '../components/TimelineBodySurface';

import { useTimelineBodySurfaceProps } from './useTimelineBodySurfaceProps';
import { useTimelineLineOpacity } from './useTimelineLineOpacity';
import { useTimelinePlaybackAutoScroll } from './useTimelinePlaybackAutoScroll';
import { useTimelinePlayheadDisplay } from './useTimelinePlayheadDisplay';
import { useTimelineRulerCacheRanges } from './useTimelineRulerCacheRanges';
import { useTimelineSurfacePointer } from './useTimelineSurfacePointer';

type BodySurfaceProps = ComponentProps<typeof TimelineBodySurface>;
type BodySurfaceParams = Parameters<typeof useTimelineBodySurfaceProps>[0];
type CacheRangeSource = () => Array<{ start: number; end: number }>;

type CompositionVideoBakeSelection = Exclude<BodySurfaceParams['videoBakeRegionSelection'], null>;

interface UseTimelineBodySurfaceControllerParams extends Omit<
  BodySurfaceParams,
  | 'cacheRanges'
  | 'clipDragActive'
  | 'getTimelineLineOpacity'
  | 'inLineOpacity'
  | 'marqueeActive'
  | 'onPointerCancel'
  | 'onPointerDown'
  | 'onPointerLeave'
  | 'onPointerMove'
  | 'onPointerUp'
  | 'outLineOpacity'
  | 'playheadInlineStyle'
  | 'showPlayhead'
  | 'timelineSurfaceCursor'
  | 'videoBakeRegionSelection'
> {
  getProxyCachedRanges: CacheRangeSource;
  getScrubCachedRanges: CacheRangeSource;
  isDraggingPlayhead: boolean;
  isPlaying: boolean;
  proxyEnabled: boolean;
  setScrollX: (scrollX: number) => void;
  setZoom: (zoom: number) => void;
  timelineToolCursor: string | undefined;
  videoBakeRegionSelection: BodySurfaceParams['videoBakeRegionSelection'] | { scope: string } | null;
}

function isCompositionVideoBakeSelection(
  selection: UseTimelineBodySurfaceControllerParams['videoBakeRegionSelection'],
): selection is CompositionVideoBakeSelection {
  return selection?.scope === 'composition';
}

export function useTimelineBodySurfaceController({
  activeTimelineToolId,
  audioLayerAdvancedMode,
  aiAnimatedMarkers,
  clipAnimationPhase,
  clipDrag,
  clipTrim,
  duration,
  exportProgress,
  exportRange,
  formatTime,
  frameRate,
  getCachedRanges,
  getProxyCachedRanges,
  getScrubCachedRanges,
  globalMarkerDrag,
  inOutMarkerContextMenu,
  inOutMarkerMouseDown,
  inPoint,
  isDraggingPlayhead,
  isExporting,
  isPlaying,
  isRamPreviewing,
  isTrackHeaderWidthResizing,
  markerCreateDrag,
  markers,
  marquee,
  midiDrawGhost,
  onContainerDragLeave,
  onRulerMouseDown,
  onSplitDividerMouseDown,
  onTimelineMarkerContextMenu,
  onTimelineMarkerMouseDown,
  onToggleAudioLayerAdvancedMode,
  onTrackFocusStep,
  onTrackHeaderWidthResizeStart,
  outPoint,
  playheadMouseDown,
  playheadPosition,
  playheadRef,
  proxyEnabled,
  ramPreviewProgress,
  renderAudioSection,
  renderVideoSection,
  scrollWrapperRef,
  scrollX,
  setScrollX,
  setZoom,
  slotGridProgress,
  splitDragVideoHeight,
  switchMotionClass,
  timelineBodyRef,
  timelineControlsProps,
  timelineMarkerDrag,
  timelineRangeSelection,
  timelineRef,
  timelineToolCursor,
  timeToPixel,
  trackFocusMode,
  trackHeaderWidth,
  trackLanesRef,
  videoBakeRegionSelection,
  videoBakeRegions,
  zoom,
}: UseTimelineBodySurfaceControllerParams): BodySurfaceProps {
  const { playheadInlineStyle, showPlayhead } = useTimelinePlayheadDisplay({
    playheadRef,
    isPlaying,
    isDraggingPlayhead,
    playheadPosition,
    scrollX,
    trackHeaderWidth,
    timeToPixel,
  });

  const {
    timelinePointerX,
    timelineSurfaceCursor,
    handleTimelinePointerDown,
    handleTimelinePointerMove,
    handleTimelinePointerUp,
    handleTimelinePointerLeave,
  } = useTimelineSurfacePointer({
    trackLanesRef,
    timelineBodyRef,
    activeTimelineToolId,
    timelineToolCursor,
    duration,
    scrollX,
    zoom,
    trackHeaderWidth,
    isClipInteractionActive: clipDrag !== null || clipTrim !== null,
    setZoom,
    setScrollX,
  });

  const {
    getTimelineLineOpacity,
    getTimelineLineOpacityForTime,
  } = useTimelineLineOpacity({
    timelinePointerX,
    scrollX,
    trackHeaderWidth,
    timeToPixel,
  });

  useTimelinePlaybackAutoScroll({
    duration,
    isDraggingPlayhead,
    isPlaying,
    playheadPosition,
    scrollX,
    setScrollX,
    timeToPixel,
    timelineRef,
    zoom,
  });

  const cacheRanges = useTimelineRulerCacheRanges({
    proxyEnabled,
    getProxyCachedRanges,
    getScrubCachedRanges,
  });

  return useTimelineBodySurfaceProps({
    activeTimelineToolId,
    audioLayerAdvancedMode,
    aiAnimatedMarkers,
    cacheRanges,
    clipAnimationPhase,
    clipDrag,
    clipDragActive: Boolean(clipDrag),
    clipTrim,
    duration,
    exportProgress,
    exportRange,
    formatTime,
    frameRate,
    getCachedRanges,
    getTimelineLineOpacity,
    globalMarkerDrag,
    inLineOpacity: getTimelineLineOpacityForTime(inPoint),
    inOutMarkerContextMenu,
    inOutMarkerMouseDown,
    inPoint,
    isExporting,
    isRamPreviewing,
    isTrackHeaderWidthResizing,
    markerCreateDrag,
    markers,
    marquee,
    marqueeActive: Boolean(marquee),
    midiDrawGhost,
    onContainerDragLeave,
    onPointerCancel: handleTimelinePointerUp,
    onPointerDown: handleTimelinePointerDown,
    onPointerLeave: handleTimelinePointerLeave,
    onPointerMove: handleTimelinePointerMove,
    onPointerUp: handleTimelinePointerUp,
    onRulerMouseDown,
    onSplitDividerMouseDown,
    onTimelineMarkerContextMenu,
    onTimelineMarkerMouseDown,
    onToggleAudioLayerAdvancedMode,
    onTrackFocusStep,
    onTrackHeaderWidthResizeStart,
    outLineOpacity: getTimelineLineOpacityForTime(outPoint),
    outPoint,
    playheadInlineStyle,
    playheadMouseDown,
    playheadPosition,
    playheadRef,
    ramPreviewProgress,
    renderAudioSection,
    renderVideoSection,
    scrollWrapperRef,
    scrollX,
    showPlayhead,
    slotGridProgress,
    splitDragVideoHeight,
    switchMotionClass,
    timeToPixel,
    timelineBodyRef,
    timelineControlsProps,
    timelineMarkerDrag,
    timelineRangeSelection,
    trackFocusMode,
    timelineRef,
    timelineSurfaceCursor,
    trackHeaderWidth,
    trackLanesRef,
    videoBakeRegionSelection: isCompositionVideoBakeSelection(videoBakeRegionSelection)
      ? videoBakeRegionSelection
      : null,
    videoBakeRegions,
    zoom,
  });
}
