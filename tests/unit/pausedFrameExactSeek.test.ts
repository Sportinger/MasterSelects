import { describe, expect, it } from 'vitest';
import {
  htmlVideoFrameSeekTime,
  presentedPtsFitsTarget,
  rememberPresentedSourceFrame,
  samePresentedSourceFrame,
  videoHasTargetFrame,
  videoPausedOnTargetFrame,
} from '../../src/services/layerBuilder/videoSyncFrameSelection';
import { setVideoSourceFrameRate } from '../../src/services/videoSourceFrameRate';
import {
  isPausedHtmlTargetMediaTimeUsable,
  pausedHtmlTargetFrameRate,
} from '../../src/engine/render/layerCollector/htmlVideoPausedFrameGuard';
import { frameIndexAtTime, stepTimeByFrames } from '../../src/utils/timelineFrameQuantization';
import { SLOT_SEEK_LEAD_SECONDS } from '../../src/engine/texture/scrubbingCache/cacheKeys';
import { resolveClipSourceTime, videoFrameSourceTime } from '../../src/services/timeline/retime/clipRetime';

/**
 * The paused preview repaint defect (found by tests/playwright/foundation/preview-truth.spec.ts):
 * a seek to exactly k/fps presented frame k-1, the previous frame passed every identity check, and
 * the stale frame stayed on screen. These cases pin the frame-exact contract without a browser.
 */
const RATES = [24, 25, 30000 / 1001, 30, 50, 60];

function videoAt(time: number, fps?: number): HTMLVideoElement {
  const video = { currentTime: time, paused: true, seeking: false } as HTMLVideoElement;
  if (fps) setVideoSourceFrameRate(video, fps);
  return video;
}

// Chromium: the seek position is truncated to whole microseconds, demuxed timestamps are rounded
// to the nearest microsecond (MP4) or millisecond (WebM); the frame shown is the last one starting
// at or before the seek position.
function presentedFrame(seekSeconds: number, fps: number, timestampUnitUs: number): number {
  const seekUs = Math.trunc(seekSeconds * 1_000_000);
  const ptsUs = (frame: number) => Math.round(frame / fps * 1_000_000 / timestampUnitUs) * timestampUnitUs;
  let frame = Math.max(0, Math.floor(seekSeconds * fps) - 2);
  while (ptsUs(frame + 1) <= seekUs) frame++;
  return frame;
}

describe('frame-exact paused HTML seeks', () => {
  it('reproduces the browser landing on the previous frame for an exact k/fps seek', () => {
    // 2/30 s truncates to 66 666 us, frame 2 starts at 66 667 us: the browser shows frame 1.
    expect(presentedFrame(2 / 30, 30, 1)).toBe(1);
    expect(presentedFrame(5 / 30, 30, 1)).toBe(4);
  });

  it.each(RATES)('positions the element inside the target frame at %f fps (MP4 and WebM timestamps)', (fps) => {
    const video = videoAt(0, fps);
    for (let frame = 0; frame < 600; frame++) {
      for (const offset of [0, 0.25, 0.5, 0.97]) {
        const target = (frame + offset) / fps;
        const seek = htmlVideoFrameSeekTime(video, target);
        expect(presentedFrame(seek, fps, 1), `frame ${frame}+${offset} (us timestamps)`).toBe(frame);
        if (offset === 0) expect(presentedFrame(seek, fps, 1000), `frame ${frame} (ms timestamps)`).toBe(frame);
        expect(frameIndexAtTime(seek, fps)).toBe(frame);
      }
    }
  });

  it.each(RATES)('keeps a reversed clip\'s seek clear of the next keyframe at %f fps (REVERSE_PAUSED_BEFORE_KEYFRAME)', (fps) => {
    // The demuxer rounds the seek position to the container time base and starts decoding at a
    // keyframe it rounds onto: Chromium presented frame 60 for a seek to 1.999995 s (keyframe 60 at
    // 2.0 s, MP4 time base 1/15360) and the preview stayed empty on the reversed mosaic tile T11b.
    const video = videoAt(0, fps);
    const reversed = { startTime: 0, duration: 20, inPoint: 0, outPoint: 20, reversed: true, speed: 1 } as Parameters<typeof resolveClipSourceTime>[0];
    for (let frame = 0; frame < Math.floor(20 * fps) - 1; frame++) {
      // Local time at which the reverse clip's sample sits exactly on the end of source frame `frame`.
      const target = videoFrameSourceTime(resolveClipSourceTime(reversed, 20 - (frame + 1) / fps));
      expect(target).toBeLessThan((frame + 1) / fps);
      const seek = htmlVideoFrameSeekTime(video, target);
      expect(frameIndexAtTime(seek, fps), `frame ${frame}`).toBe(frame);
      expect(presentedFrame(seek, fps, 1), `frame ${frame} (us timestamps)`).toBe(frame);
      for (const timescale of [15360, 90000, 1000]) {
        const tick = (seconds: number) => Math.round(seconds * timescale);
        expect(tick(seek), `frame ${frame} rounds onto frame ${frame + 1} at 1/${timescale}`).toBeLessThan(tick((frame + 1) / fps));
      }
      // The seek position is what the seeked event reports as presented: it settles the target.
      expect(isPausedHtmlTargetMediaTimeUsable(seek, target, pausedHtmlTargetFrameRate(video)), `guard ${frame}`).toBe(true);
      expect(samePresentedSourceFrame(video, seek, target), `settle ${frame}`).toBe(true);
    }
  });

  it('absorbs the microsecond truncation when the source rate is unknown', () => {
    const video = videoAt(0);
    for (let frame = 0; frame < 300; frame++) {
      expect(presentedFrame(htmlVideoFrameSeekTime(video, frame / 30), 30, 1)).toBe(frame);
    }
  });

  it.each(RATES)('never accepts the previous presented frame as the target frame at %f fps', (fps) => {
    const video = videoAt(0, fps);
    for (let frame = 1; frame < 600; frame++) {
      const target = frame / fps;
      for (const unitUs of [1, 1000]) {
        const pts = (index: number) => Math.round(index / fps * 1_000_000 / unitUs) * unitUs / 1_000_000;
        // 0.1333.. - 0.1 < 1/30 in floating point used to pass frame 3 off as frame 4.
        expect(samePresentedSourceFrame(video, pts(frame - 1), target), `frame ${frame - 1} for ${frame}`).toBe(false);
        expect(presentedPtsFitsTarget(video, pts(frame), target), `frame ${frame} (${unitUs} us)`).toBe(true);
      }
      expect(samePresentedSourceFrame(video, Math.round(target * 1e6) / 1e6, target)).toBe(true);
    }
  });

  it('accepts the browser frame of a frame-exact seek, but not a stale frame at an exact k/fps position', () => {
    const target = 4 / 30;
    const seeked = videoAt(0, 30);
    seeked.currentTime = htmlVideoFrameSeekTime(seeked, target);
    rememberPresentedSourceFrame(seeked, 0.133333);
    expect(videoHasTargetFrame(seeked, target)).toBe(true);
    expect(videoPausedOnTargetFrame(seeked, target)).toBe(true);
    // Still on the previous step's frame (0.1): neither check may skip the seek.
    const stale = videoAt(0.1, 30);
    rememberPresentedSourceFrame(stale, 0.1);
    expect(videoHasTargetFrame(stale, target)).toBe(false);
    expect(videoPausedOnTargetFrame(stale, target)).toBe(false);
    // Placed exactly on 2/30 the browser presented frame 1: that is not frame 2.
    const exact = videoAt(2 / 30, 30);
    rememberPresentedSourceFrame(exact, 0.033333);
    expect(videoPausedOnTargetFrame(exact, 2 / 30)).toBe(false);
    expect(videoHasTargetFrame(exact, 2 / 30)).toBe(false);
  });
});

describe('background scrub cache slots', () => {
  it('fills every 1/30 s slot of a 30 fps source with its own frame, not the one before', () => {
    // Exact slot starts present the previous frame for every third slot (and float-noise cases).
    expect(Array.from({ length: 600 }, (_, slot) => slot).filter(slot => presentedFrame(slot / 30, 30, 1) !== slot).length).toBeGreaterThanOrEqual(200);
    for (let slot = 0; slot < 600; slot++) {
      expect(presentedFrame(slot / 30 + SLOT_SEEK_LEAD_SECONDS, 30, 1), `slot ${slot}`).toBe(slot);
      expect(presentedFrame(slot / 30 + SLOT_SEEK_LEAD_SECONDS, 30, 1000), `slot ${slot} (ms timestamps)`).toBe(slot);
    }
  });
});

describe('paused held-frame guard', () => {
  it('admits the target frame only, never a neighbour', () => {
    for (let frame = 1; frame < 300; frame++) {
      const target = frame / 30;
      expect(isPausedHtmlTargetMediaTimeUsable((frame - 1) / 30, target, 30), `previous for ${frame}`).toBe(false);
      expect(isPausedHtmlTargetMediaTimeUsable((frame + 1) / 30, target, 30), `next for ${frame}`).toBe(false);
      expect(isPausedHtmlTargetMediaTimeUsable(Math.round(target * 1000) / 1000, target, 30), `key for ${frame}`).toBe(true);
      expect(isPausedHtmlTargetMediaTimeUsable(htmlVideoFrameSeekTime(videoAt(0, 30), target), target, 30)).toBe(true);
    }
  });

  it('judges on the source frame grid, never finer than the 1/30 s cache slots', () => {
    expect(pausedHtmlTargetFrameRate(videoAt(0, 24))).toBe(24);
    expect(pausedHtmlTargetFrameRate(videoAt(0, 60))).toBe(30);
    expect(pausedHtmlTargetFrameRate(videoAt(0))).toBe(30);
    // 24 fps: frame 4 [0.1667, 0.2083) is not frame 5, although both touch the 30 fps slot [0.2, 0.2333).
    expect(isPausedHtmlTargetMediaTimeUsable(0.2, 0.21, 24)).toBe(false);
    expect(isPausedHtmlTargetMediaTimeUsable(5 / 24, 0.21, 24)).toBe(true);
  });
});

describe('frame stepping on the composition grid', () => {
  it.each(RATES)('lands exactly on k/fps after many steps at %f fps', (fps) => {
    let time = 0;
    for (let frame = 1; frame <= 900; frame++) {
      time = stepTimeByFrames(time, 1, fps, 3600);
      expect(time).toBe(frame / fps);
    }
    for (let frame = 899; frame >= 0; frame--) {
      time = stepTimeByFrames(time, -1, fps, 3600);
      expect(time).toBe(frame / fps);
    }
  });

  it('steps from the frame shown at an off-grid playhead and clamps to the timeline', () => {
    // Paused mid-frame (65.99 at 30 fps shows frame 65): the next frame is 66, not 67.
    expect(stepTimeByFrames(2.1997, 1, 30, 10)).toBe(66 / 30);
    expect(stepTimeByFrames(2.1997, -1, 30, 10)).toBe(64 / 30);
    expect(stepTimeByFrames(0, -1, 30, 10)).toBe(0);
    expect(stepTimeByFrames(4, 1, 30, 4)).toBe(4);
    expect(stepTimeByFrames(4.01, 1, 30, 4.01)).toBe(4.01);
    expect(stepTimeByFrames(Number.NaN, 1, 25, 10)).toBe(1 / 25);
  });
});
