import type { MP4VideoTrack } from '../webCodecsTypes';

export type VideoRotationDegrees = 0 | 90 | 180 | 270;

export function getVideoTrackRotation(
  track: Pick<MP4VideoTrack, 'matrix'> | null | undefined,
): VideoRotationDegrees {
  const matrix = track?.matrix;
  if (!matrix || matrix.length < 5) return 0;

  const a = Number(matrix[0]);
  const b = Number(matrix[1]);
  const c = Number(matrix[3]);
  const d = Number(matrix[4]);
  if (![a, b, c, d].every(Number.isFinite)) return 0;

  const isQuarterTurn = Math.abs(b) > Math.abs(a) && Math.abs(c) > Math.abs(d);
  if (isQuarterTurn) {
    if (b > 0 && c < 0) return 90;
    if (b < 0 && c > 0) return 270;
  }
  return a < 0 && d < 0 ? 180 : 0;
}

export function getOrientedVideoDimensions(
  width: number,
  height: number,
  rotation: VideoRotationDegrees,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
}
