import type { ComponentProps } from 'react';

import { MAX_ZOOM, MIN_ZOOM } from '../../../stores/timeline/constants';
import { TimelineNavigatorChrome } from '../components/TimelineNavigatorChrome';
import { TimelineRootShell } from '../components/TimelineRootShell';
import { useTimelineSourceMonitorDismiss } from './useTimelineSourceMonitorDismiss';

type RootShellProps = ComponentProps<typeof TimelineRootShell>;
type NavigatorChromeProps = ComponentProps<typeof TimelineNavigatorChrome>;

interface UseTimelineRootChromeControllerParams extends Omit<RootShellProps, 'children' | 'onMouseDownCapture'> {
  duration: NavigatorChromeProps['duration'];
  onScrollChange: NavigatorChromeProps['onScrollChange'];
  onToggleSlotGrid: () => void;
  onZoomChange: NavigatorChromeProps['onZoomChange'];
  scrollX: NavigatorChromeProps['scrollX'];
  timelineBodyRef: NavigatorChromeProps['timelineBodyRef'];
  zoom: NavigatorChromeProps['zoom'];
}

export function useTimelineRootChromeController({
  activeTrackResizeId,
  audioDisplayMode,
  audioFocusMode,
  clipInteractionActive,
  duration,
  effectiveAudioLayerAdvancedMode,
  isHeaderWidthResizing,
  onScrollChange,
  onToggleSlotGrid,
  onZoomChange,
  openCompositionCount,
  scrollX,
  splitDragSmoothing,
  splitDragVideoHeight,
  timelineBodyRef,
  trackFocusMode,
  trackHeaderWidth,
  trackScaleGestureActive,
  zoom,
}: UseTimelineRootChromeControllerParams) {
  const handleTimelineSourceMonitorDismiss = useTimelineSourceMonitorDismiss();

  const rootShellProps: Omit<RootShellProps, 'children'> = {
    activeTrackResizeId,
    audioDisplayMode,
    audioFocusMode,
    clipInteractionActive,
    effectiveAudioLayerAdvancedMode,
    isHeaderWidthResizing,
    onMouseDownCapture: handleTimelineSourceMonitorDismiss,
    openCompositionCount,
    splitDragSmoothing,
    splitDragVideoHeight,
    trackFocusMode,
    trackHeaderWidth,
    trackScaleGestureActive,
  };

  const navigatorChromeProps: NavigatorChromeProps = {
    duration,
    scrollX,
    zoom,
    timelineBodyRef,
    slotGridProgress: 0,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    onScrollChange,
    onZoomChange,
  };

  return {
    handleToggleSlotGrid: onToggleSlotGrid,
    navigatorChromeProps,
    rootShellProps,
  };
}
