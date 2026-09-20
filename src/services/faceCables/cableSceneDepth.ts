import type { DepthFrame } from '../depthEstimation/depthMath';
import type { LandmarkPoint } from '../landmarkTracking/types';
import type { CablePoint } from './cablePhysics';

export interface CableDepthGrid { width: number; height: number }
export function cableDepthGrid(width: number, height: number): CableDepthGrid {
  const scale = 48 / Math.max(width, height);
  return { width: Math.max(3, Math.round(width * scale) + 1), height: Math.max(3, Math.round(height * scale) + 1) };
}
export function sampleCableDepth(values: Float32Array, grid: CableDepthGrid, u: number, v: number): number {
  const x = Math.max(0, Math.min(1, u)) * (grid.width - 1), y = Math.max(0, Math.min(1, v)) * (grid.height - 1);
  const ix = Math.min(grid.width - 2, Math.floor(x)), iy = Math.min(grid.height - 2, Math.floor(y));
  const tx = x - ix, ty = y - iy, at = iy * grid.width + ix;
  return (values[at] * (1 - tx) + values[at + 1] * tx) * (1 - ty)
    + (values[at + grid.width] * (1 - tx) + values[at + grid.width + 1] * tx) * ty;
}
export interface CableDepthCalibration { scale: number; offset: number }
/** Fit positive relative inverse depth to the tracked face, without replacing any landmarks. */
export function calibrateCableDepth(depth: DepthFrame, face: LandmarkPoint[] | undefined, points: CablePoint[] | undefined,
  sourceWidth: number, strength: number, previous?: CableDepthCalibration): CableDepthCalibration {
  const sorted = depth.values.toSorted(), low = sorted[Math.floor(sorted.length * 0.02)], high = sorted[Math.floor((sorted.length - 1) * 0.98)];
  const span = Math.max(1e-6, high - low);
  let scale = sourceWidth * 0.5 / span, offset = -high * scale;
  if (face?.length && points?.length) {
    const pairs = face.slice(0, 468).map((p, i) => [sampleCableDepth(depth.values, depth, p.x, p.y), points[i].z ?? 0]);
    const mean = pairs.reduce((sum, p) => [sum[0] + p[0] / pairs.length, sum[1] + p[1] / pairs.length], [0, 0]);
    const variance = pairs.reduce((sum, p) => sum + (p[0] - mean[0]) ** 2, 0);
    const covariance = pairs.reduce((sum, p) => sum + (p[0] - mean[0]) * (p[1] - mean[1]), 0);
    if (variance > 1e-8 && covariance > 0) scale = Math.max(sourceWidth * 0.1 / span, Math.min(sourceWidth * 2 / span, covariance / variance));
    scale *= strength;
    offset = mean[1] - mean[0] * scale;
  } else { scale *= strength; offset *= strength; }
  return previous ? { scale: previous.scale * 0.7 + scale * 0.3, offset: previous.offset * 0.7 + offset * 0.3 } : { scale, offset };
}
export function calibratedCableDepth(depth: DepthFrame, grid: CableDepthGrid, calibration: CableDepthCalibration): Float32Array {
  if (depth.values.length !== depth.width * depth.height || !depth.values.every(Number.isFinite)) throw new Error('Invalid scene depth frame.');
  return Float32Array.from({ length: grid.width * grid.height }, (_, i) => {
    const raw = sampleCableDepth(depth.values, depth, (i % grid.width) / (grid.width - 1), Math.floor(i / grid.width) / (grid.height - 1));
    // Keep the reconstructed surface behind the reference camera and bound extreme model outliers.
    return Math.max(-4, Math.min(0.8, raw * calibration.scale + calibration.offset));
  });
}
