import { describe, expect, it } from 'vitest';
import { KALEIDOSCOPE_PRESETS, kaleidoscope } from '../../src/effects/distort/kaleidoscope';

describe('Kaleidoscope presets', () => {
  it('name only Segments, Zoom and Source Angle, within the card limits', () => {
    expect(KALEIDOSCOPE_PRESETS.map(preset => preset.name)).toEqual(['Ink Blot', 'Crystal', 'Mandala', 'Tiles']);
    for (const preset of KALEIDOSCOPE_PRESETS) {
      expect(Object.keys(preset.params).toSorted()).toEqual(['segments', 'sourceAngle', 'zoom']);
      for (const [key, value] of Object.entries(preset.params)) {
        const param = kaleidoscope.params[key];
        expect(typeof value).toBe('number');
        expect(value as number).toBeGreaterThanOrEqual(param.min as number);
        expect(value as number).toBeLessThanOrEqual(param.max as number);
      }
      expect(Number.isInteger(preset.params.segments)).toBe(true);
    }
    expect(kaleidoscope.presets).toBe(KALEIDOSCOPE_PRESETS);
  });

  it('read the slice straight below the centre, where a figure in the middle of the frame stands', () => {
    // The read slice is 180° / Segments wide and starts at Source Angle: centred on 90° (down) at 90° − 90° / Segments.
    for (const preset of KALEIDOSCOPE_PRESETS) {
      const segments = preset.params.segments as number;
      const start = (preset.params.sourceAngle as number) * 180 / Math.PI;
      expect(start + 90 / segments).toBeCloseTo(90, 6);
    }
  });
});
