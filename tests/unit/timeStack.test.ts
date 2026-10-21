import { describe, expect, it } from 'vitest';
import { createDefaultTimeStackGraph, createLegacyTimeStackGraph, timeStackGraphReadsDecay, upgradeTimeStackGraph } from '../../src/services/operators/timeStackEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { BLEND_MODES } from '../../src/types/blendMode';
import { SEQUENCE_BLEND_MODES } from '../../src/services/operators/sequenceBlendModes';
import { prepareImageEffect } from '../../src/services/operators/imageEffectRuntimePlan';
import { timeStack } from '../../src/effects/time/time-stack';
import { timeStackDecay, timeStackSettings } from '../../src/effects/time/time-stack/settings';
import { blendSequencePixel } from '../../src/services/operators/sequenceBlend';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { instantiateEffectPreset } from '../../src/services/nodeGraph/effectPresetLibrary';
import { getEffectDescriptorForPath } from '../../src/services/properties/effectProperties';
import { unusedParamWarnings } from '../../src/services/operators/effectParamVisibility';

const defaults = Object.fromEntries(Object.entries(timeStack.params).map(([key, schema]) => [key, schema.default]));
const context = { allowInputHistory: true, parameterSchema: timeStack.params };
const frame: [number, number, number, number] = [0.8, 0.6, 0.4, 1];
// The structural tests compare equal-opacity copies (Decay 1); Decay has its own tests below.
const plan = (params: Record<string, unknown> = {}) => compileImageOperatorGraph(createDefaultTimeStackGraph(), { ...defaults, decay: 1, ...params }, context);

describe('Time Stack graph', () => {
  it('uses one temporal sampler for twenty distinct offsets and darkens each RGB channel', () => {
    const compiled = plan({ blendMode: 'darken' }); const delays: number[] = [];
    const result = evaluateImageOperatorPlan(compiled, frame, { timelineTimeSeconds: 0, uv: [0.5, 0.5], sampleInputHistory: (_uv, delay) => {
      delays.push(delay); return [0.8 - delay / 4, 0.6, 0.4 + delay / 8, 1];
    } });
    expect(delays).toHaveLength(20);
    delays.forEach((delay, i) => expect(delay).toBeCloseTo(i * 0.1));
    expect(result[0]).toBeCloseTo(0.325); expect(result.slice(1)).toEqual([0.6, 0.4, 1]);
    expect(compiled.externalResources?.filter(resource => resource.kind === 'input-history')).toHaveLength(2);
    expect(createLegacyTimeStackGraph().nodes).toHaveLength(11);
    expect(createDefaultTimeStackGraph().nodes).toHaveLength(15);
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

  it('defaults new stacks to Lighten (lit performers on a dark stage) with Decay 0.8; saves from before Decay load with 1', () => {
    expect(defaults).toMatchObject({ blendMode: 'lighten', decay: 0.8, count: 20, offset: 0.1 });
    const old = { id: 'ts', name: 'Time Stack', type: 'time-stack', enabled: true, params: { count: 20, offset: 0.1, blendMode: 'darken' } };
    expect(migratePersistedEffectOperatorGraph(old as never).params).toMatchObject({ decay: 1, blendMode: 'darken' });
    expect(migratePersistedEffectOperatorGraph({ ...old, params: { ...old.params, decay: 0.5 } } as never).params.decay).toBe(0.5);
  });

  it('renders a Time Stack stored without Decay (old preset or project) with Decay 1 before and after saving', () => {
    // An effect preset saved before Decay existed: no decay param, the pre-Decay graph.
    const preset = { id: 'p', label: 'Old stack', effect: { type: 'time-stack', enabled: true,
      params: { count: 20, offset: 0.1, blendMode: 'darken' }, operatorGraph: createLegacyTimeStackGraph() } };
    const live = instantiateEffectPreset(preset as never);
    // Instantiation runs the saved-project upgrade (effectPresetLibrary.ts), which stores the legacy Decay 1.
    expect(live.params.decay).toBe(1);
    const saved = migratePersistedEffectOperatorGraph(live);
    expect(saved.params.decay).toBe(1);
    // Every reader agrees on 1: the graph parameters, the inspector helper and the property registry.
    expect(effectOperatorParams(live).decay).toBe(1);
    expect(effectOperatorParams(saved).decay).toBe(1);
    expect(timeStackDecay(live.params).decay).toBe(1);
    const clip = { effects: [live] } as never;
    const path = `effect.${live.id}.decay`;
    expect(getEffectDescriptorForPath(path, clip)?.read?.(clip, path)).toBe(1);
    // Same image before and after the save round trip.
    const samples: [number, number, number, number][] = [[0.2, 0.3, 0.4, 1], [0.7, 0.1, 0.5, 0.8], [0.4, 0.9, 0.2, 1]];
    const render = (effect: typeof live) => evaluateImageOperatorPlan(prepareImageEffect({ ...effect, params: { ...effect.params, count: 3, offset: 1 } }).plan!,
      samples[0], { timelineTimeSeconds: 0, uv: [0.5, 0.5], sampleInputHistory: (_uv, delay) => samples[Math.round(delay)] });
    expect(render(live)).toEqual(render(saved));
    // A fresh effect stores its 0.8 explicitly and keeps it.
    expect(effectOperatorParams({ type: 'time-stack', params: { ...defaults } }).decay).toBe(0.8);
  });

  it('reads count and offset given as numeric text like the graph does, and null as the default', () => {
    expect(timeStackSettings({ count: '12', offset: '0.5' })).toMatchObject({ count: 12, offset: 0.5 });
    expect(timeStackSettings({ count: null, offset: 'abc' })).toMatchObject({ count: 20, offset: 0.1 });
  });

  it('draws the current frame first and older copies over it: Decay trails the subject in Lighten, buries it in Normal', () => {
    // 20 copies, the current frame white and every past frame black. Independent reference: the share of the
    // current frame after compositing copy i (opacity decay^i) over it in order.
    const share = (decay: number) => Array.from({ length: 19 }, (_, i) => 1 - decay ** (i + 1)).reduce((product, keep) => product * keep, 1);
    const run = (blendMode: string, decay: number) => evaluateImageOperatorPlan(plan({ count: 20, offset: 0.1, blendMode, decay }), [1, 1, 1, 1], {
      timelineTimeSeconds: 0, uv: [0.5, 0.5], sampleInputHistory: (_uv, delay) => delay > 0 ? [0, 0, 0, 1] : [1, 1, 1, 1] })[0];
    expect(run('lighten', 0.8)).toBeCloseTo(1, 5);
    expect(run('normal', 0.8)).toBeCloseTo(share(0.8), 4);
    expect(run('normal', 0.8)).toBeLessThan(0.01);
    expect(run('normal', 1)).toBeCloseTo(0, 5);
  });

  it('tells tools that Decay does nothing on a graph edited before it existed', () => {
    const edited = createLegacyTimeStackGraph(); edited.nodes.find(node => node.id === 'delay')!.bypassed = true;
    expect(unusedParamWarnings({ type: 'time-stack', params: defaults, operatorGraph: edited }, ['decay'])).toEqual([expect.stringContaining('decay')]);
    expect(unusedParamWarnings({ type: 'time-stack', params: defaults }, ['decay'])).toEqual([]);
  });

  it('fades older instances by Decay: instance i blends with opacity decay^i', () => {
    const samples: [number, number, number, number][] = [[0.2, 0.2, 0.2, 1], [0.9, 0.5, 0.1, 1], [0.6, 0.95, 0.3, 1], [1, 1, 1, 1]];
    for (const decay of [1, 0.6, 0.25, 0]) for (const blendMode of ['lighten', 'normal', 'screen']) {
      const mode = timeStack.params.blendMode.options!.findIndex(option => option.value === blendMode);
      const result = evaluateImageOperatorPlan(plan({ count: 4, offset: 1, blendMode, decay }), samples[0], {
        timelineTimeSeconds: 0, uv: [0.5, 0.5], sampleInputHistory: (_uv, delay) => samples[Math.round(delay)],
      });
      // Independent reference: Decay 0 is used as the 0.0001 floor (the first instance always counts fully).
      const used = Math.max(decay, 0.0001);
      const expected = samples.reduce((back, front, index) => blendSequencePixel(back, front, mode, used ** index), [0, 0, 0, 0]);
      result.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 5));
    }
  });

  it('turns out-of-range Decay into a defined, reported value', () => {
    expect(timeStackDecay({})).toEqual({ decay: 1, clamped: false, invalid: false });
    expect(timeStackDecay({ decay: 0.5 })).toEqual({ decay: 0.5, clamped: false, invalid: false });
    expect(timeStackDecay({ decay: -2 })).toEqual({ decay: 0.0001, clamped: true, invalid: false });
    expect(timeStackDecay({ decay: 7 })).toEqual({ decay: 1, clamped: true, invalid: false });
    expect(timeStackDecay({ decay: Number.NaN })).toEqual({ decay: 0.8, clamped: false, invalid: true });
    // The render path uses the same value for unusable input (effectOperatorParams), never a failing graph.
    for (const decay of [Number.NaN, null, 'abc', Number.POSITIVE_INFINITY]) {
      const effect = { type: 'time-stack', params: { ...defaults, count: 3, offset: 1, decay } };
      expect(() => prepareImageEffect(effect), String(decay)).not.toThrow();
    }
    for (const decay of [-2, 7, 0]) {
      const result = evaluateImageOperatorPlan(plan({ count: 3, offset: 1, decay }), frame, { timelineTimeSeconds: 0, uv: [0, 0],
        sampleInputHistory: (_uv, delay) => delay > 0 ? [1, 1, 1, 1] : frame });
      expect(result.every(Number.isFinite)).toBe(true);
    }
  });

  it('upgrades an untouched saved graph from before Decay to the same image, and keeps edited graphs', () => {
    const legacy = createLegacyTimeStackGraph();
    const upgraded = upgradeTimeStackGraph(legacy);
    expect(timeStackGraphReadsDecay(upgraded)).toBe(true);
    const samples: [number, number, number, number][] = [[0.2, 0.3, 0.4, 1], [0.7, 0.1, 0.5, 0.8], [0.4, 0.9, 0.2, 1]];
    const run = (graph: typeof legacy, params: Record<string, unknown>) => evaluateImageOperatorPlan(
      compileImageOperatorGraph(graph, { ...defaults, count: 3, offset: 1, ...params }, context), samples[0],
      { timelineTimeSeconds: 0, uv: [0.5, 0.5], sampleInputHistory: (_uv, delay) => samples[Math.round(delay)] });
    // A saved project loads with Decay 1 (migratePersistedEffectOperatorGraph): exactly what the old graph rendered.
    const saved = { ...defaults, blendMode: 'darken', decay: 1 } as Record<string, unknown>;
    expect(run(upgraded, saved)).toEqual(run(legacy, saved));
    const edited = createLegacyTimeStackGraph(); edited.layout.stack = { x: 1, y: 2 }; edited.nodes.find(node => node.id === 'delay')!.bypassed = true;
    expect(upgradeTimeStackGraph(edited)).toBe(edited);
    expect(timeStackGraphReadsDecay(edited)).toBe(false);
    expect(effectOperatorGraph({ type: 'time-stack', params: defaults, operatorGraph: legacy }).nodes.some(node => node.bindings.value === 'decay')).toBe(true);
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
