import type { BezierHandle } from '../types';

/**
 * Motion-design easing presets, authored as cubic-bezier curves.
 *
 * A preset is materialized into the existing per-segment bezier handles
 * (easing 'bezier' + handleOut/handleIn), so every keyframe consumer — preview,
 * export, worker render and the graph editor — renders it without new
 * interpolation code. Y values outside 0..1 overshoot (back easing).
 */
export type CubicBezierPoints = readonly [x1: number, y1: number, x2: number, y2: number];

export const KEYFRAME_EASING_PRESETS = {
  'sine-out': { label: 'Sine Out', points: [0.61, 1, 0.88, 1] },
  'sine-in-out': { label: 'Sine In-Out', points: [0.37, 0, 0.63, 1] },
  'cubic-in': { label: 'Cubic In', points: [0.32, 0, 0.67, 0] },
  'cubic-out': { label: 'Cubic Out', points: [0.33, 1, 0.68, 1] },
  'cubic-in-out': { label: 'Cubic In-Out', points: [0.65, 0, 0.35, 1] },
  'expo-out': { label: 'Expo Out', points: [0.16, 1, 0.3, 1] },
  'expo-in': { label: 'Expo In', points: [0.7, 0, 0.84, 0] },
  'expo-in-out': { label: 'Expo In-Out', points: [0.87, 0, 0.13, 1] },
  'back-out': { label: 'Back Out', points: [0.34, 1.56, 0.64, 1] },
  'back-in': { label: 'Back In', points: [0.36, 0, 0.66, -0.56] },
} as const satisfies Record<string, { label: string; points: CubicBezierPoints }>;

export type KeyframeEasingPresetId = keyof typeof KEYFRAME_EASING_PRESETS;

export const KEYFRAME_EASING_PRESET_IDS = Object.keys(KEYFRAME_EASING_PRESETS) as KeyframeEasingPresetId[];

const CUBIC_BEZIER_PATTERN = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/i;

/** Resolves a preset id (any case, `_`/space tolerant) or a CSS `cubic-bezier(x1, y1, x2, y2)` string. */
export function resolveEasingCurve(value: string): CubicBezierPoints | null {
  const trimmed = value.trim();
  const match = CUBIC_BEZIER_PATTERN.exec(trimmed);
  if (match) {
    const points = match.slice(1, 5).map(Number);
    if (points.some(point => !Number.isFinite(point))) return null;
    const [x1, y1, x2, y2] = points as [number, number, number, number];
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1 || Math.abs(y1) > 10 || Math.abs(y2) > 10) return null;
    return [x1, y1, x2, y2];
  }
  const id = trimmed.toLowerCase().replace(/[\s_]+/g, '-') as KeyframeEasingPresetId;
  return Object.hasOwn(KEYFRAME_EASING_PRESETS, id) ? KEYFRAME_EASING_PRESETS[id].points : null;
}

/** Handles for one segment: handleOut belongs to the earlier key, handleIn to the later key. */
export function segmentHandlesForCurve(
  points: CubicBezierPoints,
  from: { time: number; value: number },
  to: { time: number; value: number },
): { handleOut: BezierHandle; handleIn: BezierHandle } {
  const duration = Math.max(0, to.time - from.time);
  const delta = to.value - from.value;
  const [x1, y1, x2, y2] = points;
  return {
    handleOut: { x: x1 * duration, y: y1 * delta },
    handleIn: { x: (x2 - 1) * duration, y: (y2 - 1) * delta },
  };
}
