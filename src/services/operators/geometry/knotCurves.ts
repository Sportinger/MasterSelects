import type { CurveSet } from './geometryEvaluation';

/**
 * Knot curve generators. Closed knots repeat their first point at the end; the yarn twist and
 * spline then meet at that seam, which sits where the knot is flattest.
 */
export const KNOT_SHAPES = ['trefoil', 'figure-eight', 'reef', 'torus'] as const;
export type KnotShape = typeof KNOT_SHAPES[number];
export interface KnotSpec { shape: number; p: number; q: number; size: number; depth: number; points: number }
export interface CelticKnotSpec { columns: number; rows: number; size: number; height: number; resolution: number; roundness: number }

type Point = [number, number, number];

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : greatestCommonDivisor(b, a % b);
}

function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map(axis => 0.5 * (2 * p1[axis] + (p2[axis] - p0[axis]) * t + (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2
    + (3 * (p1[axis] - p2[axis]) + p3[axis] - p0[axis]) * t3)) as Point;
}

/** Points along a Catmull-Rom spline through `controls`; closed splines wrap and repeat their start. */
function resample(controls: readonly Point[], perInterval: number, closed: boolean): Point[] {
  const count = controls.length, intervals = closed ? count : count - 1, out: Point[] = [];
  const at = (index: number) => controls[closed ? (index + count) % count : Math.max(0, Math.min(count - 1, index))];
  for (let interval = 0; interval < intervals; interval++) {
    for (let step = 0; step < perInterval; step++) {
      out.push(catmullRom(at(interval - 1), at(interval), at(interval + 1), at(interval + 2), step / perInterval));
    }
  }
  out.push(closed ? [...out[0]] as Point : [...controls[count - 1]] as Point);
  return out;
}

function curveSet(curves: readonly Point[][]): CurveSet {
  const total = curves.reduce((sum, curve) => sum + curve.length, 0);
  const positions = new Float32Array(total * 3), starts = new Uint32Array(curves.length), counts = new Uint32Array(curves.length);
  let cursor = 0;
  curves.forEach((curve, strand) => {
    starts[strand] = cursor; counts[strand] = curve.length;
    for (const point of curve) positions.set(point, cursor++ * 3);
  });
  return { positions, starts, counts };
}

/** A closed parametric curve sampled at `points` + 1 points, scaled to `size`. */
function parametric(points: number, size: number, at: (angle: number) => Point): Point[] {
  return Array.from({ length: points + 1 }, (_, index) => at(2 * Math.PI * (index % points) / points).map(value => value * size) as Point);
}

/**
 * Reef (square) knot: two ropes whose bights lock around each other, ends side by side. The six
 * crossings alternate over and under along both ropes; Depth × Size lifts each crossing.
 */
function reefKnot(points: number, depth: number): Point[][] {
  const h = depth * 2.6, x = 1.745, ropeA: Point[] = [[-2.6, 0.25, 0], [-x, 0.25, -h], [-0.9, 0.32, 0], [0, 0.425, h], [0.9, 0.56, 0], [1.2, 0.6, 0],
    [x, 0.25, -h], [1.8, 0, 0], [x, -0.25, h], [1.2, -0.6, 0], [0.9, -0.56, 0], [0, -0.425, -h], [-0.9, -0.32, 0], [-x, -0.25, h], [-2.6, -0.25, 0]];
  const ropeB = ropeA.map(([px, py, pz]) => [-px, py, -pz] as Point);
  const perInterval = Math.max(1, Math.round(points / (ropeA.length - 1)));
  return [resample(ropeA, perInterval, false), resample(ropeB, perInterval, false)];
}

export function knotCurves(spec: KnotSpec): CurveSet {
  const { points, size, depth } = spec;
  const shape = KNOT_SHAPES[spec.shape] ?? 'trefoil';
  if (shape === 'reef') return curveSet(reefKnot(points, depth).map(curve => curve.map(point => point.map(value => value * size / 2.6) as Point)));
  if (shape === 'figure-eight') {
    return curveSet([parametric(points, size / 3, angle => [(2 + Math.cos(2 * angle)) * Math.cos(3 * angle),
      (2 + Math.cos(2 * angle)) * Math.sin(3 * angle), depth * 3 * Math.sin(4 * angle)])]);
  }
  if (shape === 'torus') {
    // A (p, q) torus knot winds p times around the axis and q times through the hole.
    return curveSet([parametric(points, size / 1.45, angle => [(1 + 0.45 * Math.cos(spec.q * angle)) * Math.cos(spec.p * angle),
      (1 + 0.45 * Math.cos(spec.q * angle)) * Math.sin(spec.p * angle), depth * 1.45 * Math.sin(spec.q * angle)])]);
  }
  return curveSet([parametric(points, size / 3, angle => [Math.sin(angle) + 2 * Math.sin(2 * angle),
    Math.cos(angle) - 2 * Math.cos(2 * angle), -depth * 3 * Math.sin(3 * angle)])]);
}

export const isCoprimeTorusKnot = (p: number, q: number) => p >= 1 && q >= 1 && greatestCommonDivisor(p, q) === 1;

/**
 * Loops of a Celtic plait on a lattice of `2·columns` × `2·rows` half cells. Crossings sit on the
 * interior lattice points with an odd coordinate sum; threads run diagonally between them and
 * reflect at the border, so with even sides they never meet a corner. Like a plain weave draft,
 * a thread rising to the right lies on top at even x, one falling to the right at odd x: over and
 * under alternate along every thread, also across reflections.
 */
export function celticLoops(columns: number, rows: number): Array<Array<{ x: number; y: number; z: -1 | 0 | 1 }>> {
  const width = 2 * columns, height = 2 * rows, visited = new Set<string>(), loops: Array<Array<{ x: number; y: number; z: -1 | 0 | 1 }>> = [];
  const border = (x: number, y: number) => x === 0 || x === width || y === 0 || y === height;
  const starts: Array<[number, number, number, number]> = [];
  for (let x = 1; x < width; x += 2) starts.push([x, 0, 1, 1]);
  for (let y = 1; y < height; y += 2) starts.push([0, y, 1, 1]);
  for (const [startX, startY, startDx, startDy] of starts) {
    if (visited.has(`${startX},${startY}`)) continue;
    const loop: Array<{ x: number; y: number; z: -1 | 0 | 1 }> = [];
    let x = startX, y = startY, dx = startDx, dy = startDy;
    do {
      if (border(x, y)) {
        visited.add(`${x},${y}`);
        loop.push({ x, y, z: 0 });
        if (x === 0 || x === width) dx = x === 0 ? 1 : -1;
        if (y === 0 || y === height) dy = y === 0 ? 1 : -1;
      } else {
        const rising = dx * dy > 0;
        loop.push({ x, y, z: (rising ? x % 2 === 0 : x % 2 === 1) ? 1 : -1 });
      }
      x += dx; y += dy;
    } while (x !== startX || y !== startY);
    loops.push(loop);
  }
  return loops;
}

/** Celtic plait curves centered on the origin, each cell `size` wide; border loops bulge out by Roundness. */
export function celticKnotCurves(spec: CelticKnotSpec): CurveSet {
  const half = spec.size / 2, width = 2 * spec.columns, height = 2 * spec.rows;
  return curveSet(celticLoops(spec.columns, spec.rows).map(loop => resample(loop.map(({ x, y, z }) => {
    const outX = x === 0 ? -1 : x === width ? 1 : 0, outY = y === 0 ? -1 : y === height ? 1 : 0;
    return [(x - spec.columns + outX * spec.roundness) * half, (y - spec.rows + outY * spec.roundness) * half, z * spec.height] as Point;
  }), spec.resolution, true)));
}
