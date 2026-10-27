import { describe, expect, it } from 'vitest';

import {
  PHONE_TIMELINE_MAX_ZOOM,
  PHONE_TIMELINE_MIN_ZOOM,
} from '../../src/components/mobileSkin/contracts';
import {
  alignTimeToFrame,
  centreTimeForScroll,
  clampPhoneZoom,
  clampScroll,
  clampTime,
  formatRulerTime,
  hitTestClip,
  lastFrameStart,
  overscanWindow,
  paddedContentWidth,
  pinchAnchorTime,
  pinchScroll,
  rulerTicks,
  rulerTickStep,
  screenXToTime,
  scrollForTime,
  timelineContentEnd,
  timeToScreenX,
  viewTimeRange,
  visibleClipsInWindow,
  windowNeedsRefresh,
  type PhoneTimelineView,
} from '../../src/components/mobileSkin/timeline/phoneTimelineGeometry';

const W = 400;

function viewAt(time: number, zoom = 60, width = W): PhoneTimelineView {
  return { width, zoom, scroll: scrollForTime(time, zoom) };
}

describe('phone timeline geometry: fixed centre playhead', () => {
  it('round-trips time and screen x', () => {
    const view: PhoneTimelineView = { width: W, zoom: 73.5, scroll: 1234.5 };
    for (const time of [0, 0.5, 3.25, 17.8, 120]) {
      expect(screenXToTime(timeToScreenX(time, view), view)).toBeCloseTo(time, 9);
    }
    for (const x of [0, 13, W / 2, W]) {
      expect(timeToScreenX(screenXToTime(x, view), view)).toBeCloseTo(x, 9);
    }
  });

  it('puts the centre time exactly under the middle of the surface', () => {
    for (const time of [0, 1.5, 9.75]) {
      const view = viewAt(time, 88);
      expect(timeToScreenX(time, view)).toBeCloseTo(W / 2, 9);
      expect(centreTimeForScroll(view.scroll, view.zoom)).toBeCloseTo(time, 9);
    }
  });

  it('pads half a viewport so time 0 and the content end both reach the centre', () => {
    const end = 12;
    const zoom = 50;
    expect(clampScroll(-500, end, zoom)).toBe(0);
    expect(timeToScreenX(0, { width: W, zoom, scroll: 0 })).toBe(W / 2);
    const maxScroll = clampScroll(1e9, end, zoom);
    expect(maxScroll).toBe(end * zoom);
    expect(timeToScreenX(end, { width: W, zoom, scroll: maxScroll })).toBe(W / 2);
    expect(paddedContentWidth(end, zoom, W)).toBe(end * zoom + W);
  });

  it('clamps time, scroll and zoom, including non-finite input', () => {
    expect(clampTime(-1, 10)).toBe(0);
    expect(clampTime(11, 10)).toBe(10);
    expect(clampTime(Number.NaN, 10)).toBe(0);
    expect(clampPhoneZoom(0)).toBe(PHONE_TIMELINE_MIN_ZOOM);
    expect(clampPhoneZoom(1e9)).toBe(PHONE_TIMELINE_MAX_ZOOM);
    expect(clampPhoneZoom(Number.NaN)).toBe(PHONE_TIMELINE_MIN_ZOOM);
    expect(clampPhoneZoom(120)).toBe(120);
  });
});

describe('phone timeline geometry: pinch', () => {
  it('keeps the anchor time under the midpoint while zooming', () => {
    const startZoom = 60;
    const startScroll = scrollForTime(5, startZoom);
    const startMidpointX = 310;
    const anchor = pinchAnchorTime(startScroll, startMidpointX, startZoom, W);
    expect(anchor).toBeCloseTo(screenXToTime(startMidpointX, { width: W, zoom: startZoom, scroll: startScroll }), 9);

    for (const nextZoom of [15, 60, 240, 900]) {
      for (const nextMidpointX of [startMidpointX, 120]) {
        const nextScroll = pinchScroll({ startScroll, startZoom, startMidpointX, nextZoom, nextMidpointX, width: W });
        const nextView = { width: W, zoom: nextZoom, scroll: nextScroll };
        expect(screenXToTime(nextMidpointX, nextView)).toBeCloseTo(anchor, 9);
      }
    }
  });

  it('keeps the playhead frame when the anchor is the centre', () => {
    const startZoom = 60;
    const startScroll = scrollForTime(7.4, startZoom);
    const nextScroll = pinchScroll({
      startScroll, startZoom, startMidpointX: W / 2, nextZoom: 333, nextMidpointX: W / 2, width: W,
    });
    expect(centreTimeForScroll(nextScroll, 333)).toBeCloseTo(7.4, 9);
  });
});

describe('phone timeline geometry: frame alignment', () => {
  it('snaps to the nearest frame start of the composition rate', () => {
    expect(alignTimeToFrame(1.01, 30)).toBeCloseTo(30 / 30, 9);
    expect(alignTimeToFrame(1.02, 30)).toBeCloseTo(31 / 30, 9);
    expect(alignTimeToFrame(2.5, 24)).toBeCloseTo(60 / 24, 9);
    expect(alignTimeToFrame(-3, 25)).toBe(0);
    // Invalid rates fall back to the editor default (30 fps).
    expect(alignTimeToFrame(1.02, 0)).toBeCloseTo(31 / 30, 9);
  });

  it('never seeks past the last frame that still shows content', () => {
    expect(lastFrameStart(4, 30)).toBeCloseTo(119 / 30, 9);
    expect(lastFrameStart(4.01, 30)).toBeCloseTo(120 / 30, 9);
    expect(alignTimeToFrame(4, 30, 4)).toBeCloseTo(119 / 30, 9);
    expect(alignTimeToFrame(10, 30, 4)).toBeCloseTo(119 / 30, 9);
    expect(alignTimeToFrame(0, 30, 0)).toBe(0);
  });
});

describe('phone timeline geometry: virtualization and hit testing', () => {
  const clips = Array.from({ length: 20 }, (_, index) => ({
    id: `clip-${index}`,
    trackId: index % 2 === 0 ? 'video-1' : 'audio-1',
    startTime: index * 2,
    duration: 2,
  }));

  it('reports the visible range and selects only intersecting clips', () => {
    const view = viewAt(10, 50);
    const range = viewTimeRange(view);
    expect(range.start).toBeCloseTo(6, 9);
    expect(range.end).toBeCloseTo(14, 9);
    const visible = visibleClipsInWindow(clips, range).map((clip) => clip.id);
    expect(visible).toEqual(['clip-3', 'clip-4', 'clip-5', 'clip-6']);

    const window = overscanWindow(view, W);
    expect(window.start).toBeCloseTo(-2, 9);
    expect(window.end).toBeCloseTo(22, 9);
    expect(visibleClipsInWindow(clips, window)).toHaveLength(11);
  });

  it('refreshes the rendered window only near its edge', () => {
    const window = overscanWindow(viewAt(10, 50), W);
    expect(windowNeedsRefresh(viewAt(10, 50), window, W / 2)).toBe(false);
    expect(windowNeedsRefresh(viewAt(13.9, 50), window, W / 2)).toBe(false);
    expect(windowNeedsRefresh(viewAt(14.1, 50), window, W / 2)).toBe(true);
    expect(windowNeedsRefresh(viewAt(10, 25), window, W / 2)).toBe(true);
  });

  it('hits clips by lane and time, with a minimum width for short clips', () => {
    const lanes = [
      { trackId: 'video-1', top: 0, height: 56 },
      { trackId: 'audio-1', top: 60, height: 36 },
    ];
    const view = viewAt(5, 50);
    // time 5 is at the centre; clip-2 (video, 4..6) and clip-3 is audio (6..8).
    expect(hitTestClip({ x: W / 2, y: 20, view, lanes, clips })).toBe('clip-2');
    expect(hitTestClip({ x: W / 2 + 75, y: 70, view, lanes, clips })).toBe('clip-3');
    expect(hitTestClip({ x: W / 2, y: 70, view, lanes, clips })).toBeNull();
    expect(hitTestClip({ x: W / 2, y: 58, view, lanes, clips })).toBeNull();
    expect(hitTestClip({ x: W / 2, y: 200, view, lanes, clips })).toBeNull();

    const tiny = [{ id: 'tiny', trackId: 'video-1', startTime: 5, duration: 0.01 }];
    expect(hitTestClip({ x: W / 2 + 6, y: 10, view, lanes, clips: tiny, minHitWidthPx: 16 })).toBe('tiny');
    expect(hitTestClip({ x: W / 2 + 20, y: 10, view, lanes, clips: tiny, minHitWidthPx: 16 })).toBeNull();
  });

  it('ends the scroll range at the authored content, bounded by the workspace duration', () => {
    expect(timelineContentEnd(clips, 60)).toBe(40);
    expect(timelineContentEnd([], 60)).toBe(60);
    expect(timelineContentEnd(clips, 30)).toBe(30);
  });
});

describe('phone timeline geometry: ruler', () => {
  it('chooses a tick step with readable spacing and lists ticks inside the window', () => {
    expect(rulerTickStep(60) * 60).toBeGreaterThanOrEqual(72);
    expect(rulerTickStep(1200)).toBeLessThan(1);
    expect(rulerTickStep(4)).toBeGreaterThanOrEqual(18);
    expect(rulerTicks({ start: -3, end: 4.5 }, 1, 10)).toEqual([0, 1, 2, 3, 4]);
    expect(rulerTicks({ start: 8, end: 20 }, 2, 10)).toEqual([8, 10]);
    expect(formatRulerTime(75, 1)).toBe('1:15');
    expect(formatRulerTime(1.5, 0.5)).toBe('0:01.5');
  });
});
