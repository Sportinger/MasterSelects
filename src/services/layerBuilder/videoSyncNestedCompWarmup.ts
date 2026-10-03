import { createClipSpeedSource, isUnitRateSourceWindow, createStoreSpeedSource, resolveClipSourceTime, videoFrameSourceTime, resolveClipSourceWindow } from '../timeline/retime/clipRetime';
import { visitNestedClipsAtTime, visitNestedClipsInWindow } from '../timeline/retime/nestedClipRetime';
import type { TimelineClip } from '../../types/timeline';
import type { FrameContext } from './types';
import { isVisibleVideoTrackClip } from './videoSyncTimelineQueries';
import type { VideoSyncWarmupState } from './videoSyncWarmupState';

/** Same window and minimum rate as the top-level upcoming-clip preplay. */
const NESTED_PREPLAY_LOOKAHEAD_SECONDS = 0.25;
const NESTED_PREPLAY_RATE = 0.0625;

interface NestedCompWarmupDeps {
  warmups: Pick<VideoSyncWarmupState, 'isWarming' | 'hasUpcomingPreplay' | 'setUpcomingPreplay' | 'deleteUpcomingPreplay'>;
  getClipHtmlVideoElement: (clip: TimelineClip) => HTMLVideoElement | null;
  safeSeekTime: (video: HTMLVideoElement, time: number) => number;
}

/** Park a nested clip's element on the frame it will show first, fully buffered. */
function primeNestedVideo(
  deps: NestedCompWarmupDeps,
  nestedClip: TimelineClip,
  nestedLocalTime: number,
): void {
  const video = deps.getClipHtmlVideoElement(nestedClip);
  if (!video) return;
  const targetTime = videoFrameSourceTime(resolveClipSourceTime(nestedClip, nestedLocalTime));
  if (deps.warmups.isWarming(video) || video.seeking) return;

  if (video.preload !== 'auto') video.preload = 'auto';
  if (Math.abs(video.currentTime - targetTime) > 0.1) {
    video.currentTime = deps.safeSeekTime(video, targetTime);
  }
}

/**
 * Right before a nested cut, start the parked element muted at the minimum rate:
 * Chromium keeps its decoder surface alive, so the cut shows a frame at once.
 * The nested sync leaves registered pre-rolls running and restores 1x at the cut.
 */
function preplayNestedVideo(
  deps: NestedCompWarmupDeps,
  nestedClip: TimelineClip,
  compStartTime: number,
): void {
  const video = deps.getClipHtmlVideoElement(nestedClip);
  if (!video || !isUnitRateSourceWindow(nestedClip, 0, Math.min(nestedClip.duration, NESTED_PREPLAY_LOOKAHEAD_SECONDS), createClipSpeedSource(nestedClip))) return;
  if (deps.warmups.hasUpcomingPreplay(video) || deps.warmups.isWarming(video)) return;
  if (video.seeking || !video.paused || video.readyState < 2) return;

  video.muted = true;
  video.playbackRate = NESTED_PREPLAY_RATE;
  deps.warmups.setUpcomingPreplay(video, { clipId: nestedClip.id, startTime: compStartTime, nestedSince: performance.now() });
  video.play().catch(() => deps.warmups.deleteUpcomingPreplay(video));
}

export function preBufferUpcomingNestedCompVideos(
  ctx: FrameContext,
  deps: NestedCompWarmupDeps,
  lookaheadSeconds: number,
): void {
  if (!ctx.isPlaying || ctx.isDraggingPlayhead) return;

  const lookaheadEnd = ctx.playheadPosition + lookaheadSeconds;
  for (const compClip of ctx.clips) {
    if (!isVisibleVideoTrackClip(ctx, compClip)) continue;
    if (!compClip.isComposition || !compClip.nestedClips?.length) continue;
    const compEnd = compClip.startTime + compClip.duration;
    if (compClip.startTime > lookaheadEnd || ctx.playheadPosition >= compEnd) continue;
    const startLocal = Math.max(0, ctx.playheadPosition - compClip.startTime);
    const endLocal = Math.min(compClip.duration, lookaheadEnd - compClip.startTime);
    // Preserve tight, provable bounds for unanimated composition clocks too.
    const speedSource = ctx.hasKeyframes(compClip.id)
      ? createStoreSpeedSource(compClip.id, ctx) : createClipSpeedSource(compClip);
    const window = resolveClipSourceWindow(compClip, startLocal, endLocal, speedSource);
    const reverse = resolveClipSourceTime(compClip, startLocal, speedSource).sourceRate < 0;
    const activeIds = new Set<string>();
    if (compClip.startTime <= ctx.playheadPosition) {
      const activeTime = videoFrameSourceTime(resolveClipSourceTime(compClip, startLocal, speedSource));
      visitNestedClipsAtTime(compClip, activeTime, child => activeIds.add(child.id));
    }
    visitNestedClipsInWindow(compClip,
      reverse ? window.maxSourceTime : window.minSourceTime,
      reverse ? window.minSourceTime : window.maxSourceTime,
      (nestedClip, local) => {
        // Never seek an already active leaf to an upcoming frame.
        if (activeIds.has(nestedClip.id)) return;
        primeNestedVideo(deps, nestedClip, local);
      });
    // Only preplay an interval whose resolved clock is continuously unit-rate.
    if (ctx.playbackSpeed !== 1 ||
        (compClip.timeRemap?.kind !== 'warp' && ctx.hasKeyframes(compClip.id, 'speed')) ||
        !isUnitRateSourceWindow(compClip, startLocal, endLocal, speedSource)) continue;

    if (compClip.startTime > ctx.playheadPosition) {
      // The comp itself starts soon: prepare whatever it shows at its in point.
      if (compClip.startTime > lookaheadEnd) continue;
      const compStartTime = videoFrameSourceTime(resolveClipSourceTime(compClip, 0, speedSource));
      for (const nestedClip of compClip.nestedClips) {
        const nestedClipEnd = nestedClip.startTime + nestedClip.duration;
        if (compStartTime < nestedClip.startTime || compStartTime >= nestedClipEnd) continue;
        primeNestedVideo(deps, nestedClip, compStartTime - nestedClip.startTime);
      }
      continue;
    }

    // The comp is playing: prepare nested clips that begin inside it shortly
    // (e.g. back-to-back pieces), so the cut does not start from a cold element.
    if (ctx.playheadPosition >= compEnd) continue;
    const localNow = window.sourceStart;
    const localEnd = window.sourceEnd;
    for (const nestedClip of compClip.nestedClips) {
      if (nestedClip.startTime <= localNow || nestedClip.startTime > localEnd) continue;
      const leadSeconds = nestedClip.startTime - localNow;
      if (leadSeconds <= NESTED_PREPLAY_LOOKAHEAD_SECONDS) {
        preplayNestedVideo(deps, nestedClip, ctx.playheadPosition + leadSeconds);
      } else {
        primeNestedVideo(deps, nestedClip, 0);
      }
    }
  }
}
