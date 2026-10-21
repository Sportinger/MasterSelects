// One display rule for effect number rows: radians as whole degrees, a scaled unit (Hue Shift's
// turns as degrees), a unit suffix with as many decimals as the value needs, else step decimals.
import { describe, expect, it } from 'vitest';
import { effectParamDisplay } from '../../src/effects/paramDisplay';
import { getEffect } from '../../src/effects';
import { getParameterSourceTarget } from '../../src/services/parameterSources/parameterSourceTargets';
import type { Effect } from '../../src/types/effects';

describe('effect parameter display', () => {
  it('shows radians as whole degrees with one-degree steps', () => {
    expect(effectParamDisplay(getEffect('twirl')!.params.amount, 1)).toEqual({ scale: 180 / Math.PI, suffix: '°', step: 1, decimals: 0 });
  });

  it('scales Hue Shift turns to degrees and keeps unit decimals the value needs', () => {
    const display = effectParamDisplay(getEffect('hue-shift')!.params.shift, 0.25);
    expect(display.scale).toBe(360);
    expect(display.suffix).toBe('°');
    expect(display.step).toBeCloseTo(1, 12);
    expect(display.decimals).toBe(0);
    expect(effectParamDisplay({ step: 0.1, unit: ' EV' }, 0.25)).toEqual({ scale: 1, step: 0.1, suffix: ' EV', decimals: 2 });
  });

  it('gives plain rows the decimals their step implies', () => {
    expect(effectParamDisplay({ step: 0.05 })).toEqual({ scale: 1, step: 0.05, decimals: 2 });
    expect(effectParamDisplay({})).toEqual({ scale: 1, step: 0.01, decimals: 2 });
  });

  it('hands the display to parameter-source rows outside the effect inspector', () => {
    const hue = { id: 'hue-1', name: 'Hue Shift', type: 'hue-shift', enabled: true, params: { shift: 0.25 } } as Effect;
    const target = getParameterSourceTarget({ effects: [hue], startTime: 0 }, 'effect.hue-1.shift');
    expect(target?.display).toMatchObject({ scale: 360, suffix: '°' });
  });
});
