import { describe, expect, it } from 'vitest';
import {
  contactSheetMediaFrameTimes,
  representativeMediaFrameTimes,
} from '../../src/services/aiTools/handlers/media/mediaPreviewFrames';

describe('representative media preview frames', () => {
  it('uses one second, midpoint, and the ending for normal videos', () => {
    expect(representativeMediaFrameTimes(12)).toEqual([1, 6, 11.95]);
  });

  it('keeps three ordered observations for very short videos', () => {
    expect(representativeMediaFrameTimes(1)).toEqual([0.098, 0.49, 0.882]);
  });

  it('rejects invalid durations', () => {
    expect(() => representativeMediaFrameTimes(0)).toThrow('positive finite video duration');
  });

  it('distributes twenty ordered contact-sheet observations across the source', () => {
    const times = contactSheetMediaFrameTimes(40);

    expect(times).toHaveLength(20);
    expect(times[0]).toBe(0.25);
    expect(times.at(-1)).toBe(39.95);
    expect(times.every((time, index) => index === 0 || time > times[index - 1]!)).toBe(true);
  });

  it('bounds contact sheets to twenty frames', () => {
    expect(() => contactSheetMediaFrameTimes(40, 21)).toThrow('frameCount');
  });
});
