import type { LandmarkFrame, LandmarkSeries } from './types';

export const faceTrackKey = (clipId: string) => `face:${clipId}`;

/** Source PTS, not rounded FPS: preserve VFR timing and never borrow a future detection. */
export function samplePreciseFace(series: LandmarkSeries | null, time: number, smoothing = 0): LandmarkFrame | null {
  if (!series?.faceTracking || !Number.isFinite(time)) return null;
  const { sourceStart, sourceEnd } = series.faceTracking;
  if (time < sourceStart - 1e-6 || time >= sourceEnd) return null;
  const frames = series.frames;
  let lo = 0, hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].time <= time + 0.6e-6) lo = mid + 1;
    else hi = mid;
  }
  const index = lo - 1;
  const frame = frames[index];
  if (!frame || time >= frame.time + (frame.duration ?? series.sampleInterval) + 1e-6) return null;
  if (!smoothing || !frame.faces[0]?.length) return frame;
  const before = frames[index - 1], after = frames[index + 1];
  const face = frame.faces[0];
  // Symmetric, local smoothing avoids phase lag; never smooth across missing detections or cuts.
  if (!before?.faces[0]?.length || !after?.faces[0]?.length
    || before.faces[0].length !== face.length || after.faces[0].length !== face.length
    || frame.time - before.time > 0.1 || after.time - frame.time > 0.1) return frame;
  const strength = Math.max(0, Math.min(1, smoothing));
  const filtered = face.map((point, i) => {
    const prev = before.faces[0][i], next = after.faces[0][i];
    const movement = Math.max(Math.hypot(point.x - prev.x, point.y - prev.y), Math.hypot(next.x - point.x, next.y - point.y));
    const weight = 0.25 * strength * Math.max(0, 1 - movement / 0.025);
    return { ...point,
      x: point.x * (1 - 2 * weight) + (prev.x + next.x) * weight,
      y: point.y * (1 - 2 * weight) + (prev.y + next.y) * weight,
      z: point.z * (1 - 2 * weight) + (prev.z + next.z) * weight,
    };
  });
  return { ...frame, faces: [filtered] };
}
