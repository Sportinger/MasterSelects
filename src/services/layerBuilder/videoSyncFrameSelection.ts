import type { TimelineClip } from '../../types/timeline';
import type { FrameContext } from './types';
import { getMediaFileForClip } from './FrameContext';

// Runtime metadata only; also available to deferred seek callbacks without a
// stale FrameContext. Composition fps is not a substitute for source fps.
const sourceFrameRates = new WeakMap<object, number>();
const presentedFrames = new WeakMap<HTMLVideoElement, { seekTime: number; pts: number }>();

export function rememberSourceFrameRate(target: object | null | undefined, clip: TimelineClip, ctx: FrameContext): void {
  if (!target) return;
  const fps = ctx.mediaFileById && ctx.mediaFileByName ? getMediaFileForClip(ctx, clip)?.fps : undefined;
  if (fps && Number.isFinite(fps) && fps > 0) sourceFrameRates.set(target, fps);
  else sourceFrameRates.delete(target);
}

export function sameSourceFrame(actual: number, target: number, fps?: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return false;
  // Only absorb floating-point arithmetic noise, never the backward-frame bias.
  if (fps && Number.isFinite(fps) && fps > 0) {
    return Math.floor(actual * fps + 1e-9) === Math.floor(target * fps + 1e-9);
  }
  // Unknown cadence: do not declare adjacent frames equivalent using a guessed fps.
  return Math.abs(actual - target) <= 1e-7;
}

export function videoHasTargetFrame(video: HTMLVideoElement, target: number): boolean {
  const presented = presentedFrames.get(video);
  if (presented && Math.abs(presented.seekTime - video.currentTime) < 1e-7 && sourceFrameRates.has(video)) {
    return samePresentedSourceFrame(video, presented.pts, target);
  }
  return sameSourceFrame(video.currentTime, target, sourceFrameRates.get(video));
}

export function rememberPresentedSourceFrame(video: HTMLVideoElement, pts: number): void {
  if (Number.isFinite(pts)) presentedFrames.set(video, { seekTime: video.currentTime, pts });
}

export function samePresentedSourceFrame(video: HTMLVideoElement, pts: number, target: number): boolean {
  const fps = sourceFrameRates.get(video);
  // Encoded PTS can be rounded down to microseconds; target time remains exact.
  return fps ? Math.floor((pts + 0.000001) * fps) === Math.floor(target * fps + 1e-9)
    : sameSourceFrame(pts, target);
}

export function sameVideoSeekFrame(video: HTMLVideoElement, actual: number, target: number): boolean {
  return sameSourceFrame(actual, target, sourceFrameRates.get(video));
}

export interface FrameSelectionProvider {
  currentTime: number;
  getCurrentFrame?: () => unknown;
  getFrameRate?: () => number;
  getDebugInfo?: () => { currentFrameTimestampSeconds?: number | null } | null;
}

export function sameProviderSeekFrame(provider: FrameSelectionProvider, actual: number, target: number): boolean {
  return sameSourceFrame(actual, target, providerFrameRate(provider));
}

export function providerHasTargetFrame(provider: FrameSelectionProvider, target: number): boolean {
  const frame = provider.getCurrentFrame?.() as { timestamp?: number; duration?: number | null } | null;
  const pts = typeof frame?.timestamp === 'number' ? frame.timestamp / 1_000_000
    : provider.getDebugInfo?.()?.currentFrameTimestampSeconds;
  if (typeof pts === 'number' && Number.isFinite(pts)) {
    // Actual PTS/duration also handles variable-frame-rate media.
    const fps = providerFrameRate(provider);
    const duration = frame?.duration ? frame.duration / 1_000_000 : fps && fps > 0 ? 1 / fps : undefined;
    if (duration && duration > 0) return target >= pts - 1e-7 && target < pts + duration - 1e-7;
    return sameSourceFrame(pts, target, fps);
  }
  return sameProviderSeekFrame(provider, provider.currentTime, target);
}

function providerFrameRate(provider: FrameSelectionProvider): number | undefined {
  const fps = provider.getFrameRate?.();
  return fps && Number.isFinite(fps) && fps > 0 ? fps : sourceFrameRates.get(provider);
}
