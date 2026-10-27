// Pure gesture math of the Curves panel's touch input (phone and tablet). The panel's hook
// (useCurvesTouchGestures) feeds pointer positions in and applies the results; nothing here
// touches the DOM, so the decisions are unit-testable.

export interface CurveTouchPoint {
  x: number;
  y: number;
}

export interface CurveTouchCandidate<T> {
  item: T;
  x: number;
  y: number;
  /** Bezier handles win a near tie: they sit on top of the curve next to their keyframe. */
  isHandle: boolean;
}

/** A finger is wider than a 10 px dot: anything within this radius counts as touched. */
export const CURVE_TOUCH_HIT_RADIUS_PX = 24;
/** Fingers closer than this on one axis do not express a zoom on that axis. */
export const CURVE_PINCH_MIN_AXIS_SPAN_PX = 36;
/** Same step the desktop uses for one Shift+wheel notch of the curve height. */
export const CURVE_VERTICAL_ZOOM_STEP = 1.15;

/** The nearest keyframe or handle within `radius` of the finger, or null. */
export function pickCurveTouchTarget<T>(
  candidates: readonly CurveTouchCandidate<T>[],
  point: CurveTouchPoint,
  radius = CURVE_TOUCH_HIT_RADIUS_PX,
): CurveTouchCandidate<T> | null {
  let best: CurveTouchCandidate<T> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance > radius) continue;
    const score = candidate.isHandle ? distance * 0.8 : distance;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export interface CurvePinchFrame {
  /** Horizontal zoom factor relative to the gesture start (1 when the fingers are stacked vertically). */
  factorX: number;
  /** Vertical zoom factor relative to the gesture start (1 when the fingers are side by side). */
  factorY: number;
  /** Midpoint now, in the coordinates the points were given in. */
  mid: CurveTouchPoint;
  /** Midpoint movement since the start. */
  panX: number;
  panY: number;
}

function axisFactor(start: number, current: number): number {
  if (start < CURVE_PINCH_MIN_AXIS_SPAN_PX) return 1;
  return Math.max(CURVE_PINCH_MIN_AXIS_SPAN_PX, current) / start;
}

/** Zoom per axis and pan of a two-finger gesture. */
export function measureCurvePinch(
  start: readonly [CurveTouchPoint, CurveTouchPoint],
  current: readonly [CurveTouchPoint, CurveTouchPoint],
): CurvePinchFrame {
  const startMid = { x: (start[0].x + start[1].x) / 2, y: (start[0].y + start[1].y) / 2 };
  const mid = { x: (current[0].x + current[1].x) / 2, y: (current[0].y + current[1].y) / 2 };
  return {
    factorX: axisFactor(Math.abs(start[0].x - start[1].x), Math.abs(current[0].x - current[1].x)),
    factorY: axisFactor(Math.abs(start[0].y - start[1].y), Math.abs(current[0].y - current[1].y)),
    mid,
    panX: mid.x - startMid.x,
    panY: mid.y - startMid.y,
  };
}

/**
 * The desktop scales the curve height in Shift+wheel notches; a pinch reaches the same zoom by
 * sending as many notches as its vertical factor spans. Positive = zoom in.
 */
export function verticalZoomNotches(factorY: number): number {
  if (!Number.isFinite(factorY) || factorY <= 0) return 0;
  return Math.round(Math.log(factorY) / Math.log(CURVE_VERTICAL_ZOOM_STEP));
}
