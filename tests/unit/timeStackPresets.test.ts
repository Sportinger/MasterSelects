import { describe, expect, it } from 'vitest';
import { timeStack, TIME_STACK_PRESETS } from '../../src/effects/time/time-stack';
import { timeStackDecay, timeStackReach, timeStackSettings } from '../../src/effects/time/time-stack/settings';
import { createDefaultTimeStackGraph } from '../../src/services/operators/timeStackEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const defaults = Object.fromEntries(Object.entries(timeStack.params).map(([key, schema]) => [key, schema.default]));
const LOOK_KEYS = ['count', 'offset', 'decay', 'blendMode'];

describe('Time Stack presets', () => {
  it('are declared on the effect, set the four look controls and stay within their ranges', () => {
    expect(timeStack.presets).toBe(TIME_STACK_PRESETS);
    expect(TIME_STACK_PRESETS.map(preset => preset.name)).toEqual(['Echo Trail', 'Long Exposure', 'Stroboscope', 'Chorus', 'Afterglow']);
    for (const preset of TIME_STACK_PRESETS) {
      expect(Object.keys(preset.params).toSorted()).toEqual(LOOK_KEYS.toSorted());
      for (const [key, value] of Object.entries(preset.params)) {
        const param = timeStack.params[key];
        if (param.type === 'select') expect(param.options!.map(option => option.value)).toContain(value);
        else {
          expect(value).toBeGreaterThanOrEqual(param.min!);
          expect(value).toBeLessThanOrEqual(param.max!);
        }
      }
      // Nothing the effect clamps: the values render as stored.
      expect(timeStackDecay(preset.params)).toMatchObject({ clamped: false, invalid: false });
      expect(timeStackSettings(preset.params)).toMatchObject({ count: preset.params.count, offset: preset.params.offset });
    }
  });

  it('names the default look Echo Trail, so a new Time Stack shows it in the Preset row', () => {
    const echo = TIME_STACK_PRESETS.find(preset => preset.id === 'echo-trail')!;
    for (const key of LOOK_KEYS) expect(echo.params[key]).toBe(defaults[key]);
  });

  it('shows distinct looks: a long smear, equal strobe copies, a few far-apart dancers and a screen glow', () => {
    const params = (id: string) => TIME_STACK_PRESETS.find(preset => preset.id === id)!.params;
    const span = (id: string) => (Number(params(id).count) - 1) * Number(params(id).offset);
    const oldest = (id: string) => Number(params(id).decay) ** (Number(params(id).count) - 1);
    // Long Exposure: many close copies, still visible at the end of the trail.
    expect(params('long-exposure').offset).toBeLessThan(0.05);
    expect(oldest('long-exposure')).toBeGreaterThan(0.05);
    // Stroboscope: equal copies.
    expect(params('stroboscope').decay).toBe(1);
    // Chorus: few copies, far apart, each one a whole figure.
    expect(params('chorus').count).toBeLessThanOrEqual(6);
    expect(params('chorus').offset).toBeGreaterThanOrEqual(0.5);
    expect(span('chorus')).toBeGreaterThan(span('echo-trail'));
    expect(params('afterglow').blendMode).toBe('screen');
  });

  it('blends equal copies at Stroboscope and fading ones at Echo Trail', () => {
    const context = { allowInputHistory: true, parameterSchema: timeStack.params };
    const grey: [number, number, number, number] = [0.2, 0.2, 0.2, 1];
    const lit: [number, number, number, number] = [0.9, 0.9, 0.9, 1];
    // The present is dark; only the oldest copy is lit. Lighten shows that copy at its opacity.
    const render = (id: string) => {
      const preset = TIME_STACK_PRESETS.find(candidate => candidate.id === id)!.params;
      const plan = compileImageOperatorGraph(createDefaultTimeStackGraph(), { ...defaults, ...preset }, context);
      const last = (Number(preset.count) - 1) * Number(preset.offset);
      return evaluateImageOperatorPlan(plan, grey, { timelineTimeSeconds: 10, uv: [0, 0],
        sampleInputHistory: (_uv, delay) => Math.abs(delay - last) < 1e-6 ? lit : grey })[0];
    };
    expect(render('stroboscope')).toBeCloseTo(0.9, 5);
    expect(render('echo-trail')).toBeLessThan(0.25);
  });
});

describe('Time Stack reach on short clips', () => {
  it('counts the instances that start before the clip ends', () => {
    expect(timeStackReach({}, 6)).toEqual({ visible: 20, count: 20 });
    expect(timeStackReach({ count: 20, offset: 0.5 }, 6)).toEqual({ visible: 12, count: 20, nextStart: 6 });
    expect(timeStackReach({ count: 4, offset: 2 }, 6)).toEqual({ visible: 3, count: 4, nextStart: 6 });
  });

  it('reports a Time offset longer than the clip, where no older copy ever appears', () => {
    expect(timeStackReach({ count: 2, offset: 10 }, 6)).toEqual({ visible: 1, count: 2, nextStart: 10 });
    expect(timeStackReach({ count: 3, offset: 6 }, 6)).toEqual({ visible: 1, count: 3, nextStart: 6 });
  });

  it('stays quiet when every instance fits, at Time offset 0 and without a clip length', () => {
    expect(timeStackReach({ count: 1, offset: 10 }, 6).nextStart).toBeUndefined();
    expect(timeStackReach({ offset: 0 }, 1).nextStart).toBeUndefined();
    expect(timeStackReach({}, Number.NaN).nextStart).toBeUndefined();
  });
});
