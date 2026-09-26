import type { PlanarTrack, SurfacePoint } from '../../../types/planarTracking';
import { inverseMatrix, projectPoint, quadMatrix, sampleSurface } from '../../../services/planarTracking/surfaceGeometry';

export interface ShapeTimeCandidate { delay: number; time: number }
export interface ShapeTimeResult { values: Float32Array; errors: Float32Array; maxError: number; rmsError: number; selected: number }

/** Search recorded positions of reference-plane points. Output is delay only: never warped UVs.
 * First stage assumes predominantly straight, planar 2D motion within the selected track.
 * A bounded coordinate descent balances positional fit with neighbouring delay coherence. */
export function solveShapeTimeField(track: PlanarTrack, now: number, candidates: readonly ShapeTimeCandidate[],
  width: number, height: number, anchor: SurfacePoint, stretch: number, coherence: number): ShapeTimeResult {
  if (![now, width, height, anchor.x, anchor.y, stretch, coherence].every(Number.isFinite)
    || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16384
    || stretch < .1 || stretch > 8 || coherence < 0 || coherence > 1 || candidates.length > 128
    || candidates.some(c => !Number.isFinite(c.delay) || c.delay < 0 || !Number.isFinite(c.time))) throw new Error('Invalid shape time-field request.');
  const reference = sampleSurface(track, now);
  if (!reference || reference.confidence < .2) throw new Error('The current source frame has no reliable tracking.');
  const inverse = inverseMatrix(quadMatrix(reference.quad));
  if (!inverse) throw new Error('The tracked selection is degenerate.');
  const observed = candidates.flatMap(candidate => {
    const sample = sampleSurface(track, candidate.time);
    return sample && sample.confidence >= .2 ? [{ ...candidate, matrix: quadMatrix(sample.quad), quad: sample.quad }] : [];
  });
  if (!observed.length || !observed.some(item => item.delay === 0)) throw new Error('No recorded source times cover this selection.');
  const center = (quad: typeof reference.quad) => quad.reduce((p, v) => ({ x: p.x + v.x / 4, y: p.y + v.y / 4 }), { x: 0, y: 0 });
  const origin = center(reference.quad);
  const farthest = observed.map(item => center(item.quad)).reduce((best, p) =>
    Math.hypot(p.x - origin.x, p.y - origin.y) > Math.hypot(best.x - origin.x, best.y - origin.y) ? p : best, origin);
  const distance = Math.hypot(farthest.x - origin.x, farthest.y - origin.y);
  if (distance < 1e-5 && stretch !== 1) throw new Error('No measurable translation in this window. Increase Delay or choose a moving track.');
  const axis = distance > 0 ? { x: (farthest.x - origin.x) / distance, y: (farthest.y - origin.y) / distance } : { x: 1, y: 0 };
  const horizon = Math.max(1e-6, ...candidates.map(item => item.delay));
  const size = width * height, count = observed.length;
  const costs = new Float32Array(size * count), active = new Uint8Array(size), choices = new Uint16Array(size);
  const current = observed.findIndex(item => item.delay === 0); choices.fill(current);
  let selected = 0;
  for (let i = 0; i < size; i++) {
    const p = { x: (i % width + .5) / width, y: (Math.floor(i / width) + .5) / height };
    const along = (p.x - anchor.x) * axis.x + (p.y - anchor.y) * axis.y;
    // Inverse target: which reference material point should occupy output p?
    const material = { x: p.x + (1 / stretch - 1) * along * axis.x, y: p.y + (1 / stretch - 1) * along * axis.y };
    const local = projectPoint(inverse, material);
    if (local.x < 0 || local.x > 1 || local.y < 0 || local.y > 1) continue;
    active[i] = 1; selected++;
    for (let k = 0; k < count; k++) {
      const point = projectPoint(observed[k].matrix, local);
      costs[i * count + k] = (point.x - p.x) ** 2 + (point.y - p.y) ** 2;
    }
  }
  for (let sweep = 0; sweep < 4; sweep++) for (let step = 0; step < size; step++) {
    const i = sweep % 2 ? size - step - 1 : step;
    if (!active[i]) continue;
    if (i % width === Math.min(width - 1, Math.floor(anchor.x * width))
      && Math.floor(i / width) === Math.min(height - 1, Math.floor(anchor.y * height))) continue;
    const neighbors = [i % width ? i - 1 : -1, i % width < width - 1 ? i + 1 : -1, i - width, i + width]
      .filter(j => j >= 0 && j < size && active[j]);
    let best = current, bestCost = Infinity;
    for (let k = 0; k < count; k++) {
      const delay = observed[k].delay / horizon;
      // Tiny current-time tie-break preserves identity in stationary/repeated poses.
      let cost = costs[i * count + k] + delay * 1e-10;
      for (const j of neighbors) cost += coherence * .01 * (delay - observed[choices[j]].delay / horizon) ** 2;
      if (cost < bestCost) { bestCost = cost; best = k; }
    }
    choices[i] = best;
  }
  const values = new Float32Array(size), errors = new Float32Array(size); let maxError = 0, sum = 0;
  for (let i = 0; i < size; i++) if (active[i]) {
    values[i] = observed[choices[i]].delay / horizon;
    errors[i] = Math.sqrt(costs[i * count + choices[i]]); maxError = Math.max(maxError, errors[i]); sum += errors[i] ** 2;
  }
  return { values, errors, maxError, rmsError: Math.sqrt(sum / Math.max(1, selected)), selected };
}
