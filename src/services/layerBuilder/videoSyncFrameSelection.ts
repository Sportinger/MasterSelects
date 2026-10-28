import type { TimelineClip } from '../../types/timeline';
import type { FrameContext } from './types';
import { getMediaFileForClip } from './FrameContext';
import { getVideoSourceFrameRate, PRESENTED_FRAME_EARLY_TOLERANCE_FRAMES, setVideoSourceFrameRate } from '../videoSourceFrameRate';

export { nominalPresentedFrameTime } from '../videoSourceFrameRate';

const presentedFrames = new WeakMap<HTMLVideoElement, { seekTime: number; pts: number }>();

// Chromium truncates a seek position to whole microseconds but rounds demuxed timestamps to the
// nearest one (WebM: whole milliseconds), so a seek to exactly k/fps presents frame k-1 whenever
// k/fps lies just below the frame's rounded timestamp (at 30 fps e.g. frames 2, 5, 8). A frame-exact
// seek therefore goes slightly into the target's frame, never past the middle of what remains of it.
const FRAME_SEEK_LEAD_SECONDS = 0.001;
// The demuxer converts the seek position to the container's time base with rounding (MP4 from
// ffmpeg: 1/15360 s, so ±33 µs), and a position that rounds onto a keyframe starts decoding there:
// a seek 10 µs before keyframe k presents frame k, not k-1 (REVERSE_PAUSED_BEFORE_KEYFRAME). Reverse
// samples sit 1e-5 s before a frame boundary (BACKWARD_FRAME_EPSILON), so a frame-exact seek also
// keeps this distance from the next frame's start; it is the same bound safeSeekTime keeps from EOF.
const FRAME_SEEK_END_GUARD_SECONDS = 0.001;
// Without a known source rate only the microsecond truncation can be absorbed safely.
const UNKNOWN_RATE_FRAME_SEEK_LEAD_SECONDS = 0.000002;
// Container timestamps are rounded to microseconds (MP4) or milliseconds (WebM). A presented frame
// that starts one frame duration (less that rounding) before the target is the previous frame.
const PTS_ROUNDING_SECONDS = 0.001;

export function rememberSourceFrameRate(target: object | null | undefined, clip: TimelineClip, ctx: FrameContext): void {
  if (!target) return;
  const fps = ctx.mediaFileById && ctx.mediaFileByName ? getMediaFileForClip(ctx, clip)?.fps : undefined;
  setVideoSourceFrameRate(target, fps);
}

/**
 * Where an HTML video element must be positioned to present the source frame holding `target`
 * (frame k covers [k/fps, (k+1)/fps)). Every paused seek goes through this, see FRAME_SEEK_LEAD_SECONDS.
 */
export function htmlVideoFrameSeekTime(video: object, target: number): number {
  if (!Number.isFinite(target)) return target;
  const fps = getVideoSourceFrameRate(video);
  if (!fps) return target + UNKNOWN_RATE_FRAME_SEEK_LEAD_SECONDS;
  const frameIndex = Math.floor(target * fps + 1e-9);
  const frameStart = frameIndex / fps;
  const frameEnd = (frameIndex + 1) / fps;
  const ahead = target + Math.min(FRAME_SEEK_LEAD_SECONDS, Math.max(0, (frameEnd - target) / 2));
  // Near the end of its frame (a reverse sample) the position moves back towards the frame's
  // middle until it is clear of the next frame's start; it never leaves the target's frame.
  const guard = Math.min(FRAME_SEEK_END_GUARD_SECONDS, (frameEnd - frameStart) / 2);
  return Math.max(Math.min(target, frameStart + guard), Math.min(ahead, frameEnd - guard));
}

/** The element sits exactly where a frame-exact seek for `target` put it. */
export function videoAtFrameSeekTime(video: HTMLVideoElement, target: number): boolean {
  return Math.abs(video.currentTime - htmlVideoFrameSeekTime(video, target)) < 1e-6;
}

export function sameSourceFrame(actual: number, target: number, fps?: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return false;
  // Only absorb floating-point arithmetic noise, never the backward-frame bias.
  if (fps && Number.isFinite(fps) && fps > 0) {
    // An element positioned after the target may already show a later frame; nominal fps can be a
    // VFR average whose bins hold two real frames, so compare at no coarser than 60 fps there.
    const binFps = actual > target + 1e-6 ? Math.max(fps, 60) : fps;
    return Math.floor(actual * binFps + 1e-9) === Math.floor(target * binFps + 1e-9);
  }
  // Unknown cadence: do not declare adjacent frames equivalent using a guessed fps.
  return Math.abs(actual - target) <= 1e-7;
}

export function videoHasTargetFrame(video: HTMLVideoElement, target: number): boolean {
  const presented = presentedFrames.get(video);
  const seekedForTarget = videoAtFrameSeekTime(video, target);
  if (presented && Math.abs(presented.seekTime - video.currentTime) < 1e-7 && getVideoSourceFrameRate(video)) {
    // A frame-exact seek's presented frame is the browser's frame for the target (also a WebM
    // timestamp rounded up past the exact target); otherwise judge the PTS itself.
    if (seekedForTarget && presented.pts <= video.currentTime + 0.000002) return true;
    return samePresentedSourceFrame(video, presented.pts, target);
  }
  if (seekedForTarget) return true;
  return sameSourceFrame(video.currentTime, target, getVideoSourceFrameRate(video));
}

/** Paused settle check: an element that moved past the target by playing (warmup, preroll) can show a
 * later frame than one seeked there, so without a presented PTS it must be seeked onto the target. */
export function videoPausedOnTargetFrame(video: HTMLVideoElement, target: number): boolean {
  const presented = presentedFrames.get(video);
  // Only a frame-exact seek position proves the browser resolved this target. An element placed
  // exactly on k/fps may show frame k-1 (see FRAME_SEEK_LEAD_SECONDS) and is judged by its frame.
  const seekedForTarget = videoAtFrameSeekTime(video, target);
  if (presented && Math.abs(presented.seekTime - video.currentTime) < 1e-7 && getVideoSourceFrameRate(video)) {
    // Seeked for the target, the browser presents the frame at or before the seek position (VFR-safe).
    if (seekedForTarget && presented.pts <= video.currentTime + 0.000002) return true;
    return samePresentedSourceFrame(video, presented.pts, target);
  }
  if (seekedForTarget) return true;
  if (video.currentTime > target + 1e-6) return false;
  return sameSourceFrame(video.currentTime, target, getVideoSourceFrameRate(video));
}

export function rememberPresentedSourceFrame(video: HTMLVideoElement, pts: number): void {
  if (Number.isFinite(pts)) presentedFrames.set(video, { seekTime: video.currentTime, pts });
}

export function samePresentedSourceFrame(video: HTMLVideoElement, pts: number, target: number): boolean {
  const fps = getVideoSourceFrameRate(video);
  // A frame that starts after the target is never the frame shown at it. Nominal fps can be an
  // average (VFR), so its bins may hold two real frames; the PTS bound keeps the later one out.
  if (pts > target + 0.000002) return false;
  // Encoded PTS can be rounded down to microseconds; target time remains exact. Within one
  // nominal frame duration an earlier PTS is the held frame (bins of an averaged fps can split it),
  // but the previous frame starts a full duration earlier: compared without the rounding margin,
  // floating-point noise (0.1333.. - 0.1 < 1/30) used to accept it as the target's frame.
  if (!fps) return sameSourceFrame(pts, target);
  const targetFrame = Math.floor(target * fps + 1e-9);
  const ptsPosition = (pts + 0.000001) * fps;
  if (Math.floor(ptsPosition) === targetFrame) return true;
  // A PTS near the previous frame's grid point is the previous frame, however late phone capture
  // jitter stamped it: frame 152 of an Android recording at 5.0695 s (2.8 ms after 152/30) lies within
  // 1/fps - 1 ms of 153/30 and kept the paused preview one keyboard step behind (Pixel run 2026-10-28).
  if (Math.floor(ptsPosition) === targetFrame - 1
    && ptsPosition - (targetFrame - 1) <= PRESENTED_FRAME_EARLY_TOLERANCE_FRAMES) return false;
  return target - pts < 1 / fps - PTS_ROUNDING_SECONDS;
}

/** Diagnostic: the presented PTS is the target's frame, allowing for a timestamp rounded up past it. */
export function presentedPtsFitsTarget(video: HTMLVideoElement, pts: number, target: number): boolean {
  return samePresentedSourceFrame(video, pts, target) || (pts > target && pts - target <= PTS_ROUNDING_SECONDS);
}

export function sameVideoSeekFrame(video: HTMLVideoElement, actual: number, target: number): boolean {
  return sameSourceFrame(actual, target, getVideoSourceFrameRate(video));
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
  return fps && Number.isFinite(fps) && fps > 0 ? fps : getVideoSourceFrameRate(provider);
}
