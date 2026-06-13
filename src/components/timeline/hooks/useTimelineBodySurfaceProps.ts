import type { ComponentProps } from 'react';
import type { TimelineBodySurface } from '../components/TimelineBodySurface';

type BodySurfaceProps = ComponentProps<typeof TimelineBodySurface>;
type GlobalOverlayProps = BodySurfaceProps['globalOverlayProps'];
type InteractionOverlayProps = BodySurfaceProps['interactionOverlayProps'];
type MarkerOverlayProps = BodySurfaceProps['markerOverlayProps'];
type PlayheadOverlayProps = BodySurfaceProps['playheadOverlayProps'];
type RulerHeaderProps = BodySurfaceProps['rulerHeaderProps'];
type SplitDividerProps = BodySurfaceProps['splitDividerProps'];

interface UseTimelineBodySurfacePropsParams extends Omit<
  BodySurfaceProps,
  | 'globalOverlayProps'
  | 'interactionOverlayProps'
  | 'markerOverlayProps'
  | 'playheadOverlayProps'
  | 'rulerHeaderProps'
  | 'splitDividerProps'
> {
  audioLayerAdvancedMode: SplitDividerProps['audioLayerAdvancedMode'];
  aiAnimatedMarkers: MarkerOverlayProps['aiAnimatedMarkers'];
  cacheRanges: RulerHeaderProps['cacheRanges'];
  clipAnimationPhase: RulerHeaderProps['clipAnimationPhase'];
  clipDrag: GlobalOverlayProps['clipDrag'];
  clipTrim: GlobalOverlayProps['clipTrim'];
  duration: GlobalOverlayProps['duration'];
  exportProgress: GlobalOverlayProps['exportProgress'];
  exportRange: GlobalOverlayProps['exportRange'];
  formatTime: GlobalOverlayProps['formatTime'];
  frameRate: RulerHeaderProps['frameRate'];
  getCachedRanges: GlobalOverlayProps['getCachedRanges'];
  getTimelineLineOpacity: MarkerOverlayProps['getTimelineLineOpacity'];
  inLineOpacity: GlobalOverlayProps['inLineOpacity'];
  inOutMarkerContextMenu: GlobalOverlayProps['onMarkerContextMenu'];
  inOutMarkerMouseDown: GlobalOverlayProps['onMarkerMouseDown'];
  inPoint: GlobalOverlayProps['inPoint'];
  isRamPreviewing: GlobalOverlayProps['isRamPreviewing'];
  isTrackHeaderWidthResizing: RulerHeaderProps['isTrackHeaderWidthResizing'];
  markerCreateDrag: MarkerOverlayProps['markerCreateDrag'];
  globalMarkerDrag: GlobalOverlayProps['markerDrag'];
  markers: MarkerOverlayProps['markers'];
  marquee: InteractionOverlayProps['marquee'];
  midiDrawGhost: InteractionOverlayProps['midiDrawGhost'];
  onRulerMouseDown: RulerHeaderProps['onRulerMouseDown'];
  onSplitDividerMouseDown: SplitDividerProps['onMouseDown'];
  onTimelineMarkerContextMenu: MarkerOverlayProps['onMarkerContextMenu'];
  onTimelineMarkerMouseDown: MarkerOverlayProps['onMarkerMouseDown'];
  onTrackFocusStep: SplitDividerProps['onTrackFocusStep'];
  onTrackHeaderWidthResizeStart: RulerHeaderProps['onTrackHeaderWidthResizeStart'];
  onToggleAudioLayerAdvancedMode: SplitDividerProps['onToggleAudioLayerAdvancedMode'];
  outLineOpacity: GlobalOverlayProps['outLineOpacity'];
  outPoint: GlobalOverlayProps['outPoint'];
  playheadInlineStyle: PlayheadOverlayProps['inlineStyle'];
  playheadMouseDown: PlayheadOverlayProps['onMouseDown'];
  playheadPosition: GlobalOverlayProps['playheadPosition'];
  playheadRef: PlayheadOverlayProps['playheadRef'];
  ramPreviewProgress: GlobalOverlayProps['ramPreviewProgress'];
  showPlayhead: PlayheadOverlayProps['show'];
  splitDragVideoHeight: number | null;
  switchMotionClass: GlobalOverlayProps['switchMotionClass'];
  timeToPixel: GlobalOverlayProps['timeToPixel'];
  timelineControlsProps: RulerHeaderProps['timelineControlsProps'];
  timelineMarkerDrag: MarkerOverlayProps['timelineMarkerDrag'];
  timelineRangeSelection: InteractionOverlayProps['timelineRangeSelection'];
  trackFocusMode: SplitDividerProps['trackFocusMode'];
  videoBakeRegionSelection: RulerHeaderProps['videoBakeRegionSelection'];
  videoBakeRegions: RulerHeaderProps['videoBakeRegions'];
}

export function useTimelineBodySurfaceProps({
  activeTimelineToolId,
  audioLayerAdvancedMode,
  aiAnimatedMarkers,
  cacheRanges,
  clipAnimationPhase,
  clipDrag,
  clipDragActive,
  clipTrim,
  duration,
  exportProgress,
  exportRange,
  formatTime,
  frameRate,
  getCachedRanges,
  getTimelineLineOpacity,
  inLineOpacity,
  inOutMarkerContextMenu,
  inOutMarkerMouseDown,
  inPoint,
  isExporting,
  isRamPreviewing,
  isTrackHeaderWidthResizing,
  markerCreateDrag,
  globalMarkerDrag,
  markers,
  marquee,
  marqueeActive,
  midiDrawGhost,
  onContainerDragLeave,
  onPointerCancel,
  onPointerDown,
  onPointerLeave,
  onPointerMove,
  onPointerUp,
  onRulerMouseDown,
  onSplitDividerMouseDown,
  onTimelineMarkerContextMenu,
  onTimelineMarkerMouseDown,
  onToggleAudioLayerAdvancedMode,
  onTrackFocusStep,
  onTrackHeaderWidthResizeStart,
  outLineOpacity,
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
  videoBakeRegionSelection,
  videoBakeRegions,
  zoom,
}: UseTimelineBodySurfacePropsParams): BodySurfaceProps {
  return {
    activeTimelineToolId,
    clipDragActive,
    globalOverlayProps: {
      timeToPixel,
      formatTime,
      scrollX,
      inPoint,
      outPoint,
      duration,
      markerDrag: globalMarkerDrag,
      onMarkerMouseDown: inOutMarkerMouseDown,
      onMarkerContextMenu: inOutMarkerContextMenu,
      switchMotionClass,
      inLineOpacity,
      outLineOpacity,
      clipDrag,
      clipTrim,
      isRamPreviewing,
      ramPreviewProgress,
      playheadPosition,
      isExporting,
      exportProgress,
      exportRange,
      getCachedRanges,
      trackHeaderWidth,
    },
    interactionOverlayProps: {
      marquee,
      midiDrawGhost,
      scrollX,
      timeToPixel,
      timelineRangeSelection,
      trackHeaderWidth,
    },
    isExporting,
    markerOverlayProps: {
      aiAnimatedMarkers,
      formatTime,
      getTimelineLineOpacity,
      markerCreateDrag,
      markers,
      onMarkerContextMenu: onTimelineMarkerContextMenu,
      onMarkerMouseDown: onTimelineMarkerMouseDown,
      scrollX,
      switchMotionClass,
      timeToPixel,
      timelineMarkerDrag,
      trackHeaderWidth,
    },
    marqueeActive,
    onContainerDragLeave,
    onPointerCancel,
    onPointerDown,
    onPointerLeave,
    onPointerMove,
    onPointerUp,
    playheadOverlayProps: {
      inlineStyle: playheadInlineStyle,
      onMouseDown: playheadMouseDown,
      playheadRef,
      show: showPlayhead,
      switchMotionClass,
    },
    renderAudioSection,
    renderVideoSection,
    rulerHeaderProps: {
      cacheRanges,
      clipAnimationPhase,
      duration,
      formatTime,
      frameRate,
      isTrackHeaderWidthResizing,
      onRulerMouseDown,
      onTrackHeaderWidthResizeStart,
      scrollX,
      timelineControlsProps,
      videoBakeRegions,
      videoBakeRegionSelection,
      zoom,
    },
    scrollWrapperRef,
    scrollX,
    slotGridProgress,
    splitDividerProps: {
      audioLayerAdvancedMode,
      isDragging: splitDragVideoHeight !== null,
      onMouseDown: onSplitDividerMouseDown,
      onToggleAudioLayerAdvancedMode,
      onTrackFocusStep,
      trackFocusMode,
    },
    timelineBodyRef,
    timelineRef,
    timelineSurfaceCursor,
    trackHeaderWidth,
    trackLanesRef,
    zoom,
  };
}
