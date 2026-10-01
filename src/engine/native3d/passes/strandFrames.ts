import type { CurveSet } from '../../../services/operators/geometry/geometryEvaluation';

/** Floats per point in the strand point buffer: position, arc length, frame normal, radius scale, tangent, strand index. */
export const STRAND_POINT_FLOATS = 12;

/**
 * Packs render data per point: [x, y, z, arcLength, nx, ny, nz, radiusScale, tx, ty, tz, strand]. Normals are
 * rotation-minimizing frames (double reflection, Wang et al. 2008), so yarn twist driven by arc
 * length does not pick up spurious rotation where a curve bends.
 */
export function packStrandPoints(curves: CurveSet): Float32Array {
  const { positions, starts, counts, radius } = curves;
  const packed = new Float32Array((positions.length / 3) * STRAND_POINT_FLOATS);
  // Scratch vectors; the arithmetic matches the reference formulation term for term.
  let tangents = new Float64Array(0);
  for (let strand = 0; strand < counts.length; strand++) {
    const start = starts[strand], count = counts[strand];
    if (tangents.length < count * 3) tangents = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      const previous = (start + Math.max(0, i - 1)) * 3, next = (start + Math.min(count - 1, i + 1)) * 3;
      const x = positions[next] - positions[previous], y = positions[next + 1] - positions[previous + 1], z = positions[next + 2] - positions[previous + 2];
      const length = Math.hypot(x, y, z);
      if (length > 1e-12) { tangents[i * 3] = x / length; tangents[i * 3 + 1] = y / length; tangents[i * 3 + 2] = z / length; }
      else if (i > 0) { tangents[i * 3] = tangents[i * 3 - 3]; tangents[i * 3 + 1] = tangents[i * 3 - 2]; tangents[i * 3 + 2] = tangents[i * 3 - 1]; }
      else { tangents[0] = 1; tangents[1] = 0; tangents[2] = 0; }
    }
    const fx = tangents[0], fy = tangents[1], fz = tangents[2];
    const [ax, ay, az] = Math.abs(fz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const along = ax * fx + ay * fy + az * fz;
    let nx = ax - fx * along, ny = ay - fy * along, nz = az - fz * along;
    let length = Math.hypot(nx, ny, nz);
    if (length > 1e-12) { nx /= length; ny /= length; nz /= length; } else { nx = 0; ny = 1; nz = 0; }
    let arc = 0;
    for (let i = 0; i < count; i++) {
      const index = start + i, p = index * 3, base = index * STRAND_POINT_FLOATS;
      const px = positions[p], py = positions[p + 1], pz = positions[p + 2];
      if (i > 0) {
        const v1x = px - positions[p - 3], v1y = py - positions[p - 2], v1z = pz - positions[p - 1];
        const c1 = v1x * v1x + v1y * v1y + v1z * v1z;
        arc += Math.sqrt(c1);
        if (c1 > 1e-18) {
          // Double reflection: reflect frame and tangent across the chord, then align the tangent.
          const kn = 2 * (v1x * nx + v1y * ny + v1z * nz) / c1;
          let rx = nx - kn * v1x, ry = ny - kn * v1y, rz = nz - kn * v1z;
          const tx0 = tangents[i * 3 - 3], ty0 = tangents[i * 3 - 2], tz0 = tangents[i * 3 - 1];
          const kt = 2 * (v1x * tx0 + v1y * ty0 + v1z * tz0) / c1;
          const v2x = tangents[i * 3] - (tx0 - kt * v1x), v2y = tangents[i * 3 + 1] - (ty0 - kt * v1y), v2z = tangents[i * 3 + 2] - (tz0 - kt * v1z);
          const c2 = v2x * v2x + v2y * v2y + v2z * v2z;
          if (c2 > 1e-18) {
            const k2 = 2 * (v2x * rx + v2y * ry + v2z * rz) / c2;
            rx -= k2 * v2x; ry -= k2 * v2y; rz -= k2 * v2z;
          }
          length = Math.hypot(rx, ry, rz);
          if (length > 1e-12) { nx = rx / length; ny = ry / length; nz = rz / length; }
        }
      }
      packed[base] = px; packed[base + 1] = py; packed[base + 2] = pz; packed[base + 3] = arc;
      packed[base + 4] = nx; packed[base + 5] = ny; packed[base + 6] = nz; packed[base + 7] = radius ? radius[index] : 1;
      packed[base + 8] = tangents[i * 3]; packed[base + 9] = tangents[i * 3 + 1]; packed[base + 10] = tangents[i * 3 + 2]; packed[base + 11] = strand;
    }
  }
  return packed;
}
