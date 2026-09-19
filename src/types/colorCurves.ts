import type { BezierHandle } from './animationProperties';

export const COLOR_CURVE_CHANNELS = ['y', 'r', 'g', 'b'] as const;
export const COLOR_CURVE_SAMPLE_COUNT = 16;

export type ColorCurveChannel = typeof COLOR_CURVE_CHANNELS[number];

export interface ColorCurvePoint {
  id: string;
  x: number;
  y: number;
  handleIn?: BezierHandle;
  handleOut?: BezierHandle;
}

export interface RuntimeColorCurves {
  y: number[];
  r: number[];
  g: number[];
  b: number[];
}

export function getColorCurveParamKey(channel: ColorCurveChannel): string {
  return `curve${channel.toUpperCase()}`;
}

export function createNeutralColorCurve(channel: ColorCurveChannel): ColorCurvePoint[] {
  return [
    { id: `curve-${channel}-black`, x: 0, y: 0 },
    { id: `curve-${channel}-white`, x: 1, y: 1 },
  ];
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isBezierHandle(value: unknown): value is BezierHandle {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BezierHandle>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

export function parseColorCurvePoints(
  value: unknown,
  channel: ColorCurveChannel,
): ColorCurvePoint[] {
  if (typeof value !== 'string') return createNeutralColorCurve(channel);

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return createNeutralColorCurve(channel);

    const points = parsed.flatMap((entry, index): ColorCurvePoint[] => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Partial<ColorCurvePoint>;
      if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return [];
      return [{
        id: typeof candidate.id === 'string' ? candidate.id : `curve-${channel}-${index}`,
        x: clampUnit(candidate.x as number),
        y: clampUnit(candidate.y as number),
        ...(isBezierHandle(candidate.handleIn) ? { handleIn: candidate.handleIn } : {}),
        ...(isBezierHandle(candidate.handleOut) ? { handleOut: candidate.handleOut } : {}),
      }];
    }).toSorted((left, right) => left.x - right.x);

    return points.length >= 2 ? points : createNeutralColorCurve(channel);
  } catch {
    return createNeutralColorCurve(channel);
  }
}

export function serializeColorCurvePoints(points: ColorCurvePoint[]): string {
  return JSON.stringify(points.toSorted((left, right) => left.x - right.x));
}

function cubic(start: number, controlA: number, controlB: number, end: number, t: number): number {
  const inverse = 1 - t;
  return inverse ** 3 * start
    + 3 * inverse ** 2 * t * controlA
    + 3 * inverse * t ** 2 * controlB
    + t ** 3 * end;
}

function sampleSegment(left: ColorCurvePoint, right: ColorCurvePoint, x: number): number {
  if (x <= left.x) return clampUnit(left.y);
  if (x >= right.x) return clampUnit(right.y);

  const fallbackOut = { x: (right.x - left.x) / 3, y: (right.y - left.y) / 3 };
  const fallbackIn = { x: -(right.x - left.x) / 3, y: -(right.y - left.y) / 3 };
  const out = left.handleOut ?? fallbackOut;
  const incoming = right.handleIn ?? fallbackIn;
  const x1 = clampUnit(left.x + out.x);
  const y1 = clampUnit(left.y + out.y);
  const x2 = clampUnit(right.x + incoming.x);
  const y2 = clampUnit(right.y + incoming.y);

  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (cubic(left.x, x1, x2, right.x, midpoint) < x) low = midpoint;
    else high = midpoint;
  }

  return clampUnit(cubic(left.y, y1, y2, right.y, (low + high) / 2));
}

export function sampleColorCurve(points: ColorCurvePoint[], sampleCount = COLOR_CURVE_SAMPLE_COUNT): number[] {
  const sorted = points.toSorted((left, right) => left.x - right.x);
  if (sorted.length < 2) {
    return Array.from({ length: sampleCount }, (_, index) => index / Math.max(1, sampleCount - 1));
  }

  return Array.from({ length: sampleCount }, (_, index) => {
    const x = index / Math.max(1, sampleCount - 1);
    const rightIndex = sorted.findIndex(point => point.x >= x);
    if (rightIndex <= 0) return clampUnit(sorted[0].y);
    if (rightIndex === -1) return clampUnit(sorted.at(-1)!.y);
    return sampleSegment(sorted[rightIndex - 1], sorted[rightIndex], x);
  });
}

export function getRuntimeColorCurves(params: Record<string, unknown>): RuntimeColorCurves {
  return Object.fromEntries(COLOR_CURVE_CHANNELS.map(channel => {
    const points = parseColorCurvePoints(params[getColorCurveParamKey(channel)], channel);
    return [channel, sampleColorCurve(points)];
  })) as unknown as RuntimeColorCurves;
}

export function areRuntimeColorCurvesNeutral(curves: RuntimeColorCurves): boolean {
  return COLOR_CURVE_CHANNELS.every(channel => curves[channel].every((value, index, samples) => (
    Math.abs(value - index / Math.max(1, samples.length - 1)) < 1e-4
  )));
}
