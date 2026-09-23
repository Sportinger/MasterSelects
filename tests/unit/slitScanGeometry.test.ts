import { describe, expect, it } from 'vitest';
import { slitScanGeometryAge, slitScanGeometryQuery } from '../../src/effects/time/slit-scan/geometryContract';
import type { TemporalClipSource } from '../../src/effects/time/temporalClipSource';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

describe('Slit Scan geometry source contract', () => {
  it('uses signed source age with expanded time, reverse, and held trim boundaries', () => {
    const source: TemporalClipSource = { mediaId: 'video', localTime: 2, duration: 10,
      inPoint: 5, outPoint: 15, speed: 1, speedKeyframes: [] };
    expect(slitScanGeometryAge(source, .25, 4)).toBe(1);
    expect(slitScanGeometryAge({ ...source, speed: -1 }, .25, 4)).toBe(-1);
    expect(slitScanGeometryAge(source, 10, 4)).toBe(2);
    expect(slitScanGeometryAge({ ...source, sourceOverride: 8 }, .25, 4)).toBe(0);
    expect(() => slitScanGeometryAge(source, 1, Infinity)).toThrow(/finite/);
  });

  it('requires the saved sampler identity and preserves its authored UV and delay edges', () => {
    const graph: EffectOperatorGraph = { version: 1, nodes: [
      { id: 'alpha-source', operator: 'image.sample-history', bindings: {} },
      { id: 'red-source', operator: 'image.sample-history', bindings: {} },
      { id: 'output', operator: 'image.output', bindings: {} },
    ], edges: ['uv', 'delay', 'current'].flatMap(input => ['alpha-source', 'red-source'].map(to => ({
      id: `${to}:${input}`, from: `${to}-${input}`, output: 'value', to, input,
    }))) };
    const before = structuredClone(graph);
    const query = slitScanGeometryQuery(graph, 'alpha-source');
    expect(query.edges.find(edge => edge.to === '__native_demand_uv' && edge.input === 'value')?.from)
      .toBe('alpha-source-uv');
    expect(query.edges.find(edge => edge.to === '__native_demand_rgba' && edge.input === 'z')?.from)
      .toBe('alpha-source-delay');
    expect(graph).toEqual(before);
    expect(() => slitScanGeometryQuery(graph, '')).toThrow(/explicit/);
    expect(() => slitScanGeometryQuery(graph, 'deleted')).toThrow(/unavailable/);
  });
});
