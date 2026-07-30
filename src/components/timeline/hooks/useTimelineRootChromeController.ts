import { useCallback, type ComponentProps } from 'react';

import { MAX_ZOOM, MIN_ZOOM } from '../../../stores/timeline/constants';
import { TimelineNavigatorChrome } from '../components/TimelineNavigatorChrome';
import { TimelineRootShell } from '../components/TimelineRootShell';
import { TimelineSlotGridChrome } from '../components/TimelineSlotGridChrome';
import { animateSlotGrid } from '../slotGridAnimation';
import { useTimelineSourceMonitorDismiss } from './useTimelineSourceMonitorDismiss';

type RootShellProps = ComponentProps<typeof TimelineRootShell>;
type SlotGridChromeProps = ComponentProps<typeof TimelineSlotGridChrome>;
type NavigatorChromeProps = ComponentProps<typeof TimelineNavigatorChrome>;

interface UseTimelineRootChromeControllerParams extends Omit<RootShellProps, 'children' | 'onMouseDownCapture'> {
  duration: NavigatorChromeProps['duration'];
  onScrollChange: NavigatorChromeProps['onScrollChange'];
  onZoomChange: NavigatorChromeProps['onZoomChange'];
  scrollX: NavigatorChromeProps['scrollX'];
  slotGridProgress: SlotGridChromeProps['slotGridProgress'];
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
  onZoomChange,
  openCompositionCount,
  scrollX,
  slotGridProgress,
  splitDragSmoothing,
  splitDragVideoHeight,
  timelineBodyRef,
  trackFocusMode,
  trackHeaderWidth,
  zoom,
}: UseTimelineRootChromeControllerParams) {
  const handleTimelineSourceMonitorDismiss = useTimelineSourceMonitorDismiss();
  const handleToggleSlotGrid = useCallback(() => {
    animateSlotGrid(slotGridProgress < 0.5 ? 1 : 0);
  }, [slotGridProgress]);

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
  };

  const slotGridChromeProps: SlotGridChromeProps = {
    onToggleSlotGrid: handleToggleSlotGrid,
    slotGridProgress,
  };

  const navigatorChromeProps: NavigatorChromeProps = {
    duration,
    scrollX,
    zoom,
    timelineBodyRef,
    slotGridProgress,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    onScrollChange,
    onZoomChange,
  };

  return {
    handleToggleSlotGrid,
    navigatorChromeProps,
    rootShellProps,
    slotGridChromeProps,
  };
}
