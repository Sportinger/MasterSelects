import type { ClothSpec } from './clothProgram';
import { CLOTH_STEP_RATE, ClothSimulation } from './clothSolver';

/** Checkpointed simulations per render thread, least recently used first. */
const SIMULATION_LIMIT = 4;
const simulations = new Map<string, ClothSimulation>();

function simulationFor(spec: ClothSpec): ClothSimulation {
  const key = JSON.stringify(spec);
  let simulation = simulations.get(key);
  if (simulation) simulations.delete(key);
  else simulation = new ClothSimulation(spec);
  simulations.set(key, simulation);
  while (simulations.size > SIMULATION_LIMIT) simulations.delete(simulations.keys().next().value!);
  return simulation;
}

/** A cloth grid at one moment: (columns + 1) × (rows + 1) positions, row-major from the bottom edge. */
export interface ClothGrid { columns: number; rows: number; width: number; height: number; positions: Float64Array }

/**
 * The simulated sheet at source time `time` (seconds). Pre-roll runs before time 0; between fixed
 * steps the positions are blended linearly so any frame rate samples the same motion.
 */
export function clothGridAt(spec: ClothSpec, time: number): ClothGrid {
  const simulation = simulationFor(spec);
  const exact = Math.max(0, ((Number.isFinite(time) ? time : 0) + spec.preroll) * CLOTH_STEP_RATE);
  const step = Math.floor(exact + 1e-7), alpha = exact - step;
  const positions = Float64Array.from(simulation.positionsAt(step));
  if (alpha > 1e-6) {
    const next = simulation.positionsAt(step + 1);
    for (let index = 0; index < positions.length; index++) positions[index] += (next[index] - positions[index]) * alpha;
  }
  return { columns: spec.columns, rows: spec.rows, width: spec.width, height: spec.height, positions };
}

/** Catch-up cost is bounded by checkpoints; this only drops the cached states. */
export function clearClothSimulations() { simulations.clear(); }

const weights = (t: number): [number, number, number, number] => {
  const t2 = t * t, t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
};
const slopes = (t: number): [number, number, number, number] => {
  const t2 = t * t;
  return [(-3 * t2 + 4 * t - 1) / 2, (9 * t2 - 10 * t) / 2, (-9 * t2 + 8 * t + 1) / 2, (3 * t2 - 2 * t) / 2];
};

/**
 * Bicubic (Catmull-Rom) surface point and tangents at grid coordinates (u, v). Rows and columns
 * beyond the border are extrapolated linearly, and coordinates outside the sheet continue along
 * its edge tangent, so bound curves stay smooth up to and past the edge.
 */
export function sampleClothGrid(grid: ClothGrid, u: number, v: number): { point: number[]; du: number[]; dv: number[] } {
  const { columns, rows, positions } = grid;
  const cu = Math.min(columns, Math.max(0, u)), cv = Math.min(rows, Math.max(0, v));
  const i = Math.min(columns - 1, Math.floor(cu)), j = Math.min(rows - 1, Math.floor(cv));
  const tu = cu - i, tv = cv - j, wu = weights(tu), wv = weights(tv), su = slopes(tu), sv = slopes(tv);
  const at = (x: number, y: number, axis: number): number => {
    if (x < 0) return 2 * at(0, y, axis) - at(1, y, axis);
    if (x > columns) return 2 * at(columns, y, axis) - at(columns - 1, y, axis);
    if (y < 0) return 2 * at(x, 0, axis) - at(x, 1, axis);
    if (y > rows) return 2 * at(x, rows, axis) - at(x, rows - 1, axis);
    return positions[(y * (columns + 1) + x) * 3 + axis];
  };
  const point = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0];
  for (let b = 0; b < 4; b++) {
    for (let a = 0; a < 4; a++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = at(i - 1 + a, j - 1 + b, axis);
        point[axis] += wu[a] * wv[b] * value; du[axis] += su[a] * wv[b] * value; dv[axis] += wu[a] * sv[b] * value;
      }
    }
  }
  for (let axis = 0; axis < 3; axis++) point[axis] += du[axis] * (u - cu) + dv[axis] * (v - cv);
  return { point, du, dv };
}

/** Fast path of `sampleClothGrid` for cells whose 4 × 4 neighbourhood lies inside the grid. */
function sampleInterior(grid: ClothGrid, u: number, v: number, point: number[], du: number[], dv: number[]): boolean {
  const { columns, rows, positions } = grid;
  const i = Math.floor(u), j = Math.floor(v);
  if (i < 1 || j < 1 || i + 2 > columns || j + 2 > rows) return false;
  const wu = weights(u - i), wv = weights(v - j), su = slopes(u - i), sv = slopes(v - j), stride = columns + 1;
  point[0] = point[1] = point[2] = du[0] = du[1] = du[2] = dv[0] = dv[1] = dv[2] = 0;
  for (let b = 0; b < 4; b++) {
    const row = (j - 1 + b) * stride + i - 1;
    for (let a = 0; a < 4; a++) {
      const base = (row + a) * 3, w = wu[a] * wv[b], wdu = su[a] * wv[b], wdv = wu[a] * sv[b];
      for (let axis = 0; axis < 3; axis++) {
        const value = positions[base + axis];
        point[axis] += w * value; du[axis] += wdu * value; dv[axis] += wdv * value;
      }
    }
  }
  return true;
}

/**
 * Surface Bind: a point (x, y, z) of the flat rest sheet lands on the simulated sheet at the same
 * (x, y) and is lifted z × `height` along its normal, so crimp and yarn frames follow the cloth.
 */
export function bindToCloth(positions: Float32Array, grid: ClothGrid, height: number): Float32Array {
  const bound = new Float32Array(positions.length);
  const point = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0];
  for (let index = 0; index < positions.length; index += 3) {
    const u = (positions[index] / grid.width + 0.5) * grid.columns, v = (positions[index + 1] / grid.height + 0.5) * grid.rows;
    if (!sampleInterior(grid, u, v, point, du, dv)) {
      const sample = sampleClothGrid(grid, u, v);
      for (let axis = 0; axis < 3; axis++) { point[axis] = sample.point[axis]; du[axis] = sample.du[axis]; dv[axis] = sample.dv[axis]; }
    }
    const nx = du[1] * dv[2] - du[2] * dv[1], ny = du[2] * dv[0] - du[0] * dv[2], nz = du[0] * dv[1] - du[1] * dv[0];
    const lift = positions[index + 2] * height / (Math.hypot(nx, ny, nz) || 1);
    bound[index] = point[0] + nx * lift; bound[index + 1] = point[1] + ny * lift; bound[index + 2] = point[2] + nz * lift;
  }
  return bound;
}
