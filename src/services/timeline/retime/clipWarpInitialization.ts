import type { ClipRetimeSample, ClipRetimeTiming, SpeedSource } from './clipRetime';
import type { ClipWarp, WarpPoint } from './clipWarp';
import { sanitizeTimelineFrameRate } from '../../../utils/timelineFrameQuantization';

const MAX_POINTS = 256;
const FRAME_BIAS = 1e-5;
type Seam = { start: number; end: number };

/** No partial conversion when the requested accuracy exceeds the durable point budget. */
export class WarpInitializationError extends Error {
  constructor() { super('This source clock needs more than 256 Warp points to preserve its frames.'); }
}

/** Approximate the current clock, not the retained speed fields behind Freeze/Loop. */
export function initializeClipWarp(
  clip: ClipRetimeTiming & { duration: number }, source: SpeedSource,
  sampleAt: (time: number) => ClipRetimeSample, requestedFrameRate: number,
): ClipWarp {
  const fps = sanitizeTimelineFrameRate(requestedFrameRate), frame = 1 / fps;
  const duration = clip.duration;
  if (!(duration > 0 && Number.isFinite(duration))) throw new WarpInitializationError();
  // An exact wrap has two equivalent boundary coordinates. Use the side actually
  // displayed by the half-open video sampler before losing Loop's wrap metadata.
  const valueAt = (time: number) => {
    const sample = sampleAt(time), domain = sample.frameDomain;
    if (domain?.wrap && domain.max > domain.min) {
      if (sample.sourceRate < 0 && sample.sourceTime <= domain.min) return domain.max;
      if (sample.sourceRate >= 0 && sample.sourceTime >= domain.max) return domain.min;
    }
    return sample.sourceTime;
  };
  const loop = clip.timeRemap?.kind === 'loop' && !clip.transitionSourceMap &&
    !Number.isFinite(clip.transitionSourceTimeOverride) && !clip.transitionSourceHold && clip.outPoint > clip.inPoint;
  const seams: Seam[] = [];
  const points = new Map<number, number>([[0, valueAt(0)], [duration, valueAt(duration)]]);
  if (!clip.transitionSourceMap && (Number.isFinite(clip.transitionSourceTimeOverride) ||
    clip.transitionSourceHold || clip.timeRemap?.kind === 'freeze'))
    return { kind: 'warp', points: [...points].map(([time, source]) => ({ time, source })) };
  const addSeam = (time: number) => {
    if (time < 1e-9 || time > duration) return;
    // Put the ramp between adjacent output samples, including non-grid loop periods.
    const end = Math.min(duration, Math.ceil(time * fps - 1e-8) / fps);
    const start = Math.max(0, end - frame);
    if (seams.some(seam => Math.abs(seam.end - end) < 1e-9)) throw new WarpInitializationError();
    seams.push({ start, end });
    const a = valueAt(start), b = valueAt(end), original = sampleAt(start);
    // The seam reverses the segment slope. Compensate only frame selection at its
    // first output sample, so the one-frame bridge does not select the adjacent frame.
    points.set(start, a + (b < a ? FRAME_BIAS : 0) - (original.sourceRate < 0 ? FRAME_BIAS : 0));
    points.set(end, b);
    if (points.size > MAX_POINTS) throw new WarpInitializationError();
  };
  const constant = (source as SpeedSource & { constantRate?: number }).constantRate;
  const ordinary = !clip.transitionSourceMap && !Number.isFinite(clip.transitionSourceTimeOverride) &&
    !clip.transitionSourceHold && !clip.timeRemap;
  if (ordinary && constant !== undefined) {
    const hit = constant === 0 ? Infinity : (clip.outPoint - clip.inPoint) / Math.abs(constant);
    // in/out/duration round independently; a crossing within 1 ns of the end is the endpoint itself.
    if (hit > 1e-9 && hit < duration - 1e-9) points.set(hit, valueAt(hit));
    return { kind: 'warp', points: [...points].toSorted((a, b) => a[0] - b[0]).map(([time, source]) => ({ time, source })) };
  }
  if (loop) {
    const cycle = clip.outPoint - clip.inPoint;
    const phase = clip.timeRemap?.kind === 'loop' && Number.isFinite(clip.timeRemap.phase) ? clip.timeRemap.phase! : 0;
    const offset = (time: number) => ((source.speedAt(0) < 0 ? cycle : 0) + phase + source.integrate(time)) / cycle;
    if (constant !== undefined) {
      if (constant !== 0) {
        const a = offset(0), b = offset(duration);
        for (let boundary = Math.ceil(Math.min(a, b)); boundary <= Math.floor(Math.max(a, b)); boundary++)
          addSeam(Math.max(0, Math.min(duration, (boundary - a) * cycle / constant)));
      }
      return { kind: 'warp', points: [...points].toSorted((a, b) => a[0] - b[0]).map(([time, source]) => ({ time, source })) };
    }
    // Quarter-frame bracketing also handles sign changes; multiple seams inside a
    // single output frame cannot be represented by one-frame bridges and are rejected.
    const steps = Math.ceil(duration * fps * 4);
    const boundaries = new Set([0, duration]);
    for (let i = 1; i < steps; i++) boundaries.add(i * duration / steps);
    for (const key of clip.keyframes ?? []) if (key.time > 0 && key.time < duration) boundaries.add(key.time);
    const times = [...boundaries].toSorted((a, b) => a - b);
    for (let i = 0; i < times.length - 1; i++) {
      const a = times[i], b = times[i + 1];
      const x = offset(a), y = offset(b);
      const bucket = (time: number, value: number) => Math.floor(value -
        (source.speedAt(time) < 0 && Math.abs(value - Math.round(value)) < 1e-10 ? 1e-10 : 0));
      if (bucket(a, x) === bucket(b, y)) continue;
      if (Math.abs(bucket(b, y) - bucket(a, x)) > 1) throw new WarpInitializationError();
      const target = y > x ? Math.floor(y) : Math.floor(x);
      let low = a, high = b;
      for (let k = 0; k < 45; k++) {
        const mid = (low + high) / 2;
        if ((offset(mid) < target) === (y > x)) low = mid; else high = mid;
      }
      addSeam((low + high) / 2);
    }
  }
  // Probe at quarter-frame resolution as well as authored knot times. Adaptive
  // subdivision retains only points needed by the curve, including short holds.
  const samples = new Map<number, number>();
  const count = Math.ceil(duration * fps * 4);
  for (let i = 0; i <= count; i++) {
    const time = Math.min(duration, i / (fps * 4));
    if (!seams.some(seam => time > seam.start - 1e-9 && time < seam.end + 1e-9)) samples.set(time, valueAt(time));
  }
  const knots = [...new Set([0, duration, ...(clip.keyframes ?? []).map(key => key.time)
    .filter(time => time > 0 && time < duration)])].toSorted((a, b) => a - b);
  for (let i = 0; i < knots.length - 1; i++) {
    for (let quarter = 0; quarter < 4; quarter++) {
      const time = knots[i] + (knots[i + 1] - knots[i]) * quarter / 4;
      if (!seams.some(seam => time >= seam.start && time <= seam.end)) samples.set(time, valueAt(time));
    }
  }
  samples.set(duration, valueAt(duration));
  const probes = [...samples].toSorted((a, b) => a[0] - b[0]);
  const tolerance = 0.25 / fps; // Safety margin below the requested half-frame bound.
  while (true) {
    const ordered = [...points].toSorted((a, b) => a[0] - b[0]);
    let worst = tolerance, candidate: WarpPoint | undefined, segment = 0;
    for (const [time, value] of probes) {
      while (segment + 2 < ordered.length && time >= ordered[segment + 1][0]) segment++;
      const [a, x] = ordered[segment], [b, y] = ordered[segment + 1];
      const error = Math.abs(value - (x + (y - x) * (time - a) / (b - a)));
      if (error > worst) { worst = error; candidate = { time, source: value }; }
    }
    if (!candidate) return { kind: 'warp', points: ordered.map(([time, source]) => ({ time, source })) };
    if (points.size >= MAX_POINTS) throw new WarpInitializationError();
    points.set(candidate.time, candidate.source);
  }
}
