import { drawThroughProfile, drawThroughSpan, DRAW_PROFILE_SIZE } from './knitDrawProfile';
import type { CurveSet } from './geometryEvaluation';

/** Period is the time per stitch, not a clock reset. Material coordinates keep advancing. */
export interface KnitCycleSpec {
  rows: number; stitches: number; resolution: number; radius: number; spacing: number;
  height: number; depth: number; lean: number; width: number; entry: number; exit: number;
  period: number; strength: number;
}
export const KNIT_CYCLE_KEYS = ['rows', 'stitches', 'resolution', 'radius', 'spacing', 'height', 'depth', 'lean',
  'width', 'entry', 'exit', 'period', 'strength'] as const;
export function isKnitCycleSpec(value: Record<string, unknown>): boolean {
  if (!KNIT_CYCLE_KEYS.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))) return false;
  const s = value as unknown as KnitCycleSpec;
  return Number.isInteger(s.rows) && s.rows >= 2 && s.rows <= 32 && Number.isInteger(s.stitches) && s.stitches >= 8 && s.stitches <= 64
    && Number.isInteger(s.resolution) && s.resolution >= 8 && s.resolution <= 64
    && s.radius > 0 && s.radius <= 10 && s.spacing >= 0.001 && s.spacing <= 1 && s.height >= 0 && s.height <= 1
    && s.radius > s.depth && s.depth >= 0 && s.depth <= 1 && s.lean >= 0 && s.lean <= 3
    && s.width >= 0.05 && s.width <= 0.6 && s.entry >= 0.01 && s.exit >= 0.01 && s.entry + s.exit <= s.width
    && s.period >= 0.2 && s.period <= 20 && s.strength >= 0 && s.strength <= 100;
}
const TAU = Math.PI * 2;
const ease = (v: number) => { const x = Math.max(0, Math.min(1, v)); return x * x * x * (10 + x * (-15 + 6 * x)); };
const patchWeight = (s: KnitCycleSpec, turn: number) => ease((turn + s.width / 2) / s.entry) * ease((s.width / 2 - turn) / s.exit);
function stitchWeight(s: KnitCycleSpec, material: number, time: number): number {
  const center = (Math.floor(material * s.stitches) + 0.5 + time / s.period) / s.stitches;
  return patchWeight(s, center - Math.floor(center + 0.5));
}

/** Four-dimensional guide sample: XYZ and a soft attachment weight. No positions are teleported.
 * Stockinette heads and legs belong to material coordinates; only the spatial forming window
 * stays still. Both windows are evaluated at the same forward simulation time.
 */
function rawCycleTarget(s: KnitCycleSpec, material: number, row: number, time: number, warpedTurn: number, out: Float64Array | number[]) {
  const q = material + time / (s.period * s.stitches), turn = q - Math.floor(q + 0.5);
  const weight = patchWeight(s, turn);
  const cell = s.stitches * material, u = cell - Math.floor(cell);
  const shape = [0, 0, 0];
  // One physical draw-through phase for the WHOLE stitch. Sampling a different
  // phase at every point sheared the head through its own legs at the window edge.
  drawThroughProfile(row, u, 1 - stitchWeight(s, material, time), shape);
  const pitch = TAU * s.radius / s.stitches;
  const angle = Math.PI - TAU * warpedTurn - shape[0] * pitch / DRAW_PROFILE_SIZE.width / s.radius * s.lean / DRAW_PROFILE_SIZE.lean;
  const radius = s.radius + weight * s.depth + shape[2] * s.depth / DRAW_PROFILE_SIZE.depth;
  const across = (row - (s.rows - 1) / 2) * s.spacing + weight * s.height + shape[1] * s.height / DRAW_PROFILE_SIZE.height;
  out[0] = radius * Math.cos(angle); out[1] = radius * Math.sin(angle); out[2] = across;
  out[3] = 0.85;

}

/** Arc-length guides keep feed uniform through straight rails and long stitch loops.
 * A periodic guide table retains the individual draw-through shape of each yarn. It is shared by CPU/GPU.
 * It describes needle targets, not baked simulation positions: contacts still solve afterwards.
 */
export const CYCLE_GUIDE_POINTS = 1024;
export const CYCLE_GUIDE_PHASES = 64;
const guideTables = new Map<string, Float32Array>();
const guideSpecs = new WeakMap<KnitCycleSpec, Float32Array>();
export function knitCycleGuideTable(s: KnitCycleSpec): Float32Array {
  const direct = guideSpecs.get(s);
  if (direct) return direct;
  const key = JSON.stringify(s), cached = guideTables.get(key);
  if (cached) { guideSpecs.set(s, cached); return cached; }
  const n = CYCLE_GUIDE_POINTS, phases = CYCLE_GUIDE_PHASES, dense = Math.max(4096, s.stitches * 128);
  const table = new Float32Array(s.rows * n * phases * 4), samples = new Float64Array((dense + 1) * 4), arcs = new Float64Array(dense + 1);
  const point = new Float64Array(4);
  const warp = new Float64Array(dense + 1);
  for (let row = 0; row < s.rows; row++) for (let frame = 0; frame < phases; frame++) {
    const time = frame / phases * s.period;
    // Allocate the measured long chord to opening/closing stitches, then distribute
    // the remaining circumference over the return. The patch centre stays fixed.
    warp[0] = 0;
    for (let i = 1; i <= dense; i++) {
      const material = (i - 0.5) / dense - 0.5 - time / (s.period * s.stitches);
      const weight = stitchWeight(s, material, time);
      const stretch = 1 + (drawThroughSpan(1 - weight) - 1) * ease(weight / 0.15);
      warp[i] = warp[i - 1] + stretch;
    }
    const centre = warp[dense / 2], perimeter = warp[dense];
    for (let i = 0; i <= dense; i++) {
      rawCycleTarget(s, i / dense - 0.5 - time / (s.period * s.stitches), row, time, (warp[i] - centre) / perimeter, point);
      samples.set(point, i * 4);
      if (i) arcs[i] = arcs[i - 1] + Math.hypot(samples[i*4] - samples[(i-1)*4], samples[i*4+1] - samples[(i-1)*4+1], samples[i*4+2] - samples[(i-1)*4+2]);
    }
    for (let i = 0, cursor = 0; i < n; i++) {
      const distance = i / n * arcs[dense];
      while (cursor < dense - 1 && arcs[cursor + 1] < distance) cursor++;
      const span = arcs[cursor + 1] - arcs[cursor], blend = span > 0 ? (distance - arcs[cursor]) / span : 0;
      for (let axis = 0; axis < 4; axis++) table[((row * phases + frame) * n + i) * 4 + axis] = samples[cursor*4+axis] + blend * (samples[(cursor+1)*4+axis] - samples[cursor*4+axis]);
    }
  }
  guideTables.set(key, table); guideSpecs.set(s, table);
  while (guideTables.size > 4) guideTables.delete(guideTables.keys().next().value!);
  return table;
}
export function knitCycleTarget(s: KnitCycleSpec, material: number, row: number, time: number, out: Float64Array | number[]) {
  const table = knitCycleGuideTable(s), n = CYCLE_GUIDE_POINTS, phases = CYCLE_GUIDE_PHASES;
  const clock = time / s.period, phase = ((clock % 1) + 1) % 1 * phases;
  const p0 = Math.floor(phase), p1 = (p0 + 1) % phases, mixTime = phase - p0;
  const u = ((material + clock / s.stitches) % 1 + 1) % 1 * n, i0 = Math.floor(u), i1 = (i0 + 1) % n, mixArc = u - i0;
  const base = row * phases * n * 4;
  for (let axis = 0; axis < 4; axis++) {
    const a = table[base + (p0*n+i0)*4+axis], b = table[base + (p0*n+i1)*4+axis];
    const c = table[base + (p1*n+i0)*4+axis], d = table[base + (p1*n+i1)*4+axis];
    out[axis] = (a + (b-a)*mixArc)*(1-mixTime) + (c + (d-c)*mixArc)*mixTime;
  }
}

/** Initial closed material curves for the driven rod solve. */
export function knitCycleCurves(s: KnitCycleSpec): CurveSet {
  const segments = s.stitches * s.resolution, count = segments + 1, sample = new Float64Array(4);
  const positions = new Float32Array(s.rows * count * 3), starts = new Uint32Array(s.rows), counts = new Uint32Array(s.rows).fill(count);
  for (let row = 0; row < s.rows; row++) {
    const start = row * count; starts[row] = start;
    for (let point = 0; point < segments; point++) {
      knitCycleTarget(s, point / segments, row, 0, sample);
      positions.set(sample.subarray(0, 3), (start + point) * 3);
    }
    positions.set(positions.subarray(start * 3, start * 3 + 3), (start + segments) * 3);
  }
  return { positions, starts, counts };
}
