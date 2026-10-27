import type { ColorCurvePoint } from '../../../types/colorCurves';

/** Screen <-> curve mapping derived from where the CurveEditor actually drew the points. */
export interface CurveTouchMapping {
  toCurve(clientX: number, clientY: number): { x: number; y: number };
  toScreen(point: Pick<ColorCurvePoint, 'x' | 'y'>): { x: number; y: number };
}

/** CurveEditor's vertical padding (top and bottom) in CSS pixels. */
const FLAT_GRAPH_PADDING = 20;

/** Finger radius in CSS pixels: a point counts as touched within this distance. */
export const CURVE_TOUCH_RADIUS = 28;

/**
 * Builds the mapping from the drawn point centres (any order) and the curve points. The editor draws
 * points in x order, x from 0 to 1 across its width and y linearly; two points with different x and
 * two with different y fix the mapping. A flat curve (every point at one value) takes its y scale from
 * `flatGraph`: the graph's top and height with the editor's 20 px vertical padding (value 1 at the
 * top padding, 0 at the bottom one). Returns null when the drawing does not match the points.
 */
export function createCurveTouchMapping(
  points: readonly ColorCurvePoint[],
  centres: readonly { x: number; y: number }[],
  flatGraph?: { top: number; height: number },
): CurveTouchMapping | null {
  if (points.length < 2 || centres.length !== points.length) return null;
  const sortedPoints = points.toSorted((left, right) => left.x - right.x);
  const sortedCentres = centres.toSorted((left, right) => left.x - right.x);
  const first = 0;
  const last = sortedPoints.length - 1;
  const xSpan = sortedPoints[last].x - sortedPoints[first].x;
  if (xSpan < 1e-6) return null;
  const xScale = (sortedCentres[last].x - sortedCentres[first].x) / xSpan;
  const xOrigin = sortedCentres[first].x - sortedPoints[first].x * xScale;
  let low = first;
  let high = first;
  sortedPoints.forEach((point, index) => {
    if (point.y < sortedPoints[low].y) low = index;
    if (point.y > sortedPoints[high].y) high = index;
  });
  const ySpan = sortedPoints[high].y - sortedPoints[low].y;
  if (Math.abs(xScale) < 1e-6) return null;
  let yScale: number;
  let yOrigin: number;
  if (ySpan >= 1e-6) {
    yScale = (sortedCentres[high].y - sortedCentres[low].y) / ySpan;
    yOrigin = sortedCentres[low].y - sortedPoints[low].y * yScale;
  } else if (flatGraph && flatGraph.height > FLAT_GRAPH_PADDING * 2) {
    yScale = -(flatGraph.height - FLAT_GRAPH_PADDING * 2);
    yOrigin = flatGraph.top + flatGraph.height - FLAT_GRAPH_PADDING;
  } else {
    return null;
  }
  if (Math.abs(yScale) < 1e-6) return null;
  return {
    toCurve: (clientX, clientY) => ({ x: (clientX - xOrigin) / xScale, y: (clientY - yOrigin) / yScale }),
    toScreen: point => ({ x: xOrigin + point.x * xScale, y: yOrigin + point.y * yScale }),
  };
}

/** The id of the curve point nearest to the finger within CURVE_TOUCH_RADIUS, or null. */
export function findTouchedCurvePoint(
  points: readonly ColorCurvePoint[],
  mapping: CurveTouchMapping,
  clientX: number,
  clientY: number,
  radius = CURVE_TOUCH_RADIUS,
): string | null {
  let best: string | null = null;
  let bestDistance = radius;
  for (const point of points) {
    const screen = mapping.toScreen(point);
    const distance = Math.hypot(screen.x - clientX, screen.y - clientY);
    if (distance <= bestDistance) {
      best = point.id;
      bestDistance = distance;
    }
  }
  return best;
}
