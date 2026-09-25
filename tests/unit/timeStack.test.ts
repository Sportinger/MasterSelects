import { describe, expect, it } from 'vitest';
import { createDefaultTimeStackGraph } from '../../src/services/operators/timeStackEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { BLEND_MODES } from '../../src/types/blendMode';
import { SEQUENCE_BLEND_MODES } from '../../src/services/operators/sequenceBlendModes';
import { prepareImageEffect } from '../../src/services/operators/imageEffectRuntimePlan';
import { timeStack } from '../../src/effects/time/time-stack';
import { timeStackSettings } from '../../src/effects/time/time-stack/settings';
import { blendSequencePixel } from '../../src/services/operators/sequenceBlend';
import { effectOperatorCompileContext, effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';

const defaults = Object.fromEntries(Object.entries(timeStack.params).map(([key, schema]) => [key, schema.default]));
const context = { allowInputHistory: true, parameterSchema: timeStack.params };
const frame: [number, number, number, number] = [0.8, 0.6, 0.4, 1];
const plan = (params: Record<string, unknown> = {}) => compileImageOperatorGraph(createDefaultTimeStackGraph(), { ...defaults, ...params }, context);

describe('Time Stack graph', () => {
  it('uses one temporal sampler for twenty distinct offsets and darkens each RGB channel', () => {
    const compiled = plan(); const delays: number[] = [];
    const result = evaluateImageOperatorPlan(compiled, frame, { timelineTimeSeconds: 0, uv: [0.5, 0.5], sampleInputHistory: (_uv, delay) => {
      delays.push(delay); return [0.8 - delay / 4, 0.6, 0.4 + delay / 8, 1];
    } });
    expect(delays).toHaveLength(20);
    delays.forEach((delay, i) => expect(delay).toBeCloseTo(i * 0.1));
    expect(result[0]).toBeCloseTo(0.325); expect(result.slice(1)).toEqual([0.6, 0.4, 1]);
    expect(compiled.externalResources?.filter(resource => resource.kind === 'input-history')).toHaveLength(2);
    expect(createDefaultTimeStackGraph().nodes).toHaveLength(11);
  });

  it('registers an executable source-time owner without enabling history in unrelated effects', () => {
    const owner = { type: 'time-stack', params: defaults };
    expect(effectOperatorCompileContext(owner).allowInputHistory).toBe(true);
    expect(() => effectOperatorGraph(owner)).not.toThrow();
    expect(() => compileImageOperatorGraph(createDefaultTimeStackGraph(), defaults, { parameterSchema: timeStack.params }))
      .toThrow('explicit compile-context opt-in');
  });

  it.each(['darken', 'lighten', 'multiply', 'screen', 'normal'])('matches sequential source-over for %s', blendMode => {
    const mode = timeStack.params.blendMode.options!.findIndex(option => option.value === blendMode);
    const samples: [number, number, number, number][] = [[0.8, 0.2, 0.4, 0.5], [0.3, 0.9, 0.6, 0.7], [0, 0, 0, 0]];
    const result = evaluateImageOperatorPlan(plan({ count: 3, offset: 1, blendMode }), samples[0], {
      timelineTimeSeconds: 0, uv: [0.5, 0.5], sampleInputHistory: (_uv, delay) => samples[Math.round(delay)],
    });
    const expected = samples.reduce((back, front) => blendSequencePixel(back, front, mode), [0, 0, 0, 0]);
    result.forEach((value, i) => expect(value).toBeCloseTo(expected[i]));
    expect(result[3]).toBeCloseTo(0.85);
  });

  it('does not darken with transparent black, and preserves straight-alpha color', () => {
    expect(blendSequencePixel([0, 0, 0, 0], [0.8, 0.6, 0.4, 0.5], 0)).toEqual([0.8, 0.6, 0.4, 0.5]);
    expect(blendSequencePixel(frame, [0, 0, 0, 0], 0)).toEqual(frame);
  });

  it('supports zero offset, one instance, and the maximum count', () => {
    for (const count of [1, 20, 32]) {
      let calls = 0;
      expect(evaluateImageOperatorPlan(plan({ count, offset: 0 }), frame, { timelineTimeSeconds: 0, uv: [0, 0], sampleInputHistory: (_uv, delay) => {
        expect(delay).toBe(0); calls++; return frame;
      } })).toEqual(frame);
      expect(calls).toBe(count);
    }
  });

  it('starts delayed instances progressively and restores the same state after a seek', () => {
    const initial = timeStackSettings({}, 0.35);
    expect(initial.activeCount).toBe(4); expect(initial.delays).toHaveLength(3);
    expect(timeStackSettings({}, 0).activeCount).toBe(1);
    expect(timeStackSettings({}, 1.9).activeCount).toBe(20);
    expect(timeStackSettings({}, 0.35)).toEqual(initial);
    expect(timeStackSettings({ offset: 0 }, 0).activeCount).toBe(20);
    expect(timeStackSettings({ count: Infinity, offset: NaN }).count).toBe(20);
  });
});


describe('Time Stack blend catalog', () => {
  const index = (name: string) => SEQUENCE_BLEND_MODES.indexOf(name as typeof SEQUENCE_BLEND_MODES[number]);
  it('covers the full timeline catalog without changing saved numeric modes', () => {
    expect([...SEQUENCE_BLEND_MODES].toSorted()).toEqual([...BLEND_MODES].toSorted());
    expect(SEQUENCE_BLEND_MODES.slice(0, 5)).toEqual(['darken', 'lighten', 'multiply', 'screen', 'normal']);
  });
  it.each(BLEND_MODES)('%s stays finite for opaque, transparent and repeated input', mode => {
    const compiled = plan({ count: 20, blendMode: mode });
    const result = evaluateImageOperatorPlan(compiled, frame, { timelineTimeSeconds: 0.4, uv: [0.25, 0.75],
      sampleInputHistory: (_uv, delay) => delay < 1 ? [0, 1, 0.4, 0.3] : [1, 0, 0.8, 0.7] });
    expect(result.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  });
  it.each([
    ['add', [0.9, 1, 1]], ['overlay', [0.28, 0.7, 0.76]], ['difference', [0.5, 0.2, 0.4]],
    ['exclusion', [0.62, 0.5, 0.56]], ['subtract', [0, 0, 0.4]], ['hard-mix', [0, 1, 1]],
  ] as const)('matches known opaque %s reference pixels', (name, expected) => {
    const actual = blendSequencePixel([0.2, 0.5, 0.8, 1], [0.7, 0.7, 0.4, 1], index(name));
    expected.forEach((value, channel) => expect(actual[channel]).toBeCloseTo(value));
  });
  it('uses alpha masks on the accumulated image and seeds the first instance', () => {
    expect(blendSequencePixel([0.2, 0.4, 0.8, 0.8], [1, 1, 1, 0.25], index('stencil-alpha'))).toEqual([0.2, 0.4, 0.8, 0.2]);
    expect(blendSequencePixel([0.2, 0.4, 0.8, 0.8], [1, 1, 1, 0.25], index('silhouette-alpha'))[3]).toBeCloseTo(0.6);
    expect(evaluateImageOperatorPlan(plan({ count: 1, blendMode: 'stencil-alpha' }), frame,
      { timelineTimeSeconds: 0, uv: [0, 0], sampleInputHistory: () => frame })).toEqual(frame);
  });
  it('only rebinds values when switching mode: shader and source resources stay stable', () => {
    const before = prepareImageEffect({ type: 'time-stack', params: defaults }).plan!;
    const after = prepareImageEffect({ type: 'time-stack', params: { ...defaults, blendMode: 'hue' } }).plan!;
    expect(after.wgsl).toBe(before.wgsl);
    expect(after.externalResources).toEqual(before.externalResources);
    expect(after.values).not.toEqual(before.values);
  });
});
