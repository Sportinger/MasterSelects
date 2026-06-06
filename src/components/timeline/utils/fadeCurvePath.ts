import { normalizeEasingType } from '../../../utils/easing';

export interface FadeCurveKeyframe {
  id?: string;
  time: number;
  value: number;
  easing: string;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
}

export interface FadeCurvePoint {
  x: number;
  y: number;
}

export interface FadeCurvePath {
  curvePath: string;
  fillPath: string;
  points: FadeCurvePoint[];
}

export interface FadeCurveSegment {
  cp1: FadeCurvePoint;
  cp2: FadeCurvePoint;
  end: FadeCurvePoint;
}

export interface FadeCurveGeometry {
  startPoint: FadeCurvePoint;
  segments: FadeCurveSegment[];
  points: FadeCurvePoint[];
}

export function buildFadeCurveGeometry({
  keyframes,
  clipDuration,
  width,
  height,
}: {
  keyframes: readonly FadeCurveKeyframe[];
  clipDuration: number;
  width: number;
  height: number;
}): FadeCurveGeometry | null {
  if (keyframes.length < 2 || width <= 0 || height <= 0 || clipDuration <= 0) {
    return null;
  }

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const timeToX = (time: number) => (time / clipDuration) * width;
  const valueToY = (value: number) => height - value * height;
  const segments: FadeCurveSegment[] = [];
  const points: FadeCurvePoint[] = [];

  const firstKeyframe = sorted[0];
  const firstPoint = {
    x: timeToX(firstKeyframe.time),
    y: valueToY(firstKeyframe.value),
  };
  points.push(firstPoint);

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];

    const x1 = timeToX(current.time);
    const y1 = valueToY(current.value);
    const x2 = timeToX(next.time);
    const y2 = valueToY(next.value);
    const duration = next.time - current.time;

    let cp1x: number;
    let cp1y: number;
    let cp2x: number;
    let cp2y: number;
    const easing = normalizeEasingType(current.easing, 'linear');

    if (easing === 'bezier' && current.handleOut && next.handleIn) {
      cp1x = timeToX(current.time + current.handleOut.x);
      cp1y = valueToY(current.value + current.handleOut.y);
      cp2x = timeToX(next.time + next.handleIn.x);
      cp2y = valueToY(next.value + next.handleIn.y);
    } else {
      switch (easing) {
        case 'ease-in':
          cp1x = x1 + duration * 0.42 * (width / clipDuration);
          cp1y = y1;
          cp2x = x2;
          cp2y = y2;
          break;
        case 'ease-out':
          cp1x = x1;
          cp1y = y1;
          cp2x = x1 + duration * 0.58 * (width / clipDuration);
          cp2y = y2;
          break;
        case 'ease-in-out':
          cp1x = x1 + duration * 0.42 * (width / clipDuration);
          cp1y = y1;
          cp2x = x1 + duration * 0.58 * (width / clipDuration);
          cp2y = y2;
          break;
        case 'linear':
        default:
          cp1x = x1 + (x2 - x1) / 3;
          cp1y = y1 + (y2 - y1) / 3;
          cp2x = x1 + (x2 - x1) * 2 / 3;
          cp2y = y1 + (y2 - y1) * 2 / 3;
          break;
      }
    }

    const end = { x: x2, y: y2 };
    segments.push({
      cp1: { x: cp1x, y: cp1y },
      cp2: { x: cp2x, y: cp2y },
      end,
    });
    points.push(end);
  }

  return { startPoint: firstPoint, segments, points };
}

export function buildFadeCurvePath({
  keyframes,
  clipDuration,
  width,
  height,
}: {
  keyframes: readonly FadeCurveKeyframe[];
  clipDuration: number;
  width: number;
  height: number;
}): FadeCurvePath | null {
  const geometry = buildFadeCurveGeometry({ keyframes, clipDuration, width, height });
  if (!geometry) return null;

  const pathSegments = [
    `M ${geometry.startPoint.x} ${geometry.startPoint.y}`,
    ...geometry.segments.map((segment) => (
      `C ${segment.cp1.x} ${segment.cp1.y}, ${segment.cp2.x} ${segment.cp2.y}, ${segment.end.x} ${segment.end.y}`
    )),
  ];
  const curvePath = pathSegments.join(' ');
  const lastPoint = geometry.points[geometry.points.length - 1];
  const fillPath = `${curvePath} L ${lastPoint.x} ${height} L ${geometry.startPoint.x} ${height} Z`;

  return { curvePath, fillPath, points: geometry.points };
}
