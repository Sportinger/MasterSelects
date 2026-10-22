import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { WAVE_PRESETS } from '../../src/effects/distort/wave';

describe('Wave definition', () => {
  const definition = getEffect('wave')!;

  it('is marked as moving with the timeline, so the docs and Look tiles show it as a loop', () => {
    expect(definition.requiresContinuousRender ?? false).toBe(false);
    expect('timelineAnimated' in definition && definition.timelineAnimated).toBe(true);
    const at = (time: number) => definition.packUniforms!({ speed: 0.5 }, 1920, 1080, time)[4];
    expect(at(1) - at(0)).toBeCloseTo(Math.PI);
  });

  it('declares named presets that set the look-defining controls inside their ranges', () => {
    expect(definition.presets).toBe(WAVE_PRESETS);
    expect(WAVE_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const preset of WAVE_PRESETS) {
      expect(Object.keys(preset.params).toSorted()).toEqual(['amplitudeX', 'amplitudeY', 'frequencyX', 'frequencyY', 'speed']);
      for (const [key, value] of Object.entries(preset.params)) {
        const param = definition.params[key];
        expect(typeof value, `${preset.id}.${key}`).toBe('number');
        expect(value as number, `${preset.id}.${key}`).toBeGreaterThanOrEqual(param.min!);
        expect(value as number, `${preset.id}.${key}`).toBeLessThanOrEqual(param.max!);
      }
    }
  });
});
