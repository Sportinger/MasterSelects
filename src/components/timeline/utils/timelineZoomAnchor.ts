const TIMELINE_ZOOM_EDGE_ANCHOR_PX = 48;
const MIN_SAFE_ZOOM = 1e-6;

interface TimelineZoomAnchorInput {
  scrollX: number;
  zoom: number;
  nextZoom: number;
  pointerX: number;
  viewportWidth: number;
  maxScrollX: number;
}

interface TimelinePinchAnchorInput {
  startScrollX: number;
  startZoom: number;
  nextZoom: number;
  startPointerX: number;
  nextPointerX: number;
  viewportWidth: number;
  maxScrollX: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Keeps the cursor time fixed in the viewport, except while zooming in near
 * either edge. The edge zones preserve the corresponding visible time
 * boundary so the nearby beginning or end is not pushed offscreen merely
 * because the pointer cannot sit on the exact viewport edge.
 */
export function calculateTimelineZoomScrollX({
  scrollX,
  zoom,
  nextZoom,
  pointerX,
  viewportWidth,
  maxScrollX,
}: TimelineZoomAnchorInput): number {
  const safeViewportWidth = Math.max(0, viewportWidth);
  const safeZoom = Math.max(MIN_SAFE_ZOOM, zoom);
  const safeNextZoom = Math.max(MIN_SAFE_ZOOM, nextZoom);
  const safeMaxScrollX = Math.max(0, maxScrollX);
  const clampedPointerX = clamp(pointerX, 0, safeViewportWidth);

  if (safeNextZoom > safeZoom) {
    const edgeAnchorWidth = Math.min(TIMELINE_ZOOM_EDGE_ANCHOR_PX, safeViewportWidth / 4);
    if (clampedPointerX <= edgeAnchorWidth) {
      const leftBoundaryTime = Math.max(0, scrollX) / safeZoom;
      return clamp(leftBoundaryTime * safeNextZoom, 0, safeMaxScrollX);
    }

    if (clampedPointerX >= safeViewportWidth - edgeAnchorWidth) {
      const rightBoundaryTime = (Math.max(0, scrollX) + safeViewportWidth) / safeZoom;
      return clamp(
        rightBoundaryTime * safeNextZoom - safeViewportWidth,
        0,
        safeMaxScrollX,
      );
    }
  }

  const anchorTime = (Math.max(0, scrollX) + clampedPointerX) / safeZoom;
  return clamp(anchorTime * safeNextZoom - clampedPointerX, 0, safeMaxScrollX);
}

/** Keeps the time below the initial pinch midpoint attached to the moving midpoint. */
export function calculateTimelinePinchScrollX({
  startScrollX,
  startZoom,
  nextZoom,
  startPointerX,
  nextPointerX,
  viewportWidth,
  maxScrollX,
}: TimelinePinchAnchorInput): number {
  const safeViewportWidth = Math.max(0, viewportWidth);
  const anchorTime = (
    Math.max(0, startScrollX) + clamp(startPointerX, 0, safeViewportWidth)
  ) / Math.max(MIN_SAFE_ZOOM, startZoom);
  return clamp(
    anchorTime * Math.max(MIN_SAFE_ZOOM, nextZoom) - clamp(nextPointerX, 0, safeViewportWidth),
    0,
    Math.max(0, maxScrollX),
  );
}
