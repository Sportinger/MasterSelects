/**
 * Deterministic math shared by the CPU reference solver. The WGSL shaders in
 * src/engine/flock/shaders mirror these functions line by line (u32 wrapping
 * arithmetic, lattice value noise, analytic paths). Keep both in sync and bump
 * FLOCK_SOLVER_VERSION when semantics change.
 */

import { fade, hashU32, latticeCellHash } from '../../procedural/latticeNoise';

export { curlNoise3, hashU32, valueNoise1, valueNoise3 } from '../../procedural/latticeNoise';

export type Vec3 = [number, number, number];

/** Random in [0,1) for (slot, key) — key mixes seed/generation/channel. */
export function rand01(slot: number, key: number): number {
  return hashU32((slot >>> 0) ^ hashU32(key >>> 0)) / 4294967296;
}

export function mixKey(seed: number, generation: number, channel: number): number {
  return (Math.imul(seed >>> 0, 2654435761) ^ Math.imul((generation + 1) >>> 0, 2246822519) ^ Math.imul(channel >>> 0, 3266489917)) >>> 0;
}

/** The 27 neighbor cells nearest first (center, faces, edges, corners); mirrored in WGSL. */
export const NEIGHBOR_CELL_ORDER: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
  [-1, -1, 0], [1, -1, 0], [-1, 1, 0], [1, 1, 0], [-1, 0, -1], [1, 0, -1],
  [-1, 0, 1], [1, 0, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1], [0, 1, 1],
  [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
];

/**
 * Candidates examined per particle before stride sampling kicks in. A sphere of
 * the neighbor radius fills ~15% of the 27-cell block, so ~6.5 candidates per
 * wanted neighbor keeps the expected neighbor count near the limit; the cell
 * candidate setting caps the work (x8).
 */
export function neighborCandidateBudget(neighborLimit: number, cellCandidates: number): number {
  return Math.max(1, Math.min(cellCandidates * 8, Math.ceil(neighborLimit * 6.5)));
}

export function cellHash(ix: number, iy: number, iz: number, tableMask: number): number {
  return latticeCellHash(ix, iy, iz) & tableMask;
}

/** Columns and rows of a grid emitter; the aspect follows size.x / size.y. Mirrors WGSL gridDims. */
export function flockGridDims(count: number, size: Vec3): [number, number] {
  const cols = Math.max(1, Math.floor(Math.sqrt(count * Math.max(size[0], 1e-3) / Math.max(size[1], 1e-3)) + 0.5));
  return [cols, Math.max(1, Math.ceil(count / cols))];
}

/** Channel salt for the generation-independent grid jitter. */
export const GRID_JITTER_SALT = 0x6a7e1d;

/**
 * Rest offset (x, y) of a grid-emitter particle relative to the emitter center:
 * its cell center plus a stable per-identity jitter (in cells) that breaks the
 * lattice so dense canvases do not moire against the pixel grid. Mirrors WGSL gridRest.
 */
export function flockGridRest(count: number, size: Vec3, seed: number, jitter: number, index: number, local: number): [number, number] {
  const [cols, rows] = flockGridDims(count, size);
  const row = Math.floor(local / cols);
  const col = local - row * cols;
  const jx = (rand01(index, mixKey(seed, 0, GRID_JITTER_SALT)) - 0.5) * jitter;
  const jy = (rand01(index, mixKey(seed, 0, GRID_JITTER_SALT + 1)) - 0.5) * jitter;
  return [((col + 0.5 + jx) / cols - 0.5) * size[0], (0.5 - (row + 0.5 + jy) / rows) * size[1]];
}

export function length3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

export function falloffWeight(mode: number, normalizedDistance: number): number {
  if (normalizedDistance >= 1) return 0;
  switch (mode) {
    case 1: return 1 - normalizedDistance;
    case 2: return 1 - fade(normalizedDistance);
    case 3: return 1 / (1 + 16 * normalizedDistance * normalizedDistance);
    default: return 1;
  }
}

export const FALLOFF_CODES: Record<string, number> = { none: 0, linear: 1, smooth: 2, inverse: 3 };

/** Rotation matrix (column-major 3x3) from XYZ Euler degrees. */
export function rotationMatrixDegrees(rotation: Vec3): Float64Array {
  const [rx, ry, rz] = rotation.map((degrees) => (degrees * Math.PI) / 180);
  const a = Math.cos(rx);
  const b = Math.sin(rx);
  const c = Math.cos(ry);
  const d = Math.sin(ry);
  const e = Math.cos(rz);
  const f = Math.sin(rz);
  // Same convention as buildSceneWorldMatrix (without scale/translation).
  return Float64Array.from([
    c * e, a * f + b * e * d, b * f - a * e * d,
    -c * f, a * e - b * f * d, b * e + a * f * d,
    d, -b * c, a * c,
  ]);
}

export function rotate(m: Float64Array, x: number, y: number, z: number): Vec3 {
  return [
    m[0] * x + m[3] * y + m[6] * z,
    m[1] * x + m[4] * y + m[7] * z,
    m[2] * x + m[5] * y + m[8] * z,
  ];
}

export function rotateInverse(m: Float64Array, x: number, y: number, z: number): Vec3 {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

export const PATH_SHAPE_CODES: Record<string, number> = { circle: 0, figure8: 1, helix: 2, line: 3, polyline: 4 };

export interface PathParams {
  shape: number;
  center: Vec3;
  radius: number;
  height: number;
  turns: number;
  rotation: Float64Array;
  points: [Vec3, Vec3, Vec3, Vec3];
}

export function isClosedPath(shape: number): boolean {
  return shape === 0 || shape === 1;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Path position at u in [0,1] (closed shapes wrap, open shapes clamp). */
export function evaluatePath(path: PathParams, u: number): Vec3 {
  const closed = isClosedPath(path.shape);
  const t = closed ? u - Math.floor(u) : Math.max(0, Math.min(1, u));
  const theta = t * Math.PI * 2;
  let local: Vec3;
  switch (path.shape) {
    case 1:
      local = [path.radius * Math.sin(theta), path.height * 0.5 * Math.sin(theta * 2), path.radius * Math.sin(theta) * Math.cos(theta)];
      break;
    case 2: {
      const angle = t * Math.PI * 2 * path.turns;
      local = [path.radius * Math.cos(angle), path.height * (t - 0.5), path.radius * Math.sin(angle)];
      break;
    }
    case 3:
      local = [path.radius * (t * 2 - 1), 0, 0];
      break;
    case 4: {
      const segments = 3;
      const scaled = t * segments;
      const index = Math.min(segments - 1, Math.floor(scaled));
      const f = scaled - index;
      const pts = path.points;
      const p0 = pts[Math.max(0, index - 1)];
      const p1 = pts[index];
      const p2 = pts[index + 1];
      const p3 = pts[Math.min(3, index + 2)];
      return [
        catmull(p0[0], p1[0], p2[0], p3[0], f),
        catmull(p0[1], p1[1], p2[1], p3[1], f),
        catmull(p0[2], p1[2], p2[2], p3[2], f),
      ];
    }
    default:
      local = [path.radius * Math.cos(theta), 0, path.radius * Math.sin(theta)];
  }
  const rotated = rotate(path.rotation, local[0], local[1], local[2]);
  return [rotated[0] + path.center[0], rotated[1] + path.center[1], rotated[2] + path.center[2]];
}

export const FLOCK_PATH_SAMPLES = 48;
