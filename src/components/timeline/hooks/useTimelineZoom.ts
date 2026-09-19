// useTimelineZoom - Zoom, scroll, and wheel handling for timeline
// Extracted from Timeline.tsx for better maintainability

import { useEffect, useCallback, useRef } from 'react';
import { MIN_ZOOM, MAX_ZOOM } from '../../../stores/timeline/constants';
import { useSettingsStore } from '../../../stores/settingsStore';
import { TIMELINE_END_PADDING_PX } from '../utils/timelineHostConstants';
import {
  calculateTimelinePinchScrollX,
  calculateTimelineZoomScrollX,
} from '../utils/timelineZoomAnchor';
import { isExclusiveTimelineMutationLeaseActive } from '../../../stores/timeline/exclusiveMutationLease';
import { isEditableValueTouchSessionActive } from '../../../services/input/editableValueTouchSession';
import { useTimelineStore } from '../../../stores/timeline';
import type { TrackSectionKind } from '../utils/timelineHostTypes';
import { useAltWheelBrowserFocusGuard } from '../../../hooks/useAltWheelBrowserFocusGuard';

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
const PINCH_CANCEL_MARKER = '__masterSelectsTimelinePinchCancel';
const TOUCH_GESTURE_THRESHOLD_PX = 8;
const TRACK_HEIGHT_TOUCH_SCALE = 0.35;
const ZOOM_CLAMP_EPSILON = 0.000001;

type PinchPointer = {
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  sectionKind: TrackSectionKind | null;
  panEligible: boolean;
  trackScaleEligible: boolean;
};

function getPinchDistance(first: PinchPointer, second: PinchPointer): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function getPinchMidpointX(first: PinchPointer, second: PinchPointer): number {
  return (first.clientX + second.clientX) / 2;
}

function getTouchSectionKind(target: EventTarget | null): TrackSectionKind | null {
  if (!(target instanceof Element)) return null;
  const sectionKind = target.closest<HTMLElement>('.timeline-track-section')?.dataset.sectionKind;
  return sectionKind === 'video' || sectionKind === 'audio' ? sectionKind : null;
}

function isTouchPanEligibleTarget(
  target: EventTarget | null,
  clientX: number,
  scrollX: number,
  zoom: number,
): boolean {
  if (!(target instanceof Element) || getTouchSectionKind(target) === null) return false;
  if (target.closest([
    'button',
    'input',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '.draggable-number',
    '.track-resize-handle',
    '[data-clip-interaction-slot]',
    '[data-shell-trim-edge]',
    '[data-shell-fade-edge]',
  ].join(', '))) return false;

  const trackLane = target.closest<HTMLElement>('.track-lane[data-track-id]');
  if (!trackLane) return true;
  if (target.closest('[data-clip-id]')) return false;

  const laneViewport = target.closest<HTMLElement>('.timeline-section-tracks');
  if (!laneViewport) return true;
  const timelineX = clientX - laneViewport.getBoundingClientRect().left + scrollX;
  const trackId = trackLane.dataset.trackId;
  return !useTimelineStore.getState().clips.some(clip => (
    clip.trackId === trackId
    && timelineX >= clip.startTime * zoom
    && timelineX <= (clip.startTime + clip.duration) * zoom
  ));
}

type TwoTouchGestureMode = 'pending' | 'time-zoom';

function classifyTwoTouchGesture(
  first: PinchPointer,
  second: PinchPointer,
): TwoTouchGestureMode {
  const firstHorizontalMovement = Math.abs(first.clientX - first.startX);
  const secondHorizontalMovement = Math.abs(second.clientX - second.startX);
  const horizontalMovement = Math.max(firstHorizontalMovement, secondHorizontalMovement);

  const startDistance = Math.hypot(second.startX - first.startX, second.startY - first.startY);
  const distanceChange = Math.abs(getPinchDistance(first, second) - startDistance);
  if (horizontalMovement >= TOUCH_GESTURE_THRESHOLD_PX || distanceChange >= TOUCH_GESTURE_THRESHOLD_PX) {
    return 'time-zoom';
  }
  return 'pending';
}

function dispatchSectionTouchPan(
  timelineBody: HTMLElement,
  sectionKind: TrackSectionKind,
  deltaY: number,
): void {
  const viewport = timelineBody.querySelector<HTMLElement>(
    `.timeline-track-section[data-section-kind="${sectionKind}"] .timeline-section-viewport`,
  );
  viewport?.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY,
    deltaMode: 0,
  }));
}

function normalizeWheelDeltaPx(event: WheelEvent): number {
  if (event.deltaMode === WHEEL_DELTA_MODE_LINE) {
    return event.deltaY * WHEEL_DELTA_LINE_HEIGHT_PX;
  }
  if (event.deltaMode === WHEEL_DELTA_MODE_PAGE) {
    return event.deltaY * WHEEL_DELTA_PAGE_HEIGHT_PX;
  }
  return event.deltaY;
}

function getVisibleTimelineLaneWidth(timelineBody: HTMLElement | null): number {
  const trackLanes = timelineBody?.querySelector<HTMLElement>('.timeline-lane-reference, .track-lanes');
  const measuredWidth = trackLanes?.clientWidth ?? 800;
  if (!trackLanes) return measuredWidth;

  const ownerWindow = trackLanes.ownerDocument.defaultView;
  const viewportWidth = ownerWindow?.innerWidth;
  if (!viewportWidth || !Number.isFinite(viewportWidth)) return measuredWidth;

  const viewportLeft = Math.max(0, trackLanes.getBoundingClientRect().left);
  const visibleWidth = Math.max(1, viewportWidth - viewportLeft);
  return Math.max(1, Math.min(measuredWidth, visibleWidth));
}

function getDynamicTimelineMinZoom(viewportWidth: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return MIN_ZOOM;
  return Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, (viewportWidth - TIMELINE_END_PADDING_PX) / duration),
  );
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
  onShowSlotGrid?: () => void;
  onSynchronousTrackScaleStart?: (sectionKind: TrackSectionKind) => void;
  onSynchronousTrackScaleEnd?: () => void;
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
  onShowSlotGrid,
  onSynchronousTrackScaleStart,
  onSynchronousTrackScaleEnd,
}: UseTimelineZoomProps): UseTimelineZoomReturn {
  const timelineZoomAnchorSetting = useSettingsStore((state) => state.timelineZoomAnchor);
  const timelineZoomAnchor = timelineZoomAnchorSetting === 'mouse' ? 'mouse' : 'playhead';

  // Ref to avoid stale closure for scrollY in wheel handler
  const scrollYRef = useRef(scrollY);
  const zoomRef = useRef(zoom);
  const scrollXRef = useRef(scrollX);
  const lastZoomWheelTimeRef = useRef<number | null>(null);
  const markAltWheelGesture = useAltWheelBrowserFocusGuard(timelineBodyRef);

  useEffect(() => {
    scrollYRef.current = scrollY;
    zoomRef.current = zoom;
    scrollXRef.current = scrollX;
  }, [scrollX, scrollY, zoom]);

  // Fit composition to window - calculate zoom to show entire duration
  const handleFitToWindow = useCallback(() => {
    if (isExclusiveTimelineMutationLeaseActive()) return;
    const viewportWidth = getVisibleTimelineLaneWidth(timelineBodyRef.current);
    // Calculate zoom: viewportWidth = duration * zoom, so zoom = viewportWidth / duration
    // Subtract some padding (50px) to not be right at the edge
    const targetZoom = Math.max(MIN_ZOOM, (viewportWidth - 50) / duration);
    setZoom(targetZoom);
    setScrollX(0); // Reset scroll to start
  }, [timelineBodyRef, duration, setZoom, setScrollX]);

  // Calculate dynamic minimum zoom to prevent zooming out too far beyond duration
  const getDynamicMinZoom = useCallback(() => {
    const viewportWidth = getVisibleTimelineLaneWidth(timelineBodyRef.current);
    return getDynamicTimelineMinZoom(viewportWidth, duration);
  }, [timelineBodyRef, duration]);

  // Wrapper for setZoom that enforces dynamic min zoom
  const handleSetZoom = useCallback((newZoom: number) => {
    if (isExclusiveTimelineMutationLeaseActive()) return;
    const dynamicMinZoom = getDynamicMinZoom();
    setZoom(Math.max(dynamicMinZoom, Math.min(MAX_ZOOM, newZoom)));
  }, [setZoom, getDynamicMinZoom]);

  // Clamp zoom and scrollX when duration or viewport changes
  useEffect(() => {
    let retryTimer: number | null = null;
    let cancelled = false;
    const applyClamp = () => {
      if (cancelled) return;
      if (isExclusiveTimelineMutationLeaseActive()) {
        retryTimer = window.setTimeout(applyClamp, 50);
        return;
      }

      const viewportWidth = getVisibleTimelineLaneWidth(timelineBodyRef.current);
      const dynamicMinZoom = getDynamicTimelineMinZoom(viewportWidth, duration);

      if (!Number.isFinite(zoom) || zoom + ZOOM_CLAMP_EPSILON < dynamicMinZoom) {
        setZoom(dynamicMinZoom);
      }

      const maxScrollX = Math.max(
        0,
        duration * zoom - viewportWidth + TIMELINE_END_PADDING_PX,
      );
      if (scrollX > maxScrollX) {
        setScrollX(maxScrollX);
      }
    };

    applyClamp();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [timelineBodyRef, zoom, duration, scrollX, setZoom, setScrollX]);

  // Native capture listeners arbitrate two-finger pinch before clip/trim
  // handlers see the second touch. The first touch remains a normal editor
  // gesture unless and until a second touch joins it.
  useEffect(() => {
    const el = timelineBodyRef.current;
    if (!el) return;

    const pointers = new Map<number, PinchPointer>();
    let suppressPointerStream = false;
    let singlePanPointerId: number | null = null;
    let singleTrackScalePointerId: number | null = null;
    let lastSingleTrackScaleDisplacement = 0;
    let pinch: {
      pointerIds: [number, number];
      startDistance: number;
      startMidpointX: number;
      startZoom: number;
      startScrollX: number;
      viewportLeft: number;
      viewportWidth: number;
      mode: TwoTouchGestureMode;
    } | null = null;

    const stopPinchEvent = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const cancelFirstTouchInteraction = (pointerId: number) => {
      const cancelEvent = typeof PointerEvent === 'function'
        ? new PointerEvent('pointercancel', { bubbles: true, pointerId, pointerType: 'touch' })
        : new MouseEvent('pointercancel', { bubbles: true });
      Object.defineProperty(cancelEvent, 'pointerId', { value: pointerId });
      Object.defineProperty(cancelEvent, PINCH_CANCEL_MARKER, { value: true });
      document.dispatchEvent(cancelEvent);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.pointerType !== 'touch'
        || isExclusiveTimelineMutationLeaseActive()
        || isEditableValueTouchSessionActive()
        || (event.target instanceof Element && event.target.closest('.draggable-number') !== null)
        // A finger that lands on a track's resize handle means "resize THIS
        // track", not "scale the section" — the handle is a deliberate target,
        // and it owns the pointer. Without this the capture-phase listener below
        // would arm the section gesture too and both would run at once.
        || (event.target instanceof Element && event.target.closest('.track-resize-handle') !== null)
      ) return;
      const sectionKind = getTouchSectionKind(event.target);
      const panEligible = isTouchPanEligibleTarget(
        event.target,
        event.clientX,
        scrollXRef.current,
        zoomRef.current,
      );
      pointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        sectionKind,
        panEligible,
        trackScaleEligible: panEligible
          && event.target instanceof Element
          && event.target.closest('.track-headers') !== null,
      });
      if (pointers.size !== 2) {
        if (suppressPointerStream) stopPinchEvent(event);
        return;
      }

      if (singleTrackScalePointerId !== null) {
        singleTrackScalePointerId = null;
        lastSingleTrackScaleDisplacement = 0;
        onSynchronousTrackScaleEnd?.();
      }

      const entries = [...pointers.entries()];
      const [[firstId, first], [secondId, second]] = entries;
      first.startX = first.clientX;
      first.startY = first.clientY;
      first.lastX = first.clientX;
      first.lastY = first.clientY;
      second.startX = second.clientX;
      second.startY = second.clientY;
      second.lastX = second.clientX;
      second.lastY = second.clientY;
      const trackLanes = el.querySelector<HTMLElement>('.timeline-lane-reference, .track-lanes');
      const viewportWidth = getVisibleTimelineLaneWidth(el);
      const viewportLeft = trackLanes?.getBoundingClientRect().left ?? el.getBoundingClientRect().left + 210;
      pinch = {
        pointerIds: [firstId, secondId],
        startDistance: Math.max(1, getPinchDistance(first, second)),
        startMidpointX: getPinchMidpointX(first, second) - viewportLeft,
        startZoom: zoomRef.current,
        startScrollX: scrollXRef.current,
        viewportLeft,
        viewportWidth,
        mode: 'pending',
      };
      singlePanPointerId = null;
      singleTrackScalePointerId = null;
      lastSingleTrackScaleDisplacement = 0;
      suppressPointerStream = true;
      cancelFirstTouchInteraction(firstId);
      stopPinchEvent(event);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      const pointer = pointers.get(event.pointerId);
      if (!pointer) return;
      pointer.clientX = event.clientX;
      pointer.clientY = event.clientY;

      if (!pinch) {
        if (
          suppressPointerStream
          && singlePanPointerId === null
          && singleTrackScalePointerId === null
        ) {
          stopPinchEvent(event);
          return;
        }
        if (singlePanPointerId === null && singleTrackScalePointerId === null) {
          const totalDeltaX = pointer.clientX - pointer.startX;
          const totalDeltaY = pointer.clientY - pointer.startY;
          if (pointer.trackScaleEligible && pointer.sectionKind !== null) {
            const isVerticalTrackScale = Math.abs(totalDeltaY) >= TOUCH_GESTURE_THRESHOLD_PX
              && Math.abs(totalDeltaY) > Math.abs(totalDeltaX) * 1.15;
            if (!isVerticalTrackScale) return;
            singleTrackScalePointerId = event.pointerId;
            lastSingleTrackScaleDisplacement = 0;
            suppressPointerStream = true;
            cancelFirstTouchInteraction(event.pointerId);
            onSynchronousTrackScaleStart?.(pointer.sectionKind);
            useTimelineStore.getState().scaleTracksOfType(pointer.sectionKind, 0);
          } else {
            if (!pointer.panEligible) return;
            if (Math.hypot(totalDeltaX, totalDeltaY) < TOUCH_GESTURE_THRESHOLD_PX) return;
            singlePanPointerId = event.pointerId;
            suppressPointerStream = true;
            cancelFirstTouchInteraction(event.pointerId);
          }
        }
        if (singleTrackScalePointerId === event.pointerId && pointer.sectionKind !== null) {
          const displacement = pointer.startY - pointer.clientY;
          const delta = (
            displacement - lastSingleTrackScaleDisplacement
          ) * TRACK_HEIGHT_TOUCH_SCALE;
          lastSingleTrackScaleDisplacement = displacement;
          if (delta !== 0) {
            useTimelineStore.getState().scaleTracksOfType(pointer.sectionKind, delta);
          }
          pointer.lastX = pointer.clientX;
          pointer.lastY = pointer.clientY;
          stopPinchEvent(event);
          return;
        }
        if (singlePanPointerId !== event.pointerId) return;

        const deltaX = pointer.clientX - pointer.lastX;
        const deltaY = pointer.clientY - pointer.lastY;
        const viewportWidth = getVisibleTimelineLaneWidth(el);
        const maxScrollX = Math.max(
          0,
          duration * zoomRef.current - viewportWidth + TIMELINE_END_PADDING_PX,
        );
        const nextScrollX = Math.max(0, Math.min(maxScrollX, scrollXRef.current - deltaX));
        scrollXRef.current = nextScrollX;
        setScrollX(nextScrollX);
        if (pointer.sectionKind !== null && deltaY !== 0) {
          dispatchSectionTouchPan(el, pointer.sectionKind, -deltaY);
        }
        pointer.lastX = pointer.clientX;
        pointer.lastY = pointer.clientY;
        stopPinchEvent(event);
        return;
      }
      const [first, second] = pinch.pointerIds.map(pointerId => pointers.get(pointerId));
      if (!first || !second) return;

      if (pinch.mode === 'pending') {
        pinch.mode = classifyTwoTouchGesture(first, second);
        if (pinch.mode === 'pending') {
          stopPinchEvent(event);
          return;
        }
      }

      const nextZoom = Math.max(
        Math.max(MIN_ZOOM, (pinch.viewportWidth - TIMELINE_END_PADDING_PX) / Math.max(0.001, duration)),
        Math.min(MAX_ZOOM, pinch.startZoom * getPinchDistance(first, second) / pinch.startDistance),
      );
      const maxScrollX = Math.max(
        0,
        duration * nextZoom - pinch.viewportWidth + TIMELINE_END_PADDING_PX,
      );
      const nextScrollX = calculateTimelinePinchScrollX({
        startScrollX: pinch.startScrollX,
        startZoom: pinch.startZoom,
        nextZoom,
        startPointerX: pinch.startMidpointX,
        nextPointerX: getPinchMidpointX(first, second) - pinch.viewportLeft,
        viewportWidth: pinch.viewportWidth,
        maxScrollX,
      });
      zoomRef.current = nextZoom;
      scrollXRef.current = nextScrollX;
      setZoom(nextZoom);
      setScrollX(nextScrollX);
      stopPinchEvent(event);
    };

    const handlePointerFinish = (event: PointerEvent) => {
      if ((event as PointerEvent & Record<string, unknown>)[PINCH_CANCEL_MARKER]) return;
      if (!pointers.has(event.pointerId)) return;
      if (suppressPointerStream) stopPinchEvent(event);
      pointers.delete(event.pointerId);
      if (singlePanPointerId === event.pointerId) singlePanPointerId = null;
      if (singleTrackScalePointerId === event.pointerId) {
        singleTrackScalePointerId = null;
        lastSingleTrackScaleDisplacement = 0;
        onSynchronousTrackScaleEnd?.();
      }
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) suppressPointerStream = false;
    };

    el.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handlePointerFinish, { capture: true, passive: false });
    window.addEventListener('pointercancel', handlePointerFinish, { capture: true, passive: false });
    return () => {
      if (singleTrackScalePointerId !== null) onSynchronousTrackScaleEnd?.();
      el.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerFinish, true);
      window.removeEventListener('pointercancel', handlePointerFinish, true);
    };
  }, [duration, onSynchronousTrackScaleEnd, onSynchronousTrackScaleStart, setScrollX, setZoom, timelineBodyRef]);

  // Zoom with mouse wheel, also handle vertical scroll
  // Use native event listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = timelineBodyRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.altKey) markAltWheelGesture();
      if (isExclusiveTimelineMutationLeaseActive()) return;
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

      // Ctrl+Shift+Scroll down (Win/Linux) or Cmd+Shift+Scroll down (Mac): show Slot Grid.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        if (e.deltaY > 0) onShowSlotGrid?.();
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
        const viewportWidth = getVisibleTimelineLaneWidth(el);
        const viewportLeft = trackLanes?.getBoundingClientRect().left ?? el.getBoundingClientRect().left + 210;

        // Calculate dynamic minimum zoom with padding to see end marker
        const dynamicMinZoom = getDynamicTimelineMinZoom(viewportWidth, duration);

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
        const maxScrollX = Math.max(
          0,
          duration * newZoom - viewportWidth + TIMELINE_END_PADDING_PX,
        );

        let newScrollX: number;
        if (timelineZoomAnchor === 'mouse') {
          const mouseX = Math.max(0, Math.min(viewportWidth, e.clientX - viewportLeft));
          newScrollX = calculateTimelineZoomScrollX({
            scrollX,
            zoom,
            nextZoom: newZoom,
            pointerX: mouseX,
            viewportWidth,
            maxScrollX,
          });
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
        const viewportWidth = getVisibleTimelineLaneWidth(el);
        const maxScrollX = Math.max(
          0,
          duration * zoom - viewportWidth + TIMELINE_END_PADDING_PX,
        );
        setScrollX(Math.max(0, Math.min(maxScrollX, scrollX + e.deltaY)));
      } else {
        // Handle horizontal scroll (e.g., trackpad horizontal gesture)
        if (e.deltaX !== 0) {
          const viewportWidth = getVisibleTimelineLaneWidth(el);
          const maxScrollX = Math.max(
            0,
            duration * zoom - viewportWidth + TIMELINE_END_PADDING_PX,
          );
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
  }, [timelineBodyRef, zoom, scrollX, playheadPosition, duration, contentHeight, viewportHeight, trackSnapPositions, timelineZoomAnchor, setZoom, setScrollX, setScrollY, onShowSlotGrid, markAltWheelGesture]);

  return {
    handleSetZoom,
    handleFitToWindow,
  };
}
