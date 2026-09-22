import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { createDefaultSlitScanGraph } from '../../src/services/operators/slitScanEffectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorCompileContext, effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { InputHistoryClock, inputHistorySize } from '../../src/effects/time/InputHistoryClock';
import { withSlitScanProtection } from '../../src/services/operators/slitScanProtectionGraph';

function sample(uv: [number, number], overrides: Record<string, number | string> = {}, time = 0) {
  const params = { ...getDefaultParams('slit-scan'), ...overrides };
  const plan = compileImageOperatorGraph(createDefaultSlitScanGraph(), params, effectOperatorCompileContext({ type: 'slit-scan' }));
  return evaluateImageOperatorPlan(plan, [0, 0, 0, 1], {
    uv, resolution: [100, 100], timelineTimeSeconds: time,
    sampleResource: id => id === 'slit-scan:time-map'
      ? [Number(overrides.testMap ?? 0), Number(overrides.testMap ?? 0), Number(overrides.testMap ?? 0), Number(overrides.testAlpha ?? 1)]
      : [Number(overrides.testMask ?? 0), 0, 0, 1],
    sampleInputHistory: (_uv, delay, current) => delay === 0 ? current : [delay, delay, delay, 1],
  });
}

describe('Slit Scan editable time displacement', () => {
  it('mixes external luminance or alpha before bands and subject protection', () => {
    expect(sample([1, 0.5], { testMap: 0.2, mapAmount: 1 })[0]).toBeCloseTo(0.2);
    expect(sample([1, 0.5], { testMap: 0.2, mapAmount: 0.5 })[0]).toBeCloseTo(0.6);
    expect(sample([1, 0.5], { testMap: 0.2, mapAmount: 1, mapInvert: 'on' })[0]).toBeCloseTo(0.8);
    expect(sample([1, 0.5], { testMap: 0.2, testAlpha: 0.7, mapAmount: 1, mapChannel: 'alpha' })[0]).toBeCloseTo(0.7);
    expect(sample([1, 0.5], { testMap: 0.4, mapAmount: 1, bands: 4 })[0]).toBeCloseTo(1 / 3);
    expect(sample([1, 0.5], { testMap: 0.4, mapAmount: 1, testMask: 0.5 })[0]).toBeCloseTo(0.2);
    expect(sample([1, 0.5], { testMap: 0.4, mapAmount: 0 })[0]).toBeCloseTo(1);
  });
  it('uses selected mask coverage to protect current time with a soft transition', () => {
    expect(sample([1, 0.5], { testMask: 1 })[0]).toBe(0);
    expect(sample([1, 0.5], { testMask: 0.5 })[0]).toBeCloseTo(0.5);
    expect(sample([1, 0.5], { testMask: 1, maskStrength: 0.25 })[0]).toBeCloseTo(0.75);
    expect(sample([1, 0.5], { testMask: 1, maskStrength: 0 })[0]).toBeCloseTo(1);
  });
  it('previews the actual delay and protection fields as grayscale', () => {
    expect(sample([1, 0.5], { testMask: 0.25, preview: 'mask' })).toEqual([0.25, 0.25, 0.25, 1]);
    expect(sample([1, 0.5], { testMask: 0.25, preview: 'time' })).toEqual([0.75, 0.75, 0.75, 1]);
    expect(sample([0, 0.5], { preview: 'time' })).toEqual([0, 0, 0, 1]);
  });
  it('inserts protection around custom wiring without replacing existing graph edits', () => {
    const graph = createDefaultSlitScanGraph();
    graph.nodes = graph.nodes.filter(node => !node.id.startsWith('subject-'));
    graph.edges = graph.edges.filter(edge => !edge.to.startsWith('subject-'))
      .map(edge => edge.to === 'masked-delay' && edge.input === 'b' ? { ...edge, from: 'safe-mix', output: 'value' } : edge);
    graph.groups = graph.groups?.filter(group => group.id !== 'subject-protection');
    const before = structuredClone(graph);
    const upgraded = withSlitScanProtection(graph);
    expect(graph).toEqual(before);
    expect(upgraded.nodes.slice(0, graph.nodes.length)).toEqual(graph.nodes);
    expect(upgraded.edges.find(edge => edge.to === 'subject-protected' && edge.input === 'a')?.from).toBe('safe-mix');
    expect(withSlitScanProtection(upgraded)).toBe(upgraded);
  });
  it('uses increasing input ages, reverses direction and preserves zero delay/mix', () => {
    expect(sample([0, 0.5])[0]).toBeCloseTo(0);
    expect(sample([1, 0.5])[0]).toBeCloseTo(1);
    expect(sample([0, 0.5], { angle: 180 })[0]).toBeCloseTo(1);
    expect(sample([0.5, 1], { angle: 90 })[0]).toBeCloseTo(1);
    expect(sample([1, 1], { delay: 0 })).toEqual([0, 0, 0, 1]);
    expect(sample([1, 1], { mix: 0 })).toEqual([0, 0, 0, 1]);
  });
  it('protects the center and makes symmetric or animated folded scans', () => {
    expect(sample([0.5, 0.5], { protect: 0.2 })[0]).toBe(0);
    expect(sample([0.5, 0.5], { profile: 'center' })[0]).toBe(0);
    expect(sample([0, 0.5], { profile: 'center' })[0]).toBeCloseTo(sample([1, 0.5], { profile: 'center' })[0]);
    expect(sample([0.5, 0.5], { profile: 'wave', speed: 1 }, 0)[0]).toBeCloseTo(0.5);
    expect(sample([0.5, 0.5], { profile: 'wave', speed: 1 }, 0.25)[0]).toBeCloseTo(1);
  });
  it('retains saved graph edits and requires an explicit history owner', () => {
    const graph = createDefaultSlitScanGraph();
    graph.nodes.find(node => node.id === 'tau')!.constants = { value: 3 };
    const restored = effectOperatorGraph({ type: 'slit-scan', params: getDefaultParams('slit-scan'), operatorGraph: graph });
    expect(restored.nodes.find(node => node.id === 'tau')!.constants).toEqual({ value: 3 });
    expect(() => compileImageOperatorGraph(graph, getDefaultParams('slit-scan'), { ...effectOperatorCompileContext({ type: 'slit-scan' }), allowInputHistory: false })).toThrow(/history/i);
    expect(graph.groups).toHaveLength(8);
  });
  it('supports aspect-aware radial scans, animated rings and discrete time bands', () => {
    expect(sample([0.5, 0.5], { profile: 'radial' })[0]).toBe(0);
    expect(sample([0.5, 1], { profile: 'radial' })[0]).toBeCloseTo(1);
    expect(sample([0.5, 0.5], { profile: 'rings', speed: 1 }, 0.25)[0]).toBeCloseTo(1);
    expect(sample([0.1, 0.5], { bands: 4 })[0]).toBe(0);
    expect(sample([0.3, 0.5], { bands: 4 })[0]).toBeCloseTo(1 / 3);
    expect(sample([0.4, 0.5], { bands: 4 })[0]).toBeCloseTo(1 / 3);
    expect(sample([1, 0.5], { bands: 4 })[0]).toBeCloseTo(1);
  });
});

describe('Input history clock', () => {
  it('keeps live preview tiny without changing the default mask raster size', () => {
    expect(inputHistorySize(1920, 1080, 160)).toEqual([160, 90]);
    expect(inputHistorySize(1080, 1920, 160)).toEqual([90, 160]);
    expect(inputHistorySize(1920, 1080)).toEqual([640, 360]);
  });
  it('holds on duplicate renders, resets on seek/loop/export, and isolates timestamps from render rate', () => {
    const clock = new InputHistoryClock();
    const context = { ownerRevision: 1, eventRevision: 0 };
    expect(clock.update(0, 1, context)).toBe(true);
    expect(clock.update(0, 1, context)).toBe(false);
    expect(clock.update(0.001, 1, context)).toBe(false);
    expect(clock.update(0.1, 1, context)).toBe(true);
    expect(clock.count).toBe(2);
    expect(clock.metadata(0.1)[0]).toBeCloseTo(0.1);
    for (const [index, discontinuity] of (['seek', 'loop', 'export-start'] as const).entries()) {
      expect(clock.update(0.1, 1, { ...context, eventRevision: index + 1, discontinuity })).toBe(true);
      expect(clock.count).toBe(1);
    }
  });
  it('bounds memory and ring length, resets on resize horizon or backwards movement', () => {
    const clock = new InputHistoryClock();
    for (let i = 0; i < 1000; i++) clock.update(i / 30, 1);
    expect(clock.count).toBe(64);
    expect(clock.metadata(999 / 30)[clock.newest * 4]).toBe(0);
    clock.update(34, 2); expect(clock.count).toBe(1);
    clock.update(0, 2); expect(clock.count).toBe(1);
    for (const [w, h] of [[3840, 2160], [2160, 3840], [16000, 100]]) {
      const [x, y] = inputHistorySize(w, h);
      expect(x * y).toBeLessThanOrEqual(230400);
      expect(Math.max(x, y)).toBeLessThanOrEqual(640);
    }
  });
});
