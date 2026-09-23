import { prepareImageEffect } from '../../src/services/operators/imageEffectRuntimePlan';
import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { createDefaultSlitScanGraph } from '../../src/services/operators/slitScanEffectGraph';
import { withSlitScanTimeFields } from '../../src/services/operators/slitScanTimeFieldsGraph';
import { effectOperatorCompileContext, effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { evaluateMaterializedImage } from '../helpers/evaluateMaterializedImage';
import { needsSlitScanTimeMedia } from '../../src/effects/time/slit-scan/timeFieldResources';
import { slitScanTimeFieldPreset } from '../../src/effects/time/slit-scan/timeFieldParameters';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

function sample(overrides: Record<string, unknown>, inputs: { pixel?: [number, number, number, number]; map?: number; mask?: number; protection?: number; time?: number } = {}) {
  const params = { ...getDefaultParams('slit-scan'), delay: 2, mapAmount: 1, ...overrides };
  const graph = effectOperatorGraph({ type: 'slit-scan', params });
  const plan = compileImageOperatorGraph(graph, params, effectOperatorCompileContext({ type: 'slit-scan' }));
  return evaluateMaterializedImage(plan, inputs.pixel ?? [.2, .4, .6, 1], {
    uv: [.25, .5], resolution: [100, 100], timelineTimeSeconds: inputs.time ?? 0,
    sampleResource: id => id === 'slit-scan:time-mask' ? [inputs.mask ?? 0, 0, 0, inputs.mask === undefined ? 0 : 1]
      : id === 'slit-scan:time-map' ? [inputs.map ?? .4, inputs.map ?? .4, inputs.map ?? .4, .8]
        : [inputs.protection ?? 0, 0, 0, 1],
    sampleInputHistory: (_uv, delay) => [delay, delay, delay, 1],
  })[0];
}

function legacyGraph(): EffectOperatorGraph {
  const graph = createDefaultSlitScanGraph();
  graph.nodes = graph.nodes.filter(node => !node.id.startsWith('time-field-'));
  graph.edges = graph.edges.filter(edge => !edge.to.startsWith('time-field-')).map(edge => edge.from.startsWith('time-field-')
    ? { ...edge, from: 'time-map-selected', output: 'value' } : edge);
  graph.layout = Object.fromEntries(Object.entries(graph.layout).filter(([id]) => !id.startsWith('time-field-')));
  graph.groups = graph.groups?.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !id.startsWith('time-field-')) }));
  return graph;
}

describe('Slit Scan time fields', () => {
  it('uses edge strength without requesting external media or source motion', () => {
    expect(sample({ mapSource: 'edges', scanSmoothing: 0 })).toBeCloseTo(0);
    const params = { ...getDefaultParams('slit-scan'), mapSource: 'edges', mapAmount: 1, scanSmoothing: 0 };
    const graph = effectOperatorGraph({ type: 'slit-scan', params });
    const plan = compileImageOperatorGraph(graph, params, effectOperatorCompileContext({ type: 'slit-scan' }));
    expect(plan.externalResources?.some(resource => resource.kind === 'source-motion')).toBe(false);
    expect(needsSlitScanTimeMedia(graph, params)).toBe(false);
  });
  it('uses the effect input channels without requiring an external map', () => {
    expect(sample({ mapSource: 'input', mapChannel: 'red' })).toBeCloseTo(.4);
    expect(sample({ mapSource: 'input', mapChannel: 'green' })).toBeCloseTo(.8);
    expect(sample({ mapSource: 'input', mapChannel: 'blue' })).toBeCloseTo(1.2);
    expect(sample({ mapSource: 'input', mapChannel: 'alpha' })).toBeCloseTo(2);
    expect(sample({ mapSource: 'input', mapChannel: 'value' })).toBeCloseTo(1.2);
  });

  it('shapes the field before bands and applies independent subject protection afterwards', () => {
    expect(sample({ mapMin: .2, mapMax: .6, mapGamma: 2, mapInvert: 'on' })).toBeCloseTo(1.5);
    expect(sample({ mapSource: 'mask' }, { mask: .75, protection: .5 })).toBeCloseTo(.75);
    expect(sample({ mapSource: 'mask', bands: 3 }, { mask: .4 })).toBeCloseTo(1);
    expect(sample({ mapSource: 'mask' })).toBeCloseTo(.5);
  });

  it('fades undefined hue to the scan profile and keeps the full field optional', () => {
    expect(sample({ mapSource: 'input', mapChannel: 'hue' }, { pixel: [.5, .5, .5, 1] })).toBeCloseTo(.5);
    expect(sample({ mapSource: 'input', mapChannel: 'blue', mapAmount: 0 })).toBeCloseTo(.5);
  });

  it('reconstructs noise after seeks and combines it with a map in one sampler', () => {
    const params = { mapSource: 'noise', mapNoiseSeed: 11 };
    const first = sample(params, { time: 1.25 });
    expect(first).toBeGreaterThanOrEqual(0); expect(first).toBeLessThanOrEqual(2);
    sample(params, { time: 10 });
    expect(sample(params, { time: 1.25 })).toBe(first);
    expect(sample({ ...params, mapSource: 'external', mapNoiseAmount: 1, mapCombine: 'mix' }, { time: 1.25 })).toBeCloseTo(first);
    expect(sample({ mapSource: 'external', mapNoiseAmount: 0 })).toBeCloseTo(.8);
  });

  it('upgrades legacy output wiring once and preserves authored channel/profile edits', () => {
    const graph = legacyGraph();
    graph.nodes.find(node => node.id === 'tau')!.constants = { value: 3 };
    const before = structuredClone(graph), upgraded = withSlitScanTimeFields(graph);
    expect(graph).toEqual(before);
    expect(upgraded.nodes.some(node => node.operator === 'field.combine')).toBe(true);
    expect(upgraded.nodes.find(node => node.id === 'tau')!.constants).toEqual({ value: 3 });
    expect(withSlitScanTimeFields(upgraded)).toBe(upgraded);
    const edited = legacyGraph();
    edited.edges.find(edge => edge.to === 'time-map-mix-0' && edge.input === 'b')!.from = 'zero';
    expect(withSlitScanTimeFields(edited)).toBe(edited);
  });

  it('avoids inactive media requests but retains custom named-image consumers', () => {
    const graph = createDefaultSlitScanGraph();
    expect(needsSlitScanTimeMedia(graph, { mapSource: 'input', mapAmount: 1 })).toBe(false);
    expect(needsSlitScanTimeMedia(graph, { mapSource: 'external', mapAmount: 0 })).toBe(false);
    expect(needsSlitScanTimeMedia(graph, { mapSource: 'external', mapAmount: 1 })).toBe(true);
    graph.edges.push({ id: 'custom', from: 'time-map-source', output: 'image', to: 'output', input: 'image' });
    expect(needsSlitScanTimeMedia(graph, { mapSource: 'input', mapAmount: 1 })).toBe(true);
  });

  it('keeps preset application a single parameter patch with neutral shaping', () => {
    expect(slitScanTimeFieldPreset('hue')).toMatchObject({ mapSource: 'input', mapChannel: 'hue', mapAmount: 1, mapGamma: 1 });
    expect(slitScanTimeFieldPreset('shards')).toMatchObject({ mapNoiseMode: 'cells', mapSource: 'noise' });
    expect(slitScanTimeFieldPreset('unknown')).toBeUndefined();
  });
});


describe('motion time field resource contract', () => {
  it('activates independently of smoothing, prunes unselected motion and recompiles source changes', () => {
    const params = { ...getDefaultParams('slit-scan'), mapAmount: 1, mapSource: 'motion', scanSmoothing: 0, scanSmoothingPreview: false };
    const motion = prepareImageEffect({ type: 'slit-scan', params }).plan!;
    expect(motion.externalResources?.filter(item => item.kind === 'source-motion')).toEqual([
      expect.objectContaining({ owner: 'time-field-motion-source', part: 'atlas', lookback: 0, required: true, stabilize: true }),
      expect.objectContaining({ owner: 'time-field-motion-source', part: 'ages', lookback: 0, required: true, stabilize: true }),
    ]);
    const off = prepareImageEffect({ type: 'slit-scan', params: { ...params, mapSource: 'noise' } }).plan!;
    expect(off.externalResources?.some(item => item.kind === 'source-motion')).toBe(false);
    const zero = prepareImageEffect({ type: 'slit-scan', params: { ...params, mapAmount: 0 } }).plan!;
    expect(zero.externalResources?.some(item => item.kind === 'source-motion')).toBe(false);
    const again = prepareImageEffect({ type: 'slit-scan', params }).plan!;
    expect(again.externalResources?.some(item => item.kind === 'source-motion')).toBe(true);
    const graph = effectOperatorGraph({ type: 'slit-scan', params });
    expect(graph.edges.find(edge => edge.to === 'time-field-motion-source' && edge.input === 'delay')?.from).toBe('time-field-motion-zero');
    expect(withSlitScanTimeFields(graph)).toBe(graph);
  });
});
