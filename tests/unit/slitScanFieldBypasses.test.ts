import { withSlitScanFieldGroups } from '../../src/services/operators/slitScanFieldGroups';
import { expandOperatorCompositions, packOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { createDefaultSlitScanGraph } from '../../src/services/operators/slitScanEffectGraph';
﻿import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { effectOperatorGraph, effectOperatorCompileContext } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { operatorGroupBypassRoutes } from '../../src/services/operators/operatorGroupBypass';
import { evaluateMaterializedImage } from '../helpers/evaluateMaterializedImage';
function prepare(params: Record<string, unknown>, bypass?: string) {
  const values = { ...getDefaultParams('slit-scan'), delay: 2, scanSmoothing: 0, scanSmoothingPreview: false, ...params };
  const graph = effectOperatorGraph({ type: 'slit-scan', params: values });
  if (bypass) graph.groups = graph.groups?.map(group => group.id === bypass ? { ...group, bypassed: true } : group);
  const plan = compileImageOperatorGraph(graph, values, effectOperatorCompileContext({ type: 'slit-scan' }));
  const pixel = evaluateMaterializedImage(plan, [.2, .4, .6, 1], { uv: [.25, .5], resolution: [100, 100], timelineTimeSeconds: 1,
    sampleResource: () => [0, 0, 0, 0], sampleInputHistory: (_uv, delay) => [delay, delay, delay, 1] });
  return { graph, plan, pixel };
}
describe('time field inspector bypasses', () => {
  it('exposes a valid independent bypass boundary for every new processing section', () => {
    const { graph } = prepare({});
    for (const id of ['time-map', 'field-shaping', 'field-combination', 'field-noise', 'field-motion', 'rgb-time']) {
      const group = graph.groups?.find(group => group.id === id)!;
      expect(group, id).toBeDefined();
      expect(operatorGroupBypassRoutes(graph, group), id).toBeDefined();
    }
  });
  it('adds the same boundaries to saved expanded compositions and survives packing', () => {
    const expanded = expandOperatorCompositions(createDefaultSlitScanGraph());
    const before = structuredClone(expanded);
    const upgraded = withSlitScanFieldGroups(expanded);
    const roundtrip = expandOperatorCompositions(packOperatorCompositions(upgraded));
    for (const id of ['field-shaping', 'field-combination', 'field-noise', 'field-motion', 'rgb-time']) {
      const group = roundtrip.groups!.find(group => group.id === id)!;
      expect(operatorGroupBypassRoutes(roundtrip, group), id).toBeDefined();
    }
    expect(expanded).toEqual(before);
  });

  it('bypasses shaping and combination independently without overwriting stored values', () => {
    const params = { mapSource: 'input', mapChannel: 'red', mapAmount: 1, mapGamma: 2, mapNoiseAmount: 1 };
    expect(prepare(params, 'field-combination').pixel[0]).toBeCloseTo(.08);
    expect(prepare({ ...params, mapNoiseAmount: 0 }, 'field-shaping').pixel[0]).toBeCloseTo(.4);
  });
  it('bypasses primary noise to the profile and removes only secondary noise from image fields', () => {
    expect(prepare({ mapSource: 'noise', mapAmount: 1 }, 'field-noise').pixel[0]).toBeCloseTo(.5);
    expect(prepare({ mapSource: 'input', mapChannel: 'red', mapAmount: 1, mapNoiseAmount: 1 }, 'field-noise').pixel[0]).toBeCloseTo(.4);
  });
  it('bypasses RGB to linked time and prunes motion analysis when its section is off', () => {
    const rgb = prepare({ rgbTimeMode: 'separate', rgbRedOffset: 1 }, 'rgb-time');
    expect(rgb.pixel[0]).toBeCloseTo(.5);
    expect(new Set(rgb.plan.externalResources?.filter(resource => resource.kind === 'input-history').map(resource => resource.owner)).size).toBe(1);
    const motion = prepare({ mapSource: 'motion', mapAmount: 1 }, 'field-motion');
    expect(motion.plan.externalResources?.some(resource => resource.kind === 'source-motion')).toBe(false);
    expect(motion.pixel[0]).toBeCloseTo(.5);
  });
});
