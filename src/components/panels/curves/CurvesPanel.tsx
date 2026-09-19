import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useMediaStore } from '../../../stores/mediaStore';
import { useDockStore } from '../../../stores/dockStore';
import { useTimelineStore } from '../../../stores/timeline';
import { MAX_ZOOM, MIN_ZOOM } from '../../../stores/timeline/constants';
import type { ClipTrimState } from '../../timeline/types';
import { TimelineNavigator } from '../../timeline/TimelineNavigator';
import {
  TimelineGlobalCurveSurface,
  type TimelineGraphTarget,
} from '../../timeline/TimelineGlobalCurveSurface';
import {
  fitCurveTimeViewToClip,
  normalizeCurveTimeView,
  panCurveTimeViewHorizontally,
  zoomCurveTimeViewAtPointer,
  type CurveTimeView,
} from './curvesPanelTimeView';
import { useAltWheelBrowserFocusGuard } from '../../../hooks/useAltWheelBrowserFocusGuard';
import './CurvesPanel.css';

const DOCK_CURVES_FALLBACK_WIDTH = 640;
const DOCK_CURVES_FALLBACK_HEIGHT = 320;
const DOCK_CURVES_MIN_SIDEBAR_WIDTH = 120;
const DOCK_CURVES_MAX_SIDEBAR_WIDTH = 180;
const TIMELINE_NAVIGATOR_HEIGHT = 16;
const CURVE_VIEW_PERSIST_DELAY_MS = 120;

interface CurvesPanelSize {
  height: number;
  width: number;
}

interface TimelineCurvesPanelProps {
  variant: 'timeline';
  clipTrim?: ClipTrimState | null;
  height: number;
  onActiveSeriesChange?: (target: TimelineGraphTarget) => void;
  onClose?: () => void;
  onScrollChange: (scrollX: number) => void;
  onZoomChange: (zoom: number) => void;
  pixelToTime: (pixel: number) => number;
  preferredTarget?: TimelineGraphTarget | null;
  scrollX: number;
  timeToPixel: (time: number) => number;
  trackHeaderWidth: number;
  width: number;
}

interface DockCurvesPanelProps {
  variant?: 'dock';
  initialPreferredTarget?: TimelineGraphTarget | null;
  initialTimeView?: CurveTimeView;
  initialViewedClipId?: string | null;
  panelId?: string;
}

export type CurvesPanelProps = TimelineCurvesPanelProps | DockCurvesPanelProps;

function useCurvesPanelSize(): {
  hostRef: RefObject<HTMLDivElement | null>;
  size: CurvesPanelSize;
} {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CurvesPanelSize>({
    height: DOCK_CURVES_FALLBACK_HEIGHT,
    width: DOCK_CURVES_FALLBACK_WIDTH,
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const updateSize = (width = host.clientWidth, height = host.clientHeight) => {
      if (width <= 0 || height <= 0) return;
      setSize(current => (
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height }
      ));
    };

    updateSize();
    if (typeof ResizeObserver === 'undefined') {
      const handleWindowResize = () => updateSize();
      window.addEventListener('resize', handleWindowResize);
      return () => window.removeEventListener('resize', handleWindowResize);
    }

    const observer = new ResizeObserver((entries) => {
      const bounds = entries[0]?.contentRect;
      updateSize(bounds?.width, bounds?.height);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return { hostRef, size };
}

function getDockSidebarWidth(panelWidth: number): number {
  return Math.min(
    DOCK_CURVES_MAX_SIDEBAR_WIDTH,
    Math.max(DOCK_CURVES_MIN_SIDEBAR_WIDTH, panelWidth * 0.28),
  );
}

function DockCurvesPlayhead({
  graphWidth,
  scrollX,
  timeToPixel,
  trackHeaderWidth,
}: {
  graphWidth: number;
  scrollX: number;
  timeToPixel: (time: number) => number;
  trackHeaderWidth: number;
}) {
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const graphX = timeToPixel(playheadPosition) - scrollX;
  if (!Number.isFinite(graphX) || graphX < 0 || graphX > graphWidth) return null;

  return (
    <span
      className="curves-panel-playhead"
      data-testid="curves-panel-playhead"
      data-time={playheadPosition}
      style={{ left: trackHeaderWidth + graphX }}
      aria-label="Curves playhead"
    />
  );
}

/**
 * The single motion-curves surface used both as a dock panel and as the
 * Timeline's embedded Graph mode. Timeline placement only changes sizing and
 * chrome; selection, graphing, and editing always use the same store-backed UI.
 */
export function CurvesPanel(props: CurvesPanelProps) {
  const dockProps = props.variant === 'timeline' ? null : props;
  const activeComposition = useMediaStore(state => state.getActiveComposition() ?? null);
  const updatePanelData = useDockStore(state => state.updatePanelData);
  const {
    applyTimelineEditOperation,
    clipDragPreview,
    clipKeyframes,
    clips,
    duration,
    propertiesSelection,
    selectKeyframe,
    selectedClipIds,
    selectedKeyframeIds,
  } = useTimelineStore(useShallow(state => ({
    applyTimelineEditOperation: state.applyTimelineEditOperation,
    clipDragPreview: state.clipDragPreview,
    clipKeyframes: state.clipKeyframes,
    clips: state.clips,
    duration: state.duration,
    propertiesSelection: state.propertiesSelection,
    selectKeyframe: state.selectKeyframe,
    selectedClipIds: state.selectedClipIds,
    selectedKeyframeIds: state.selectedKeyframeIds,
  })));
  const [dockPreferredTarget, setDockPreferredTarget] = useState<TimelineGraphTarget | null>(
    () => dockProps?.initialPreferredTarget ?? null,
  );
  const [dockTimeView, setDockTimeView] = useState<CurveTimeView>(
    () => normalizeCurveTimeView(dockProps?.initialTimeView),
  );
  const dockTimeViewRef = useRef(dockTimeView);
  const viewedClipIdRef = useRef<string | null>(dockProps?.initialViewedClipId ?? null);
  const { hostRef, size: dockSize } = useCurvesPanelSize();
  const markDockAltWheelGesture = useAltWheelBrowserFocusGuard(hostRef);

  const timelineProps = props.variant === 'timeline' ? props : null;

  const panelWidth = timelineProps?.width ?? dockSize.width;
  const trackHeaderWidth = timelineProps?.trackHeaderWidth ?? getDockSidebarWidth(panelWidth);
  const graphWidth = timelineProps?.width ?? Math.max(1, panelWidth - trackHeaderWidth);
  const graphHeight = timelineProps?.height
    ?? Math.max(1, dockSize.height - TIMELINE_NAVIGATOR_HEIGHT);
  const preferredTarget = timelineProps
    ? timelineProps.preferredTarget ?? null
    : dockPreferredTarget;
  const primaryClipId = propertiesSelection?.kind === 'clip'
    ? propertiesSelection.clipId
    : null;
  const selectedClip = useMemo(() => {
    if (primaryClipId && selectedClipIds.has(primaryClipId)) {
      const primaryClip = clips.find(clip => clip.id === primaryClipId);
      if (primaryClip) return primaryClip;
    }
    return clips.find(clip => selectedClipIds.has(clip.id)) ?? null;
  }, [clips, primaryClipId, selectedClipIds]);

  const dockTimeToPixel = useCallback(
    (time: number) => time * dockTimeView.zoom,
    [dockTimeView.zoom],
  );
  const dockPixelToTime = useCallback(
    (pixel: number) => pixel / Math.max(dockTimeView.zoom, 0.001),
    [dockTimeView.zoom],
  );
  const resolvedTimeToPixel = timelineProps?.timeToPixel ?? dockTimeToPixel;
  const resolvedPixelToTime = timelineProps?.pixelToTime ?? dockPixelToTime;
  const resolvedScrollX = timelineProps?.scrollX ?? dockTimeView.scrollX;
  const handleDockScrollChange = useCallback((scrollX: number) => {
    setDockTimeView(current => ({ ...current, scrollX: Math.max(0, scrollX) }));
  }, []);
  const handleDockZoomChange = useCallback((zoom: number) => {
    setDockTimeView(current => ({
      ...current,
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)),
    }));
  }, []);
  const handleCurveGraphWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if ((!event.altKey && !event.shiftKey)
      || (event.deltaX === 0 && event.deltaY === 0)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey) markDockAltWheelGesture();

    const currentView = timelineProps
      ? {
          scrollX: timelineProps.scrollX,
          zoom: Math.max(
            MIN_ZOOM,
            timelineProps.timeToPixel(1) - timelineProps.timeToPixel(0),
          ),
        }
      : dockTimeViewRef.current;
    const nextView = event.altKey
      ? zoomCurveTimeViewAtPointer({
          compositionDuration: duration,
          deltaY: event.deltaY || event.deltaX,
          pointerX: event.clientX
            - event.currentTarget.getBoundingClientRect().left
            - trackHeaderWidth,
          view: currentView,
          viewportWidth: graphWidth,
        })
      : panCurveTimeViewHorizontally({
          compositionDuration: duration,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          view: currentView,
          viewportWidth: graphWidth,
        });

    if (timelineProps) {
      if (event.altKey) timelineProps.onZoomChange(nextView.zoom);
      timelineProps.onScrollChange(nextView.scrollX);
      return;
    }
    setDockTimeView(nextView);
  }, [duration, graphWidth, markDockAltWheelGesture, timelineProps, trackHeaderWidth]);
  const handleFitSeries = useCallback((timeBounds: { startTime: number; endTime: number }) => {
    const fittedView = fitCurveTimeViewToClip({
      clipStartTime: timeBounds.startTime,
      clipDuration: timeBounds.endTime - timeBounds.startTime,
      compositionDuration: duration,
      viewportWidth: graphWidth,
    });
    if (!fittedView) return;
    if (timelineProps) {
      timelineProps.onZoomChange(fittedView.zoom);
      timelineProps.onScrollChange(fittedView.scrollX);
      return;
    }
    setDockTimeView(fittedView);
  }, [duration, graphWidth, timelineProps]);
  const handleActiveSeriesChange = useCallback((target: TimelineGraphTarget) => {
    if (timelineProps?.onActiveSeriesChange) {
      timelineProps.onActiveSeriesChange(target);
      return;
    }
    setDockPreferredTarget(target);
    if (dockProps?.panelId) {
      updatePanelData(dockProps.panelId, { curvePreferredTarget: target });
    }
  }, [dockProps?.panelId, timelineProps, updatePanelData]);

  const selectedClipId = selectedClip?.id ?? null;
  const selectedClipStartTime = selectedClip?.startTime ?? 0;
  const selectedClipDuration = selectedClip?.duration ?? 0;
  const timelineScrollChange = timelineProps?.onScrollChange;
  const timelineZoomChange = timelineProps?.onZoomChange;
  useEffect(() => {
    if (!selectedClipId) return;
    if (!timelineScrollChange && !timelineZoomChange
      && viewedClipIdRef.current === selectedClipId) return;
    const fittedView = fitCurveTimeViewToClip({
      clipDuration: selectedClipDuration,
      clipStartTime: selectedClipStartTime,
      compositionDuration: duration,
      viewportWidth: graphWidth,
    });
    if (!fittedView) return;

    if (timelineScrollChange && timelineZoomChange) {
      timelineZoomChange(fittedView.zoom);
      timelineScrollChange(fittedView.scrollX);
      return;
    }
    viewedClipIdRef.current = selectedClipId;
    setDockTimeView(fittedView);
  }, [
    duration,
    graphWidth,
    selectedClipDuration,
    selectedClipId,
    selectedClipStartTime,
    timelineScrollChange,
    timelineZoomChange,
  ]);

  dockTimeViewRef.current = dockTimeView;
  const dockPanelId = dockProps?.panelId;
  useEffect(() => {
    if (!dockPanelId) return undefined;
    const timerId = window.setTimeout(() => {
      updatePanelData(dockPanelId, {
        curveTimeView: dockTimeView,
        curveViewedClipId: viewedClipIdRef.current,
      });
    }, CURVE_VIEW_PERSIST_DELAY_MS);
    return () => window.clearTimeout(timerId);
  }, [dockPanelId, dockTimeView, updatePanelData]);

  useEffect(() => () => {
    if (!dockPanelId) return;
    updatePanelData(dockPanelId, {
      curveTimeView: dockTimeViewRef.current,
      curveViewedClipId: viewedClipIdRef.current,
    });
  }, [dockPanelId, updatePanelData]);

  const surface = (
    <TimelineGlobalCurveSurface
      activeComposition={activeComposition}
      applyTimelineEditOperation={applyTimelineEditOperation}
      clipDragPreview={clipDragPreview}
      clipKeyframes={clipKeyframes}
      clipTrim={timelineProps?.clipTrim}
      clips={clips}
      height={graphHeight}
      onActiveSeriesChange={handleActiveSeriesChange}
      onClose={timelineProps?.onClose}
      onFitSeries={handleFitSeries}
      onGraphWheel={handleCurveGraphWheel}
      onSelectKeyframe={selectKeyframe}
      pixelToTime={resolvedPixelToTime}
      preferredTarget={preferredTarget}
      primaryClipId={primaryClipId}
      scrollX={resolvedScrollX}
      selectedClipIds={selectedClipIds}
      selectedKeyframeIds={selectedKeyframeIds}
      timeToPixel={resolvedTimeToPixel}
      trackHeaderWidth={trackHeaderWidth}
      width={graphWidth}
    />
  );

  if (timelineProps) return surface;

  return (
    <section
      ref={hostRef}
      className="curves-panel"
      aria-label="Curves"
      data-testid="curves-panel"
      style={{ '--track-header-width': `${trackHeaderWidth}px` } as CSSProperties}
    >
      {surface}
      <DockCurvesPlayhead
        graphWidth={graphWidth}
        scrollX={dockTimeView.scrollX}
        timeToPixel={dockTimeToPixel}
        trackHeaderWidth={trackHeaderWidth}
      />
      <TimelineNavigator
        duration={Math.max(duration, 0.001)}
        scrollX={dockTimeView.scrollX}
        zoom={dockTimeView.zoom}
        viewportWidth={graphWidth}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onScrollChange={handleDockScrollChange}
        onZoomChange={handleDockZoomChange}
      />
    </section>
  );
}
