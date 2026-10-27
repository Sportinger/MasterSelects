// Pure rules of the phone source monitor: frame marks <-> source-monitor seconds, clamping, the
// range line and the placement preview line built from the editor's own placement preview.
import { describe, expect, it } from 'vitest';

import {
  clampPhoneSourceMark, describePhoneSourcePreview, describePhoneSourceRange, PHONE_SOURCE_MODES, phoneSourceFps,
  phoneSourceFrameAt, phoneSourceFrameCount, phoneSourceMarksFromTimes, phoneSourceMarkTimes, phoneSourceSeekTime,
} from '../../src/components/mobileSkin/source/phoneSourceModel';

describe('phone source monitor marks', () => {
  it('turns inclusive frame marks into the source-monitor In/Out seconds and back', () => {
    const times = phoneSourceMarkTimes({ inFrame: 30, outFrame: 59 }, 30);
    expect(times.inPoint).toBeCloseTo(1, 9);
    expect(times.outPoint).toBeCloseTo(2, 9);
    expect(phoneSourceMarksFromTimes(times.inPoint, times.outPoint, 30)).toEqual({ inFrame: 30, outFrame: 59 });
    expect(phoneSourceMarkTimes({ inFrame: null, outFrame: null }, 30)).toEqual({ inPoint: null, outPoint: null });
  });

  it('keeps In before Out and both inside the source', () => {
    expect(clampPhoneSourceMark('in', 80, { inFrame: null, outFrame: 50 }, 120)).toEqual({ inFrame: 80, outFrame: 80 });
    expect(clampPhoneSourceMark('out', 5, { inFrame: 10, outFrame: null }, 120)).toEqual({ inFrame: 5, outFrame: 5 });
    expect(clampPhoneSourceMark('out', 500, { inFrame: null, outFrame: null }, 120)).toEqual({ inFrame: null, outFrame: 119 });
    expect(clampPhoneSourceMark('in', -3, { inFrame: null, outFrame: null }, 120)).toEqual({ inFrame: 0, outFrame: null });
  });

  it('reads frames like the frame code (floor with tolerance) and seeks to frame centres', () => {
    expect(phoneSourceFrameAt(1, 30)).toBe(30);
    expect(phoneSourceFrameAt(0.99999999, 30)).toBe(30);
    expect(phoneSourceFrameAt(phoneSourceSeekTime(42, 30), 30)).toBe(42);
    expect(phoneSourceFrameCount(4, 30)).toBe(120);
    expect(phoneSourceFrameCount(undefined, 30)).toBe(0);
    expect(phoneSourceFps(undefined)).toBe(30);
    expect(phoneSourceFps(25)).toBe(25);
  });

  it('describes the marked range in frames and seconds', () => {
    expect(describePhoneSourceRange({ inFrame: 30, outFrame: 59 }, 120, 30)).toBe('Frames 30–59 · 30 frames (1.00 s)');
    expect(describePhoneSourceRange({ inFrame: null, outFrame: null }, 120, 30)).toBe('Whole source · 120 frames (4.00 s)');
    expect(describePhoneSourceRange({ inFrame: null, outFrame: null }, 0, 30)).toMatch(/Still image/);
  });
});

describe('phone source placement modes', () => {
  it('offers the seven editor placement modes, the three replacing ones need a target clip', () => {
    expect(PHONE_SOURCE_MODES.map((mode) => mode.id)).toEqual([
      'insert', 'overwrite', 'append-at-end', 'place-on-top', 'replace', 'fit-to-fill', 'ripple-overwrite',
    ]);
    expect(PHONE_SOURCE_MODES.filter((mode) => mode.needsTarget).map((mode) => mode.id)).toEqual(['replace', 'fit-to-fill', 'ripple-overwrite']);
  });

  it('turns the editor placement preview into one line, and passes a refusal through', () => {
    const line = describePhoneSourcePreview('insert', {
      toolId: 'insert', plane: 'section-scrolled', trackId: 't1', trackIds: ['t1'], startTime: 2, endTime: 3,
    }, () => 'Video 1');
    expect(line).toEqual({ ok: true, text: 'Insert: 0:02.00–0:03.00 on Video 1; later clips move right.' });
    const blocked = describePhoneSourcePreview('place-on-top', {
      toolId: 'place-on-top', plane: 'global-fixed', blocked: true, message: 'Place on Top requires a visual source.',
    }, () => 'x');
    expect(blocked).toEqual({ ok: false, text: 'Place on Top requires a visual source.' });
    expect(describePhoneSourcePreview('insert', null, () => 'x').ok).toBe(false);
  });
});
