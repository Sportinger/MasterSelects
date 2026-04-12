// Convert format-specific data into canonical 14-float layout
//
// Canonical layout per splat (14 floats = 56 bytes):
//   [0-2]  position  (x, y, z)
//   [3-5]  scale     (sx, sy, sz) — exp-activated
//   [6-9]  rotation  (w, x, y, z) — normalized quaternion
//   [10-12] color    (r, g, b)    — [0,1], from SH DC
//   [13]   opacity   — [0,1], sigmoid-activated

import type { GaussianSplatMetadata } from './types.ts';
import { FLOATS_PER_SPLAT } from './types.ts';

const BASIS_ROTATION_X_180: [number, number, number, number] = [0, 1, 0, 0];

/**
 * Compute bounding box from canonical splat buffer.
 * Reads positions at stride-14 offsets.
 */
export function computeBoundingBox(
  data: Float32Array,
  splatCount: number,
): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < splatCount; i++) {
    const base = i * FLOATS_PER_SPLAT;
    const x = data[base];
    const y = data[base + 1];
    const z = data[base + 2];

    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }

  // Handle empty data
  if (splatCount === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }

  return { min, max };
}

/** Sigmoid activation: 1 / (1 + exp(-x)) */
export function sigmoid(x: number): number {
  return 1.0 / (1.0 + Math.exp(-x));
}

/** Normalize a quaternion in-place and return the length */
export function normalizeQuaternion(w: number, x: number, y: number, z: number): [number, number, number, number] {
  const len = Math.sqrt(w * w + x * x + y * y + z * z);
  if (len < 1e-10) {
    return [1, 0, 0, 0]; // identity quaternion for degenerate case
  }
  const inv = 1.0 / len;
  return [w * inv, x * inv, y * inv, z * inv];
}

function multiplyQuaternions(
  aw: number,
  ax: number,
  ay: number,
  az: number,
  bw: number,
  bx: number,
  by: number,
  bz: number,
): [number, number, number, number] {
  return normalizeQuaternion(
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  );
}

/**
 * Align imported splat scenes with the editor's upright camera convention.
 * Most gaussian-splat exports arrive in an OpenCV-style basis (+Y down, +Z forward),
 * while the editor renderers assume +Y up and -Z forward.
 */
export function applyCanonicalBasisCorrection(
  data: Float32Array,
  splatCount: number,
): void {
  for (let i = 0; i < splatCount; i += 1) {
    const base = i * FLOATS_PER_SPLAT;

    data[base + 1] = -data[base + 1];
    data[base + 2] = -data[base + 2];

    const [nw, nx, ny, nz] = multiplyQuaternions(
      BASIS_ROTATION_X_180[0],
      BASIS_ROTATION_X_180[1],
      BASIS_ROTATION_X_180[2],
      BASIS_ROTATION_X_180[3],
      data[base + 6],
      data[base + 7],
      data[base + 8],
      data[base + 9],
    );
    data[base + 6] = nw;
    data[base + 7] = nx;
    data[base + 8] = ny;
    data[base + 9] = nz;
  }
}

/**
 * Build a GaussianSplatMetadata from a parsed canonical buffer.
 */
export function buildMetadata(
  format: GaussianSplatMetadata['format'],
  splatCount: number,
  boundingBox: { min: [number, number, number]; max: [number, number, number] },
  byteSize: number,
  hasSphericalHarmonics: boolean,
  shDegree: number,
): GaussianSplatMetadata {
  return {
    format,
    splatCount,
    isTemporal: false,
    frameCount: 1,
    fps: 0,
    totalDuration: 0,
    boundingBox,
    byteSize,
    perSplatByteStride: FLOATS_PER_SPLAT * 4,
    hasSphericalHarmonics,
    shDegree,
    compressionType: 'none',
  };
}
