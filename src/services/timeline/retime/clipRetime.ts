import { initializeClipWarp } from './clipWarpInitialization';
import { hasValidWarpPoints, sampleWarp } from './clipWarp';
import type { TimelineClip } from '../../../types/timeline';
import type { Keyframe } from '../../../types/keyframes';
import { calculateSourceTime, getSpeedAtTime } from '../../../utils/speedIntegration';
import { isVideoInspectorSectionEnabled } from '../../videoInspector/sectionBypass';
import { slitScanPlaybackFactor } from '../../../effects/time/slit-scan/timeFactor';
import { resolveTransitionSourceMapTime } from '../transitionSourceMap';

/**
 * Video retime contract (seconds, clip-local input): transitionSourceMap > finite
 * transitionSourceTimeOverride > transitionSourceHold > timeRemap > signed speed integration.
 * Speed starts at inPoint when speedAt(0) >= 0, otherwise outPoint, then clamps
 * start + integrate(local) to the trim window. Loop adds phase and wraps that
 * value into [inPoint, outPoint) instead. `reversed` mirrors that result as
 * inPoint + outPoint - sourceTime and negates its signed rate (constant-speed XOR).
 * Resolved transition maps, overrides and holds are absolute source requests and
 * are never mirrored again. Map copies already carry reversed:false.
 * Store adapters preserve the existing integrator, keyframe holds, speed-section
 * bypass and Slit Scan clock factor. Visual quantization belongs to the caller.
 * This module reads values only; it never mutates timeline or project state.
 */
export interface SpeedSource {
  speedAt(local: number): number;
  integrate(local: number): number;
}

export type ClipRetimeTiming = Pick<TimelineClip, 'inPoint' | 'outPoint'> &
  Partial<Pick<TimelineClip, 'speed' | 'reversed' | 'duration' | 'effects' |
    'videoInspectorSections' | 'transitionSourceMap' | 'transitionSourceTimeOverride' |
    'transitionSourceHold' | 'timeRemap' | 'source'>> & { keyframes?: readonly Keyframe[] };

export interface ClipRetimeSample {
  sourceTime: number;
  sourceRate: number;
  isHold: boolean;
  mirrored: boolean;
  /** True when the unmirrored speed result exceeded the trim window. */
  clamped: boolean;
  /** Raw loop offset lies outside the canonical half-open cycle (not a hold). */
  wrapped?: boolean;
  /** Runtime-only bounds for video frame selection; exact timing stays unchanged. */
  frameDomain?: { min: number; max: number; wrap: boolean };
}

export interface StoreSpeedPrimitives {
  getInterpolatedSpeed(clipId: string, local: number): number;
  getSourceTimeForClip(clipId: string, local: number): number;
}

/** Decoder direction follows the resolved clock, including timeline reversal. */
export function isReverseVideoPlayback(sample: Pick<ClipRetimeSample, 'sourceRate'>, playbackSpeed = 1): boolean {
  return sample.sourceRate * playbackSpeed < 0;
}

/** Conservative admission for muted, free-running preplay; never cross a wrap/turn/hold. */
export function isUnitRateSourceWindow(clip: ClipRetimeTiming, start: number, end: number,
  speedSource: SpeedSource = createClipSpeedSource(clip)): boolean {
  if (end <= start || clip.transitionSourceMap) return false;
  const times = [start, end, (start + end) / 2];
  if (clip.timeRemap?.kind === 'warp') {
    if (!hasValidWarpPoints(clip.timeRemap.points)) return false;
    times.push(...clip.timeRemap.points.filter(point => point.time > start && point.time < end).map(point => point.time));
  }
  if (times.some(time => Math.abs(resolveClipSourceTime(clip, time, speedSource).sourceRate - 1) > 1e-8)) return false;
  const window = resolveClipSourceWindow(clip, start, end, speedSource);
  return Math.abs(window.sourceEnd - window.sourceStart - (end - start)) < 1e-8 &&
    Math.abs(window.minSourceTime - window.sourceStart) < 1e-8 &&
    Math.abs(window.maxSourceTime - window.sourceEnd) < 1e-8;
}

export function createStoreSpeedSource(clipId: string, store: StoreSpeedPrimitives): SpeedSource {
  return {
    speedAt: local => store.getInterpolatedSpeed(clipId, local),
    integrate: local => store.getSourceTimeForClip(clipId, local),
  };
}

type KnownSpeedSource = SpeedSource & { constantRate?: number };

/** Plain clips default to constant speed; snapshots may explicitly supply keyframes. */
export function createClipSpeedSource(
  clip: ClipRetimeTiming,
  keyframes: readonly Keyframe[] = clip.keyframes ?? [],
): SpeedSource {
  const enabled = isVideoInspectorSectionEnabled(clip.videoInspectorSections, 'speedChange');
  const keys = [...keyframes];
  const speed = clip.speed ?? 1;
  const clockClip = { effects: clip.effects ?? [] };
  const factorAt = (local: number) => slitScanPlaybackFactor(clockClip, keys, local);
  const source: KnownSpeedSource = {
    speedAt: local => {
      const factor = factorAt(local);
      return (enabled ? getSpeedAtTime(keys, local * factor, speed) : 1) * factor;
    },
    integrate: local => {
      const clockTime = local * factorAt(local);
      return enabled ? calculateSourceTime(keys, clockTime, speed) : clockTime;
    },
  };
  if (keys.length === 0) source.constantRate = source.speedAt(0);
  return source;
}

export function resolveClipSourceTime(
  clip: ClipRetimeTiming,
  localTime: number,
  speedSource: SpeedSource = createClipSpeedSource(clip),
): ClipRetimeSample {
  const mapped = resolveTransitionSourceMapTime(clip.transitionSourceMap, localTime);
  if (mapped) return { ...mapped, mirrored: false, clamped: false };
  if (Number.isFinite(clip.transitionSourceTimeOverride)) {
    return { sourceTime: clip.transitionSourceTimeOverride!, sourceRate: 0,
      isHold: true, mirrored: false, clamped: false };
  }
  if (clip.transitionSourceHold) {
    return { sourceTime: clip.inPoint, sourceRate: 0,
      isHold: true, mirrored: false, clamped: false };
  }
  if (clip.timeRemap?.kind === 'freeze') {
    const requested = Number.isFinite(clip.timeRemap.sourceTime) ? clip.timeRemap.sourceTime : clip.inPoint;
    const domainEnd = clip.source?.naturalDuration;
    const upper = Number.isFinite(domainEnd) && domainEnd! >= 0 ? domainEnd! : Math.max(0, clip.outPoint);
    const sourceTime = Math.max(0, Math.min(upper, requested));
    return { sourceTime, sourceRate: 0, isHold: true, mirrored: false, clamped: sourceTime !== requested };
  }
  if (clip.timeRemap?.kind === 'warp' && hasValidWarpPoints(clip.timeRemap.points)) {
    const requested = sampleWarp(clip.timeRemap.points, localTime);
    const domainEnd = clip.source?.naturalDuration;
    const upper = Number.isFinite(domainEnd) && domainEnd! >= 0 ? domainEnd! : Math.max(0, clip.outPoint);
    const sourceTime = Math.max(0, Math.min(upper, requested.sourceTime));
    const clamped = sourceTime !== requested.sourceTime;
    const isHold = clamped || requested.sourceRate === 0 || upper === 0 ||
      (sourceTime === 0 && requested.sourceRate < 0) || (sourceTime === upper && requested.sourceRate > 0);
    return { sourceTime, sourceRate: isHold ? 0 : requested.sourceRate, isHold, mirrored: false, clamped,
      frameDomain: { min: 0, max: upper, wrap: false } };
  }
  const start = speedSource.speedAt(0) >= 0 ? clip.inPoint : clip.outPoint;
  const raw = start + speedSource.integrate(localTime);
  if (clip.timeRemap?.kind === 'loop') {
    const cycle = clip.outPoint - clip.inPoint;
    if (!(cycle > 0)) return { sourceTime: clip.inPoint, sourceRate: 0,
      isHold: true, mirrored: false, clamped: false, wrapped: false };
    const phase = Number.isFinite(clip.timeRemap.phase) ? clip.timeRemap.phase! : 0;
    const offset = raw + phase - clip.inPoint;
    const wrappedTime = clip.inPoint + ((offset % cycle) + cycle) % cycle;
    const rate = speedSource.speedAt(localTime);
    const mirrored = clip.reversed === true;
    return { sourceTime: mirrored ? clip.inPoint + clip.outPoint - wrappedTime : wrappedTime,
      sourceRate: mirrored ? -rate : rate, isHold: rate === 0, mirrored, clamped: false,
      wrapped: offset < 0 || offset >= cycle,
      frameDomain: { min: clip.inPoint, max: clip.outPoint, wrap: true } };
  }
  const bounded = Math.max(clip.inPoint, Math.min(clip.outPoint, raw));
  const clamped = bounded !== raw;
  const rate = speedSource.speedAt(localTime);
  const isHold = clamped || rate === 0 || clip.inPoint === clip.outPoint ||
    (raw === clip.inPoint && rate < 0) || (raw === clip.outPoint && rate > 0);
  const mirrored = clip.reversed === true;
  const sourceRate = isHold ? 0 : mirrored ? -rate : rate;
  const sourceTime = mirrored ? clip.inPoint + clip.outPoint - bounded : bounded;
  return {
    sourceTime,
    sourceRate,
    isHold, mirrored, clamped,
    frameDomain: { min: clip.inPoint, max: clip.outPoint, wrap: false },
  };
}

/** Far below one frame at any supported rate; only moves exact frame-boundary samples. */
export const BACKWARD_FRAME_EPSILON = 1e-5;

/**
 * Source time used to pick a VIDEO frame. Output frames are half-open [t, t + 1/fps);
 * played backward they cover the source interval (s - d, s], so an exact boundary
 * sample must select the source frame left of s, not the frame starting at s.
 * Timing math (audio, split, trim, inverse) keeps the exact contract time.
 */
export function videoFrameSourceTime(sample: Pick<ClipRetimeSample, 'sourceTime' | 'sourceRate' | 'frameDomain'>, floor = 0): number {
  const requested = sample.sourceTime - (sample.sourceRate < 0 ? BACKWARD_FRAME_EPSILON : 0);
  const domain = sample.frameDomain;
  if (domain?.wrap && domain.max > domain.min) {
    const cycle = domain.max - domain.min;
    let wrapped = requested >= domain.min && requested < domain.max ? requested
      : domain.min + ((requested - domain.min) % cycle + cycle) % cycle;
    // A tiny negative remainder can round up to exactly max; keep the half-open cycle.
    if (wrapped >= domain.max) wrapped = domain.min;
    // Apply the caller's floor after wrapping; it never changes the loop period.
    return Math.max(floor < domain.max ? floor : domain.min, wrapped);
  }
  return sample.sourceRate < 0 ? Math.max(floor, domain?.min ?? floor, requested) : requested;
}

/**
 * Conservative prefetch bounds, including interior direction changes and jumps.
 * Two callbacks cannot prove extrema of an arbitrary speed curve: unknown curves
 * cover the full trim window; maps cover their full source domain. Constant clips
 * get tight endpoint bounds. sourceStart/sourceEnd retain requested time order.
 */
export function resolveClipSourceWindow(
  clip: ClipRetimeTiming,
  localStart: number,
  localEnd: number,
  speedSource: SpeedSource = createClipSpeedSource(clip),
) {
  const sourceStart = resolveClipSourceTime(clip, localStart, speedSource).sourceTime;
  const sourceEnd = resolveClipSourceTime(clip, localEnd, speedSource).sourceTime;
  let minSourceTime = Math.min(sourceStart, sourceEnd);
  let maxSourceTime = Math.max(sourceStart, sourceEnd);
  if (localStart !== localEnd) {
    const map = clip.transitionSourceMap;
    if (map && resolveTransitionSourceMapTime(map, localStart)) {
      const bounds = map.version === 2 ? [0, map.mediaDuration] : map.segments.flatMap(segment =>
        segment.kind === 'hold' ? [segment.sourceTime] : [segment.sourceStart, segment.sourceEnd]);
      minSourceTime = Math.min(minSourceTime, ...bounds);
      maxSourceTime = Math.max(maxSourceTime, ...bounds);
    } else if (!Number.isFinite(clip.transitionSourceTimeOverride) && !clip.transitionSourceHold &&
      clip.timeRemap?.kind === 'warp' && hasValidWarpPoints(clip.timeRemap.points)) {
      for (const point of clip.timeRemap.points) {
        if (point.time > Math.min(localStart, localEnd) && point.time < Math.max(localStart, localEnd)) {
          const value = resolveClipSourceTime(clip, point.time, speedSource).sourceTime;
          minSourceTime = Math.min(minSourceTime, value);
          maxSourceTime = Math.max(maxSourceTime, value);
        }
      }
    } else if (!Number.isFinite(clip.transitionSourceTimeOverride) && !clip.transitionSourceHold && clip.timeRemap?.kind !== 'freeze' &&
      !(clip.timeRemap?.kind === 'loop' && clip.outPoint <= clip.inPoint) &&
      ((speedSource as KnownSpeedSource).constantRate === undefined ||
        (clip.timeRemap?.kind === 'loop' && clip.outPoint > clip.inPoint && (() => {
          const cycle = clip.outPoint - clip.inPoint;
          const start = speedSource.speedAt(0) >= 0 ? 0 : cycle;
          const phase = Number.isFinite(clip.timeRemap.phase) ? clip.timeRemap.phase! : 0;
          return Math.floor((start + phase + speedSource.integrate(localStart)) / cycle) !==
            Math.floor((start + phase + speedSource.integrate(localEnd)) / cycle);
        })()))) {
      minSourceTime = Math.min(minSourceTime, clip.inPoint);
      maxSourceTime = Math.max(maxSourceTime, clip.outPoint);
    }
  }
  return { sourceStart, sourceEnd, minSourceTime, maxSourceTime };
}

/** Constant-speed inverse only. Callers with external keyframes must exclude them. */
export function clipSourceTimeToLocal(clip: ClipRetimeTiming, sourceTime: number): number | undefined {
  if (clip.transitionSourceMap || Number.isFinite(clip.transitionSourceTimeOverride) ||
    clip.transitionSourceHold || clip.timeRemap?.kind === 'freeze' || clip.timeRemap?.kind === 'loop' || clip.timeRemap?.kind === 'warp' || clip.keyframes?.length || !Number.isFinite(sourceTime) ||
    sourceTime < clip.inPoint || sourceTime > clip.outPoint || clip.inPoint === clip.outPoint) return undefined;
  const rate = createClipSpeedSource(clip).speedAt(0);
  if (!Number.isFinite(rate) || rate === 0) return undefined;
  const unmirrored = clip.reversed ? clip.inPoint + clip.outPoint - sourceTime : sourceTime;
  const start = rate >= 0 ? clip.inPoint : clip.outPoint;
  const local = (unmirrored - start) / rate;
  if (local < 0 || (clip.duration !== undefined && local > clip.duration)) return undefined;
  const end = rate >= 0 ? clip.outPoint : clip.inPoint;
  if (unmirrored === end && clip.duration !== undefined && local < clip.duration) return undefined;
  return local;
}

/** Frame-aware conversion; throws before mutation if the 256-point budget cannot preserve the clock. */
export function createIdentityClipWarp(clip: ClipRetimeTiming & { duration: number },
  source: SpeedSource = createClipSpeedSource(clip), frameRate = 30): Extract<NonNullable<TimelineClip['timeRemap']>, { kind: 'warp' }> {
  return initializeClipWarp(clip, source, time => resolveClipSourceTime(clip, time, source), frameRate);
}
