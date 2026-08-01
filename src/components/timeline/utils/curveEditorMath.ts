import {
  parseCameraProperty,
  parseMaskProperty,
  type AnimatableProperty,
  type EasingType,
} from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import { PRESET_BEZIER } from '../../../utils/keyframeInterpolation';
import {
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
} from '../../../types/vectorAnimation';

export interface CurveValueRange {
  min: number;
  max: number;
}

export interface CurveValueRangeOptions {
  fallback: CurveValueRange & { fallbackPad: number };
  bounds?: {
    min?: number;
    max?: number;
  };
  paddingRatio?: number;
}

export function getPropertyDefaults(property: AnimatableProperty): { min: number; max: number; fallbackPad: number } {
  const maskProperty = parseMaskProperty(property);
  if (maskProperty?.property === 'path') {
    return { min: 0, max: 1, fallbackPad: 0.05 };
  }
  if (maskProperty?.property === 'position.x' || maskProperty?.property === 'position.y') {
    return { min: -1, max: 1, fallbackPad: 0.05 };
  }
  if (maskProperty?.property === 'feather' || maskProperty?.property === 'edgeFeather') {
    return { min: 0, max: 500, fallbackPad: 5 };
  }
  if (maskProperty?.property === 'featherQuality') {
    return { min: 1, max: 100, fallbackPad: 5 };
  }
  const cameraProperty = parseCameraProperty(property);
  if (cameraProperty === 'fov') {
    return { min: 10, max: 140, fallbackPad: 2 };
  }
  if (cameraProperty === 'near') {
    return { min: 0.001, max: 10, fallbackPad: 0.1 };
  }
  if (cameraProperty === 'far') {
    return { min: 1, max: 1000, fallbackPad: 10 };
  }
  if (parseVectorAnimationStateProperty(property)) {
    return { min: 0, max: 1, fallbackPad: 0 };
  }
  if (property === 'opacity' || property.includes('.volume')) {
    return { min: 0, max: 1, fallbackPad: 0.05 };
  }
  if (property.startsWith('scale.')) {
    return { min: 0, max: 2, fallbackPad: 0.05 };
  }
  if (property.startsWith('rotation.')) {
    return { min: -360, max: 360, fallbackPad: 5 };
  }
  if (property.startsWith('position.')) {
    return { min: -1000, max: 1000, fallbackPad: 10 };
  }
  if (parseVectorAnimationInputProperty(property)) {
    return { min: 0, max: 1, fallbackPad: 0.05 };
  }
  return { min: -100, max: 100, fallbackPad: 5 };
}

export function niceStep(range: number, targetLines: number = 5): number {
  if (range <= 0) return 1;
  const roughStep = range / targetLines;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;

  let nice: number;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;

  return nice * magnitude;
}

export function computeCurveValueRange(
  values: readonly number[],
  options: CurveValueRangeOptions,
): CurveValueRange {
  const finiteValues = values.filter(Number.isFinite);
  const boundedMin = Number.isFinite(options.bounds?.min)
    ? options.bounds?.min
    : undefined;
  const boundedMax = Number.isFinite(options.bounds?.max)
    ? options.bounds?.max
    : undefined;

  if (boundedMin !== undefined && boundedMax !== undefined && boundedMax > boundedMin) {
    return { min: boundedMin, max: boundedMax };
  }

  if (finiteValues.length === 0) {
    const fallbackMin = boundedMin ?? options.fallback.min;
    const fallbackMax = boundedMax ?? options.fallback.max;
    if (fallbackMax > fallbackMin) return { min: fallbackMin, max: fallbackMax };
    return { min: fallbackMin - 1, max: fallbackMin + 1 };
  }

  let min = Math.min(...finiteValues);
  let max = Math.max(...finiteValues);
  const range = max - min;
  if (range > 0) {
    const pad = range * (options.paddingRatio ?? 0.1);
    min -= pad;
    max += pad;
  } else {
    const pad = Math.max(Math.abs(min) * 0.1, options.fallback.fallbackPad) || 1;
    min -= pad;
    max += pad;
  }

  if (boundedMin !== undefined) min = Math.max(boundedMin, min);
  if (boundedMax !== undefined) max = Math.min(boundedMax, max);
  if (max <= min) {
    const pad = options.fallback.fallbackPad || 1;
    if (boundedMin !== undefined) return { min: boundedMin, max: boundedMin + pad };
    if (boundedMax !== undefined) return { min: boundedMax - pad, max: boundedMax };
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

export function curveValueToY(
  value: number,
  range: CurveValueRange,
  height: number,
  padding: { top: number; bottom: number },
): number {
  const drawableHeight = Math.max(1, height - padding.top - padding.bottom);
  const span = Math.max(Number.EPSILON, range.max - range.min);
  const normalized = (value - range.min) / span;
  return height - padding.bottom - normalized * drawableHeight;
}

export function curveYToValue(
  y: number,
  range: CurveValueRange,
  height: number,
  padding: { top: number; bottom: number },
): number {
  const drawableHeight = Math.max(1, height - padding.top - padding.bottom);
  const normalized = (height - padding.bottom - y) / drawableHeight;
  return range.min + normalized * (range.max - range.min);
}

export function formatCurveAuthoringValue(
  value: number,
  unit?: string,
  step?: number,
): string {
  if (unit === '%') return `${(value * 100).toFixed(0)}%`;
  const precision = step !== undefined && step > 0
    ? Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))))
    : Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  const formatted = value.toFixed(precision);
  if (unit === 'deg' || unit === 'degree' || unit === 'degrees') return `${formatted}°`;
  return unit ? `${formatted} ${unit}` : formatted;
}

export function generateBezierPath(
  prevKf: Keyframe,
  nextKf: Keyframe,
  timeToX: (time: number) => number,
  valueToY: (value: number) => number,
): string {
  const x1 = timeToX(prevKf.time);
  const y1 = valueToY(prevKf.value);
  const x2 = timeToX(nextKf.time);
  const y2 = valueToY(nextKf.value);

  const timeDelta = nextKf.time - prevKf.time;
  const valueDelta = nextKf.value - prevKf.value;

  let cp1x: number, cp1y: number, cp2x: number, cp2y: number;

  if (prevKf.easing === 'bezier' || prevKf.handleOut || nextKf.handleIn) {
    const handleOut = prevKf.handleOut || { x: timeDelta / 3, y: valueDelta / 3 };
    const handleIn = nextKf.handleIn || { x: -timeDelta / 3, y: -valueDelta / 3 };

    cp1x = timeToX(prevKf.time + handleOut.x);
    cp1y = valueToY(prevKf.value + handleOut.y);
    cp2x = timeToX(nextKf.time + handleIn.x);
    cp2y = valueToY(nextKf.value + handleIn.y);
  } else {
    const preset = PRESET_BEZIER[prevKf.easing as Exclude<EasingType, 'bezier'>] || PRESET_BEZIER.linear;

    cp1x = x1 + (x2 - x1) * preset.p1[0];
    cp1y = y1 + (y2 - y1) * preset.p1[1];
    cp2x = x1 + (x2 - x1) * preset.p2[0];
    cp2y = y1 + (y2 - y1) * preset.p2[1];
  }

  return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
}

export function generateStepPath(
  prevKf: Keyframe,
  nextKf: Keyframe,
  timeToX: (time: number) => number,
  valueToY: (value: number) => number,
): string {
  const x1 = timeToX(prevKf.time);
  const y1 = valueToY(prevKf.value);
  const x2 = timeToX(nextKf.time);
  const y2 = valueToY(nextKf.value);
  return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
}
