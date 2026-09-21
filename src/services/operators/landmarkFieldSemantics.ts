import type { LandmarkPoint } from '../landmarkTracking/types';

export const LANDMARK_FIELD_MAX_POINTS = 64;
export const LANDMARK_FIELD_STORAGE_FLOATS = 4 + LANDMARK_FIELD_MAX_POINTS * 4;

export interface TrackingLandmarkSourceDescriptor {
  readonly kind: 'tracking-landmarks';
  readonly operator: 'source.tracking-landmarks';
  readonly policy: 'pose-first-face';
}

/** Header order shared by the portable descriptor and GPU storage buffer. */
export type TrackingLandmarkMetadata = readonly [
  fullCount: number,
  centerX: number,
  centerY: number,
  spread: number,
];

export interface TrackingLandmarkStorage {
  readonly header: TrackingLandmarkMetadata;
  readonly points: readonly LandmarkPoint[];
}

const f = Math.fround;
const add = (a: number, b: number) => f(f(a) + f(b));
const subtract = (a: number, b: number) => f(f(a) - f(b));
const multiply = (a: number, b: number) => f(f(a) * f(b));
const divide = (a: number, b: number) => f(f(a) / f(b));

function finiteF32(value: number): boolean {
  return Number.isFinite(value) && Number.isFinite(f(value));
}

function smoothstepF32(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, divide(subtract(value, edge0), subtract(edge1, edge0))));
  return multiply(multiply(t, t), subtract(3, multiply(2, t)));
}

/** Pure f32 reference for the legacy tracking shader's bounded landmarkField. */
export function evaluateLandmarkField(options: {
  readonly points: readonly Pick<LandmarkPoint, 'x' | 'y'>[];
  readonly uv: readonly [number, number];
  readonly radius: number;
  readonly resolution: readonly [number, number];
}): number {
  const [uvX, uvY] = options.uv;
  const [width, height] = options.resolution;
  if (!Array.isArray(options.points) || !finiteF32(uvX) || !finiteF32(uvY)
    || !finiteF32(width) || !finiteF32(height) || width <= 0 || height <= 0
    || !finiteF32(options.radius) || options.radius <= 0) return 0;

  const count = Math.min(LANDMARK_FIELD_MAX_POINTS, options.points.length);
  const aspect = divide(width, Math.max(1, f(height)));
  const radius = f(options.radius);
  const innerRadius = multiply(radius, .3);
  let field = f(0);
  for (let index = 0; index < count; index += 1) {
    const point = options.points[index];
    if (!point || !finiteF32(point.x) || !finiteF32(point.y)) return 0;
    const deltaX = multiply(subtract(uvX, point.x), aspect);
    const deltaY = multiply(subtract(uvY, point.y), 1);
    const distance = f(Math.sqrt(add(multiply(deltaX, deltaX), multiply(deltaY, deltaY))));
    if (!Number.isFinite(distance)) return 0;
    field = Math.max(field, subtract(1, smoothstepF32(innerRadius, radius, distance)));
  }
  return f(field);
}

/** Packs the existing vec4 header followed by 64 vec4 landmark records. */
export function packTrackingLandmarkStorage(storage: TrackingLandmarkStorage): Float32Array {
  if (!Array.isArray(storage.header) || storage.header.length !== 4
    || storage.header.some(value => !finiteF32(value))
    || !Number.isSafeInteger(storage.header[0]) || storage.header[0] < 0
    || !Array.isArray(storage.points) || storage.points.length > LANDMARK_FIELD_MAX_POINTS) {
    throw new Error('Tracking landmark storage metadata is invalid.');
  }
  const packed = new Float32Array(LANDMARK_FIELD_STORAGE_FLOATS);
  packed.set(storage.header.map(f), 0);
  for (let index = 0; index < storage.points.length; index += 1) {
    const point = storage.points[index];
    const visibility = point.visibility ?? 1;
    if (![point.x, point.y, point.z, visibility].every(finiteF32)) {
      throw new Error('Tracking landmark storage points must contain finite f32 values.');
    }
    packed.set([f(point.x), f(point.y), f(point.z), f(visibility)], 4 + index * 4);
  }
  return packed;
}
