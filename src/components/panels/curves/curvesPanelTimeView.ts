import { MAX_ZOOM, MIN_ZOOM } from '../../../stores/timeline/constants';
import { TIMELINE_END_PADDING_PX } from '../../timeline/utils/timelineHostConstants';

export interface CurveTimeView {
  scrollX: number;
  zoom: number;
}

export const DEFAULT_CURVE_TIME_VIEW: CurveTimeView = { scrollX: 0, zoom: 100 };
const CURVE_WHEEL_ZOOM_SENSITIVITY = 0.0015;
const CURVE_WHEEL_MAX_DELTA_PX = 800;

export function normalizeCurveTimeView(
  view: Partial<CurveTimeView> | null | undefined,
): CurveTimeView {
  return {
    scrollX: Number.isFinite(view?.scrollX)
      ? Math.max(0, view!.scrollX!)
      : DEFAULT_CURVE_TIME_VIEW.scrollX,
    zoom: Number.isFinite(view?.zoom)
      ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view!.zoom!))
      : DEFAULT_CURVE_TIME_VIEW.zoom,
  };
}

interface FitCurveTimeViewInput {
  clipDuration: number;
  clipStartTime: number;
  compositionDuration: number;
  viewportWidth: number;
}

const CURVE_CLIP_FIT_MAX_PADDING_PX = 24;

export function fitCurveTimeViewToClip({
  clipDuration,
  clipStartTime,
  compositionDuration,
  viewportWidth,
}: FitCurveTimeViewInput): CurveTimeView | null {
  if (![clipDuration, clipStartTime, compositionDuration, viewportWidth].every(Number.isFinite)
    || clipDuration <= 0
    || viewportWidth <= 0) {
    return null;
  }

  const padding = Math.min(CURVE_CLIP_FIT_MAX_PADDING_PX, viewportWidth * 0.05);
  const usableWidth = Math.max(1, viewportWidth - padding * 2);
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, usableWidth / clipDuration));
  const maximumScrollX = Math.max(
    0,
    Math.max(compositionDuration, clipStartTime + clipDuration) * zoom
      + TIMELINE_END_PADDING_PX
      - viewportWidth,
  );
  const scrollX = Math.max(
    0,
    Math.min(maximumScrollX, clipStartTime * zoom - padding),
  );

  return { scrollX, zoom };
}

interface ZoomCurveTimeViewAtPointerInput {
  compositionDuration: number;
  deltaY: number;
  pointerX: number;
  view: CurveTimeView;
  viewportWidth: number;
}

interface PanCurveTimeViewHorizontallyInput {
  compositionDuration: number;
  deltaX: number;
  deltaY: number;
  view: CurveTimeView;
  viewportWidth: number;
}

export function panCurveTimeViewHorizontally({
  compositionDuration,
  deltaX,
  deltaY,
  view,
  viewportWidth,
}: PanCurveTimeViewHorizontallyInput): CurveTimeView {
  const current = normalizeCurveTimeView(view);
  if (viewportWidth <= 0) return current;

  const wheelDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  if (!Number.isFinite(wheelDelta) || wheelDelta === 0) return current;
  const maximumScrollX = Math.max(
    0,
    Math.max(0.001, compositionDuration) * current.zoom
      + TIMELINE_END_PADDING_PX
      - viewportWidth,
  );

  return {
    ...current,
    scrollX: Math.max(0, Math.min(maximumScrollX, current.scrollX + wheelDelta)),
  };
}

export function zoomCurveTimeViewAtPointer({
  compositionDuration,
  deltaY,
  pointerX,
  view,
  viewportWidth,
}: ZoomCurveTimeViewAtPointerInput): CurveTimeView {
  const current = normalizeCurveTimeView(view);
  if (!Number.isFinite(deltaY) || deltaY === 0 || viewportWidth <= 0) return current;

  const clampedDelta = Math.max(-CURVE_WHEEL_MAX_DELTA_PX, Math.min(CURVE_WHEEL_MAX_DELTA_PX, deltaY));
  const nextZoom = Math.max(
    MIN_ZOOM,
    Math.min(MAX_ZOOM, current.zoom * Math.exp(-clampedDelta * CURVE_WHEEL_ZOOM_SENSITIVITY)),
  );
  const clampedPointerX = Math.max(0, Math.min(viewportWidth, pointerX));
  const pointerTime = (current.scrollX + clampedPointerX) / current.zoom;
  const maximumScrollX = Math.max(
    0,
    Math.max(0.001, compositionDuration) * nextZoom
      + TIMELINE_END_PADDING_PX
      - viewportWidth,
  );
  const nextScrollX = Math.max(
    0,
    Math.min(maximumScrollX, pointerTime * nextZoom - clampedPointerX),
  );

  return { scrollX: nextScrollX, zoom: nextZoom };
}
