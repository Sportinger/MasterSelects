// Phone mask shapes as ordinary editor masks (ClipMask paths). Pure functions: a shape plus a few
// parameters become vertices, position and rotation the editor renders and the desktop mask panel
// edits; a mask the phone made is read back into the same parameters. Everything else (pen paths,
// edited vertices, animated masks) is "custom" and stays untouched.
//
// Coordinates: vertices are normalized to the clip (0..1). The editor rotates masks in raster
// pixels, and the raster has the composition's size, so `aspect` is composition width / height.

import type { ClipMask, MaskVertex } from '../../../types/masks';

export type PhoneMaskShape = 'linear' | 'mirror' | 'circle' | 'rectangle' | 'star' | 'heart';

export const PHONE_MASK_SHAPES: readonly { value: PhoneMaskShape; label: string; maskName: string }[] = [
  { value: 'linear', label: 'Linear', maskName: 'Linear Mask' },
  { value: 'mirror', label: 'Mirror', maskName: 'Mirror Mask' },
  { value: 'circle', label: 'Circle', maskName: 'Ellipse Mask' },
  { value: 'rectangle', label: 'Rectangle', maskName: 'Rectangle Mask' },
  { value: 'star', label: 'Star', maskName: 'Star Mask' },
  { value: 'heart', label: 'Heart', maskName: 'Heart Mask' },
];

export interface PhoneMaskParams {
  /** Centre of the shape in clip coordinates (0..1). For Linear and Mirror: a point on the line. */
  centerX: number;
  centerY: number;
  /** Width as a share of the clip width (Rectangle, Circle, Star, Heart). */
  width: number;
  /** Height as a share of the clip height (Rectangle, Circle); band thickness for Mirror. */
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** Soft edge in raster pixels. */
  feather: number;
  inverted: boolean;
}

/** Which parameters a shape uses; the sheet greys the rest out with a reason. */
export const PHONE_MASK_SHAPE_PARAMS: Readonly<Record<PhoneMaskShape, { width: boolean; height: boolean }>> = {
  linear: { width: false, height: false },
  mirror: { width: false, height: true },
  circle: { width: true, height: true },
  rectangle: { width: true, height: true },
  star: { width: true, height: false },
  heart: { width: true, height: false },
};

/** Half-plane and band shapes reach this far beyond the clip, so any rotation still covers the frame. */
const FAR = 4;
const CIRCLE_K = 0.5523;
const STAR_POINTS = 5;
const STAR_INNER = 0.45;
const HEART_SEGMENTS = 32;
const EPSILON = 1e-6;

export function defaultPhoneMaskParams(shape: PhoneMaskShape, aspect: number): PhoneMaskParams {
  const base = { centerX: 0.5, centerY: 0.5, rotation: 0, feather: 0, inverted: false };
  switch (shape) {
    case 'linear': return { ...base, width: 1, height: 1 };
    case 'mirror': return { ...base, width: 1, height: 0.3 };
    case 'circle': return { ...base, width: 0.6, height: Math.min(1, 0.6 * aspect) };
    case 'rectangle': return { ...base, width: 0.7, height: 0.5 };
    case 'star':
    case 'heart': return { ...base, width: 0.6, height: 0.6 };
  }
}

/** Drops negative zero: the project format round trip stores 0, and -0 !== 0 would read as an edit. */
function z(value: number): number {
  return value + 0;
}

function corner(id: string, x: number, y: number): MaskVertex {
  return { id, x: z(x), y: z(y), handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' };
}

function box(prefix: string, x1: number, y1: number, x2: number, y2: number): MaskVertex[] {
  return [corner(`${prefix}-tl`, x1, y1), corner(`${prefix}-tr`, x2, y1), corner(`${prefix}-br`, x2, y2), corner(`${prefix}-bl`, x1, y2)];
}

/** Points of a unit template (pixel proportions), centred on its bounding box, scaled to `width`. */
function templateVertices(prefix: string, points: readonly [number, number][], width: number, aspect: number): MaskVertex[] {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(EPSILON, maxX - minX);
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  // `width` is a share of the clip width; the template keeps its pixel proportions in a raster of `aspect`.
  const scaleX = width / spanX;
  const scaleY = (width * aspect) / spanX;
  return points.map(([x, y], index) => corner(`${prefix}-${index}`, 0.5 + (x - midX) * scaleX, 0.5 + (y - midY) * scaleY));
}

function starPoints(): [number, number][] {
  return Array.from({ length: STAR_POINTS * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? 1 : STAR_INNER;
    const angle = -Math.PI / 2 + (index * Math.PI) / STAR_POINTS;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function heartPoints(): [number, number][] {
  return Array.from({ length: HEART_SEGMENTS }, (_, index) => {
    const t = (index / HEART_SEGMENTS) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    return [x, y];
  });
}

function ellipse(prefix: string, rx: number, ry: number): MaskVertex[] {
  const v = (id: string, x: number, y: number, inX: number, inY: number): MaskVertex => ({
    id: `${prefix}-${id}`, x: z(x), y: z(y), handleIn: { x: z(inX), y: z(inY) }, handleOut: { x: z(-inX), y: z(-inY) }, handleMode: 'mirrored',
  });
  return [
    v('t', 0.5, 0.5 - ry, -rx * CIRCLE_K, 0),
    v('r', 0.5 + rx, 0.5, 0, -ry * CIRCLE_K),
    v('b', 0.5, 0.5 + ry, rx * CIRCLE_K, 0),
    v('l', 0.5 - rx, 0.5, 0, ry * CIRCLE_K),
  ];
}

/** Unrotated, uncentred vertices of a shape around (0.5, 0.5). */
export function phoneMaskVertices(shape: PhoneMaskShape, params: PhoneMaskParams, aspect: number, prefix = 'pm'): MaskVertex[] {
  const width = Math.max(EPSILON, params.width);
  const height = Math.max(EPSILON, params.height);
  switch (shape) {
    // Keeps everything below the line through (0.5, 0.5); Invert keeps the part above.
    case 'linear': return box(prefix, 0.5 - FAR, 0.5, 0.5 + FAR, 0.5 + 2 * FAR);
    case 'mirror': return box(prefix, 0.5 - FAR, 0.5 - height / 2, 0.5 + FAR, 0.5 + height / 2);
    case 'rectangle': return box(prefix, 0.5 - width / 2, 0.5 - height / 2, 0.5 + width / 2, 0.5 + height / 2);
    case 'circle': return ellipse(prefix, width / 2, height / 2);
    case 'star': return templateVertices(prefix, starPoints(), width, aspect);
    case 'heart': return templateVertices(prefix, heartPoints(), width, aspect);
  }
}

function boundsOf(vertices: readonly Pick<MaskVertex, 'x' | 'y'>[]) {
  const xs = vertices.map((vertex) => vertex.x);
  const ys = vertices.map((vertex) => vertex.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY };
}

/** Rotates `point` around `pivot` by `degrees` in raster pixels (the editor's mask rotation). */
function rotateInRaster(point: { x: number; y: number }, pivot: { x: number; y: number }, degrees: number, aspect: number) {
  const radians = (degrees * Math.PI) / 180;
  const localX = (point.x - pivot.x) * aspect;
  const localY = point.y - pivot.y;
  return {
    x: pivot.x + (localX * Math.cos(radians) - localY * Math.sin(radians)) / aspect,
    y: pivot.y + localX * Math.sin(radians) + localY * Math.cos(radians),
  };
}

/** The point the shape's centre parameter refers to, before rotation and offset. */
function anchorOf(shape: PhoneMaskShape, bounds: ReturnType<typeof boundsOf>) {
  return shape === 'linear' ? { x: bounds.centerX, y: bounds.minY } : { x: bounds.centerX, y: bounds.centerY };
}

/** Full mask state for a shape: what the sheet writes with updateMask (absolute, not a delta). */
export function buildPhoneMaskPatch(shape: PhoneMaskShape, params: PhoneMaskParams, aspect: number, prefix = 'pm'): Partial<ClipMask> {
  const vertices = phoneMaskVertices(shape, params, aspect, prefix);
  const bounds = boundsOf(vertices);
  const pivot = { x: bounds.centerX, y: bounds.centerY };
  const rotation = Number.isFinite(params.rotation) ? params.rotation : 0;
  // The editor rotates around the geometry centre, then offsets: place the anchor at the centre parameter.
  const anchor = rotateInRaster(anchorOf(shape, bounds), pivot, rotation, aspect);
  return {
    name: PHONE_MASK_SHAPES.find((entry) => entry.value === shape)!.maskName,
    vertices,
    closed: true,
    mode: 'add',
    opacity: 1,
    enabled: true,
    inverted: params.inverted,
    feather: Math.max(0, params.feather),
    featherOffset: 0,
    featherBalance: 0,
    rotation: z(rotation),
    position: { x: z(params.centerX - anchor.x), y: z(params.centerY - anchor.y) },
  };
}

function isAxisBox(vertices: readonly MaskVertex[]): boolean {
  if (vertices.length !== 4) return false;
  const b = boundsOf(vertices);
  return vertices.every((vertex) => (Math.abs(vertex.x - b.minX) < EPSILON || Math.abs(vertex.x - b.maxX) < EPSILON)
    && (Math.abs(vertex.y - b.minY) < EPSILON || Math.abs(vertex.y - b.maxY) < EPSILON)
    && Math.abs(vertex.handleIn.x) + Math.abs(vertex.handleIn.y) + Math.abs(vertex.handleOut.x) + Math.abs(vertex.handleOut.y) < EPSILON);
}

function shapeOfName(name: string): PhoneMaskShape | null {
  return PHONE_MASK_SHAPES.find((entry) => entry.maskName === name)?.value ?? null;
}

/**
 * Reads a mask back into phone parameters, or null when the phone cannot edit it as one of its
 * shapes (a pen path, edited vertices, the crop mask, per-edge feathers, a non-default edge profile,
 * or settings the sheet cannot show: opacity below 100 %, a disabled mask, a mask kept for effects
 * only). A phone write sets opacity 1 and enabled, so editing such a mask would change it silently.
 */
export function readPhoneMask(mask: ClipMask, aspect: number): { shape: PhoneMaskShape; params: PhoneMaskParams } | null {
  if (mask.purpose === 'crop' || !mask.closed || mask.mode !== 'add') return null;
  if ((mask.opacity ?? 1) !== 1 || mask.enabled === false || mask.compositeEnabled === false) return null;
  if (mask.edgeFeathers && Object.keys(mask.edgeFeathers).length > 0) return null;
  if ((mask.featherOffset ?? 0) !== 0 || (mask.featherBalance ?? 0) !== 0) return null;
  const shape = shapeOfName(mask.name);
  if (!shape) return null;
  const vertices = mask.vertices;
  const bounds = boundsOf(vertices);
  const expectedCount = shape === 'star' ? STAR_POINTS * 2 : shape === 'heart' ? HEART_SEGMENTS : 4;
  if (vertices.length !== expectedCount) return null;
  if ((shape === 'linear' || shape === 'mirror' || shape === 'rectangle') && !isAxisBox(vertices)) return null;
  if (shape === 'linear' && (Math.abs(bounds.width - 2 * FAR) > 1e-4 || Math.abs(bounds.height - 2 * FAR) > 1e-4)) return null;
  if (shape === 'mirror' && Math.abs(bounds.width - 2 * FAR) > 1e-4) return null;
  const rotation = mask.rotation ?? 0;
  const pivot = { x: bounds.centerX, y: bounds.centerY };
  const anchor = rotateInRaster(anchorOf(shape, bounds), pivot, rotation, aspect);
  const position = mask.position ?? { x: 0, y: 0 };
  const params: PhoneMaskParams = {
    centerX: anchor.x + position.x,
    centerY: anchor.y + position.y,
    width: shape === 'linear' || shape === 'mirror' ? 1 : bounds.width,
    height: shape === 'linear' ? 1 : shape === 'star' || shape === 'heart' ? bounds.width : bounds.height,
    rotation,
    feather: Math.max(0, mask.feather ?? 0),
    inverted: Boolean(mask.inverted),
  };
  // A rebuilt mask must give the same vertices; otherwise someone edited the path by hand.
  const rebuilt = phoneMaskVertices(shape, params, aspect);
  const offsetX = bounds.minX - boundsOf(rebuilt).minX;
  const offsetY = bounds.minY - boundsOf(rebuilt).minY;
  const same = rebuilt.every((vertex, index) => Math.abs(vertex.x + offsetX - vertices[index].x) < 1e-4
    && Math.abs(vertex.y + offsetY - vertices[index].y) < 1e-4
    && Math.abs(vertex.handleIn.x - vertices[index].handleIn.x) < 1e-4 && Math.abs(vertex.handleIn.y - vertices[index].handleIn.y) < 1e-4
    && Math.abs(vertex.handleOut.x - vertices[index].handleOut.x) < 1e-4 && Math.abs(vertex.handleOut.y - vertices[index].handleOut.y) < 1e-4);
  return same ? { shape, params } : null;
}
