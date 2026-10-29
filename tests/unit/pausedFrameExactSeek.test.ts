import { describe, expect, it } from 'vitest';
import {
  htmlVideoFrameSeekTime,
  presentedPtsFitsTarget,
  rememberPresentedSourceFrame,
  samePresentedSourceFrame,
  videoHasTargetFrame,
  videoPausedOnTargetFrame,
} from '../../src/services/layerBuilder/videoSyncFrameSelection';
import { nominalPresentedFrameTime, presentedFrameCallbackIsLate, setVideoSourceFrameRate } from '../../src/services/videoSourceFrameRate';
import { requestOnTimePresentedFrame, WARMUP_MAX_LATE_FRAME_CALLBACKS } from '../../src/services/layerBuilder/videoSyncPresentedFrame';
import {
  isPausedHtmlTargetMediaTimeUsable,
  pausedHtmlTargetFrameRate,
} from '../../src/engine/render/layerCollector/htmlVideoPausedFrameGuard';
import { frameIndexAtTime, stepTimeByFrames } from '../../src/utils/timelineFrameQuantization';
import { SLOT_SEEK_LEAD_SECONDS, frameIndexForTime } from '../../src/engine/texture/scrubbingCache/cacheKeys';
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

/**
 * Jittered phone recordings (Android MediaMuxer, 30 fps at 1/90000 with frames up to 4 ms off k/30):
 * the Pixel 10 Pro run of 2026-10-28 kept the paused preview one frame off in two ways. These are the
 * real timestamps of the generated android-h264 recording (tests/playwright/fixtures/phoneFootage.ts).
 */
describe('presented frames of jittered phone footage', () => {
  const PTS_TICKS: Record<number, number> = {
    151: 453104, 152: 456257, 153: 458665, 244: 732344, 245: 734707, 246: 737767, 247: 740803,
  };
  const pts = (frame: number) => PTS_TICKS[frame] / 90000;

  it('labels a frame stamped just before its grid point as its own frame (scrub slot, held-frame guard)', () => {
    const video = videoAt(0, 30);
    // Frame 246 starts 2.6 ms before 246/30: raw, it filled scrub slot 245 and passed the guard as 245.
    expect(frameIndexForTime(pts(246))).toBe(245);
    expect(frameIndexForTime(nominalPresentedFrameTime(video, pts(246)))).toBe(246);
    expect(isPausedHtmlTargetMediaTimeUsable(nominalPresentedFrameTime(video, pts(246)), 245 / 30, 30)).toBe(false);
    // Frame 245 starts 3.3 ms early: raw, the guard rejected the right frame for timeline frame 245.
    expect(isPausedHtmlTargetMediaTimeUsable(pts(245), 245 / 30, 30)).toBe(false);
    expect(isPausedHtmlTargetMediaTimeUsable(nominalPresentedFrameTime(video, pts(245)), 245 / 30, 30)).toBe(true);
    // A late PTS, exact timestamps and an unknown rate keep their time.
    expect(nominalPresentedFrameTime(video, pts(152))).toBe(pts(152));
    expect(nominalPresentedFrameTime(video, 2 / 30)).toBe(2 / 30);
    expect(nominalPresentedFrameTime(videoAt(0), pts(246))).toBe(pts(246));
  });

  it.each([24, 25, 30, 60])('maps every jittered frame onto its own slot and guard frame at %f fps', (fps) => {
    const video = videoAt(0, fps);
    for (let frame = 1; frame < 600; frame++) {
      for (const jitterFrames of [-0.24, -0.12, -0.01, 0, 0.01, 0.12, 0.24]) {
        const label = nominalPresentedFrameTime(video, (frame + jitterFrames) / fps);
        expect(Math.floor(label * fps + 1e-6), `frame ${frame}${jitterFrames}`).toBe(frame);
        expect(isPausedHtmlTargetMediaTimeUsable(label, frame / fps, pausedHtmlTargetFrameRate(video))).toBe(true);
        if (fps === 30) expect(frameIndexForTime(label), `slot of ${frame}${jitterFrames}`).toBe(frame);
      }
    }
  });

  it('never takes the previous frame, stamped late, for the next target (preview stuck one step behind)', () => {
    // The Android capture played the element from frame 152's seek to 5.0864 s; frame 152 (5.0695 s,
    // 2.8 ms late) was presented. Stepping on to 153 must seek instead of accepting it.
    const video = videoAt(5.086358, 30);
    rememberPresentedSourceFrame(video, pts(152));
    expect(samePresentedSourceFrame(video, pts(152), 153 / 30)).toBe(false);
    expect(videoHasTargetFrame(video, 153 / 30)).toBe(false);
    expect(videoPausedOnTargetFrame(video, 153 / 30)).toBe(false);
    // The target's own frame, stamped early, and an averaged-VFR frame held from mid-bin still pass.
    expect(samePresentedSourceFrame(video, pts(153), 153 / 30)).toBe(true);
    expect(samePresentedSourceFrame(video, 152.5 / 30, 153 / 30)).toBe(true);
    for (let frame = 1; frame < 600; frame++) {
      for (const late of [0.01, 0.12, 0.24]) {
        expect(samePresentedSourceFrame(video, (frame - 1 + late) / 30, frame / 30), `frame ${frame - 1}+${late}`).toBe(false);
      }
    }
  });
});

describe('late frame callbacks of a playing warmup', () => {
  // Phone journey m1-edit 5 (2026-10-29): the warmup's callback reported frame 0 (mediaTime 0) while the
  // element was already at 0.0269 s, i.e. showing frame 1. The capture was labelled frame 0 and the
  // paused preview kept frame 1 at timeline frame 0. A late report must not label the picture.
  it('flags a report that currentTime has already run more than half a frame past', () => {
    const video = videoAt(0.0269, 30);
    expect(presentedFrameCallbackIsLate(video, 0, video.currentTime)).toBe(true);
  });

  it('accepts the usual report of a frame presented ahead of currentTime, or just behind it', () => {
    const video = videoAt(0.025, 30);
    expect(presentedFrameCallbackIsLate(video, 1 / 30, 0.025)).toBe(false);
    expect(presentedFrameCallbackIsLate(video, 2, 2 + 0.4 / 30)).toBe(false);
  });

  it('never judges without a known rate or a reported time', () => {
    expect(presentedFrameCallbackIsLate(videoAt(0.5), 0, 0.5)).toBe(false);
    expect(presentedFrameCallbackIsLate(videoAt(0.5, 30), undefined, 0.5)).toBe(false);
  });
});

describe('the warmup waits past late frame callbacks', () => {
  type FrameCallback = (now: number, metadata?: { mediaTime?: number }) => void;
  function fakeVideo(currentTime: number, fps: number) {
    const pending: FrameCallback[] = [];
    const video = { currentTime, requestVideoFrameCallback: (cb: FrameCallback) => pending.push(cb) } as unknown as HTMLVideoElement;
    setVideoSourceFrameRate(video, fps);
    const present = (mediaTime: number, time: number) => {
      (video as { currentTime: number }).currentTime = time;
      pending.shift()?.(0, { mediaTime });
    };
    return { video, pending, present };
  }

  it('skips a late report and labels the next on-time frame', () => {
    const { video, present } = fakeVideo(0, 30);
    const frames: Array<number | undefined> = [];
    expect(requestOnTimePresentedFrame(video, { clipId: 'c', isCurrent: () => true, onFrame: (t) => frames.push(t) })).toBe(true);
    present(0, 0.0269);
    expect(frames).toEqual([]);
    present(1 / 30, 0.04);
    expect(frames).toEqual([1 / 30]);
  });

  it('gives up after the allowed late callbacks and still finishes the warmup', () => {
    const { video, present } = fakeVideo(0, 30);
    const frames: Array<number | undefined> = [];
    requestOnTimePresentedFrame(video, { clipId: 'c', isCurrent: () => true, onFrame: (t) => frames.push(t) });
    for (let i = 0; i <= WARMUP_MAX_LATE_FRAME_CALLBACKS; i++) present(i / 30, i / 30 + 0.9 / 30);
    expect(frames).toEqual([WARMUP_MAX_LATE_FRAME_CALLBACKS / 30]);
  });

  it('stops the chain once the attempt is superseded, and reports elements without frame callbacks', () => {
    const { video, pending, present } = fakeVideo(0, 30);
    let current = true;
    const frames: Array<number | undefined> = [];
    requestOnTimePresentedFrame(video, { clipId: 'c', isCurrent: () => current, onFrame: (t) => frames.push(t) });
    present(0, 0.0269);
    current = false;
    present(1 / 30, 0.04);
    expect(frames).toEqual([]);
    expect(pending).toHaveLength(0);
    const bare = {} as HTMLVideoElement;
    expect(requestOnTimePresentedFrame(bare, { clipId: 'c', isCurrent: () => true, onFrame: () => {} })).toBe(false);
  });
});
