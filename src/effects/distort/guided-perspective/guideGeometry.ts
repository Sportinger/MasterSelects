import { fitVanishingPoint } from './vanishingPointFit';
export const MAX_GUIDES_PER_AXIS = 8;
export interface PerspectiveGuide { axis: 'vertical' | 'horizontal'; x1: number; y1: number; x2: number; y2: number }
export type Matrix3 = [number, number, number, number, number, number, number, number, number];
export const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function parsePerspectiveGuides(value: unknown): PerspectiveGuide[] {
  try {
    const rows: unknown = JSON.parse(String(value));
    if (!Array.isArray(rows) || rows.length > MAX_GUIDES_PER_AXIS * 2) return [];
    return rows.filter((g): g is PerspectiveGuide => g && ['vertical', 'horizontal'].includes(g.axis)
      && [g.x1, g.y1, g.x2, g.y2].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1));
  } catch { return []; }
}
function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function multiplyMatrix(a: Matrix3, b: Matrix3): Matrix3 {
  return Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3), col = i % 3;
    return a[row * 3] * b[col] + a[row * 3 + 1] * b[col + 3] + a[row * 3 + 2] * b[col + 6];
  }) as Matrix3;
}
export function invertMatrix(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const adj: Matrix3 = [e * i - f * h, c * h - b * i, b * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d];
  const determinant = a * adj[0] + b * adj[3] + c * adj[6];
  if (Math.abs(determinant) < 1e-8) throw new Error('Guides do not define a stable perspective. Use distinct scene edges.');
  return adj.map(v => v / determinant) as Matrix3;
}
export function transformGuidePoint(m: Matrix3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8];
  if (Math.abs(w) < 1e-6) throw new Error('Perspective approaches the horizon. Move the guides closer to the image center.');
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}
function vanishingPoint(guides: PerspectiveGuide[], aspect: number, axis: PerspectiveGuide['axis']): number[] {
  const pair = guides.filter(g => g.axis === axis);
  if (!pair.length) return axis === 'horizontal' ? [1, 0, 0] : [0, 1, 0];
  if (pair.length < 2) throw new Error(`Draw at least two ${axis} guides along different scene edges.`);
  if (pair.length > MAX_GUIDES_PER_AXIS) throw new Error(`Use at most ${MAX_GUIDES_PER_AXIS} ${axis} guides.`);
  const lines = pair.map(g => {
    const a = [(g.x1 - 0.5) * aspect, g.y1 - 0.5, 1], b = [(g.x2 - 0.5) * aspect, g.y2 - 0.5, 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.025) throw new Error('Guides are too short. Draw along longer edges.');
    return cross(a, b);
  });
  if (!lines.some((line, i) => lines.slice(i + 1).some(other => Math.hypot(...cross(line, other)) > 1e-7)))
    throw new Error('Guides overlap. Use distinct parallel scene edges.');
  const point = pair.length === 2 ? cross(lines[0], lines[1]) : fitVanishingPoint(lines);
  const length = Math.hypot(point[0], point[1]);
  if (length < 1e-7) throw new Error('Guides overlap or cross near the image center. Use two distinct parallel scene edges.');
  const sign = (axis === 'horizontal' ? point[0] : point[1]) < 0 ? -1 : 1;
  return point.map(v => v * sign / length);
}
/** Rectify guide vanishing points, then fit the entire source with uniform scale. */
export function solveGuidedPerspective(guides: PerspectiveGuide[], aspect: number): { forward: Matrix3; inverse: Matrix3 } {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('Source dimensions unavailable.');
  if (guides.length < 2 || guides.length > MAX_GUIDES_PER_AXIS * 2) throw new Error('Draw at least two vertical guides or two horizontal guides.');
  const h = vanishingPoint(guides, aspect, 'horizontal'), v = vanishingPoint(guides, aspect, 'vertical');
  const rectify = invertMatrix([h[0], v[0], 0, h[1], v[1], 0, h[2], v[2], 1]);
  const corners = [[-aspect / 2, -0.5], [aspect / 2, -0.5], [-aspect / 2, 0.5], [aspect / 2, 0.5]];
  if (corners.some(([x, y]) => rectify[6] * x + rectify[7] * y + rectify[8] < 0.15))
    throw new Error('These guides require an extreme warp. Use longer, more accurate scene edges.');
  const points = corners.map(([x, y]) => transformGuidePoint(rectify, x, y));
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const scale = Math.min(aspect / (right - left), 1 / (bottom - top));
  const fit: Matrix3 = [scale, 0, -(left + right) * scale / 2, 0, scale, -(top + bottom) * scale / 2, 0, 0, 1];
  const toMetric: Matrix3 = [aspect, 0, -aspect / 2, 0, 1, -0.5, 0, 0, 1];
  const forward = multiplyMatrix(invertMatrix(toMetric), multiplyMatrix(fit, multiplyMatrix(rectify, toMetric)));
  return { forward, inverse: invertMatrix(forward) };
}
