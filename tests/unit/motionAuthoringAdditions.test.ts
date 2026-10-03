import { describe, expect, it } from 'vitest';
import { countTextRevealSlots, createTextRevealPlan } from '../../src/services/text/textReveal';
import { formatTextTimecode, formatTextValueTemplate } from '../../src/services/text/textValueTemplate';
import { KEYFRAME_EASING_PRESETS, resolveEasingCurve, segmentHandlesForCurve } from '../../src/utils/easingPresets';
import { applyEasingCurveToKeyframes } from '../../src/stores/timeline/keyframes/keyframeEasingCurves';
import { interpolateKeyframes } from '../../src/utils/keyframeInterpolation';
import type { Keyframe } from '../../src/types/keyframes';

const plan = (text: string, reveal: number, extra: Record<string, unknown> = {}) =>
  createTextRevealPlan({ text, fontSize: 100, reveal, ...extra });
const visible = (text: string, reveal: number, extra: Record<string, unknown> = {}) => {
  const p = plan(text, reveal, extra)!;
  return [...text.replace(/\n/g, '')].map((char, index) => p.glyph(index, char));
};

describe('text reveal', () => {
  it('is inactive at full reveal and counts slots without newlines', () => {
    expect(plan('ABC', 1)).toBeNull();
    expect(plan('ABC', undefined as unknown as number)).toBeNull();
    expect(countTextRevealSlots('AB\nCD')).toBe(4);
  });

  it('types characters in order and places the cursor at the head', () => {
    const glyphs = visible('HELLO', 0.4, { revealMode: 'typewriter', revealCursor: true });
    expect(glyphs.map(g => g.visible)).toEqual([true, true, false, false, false]);
    expect(plan('HELLO', 0.4, { revealCursor: true })!.cursorIndex).toBe(2);
    expect(plan('HELLO', 0.4)!.cursorIndex).toBe(-1);
  });

  it('decodes with scrambled glyphs ahead of the head that keep spaces and change with progress', () => {
    const a = visible('ABCDE FGHIJ', 0.2, { revealMode: 'decode', revealSpread: 4 });
    expect(a.slice(0, 2).map(g => g.glyph)).toEqual(['A', 'B']);
    expect(a.slice(2, 6).every(g => g.visible)).toBe(true);
    expect(a[5]!.glyph).toBe(' ');
    expect(a.slice(6).some(g => g.visible)).toBe(false);
    const b = visible('ABCDE FGHIJ', 0.25, { revealMode: 'decode', revealSpread: 4 });
    expect(b.slice(2, 5).map(g => g.glyph).join('')).not.toBe(a.slice(2, 5).map(g => g.glyph).join(''));
  });

  it('fades and lifts with a soft edge', () => {
    const fade = visible('ABCDEFGH', 0.5, { revealMode: 'fade', revealSpread: 4 });
    const alphas = fade.map(g => g.alpha);
    expect(alphas[0]).toBe(1);
    expect(alphas.at(-1)).toBe(0);
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]!).toBeLessThanOrEqual(alphas[i - 1]!);
    const rise = visible('ABCDEFGH', 0.5, { revealMode: 'rise', revealSpread: 4 });
    const partial = rise.find(g => g.alpha > 0 && g.alpha < 1)!;
    expect(partial.offsetY).toBeGreaterThan(0);
  });
});

describe('frame and timecode tokens', () => {
  it('formats clip-local frames and timecode at the composition rate', () => {
    expect(formatTextValueTemplate('{timecode}', { value: 0, time: 4.9, fps: 60 })).toBe('00:00:04:54');
    expect(formatTextValueTemplate('F{frame}', { value: 0, time: 1.5, fps: 60 })).toBe('F90');
    expect(formatTextValueTemplate('{timecode}', { value: 0, time: 61.5 })).toBe('00:01:01:15');
    expect(formatTextTimecode(3725, 25)).toBe('01:02:05:00');
  });
});

describe('easing presets', () => {
  it('resolves presets and css cubic-bezier strings and rejects invalid curves', () => {
    expect(resolveEasingCurve('expo-out')).toEqual(KEYFRAME_EASING_PRESETS['expo-out'].points);
    expect(resolveEasingCurve('Back_Out')).toEqual(KEYFRAME_EASING_PRESETS['back-out'].points);
    expect(resolveEasingCurve('cubic-bezier(0.2, 1.4, 0.4, 1)')).toEqual([0.2, 1.4, 0.4, 1]);
    expect(resolveEasingCurve('cubic-bezier(1.4, 0, 0.4, 1)')).toBeNull();
    expect(resolveEasingCurve('bouncy')).toBeNull();
  });

  it('materializes a curve as segment handles that every keyframe consumer interpolates', () => {
    const keys: Keyframe[] = [
      { id: 'a', clipId: 'c', time: 0, property: 'opacity', value: 0, easing: 'linear' },
      { id: 'b', clipId: 'c', time: 1, property: 'opacity', value: 1, easing: 'linear' },
    ];
    const eased = applyEasingCurveToKeyframes(keys, new Set(['a']), KEYFRAME_EASING_PRESETS['expo-out'].points);
    expect(eased[0]).toMatchObject({ easing: 'bezier', handleOut: segmentHandlesForCurve(KEYFRAME_EASING_PRESETS['expo-out'].points, keys[0]!, keys[1]!).handleOut });
    expect(eased[1]!.handleIn).toBeDefined();
    expect(interpolateKeyframes(eased, 'opacity', 0.25, 0)).toBeGreaterThan(0.75);
    const back = applyEasingCurveToKeyframes(keys, new Set(['a']), KEYFRAME_EASING_PRESETS['back-out'].points);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(t => interpolateKeyframes(back, 'opacity', t, 0)))).toBeGreaterThan(1);
    const plain = applyEasingCurveToKeyframes(eased, new Set(['a']), null, 'ease-in');
    expect(plain[0]).toMatchObject({ easing: 'ease-in' });
    expect(plain[0]!.handleOut).toBeUndefined();
    expect(plain[1]!.handleIn).toBeUndefined();
  });
});

