import { describe, expect, it } from 'vitest';
import { KALEIDOSCOPE_PRESETS, kaleidoscope } from '../../src/effects/distort/kaleidoscope';
import { getDefaultParams, getEffect } from '../../src/effects';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import type { Effect } from '../../src/types/effects';

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

describe('Kaleidoscope Source Angle default', () => {
  it('starts new effects on the slice below the centre (75°) and keeps 0° for instances saved without the key', () => {
    expect(getDefaultParams('kaleidoscope').sourceAngle).toBeCloseTo(75 * Math.PI / 180, 12);
    expect(kaleidoscope.params.sourceAngle.legacyDefault).toBe(0);
    const saved = { id: 'k-1', name: 'Kaleidoscope', type: 'kaleidoscope', enabled: true, params: { segments: 6, zoom: 1 } } as Effect;
    expect(migratePersistedEffectOperatorGraph(saved).params.sourceAngle).toBe(0);
    const stored = { ...saved, params: { ...saved.params, sourceAngle: 0.5 } } as Effect;
    expect(migratePersistedEffectOperatorGraph(stored).params.sourceAngle).toBe(0.5);
  });

  it('marks the angle controls of the D2 effects as repeating every turn, so typed values are not capped at the slider ends', () => {
    for (const [type, key] of [['kaleidoscope', 'rotation'], ['kaleidoscope', 'sourceAngle'], ['wave', 'phase'], ['mirror', 'angle'], ['rgb-split', 'angle']] as const) {
      expect(getEffect(type)!.params[key].wraps, `${type}.${key}`).toBe(true);
    }
    expect(getEffect('wave')!.params.phase.unit).toBe('°');
  });
});
