import type { PlanarTrack, SurfacePoint, SurfaceQuad, SurfaceSample } from '../../types/planarTracking';

export function quadArea(q: SurfaceQuad): number {
  return q.reduce((sum, p, i) => sum + p.x * q[(i + 1) % 4].y - p.y * q[(i + 1) % 4].x, 0) / 2;
}

export function validQuad(q: SurfaceQuad): boolean {
  if (q.length !== 4 || q.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  const crosses = q.map((p, i) => {
    const b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    return (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x);
  });
  return Math.abs(quadArea(q)) > 0.00001 && (crosses.every(c => c > 0) || crosses.every(c => c < 0));
}

export function mixQuad(a: SurfaceQuad, b: SurfaceQuad, t: number): SurfaceQuad {
  return a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * t, y: p.y + (b[i].y - p.y) * t })) as SurfaceQuad;
}

/** No extrapolation: an untracked part of a shot must never look tracked. */
export function sampleSurface(track: PlanarTrack, time: number): SurfaceSample | null {
  const samples = track.samples;
  if (!samples.length || !Number.isFinite(time)) return null;
  let lo = 0, hi = samples.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (samples[m].time <= time + 0.6e-6) lo = m + 1; else hi = m; }
  const sample = samples[lo - 1];
  if (!sample) return null;
  const duration = sample.duration && sample.duration > 0 ? sample.duration : 1 / track.fps;
  return time < sample.time + duration - 0.6e-6 ? sample : null;
}

export function sampleOcclusion(track: PlanarTrack, time: number): SurfaceQuad | null {
  const keys = track.occlusions;
  const next = keys.findIndex(k => k.time > time);
  const a = next === -1 ? keys.at(-1) : keys[next - 1];
  if (!a?.quad) return null;
  const b = next === -1 ? undefined : keys[next];
  return b?.quad ? mixQuad(a.quad, b.quad, (time - a.time) / (b.time - a.time)) : a.quad;
}

export function replaceSamples(track: PlanarTrack, samples: SurfaceSample[], from: number, to: number): PlanarTrack {
  const retained = track.samples.filter(s => s.time < from - (s.duration === undefined ? 0.25 / track.fps : 0.6e-6) || s.time > to + (s.duration === undefined ? 0.25 / track.fps : 0.6e-6));
  return { ...track, samples: [...retained, ...samples].toSorted((a, b) => a.time - b.time) };
}

/** Unit square -> quadrilateral, row-major projective matrix. */
export function quadMatrix(q: SurfaceQuad): number[] {
  const [a, b, c, d] = q;
  const dx = a.x - b.x + c.x - d.x, dy = a.y - b.y + c.y - d.y;
  const ux = b.x - c.x, uy = b.y - c.y, vx = d.x - c.x, vy = d.y - c.y;
  const det = ux * vy - vx * uy;
  const g = Math.abs(det) < 1e-12 ? 0 : (dx * vy - vx * dy) / det;
  const h = Math.abs(det) < 1e-12 ? 0 : (ux * dy - dx * uy) / det;
  return [b.x - a.x + g * b.x, d.x - a.x + h * d.x, a.x,
    b.y - a.y + g * b.y, d.y - a.y + h * d.y, a.y, g, h, 1];
}

export function inverseMatrix(m: number[]): number[] | null {
  const [a,b,c,d,e,f,g,h,i] = m;
  const r = [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
  const det = a*r[0]+b*r[3]+c*r[6];
  return Math.abs(det) < 1e-12 ? null : r.map(v => v / det);
}

export function projectPoint(m: number[], p: SurfacePoint): SurfacePoint {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0]*p.x+m[1]*p.y+m[2])/w, y: (m[3]*p.x+m[4]*p.y+m[5])/w };
}
