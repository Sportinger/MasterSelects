import type { CurveSet } from './geometryEvaluation';

export interface KnitSphereSpec {
  rows: number; stitches: number; resolution: number; radius: number;
  height: number; depth: number; lean: number; phase: number;
  zoneWidth: number; zoneCenter: number; zoneHeight: number; feather: number;
}

export const KNIT_SPHERE_KEYS = ['rows', 'stitches', 'resolution', 'radius', 'height', 'depth', 'lean',
  'phase', 'zoneWidth', 'zoneCenter', 'zoneHeight', 'feather'] as const;

/** Shared compiler/transport bounds, checked before allocating curve buffers. */
export function isKnitSphereSpec(value: Record<string, unknown>): boolean {
  if (!KNIT_SPHERE_KEYS.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))) return false;
  const s = value as unknown as KnitSphereSpec;
  return Number.isInteger(s.rows) && s.rows >= 2 && s.rows <= 512
    && Number.isInteger(s.stitches) && s.stitches >= 4 && s.stitches <= 512
    && Number.isInteger(s.resolution) && s.resolution >= 8 && s.resolution <= 128
    && s.radius > 0 && s.radius <= 100 && s.height >= 0 && s.height <= 100
    && s.depth >= 0 && s.depth <= 10 && s.lean >= 0 && s.lean <= 4
    && s.zoneWidth >= 0 && s.zoneWidth <= 360 && s.zoneCenter >= -1 && s.zoneCenter <= 1
    && s.zoneHeight > 0 && s.zoneHeight <= 2 && s.feather > 0 && s.feather <= 1;
}

const TAU = 2 * Math.PI;
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const wrap = (turns: number) => ((turns % 1) + 1) % 1;

/**
 * Closed latitude rings advect through a stationary oval stockinette patch at +Z. Material
 * coordinates carry the Knit waveform; the window uses spatial longitude and rest latitude.
 * Heads/legs travel through the window, smoothly form and straighten at its edges,
 * while the window stays below the equator. This is a periodic deformation, not a rod solver:
 * it does not conserve yarn length or resolve contacts during knitting/unravelling.
 */
export function knitSphereCurves(spec: KnitSphereSpec): CurveSet {
  const { rows, stitches, resolution, radius, height, depth, lean, zoneWidth, zoneCenter, zoneHeight, feather } = spec;
  const segments = stitches * resolution, count = segments + 1;
  const positions = new Float32Array(rows * count * 3);
  const starts = new Uint32Array(rows), counts = new Uint32Array(rows).fill(count);
  const phase = wrap(spec.phase), halfWidth = zoneWidth / 720;
  for (let row = 0; row < rows; row++) {
    const start = row * count;
    starts[row] = start;
    // Keep the rings away from the singular poles; all rows remain distinct closed curves.
    const latitude = -0.94 + 1.88 * row / (rows - 1);
    const rowDistance = Math.abs(latitude - zoneCenter) / (zoneHeight / 2);
    const rowWeight = smooth((1 - rowDistance) / feather);
    // Shorter courses toward the top/bottom make a bounded oval, with the entry and
    // exit edges visible on the front of the sphere instead of hidden at its silhouette.
    const rowHalfWidth = halfWidth * Math.sqrt(Math.max(0, 1 - rowDistance * rowDistance));
    for (let point = 0; point < segments; point++) {
      const material = point / segments, turn = wrap(material + phase);
      const distance = Math.min(turn, 1 - turn);
      const weight = rowHalfWidth > 0 ? rowWeight * smooth((1 - distance / rowHalfWidth) / feather) : 0;
      const t = TAU * point / resolution;
      // The same head/leg/sinker equations as Knit, mapped onto the spherical surface.
      // The entering yarn first bows, then folds back into a loop as the lean exceeds
      // its turning threshold. Leaving the patch unfolds that same sequence in reverse.
      const fold = smooth((weight - 0.15) / 0.85);
      const angle = TAU * turn + fold * lean * Math.sin(2 * t) / stitches;
      const y = Math.max(-0.98 * radius, Math.min(0.98 * radius, latitude * radius + weight * height * Math.cos(t)));
      const ringRadius = Math.sqrt(Math.max(0, radius * radius - y * y));
      const relief = weight * depth * Math.cos(2 * t);
      positions.set([(ringRadius + relief) * Math.sin(angle), y, (ringRadius + relief) * Math.cos(angle)], (start + point) * 3);
    }
    // Exact repeated endpoint: no numerical seam, including negative and wrapped phases.
    positions.set(positions.subarray(start * 3, start * 3 + 3), (start + segments) * 3);
  }
  return { positions, starts, counts };
}
