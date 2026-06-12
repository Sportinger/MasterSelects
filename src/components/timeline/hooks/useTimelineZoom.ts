// useTimelineZoom - Zoom, scroll, and wheel handling for timeline
// Extracted from Timeline.tsx for better maintainability

import { useEffect, useCallback, useRef } from 'react';
import { MIN_ZOOM, MAX_ZOOM } from '../../../stores/timeline/constants';
import { useSettingsStore } from '../../../stores/settingsStore';
import { animateSlotGrid } from '../slotGridAnimation';

const ZOOM_WHEEL_BASE_MULTIPLIER = 1.08;
const ZOOM_WHEEL_REFERENCE_DELTA_PX = 100;
const ZOOM_WHEEL_MIN_STEPS = 0.35;
const ZOOM_WHEEL_MAX_STEPS = 8;
const ZOOM_WHEEL_RAPID_INTERVAL_MS = 90;
const ZOOM_WHEEL_MAX_RAPID_BOOST = 2.25;
const WHEEL_DELTA_MODE_LINE = 1;
const WHEEL_DELTA_MODE_PAGE = 2;
const WHEEL_DELTA_LINE_HEIGHT_PX = 16;
const WHEEL_DELTA_PAGE_HEIGHT_PX = 800;

function normalizeWheelDeltaPx(event: WheelEvent): number {
  if (event.deltaMode === WHEEL_DELTA_MODE_LINE) {
    return event.deltaY * WHEEL_DELTA_LINE_HEIGHT_PX;
  }
  if (event.deltaMode === WHEEL_DELTA_MODE_PAGE) {
    return event.deltaY * WHEEL_DELTA_PAGE_HEIGHT_PX;
  }
  return event.deltaY;
}

export function getTimelineZoomWheelMultiplier(deltaPx: number, elapsedMs: number): number {
  const absDeltaPx = Math.abs(deltaPx);
  if (!Number.isFinite(absDeltaPx) || absDeltaPx === 0) {
    return 1;
  }

  const baseSteps = Math.max(ZOOM_WHEEL_MIN_STEPS, absDeltaPx / ZOOM_WHEEL_REFERENCE_DELTA_PX);
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(1, elapsedMs) : ZOOM_WHEEL_RAPID_INTERVAL_MS;
  const rapidFactor = safeElapsedMs < ZOOM_WHEEL_RAPID_INTERVAL_MS
    ? 1 + ((ZOOM_WHEEL_RAPID_INTERVAL_MS - safeElapsedMs) / ZOOM_WHEEL_RAPID_INTERVAL_MS) * (ZOOM_WHEEL_MAX_RAPID_BOOST - 1)
    : 1;
  const steps = Math.min(ZOOM_WHEEL_MAX_STEPS, baseSteps * rapidFactor);

  return Math.pow(ZOOM_WHEEL_BASE_MULTIPLIER, steps);
}

interface UseTimelineZoomProps {
  // Refs
  timelineBodyRef: React.RefObject<HTMLDivElement | null>;

  // State
  zoom: number;
  scrollX: number;
  scrollY: number;
  duration: number;
  playheadPosition: number;
  contentHeight: number;
  viewportHeight: number;
  trackSnapPositions: number[];

  // Actions
  setZoom: (zoom: number) => void;
  setScrollX: (scrollX: number) => void;
  setScrollY: (scrollY: number) => void;
}

interface UseTimelineZoomReturn {
  handleSetZoom: (newZoom: number) => void;
  handleFitToWindow: () => void;
}

export function useTimelineZoom({
  timelineBodyRef,
  zoom,
  scrollX,
  scrollY,
  duration,
  playheadPosition,
  contentHeight,
  viewportHeight,
  trackSnapPositions,
  setZoom,
  setScrollX,
  setScrollY,
}: UseTimelineZoomProps): UseTimelineZoomReturn {
  const timelineZoomAnchorSetting = useSettingsStore((state) => state.timelineZoomAnchor);
  const timelineZoomAnchor = timelineZoomAnchorSetting === 'mouse' ? 'mouse' : 'playhead';

  // Ref to avoid stale closure for scrollY in wheel handler
  const scrollYRef = useRef(scrollY);
  const lastZoomWheelTimeRef = useRef<number | null>(null);

  useEffect(() => {
    scrollYRef.current = scrollY;
  }, [scrollY]);

  // Fit composition to window - calculate zoom to show entire duration
  const handleFitToWindow = useCallback(() => {
    const trackLanes = timelineBodyRef.current?.querySelector<HTMLElement>('.timeline-lane-reference, .track-lanes');
    const viewportWidth = trackLanes?.clientWidth ?? 800;
    // Calculate zoom: viewportWidth = duration * zoom, so zoom = viewportWidth / duration
    // Subtract some padding (50px) to not be right at the edge
    const targetZoom = Math.max(MIN_ZOOM, (viewportWidth - 50) / duration);
    setZoom(targetZoom);
    setScrollX(0); // Reset scroll to start
  }, [timelineBodyRef, duration, setZoom, setScrollX]);

  // Padding in pixels to show beyond the end of the composition
  const END_PADDING = 100;

  // Calculate dynamic minimum zoom to prevent zooming out too far beyond duration
  const getDynamicMinZoom = useCallback(() => {
    const trackLanes = timelineBodyRef.current?.querySelector<HTMLElement>('.timeline-lane-reference, .track-lanes');
    const viewportWidth = trackLanes?.clientWidth ?? 800;
    // Allow some padding at the end to see the end marker
    // Min zoom ensures duration * zoom >= viewportWidth - END_PADDING
    return Math.max(MIN_ZOOM, (viewportWidth - END_PADDING) / duration);
  }, [timelineBodyRef, duration]);

  // Wrapper for setZoom that enforces dynamic min zoom
  const handleSetZoom = useCallback((newZoom: number) => {
    const dynamicMinZoom = getDynamicMinZoom();
    setZoom(Math.max(dynamicMinZoom, Math.min(MAX_ZOOM, newZoom)));
  }, [setZoom, getDynamicMinZoom]);

  // Clamp zoom and scrollX when duration or viewport changes
  useEffect(() => {
    const trackLanes = timelineBodyRef.current?.querySelector<HTMLElement>('.timeline-lane-reference, .track-lanes');
    const viewportWidth = trackLanes?.clientWidth ?? 800;
    const dynamicMinZoom = Math.max(MIN_ZOOM, (viewportWidth - END_PADDING) / duration);

    // Clamp zoom to dynamic minimum
    if (zoom < dynamicMinZoom) {
      setZoom(dynamicMinZoom);
    }

    // Clamp scrollX to max (allow scrolling up to END_PADDING past duration)
    const maxScrollX = Math.max(0, duration * zoom - viewportWidth + END_PADDING);
    if (scrollX > maxScrollX) {
      setScrollX(maxScrollX);
    }
  }, [timelineBodyRef, zoom, duration, scrollX, setZoom, setScrollX]);

  // Zoom with mouse wheel, also handle vertical scroll
  // Use native event listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = timelineBodyRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      // Coordinates with usePageZoom (src/hooks/usePageZoom.ts): that window-level
      // capture guard blocks the browser's Ctrl+wheel page zoom everywhere, but it
      // deliberately does NOT preventDefault over `.timeline-body` lanes so this
      // handler can run our own Ctrl+wheel zoom. If that exception is ever removed,
      // e.defaultPrevented will be true here and timeline zoom dies silently — and
      // on Linux that leaves no working zoom at all (see the Alt+wheel note below).
      if (e.defaultPrevented) return;

      // Don't zoom when hovering over track headers (first column for height adjustment)
      const target = e.target as HTMLElement;
      const isOverTrackHeaders = target.closest('.track-headers') !== null;
      const isOverSplitTrackSection = target.closest('.timeline-track-section') !== null;

      // Ctrl+Shift+Scroll (Win/Linux) or Cmd+Shift+Scroll (Mac): toggle slot grid view
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        animateSlotGrid(e.deltaY > 0 ? 1 : 0);
        return;
      }

      // Ctrl+wheel and Alt+wheel both zoom horizontally. Ctrl is the primary,
      // reliable binding cross-platform; Alt+wheel is a fallback that is commonly
      // unusable on Linux because GNOME/KDE window managers grab Alt+scroll for
      // window actions, so it never reaches the page. Keep Ctrl working at all
      // costs — it is the only zoom modifier Linux users can count on.
      if ((e.ctrlKey || e.altKey) && !isOverTrackHeaders) {
        e.preventDefault();
        // Get the track lanes container width for accurate centering
        const trackLanes = el.querySelector<HTMLElement>('.timeline-lane-reference, .track-lanes');
        const viewportWidth = trackLanes?.clientWidth ?? el.clientWidth - 210;
        const viewportLeft = trackLanes?.getBoundingClientRect().left ?? el.getBoundingClientRect().left + 210;

        // Calculate dynamic minimum zoom with padding to see end marker
        const dynamicMinZoom = Math.max(MIN_ZOOM, (viewportWidth - END_PADDING) / duration);

        const now = performance.now();
        const elapsedMs = lastZoomWheelTimeRef.current === null
          ? ZOOM_WHEEL_RAPID_INTERVAL_MS
          : now - lastZoomWheelTimeRef.current;
        lastZoomWheelTimeRef.current = now;
        const wheelDeltaPx = normalizeWheelDeltaPx(e);
        const zoomMultiplier = getTimelineZoomWheelMultiplier(wheelDeltaPx, elapsedMs);
        const newZoom = Math.max(dynamicMinZoom, Math.min(MAX_ZOOM,
          wheelDeltaPx > 0 ? zoom / zoomMultiplier : zoom * zoomMultiplier
        ));

        // Calculate max scroll with padding
        const maxScrollX = Math.max(0, duration * newZoom - viewportWidth + END_PADDING);

        let newScrollX: number;
        if (timelineZoomAnchor === 'mouse') {
          const mouseX = Math.max(0, Math.min(viewportWidth, e.clientX - viewportLeft));
          const anchorTime = (scrollX + mouseX) / Math.max(MIN_ZOOM, zoom);
          newScrollX = Math.max(0, Math.min(maxScrollX, anchorTime * newZoom - mouseX));
        } else {
          // Calculate playhead position in pixels with new zoom
          const playheadPixel = playheadPosition * newZoom;

          // Calculate scrollX to center playhead in viewport, clamped to valid range
          newScrollX = Math.max(0, Math.min(maxScrollX, playheadPixel - viewportWidth / 2));
        }

        setZoom(newZoom);
        setScrollX(newScrollX);
      } else if (e.shiftKey && !isOverTrackHeaders) {
        // Shift+scroll = horizontal scroll (use deltaY since mouse wheel is vertical)
        e.preventDefault();
        const trackLanes = el.querySelector<HTMLElement>('.timeline-lane-reference, .track-lanes');
        const viewportWidth = trackLanes?.clientWidth ?? el.clientWidth - 210;
        const maxScrollX = Math.max(0, duration * zoom - viewportWidth + END_PADDING);
        setScrollX(Math.max(0, Math.min(maxScrollX, scrollX + e.deltaY)));
      } else {
        // Handle horizontal scroll (e.g., trackpad horizontal gesture)
        if (e.deltaX !== 0) {
          const trackLanes = el.querySelector<HTMLElement>('.timeline-lane-reference, .track-lanes');
          const viewportWidth = trackLanes?.clientWidth ?? el.clientWidth - 210;
          const maxScrollX = Math.max(0, duration * zoom - viewportWidth + END_PADDING);
          setScrollX(Math.max(0, Math.min(maxScrollX, scrollX + e.deltaX)));
        }
        // Handle vertical scroll — snap to track boundaries (1 track per step)
        if (e.deltaY !== 0 && !e.shiftKey && !e.ctrlKey && !e.altKey && !isOverSplitTrackSection) {
          e.preventDefault();
          const maxScrollY = Math.max(0, contentHeight - viewportHeight);
          const currentY = scrollYRef.current;
          if (trackSnapPositions.length > 1) {
            // Find current snap index
            let currentIdx = 0;
            for (let i = trackSnapPositions.length - 1; i >= 0; i--) {
              if (trackSnapPositions[i] <= currentY + 1) {
                currentIdx = i;
                break;
              }
            }
            const nextIdx = e.deltaY > 0
              ? Math.min(currentIdx + 1, trackSnapPositions.length - 1)
              : Math.max(currentIdx - 1, 0);
            const newY = Math.max(0, Math.min(maxScrollY, trackSnapPositions[nextIdx]));
            scrollYRef.current = newY;
            setScrollY(newY);
          } else {
            setScrollY(Math.max(0, Math.min(maxScrollY, currentY + e.deltaY)));
          }
        }
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [timelineBodyRef, zoom, scrollX, playheadPosition, duration, contentHeight, viewportHeight, trackSnapPositions, timelineZoomAnchor, setZoom, setScrollX, setScrollY]);

  return {
    handleSetZoom,
    handleFitToWindow,
  };
}
