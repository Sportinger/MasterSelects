import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import type { EffectParam } from '../../src/effects/types';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { geometryRateTravel, keyframesBindingsLeave } from '../../src/services/operators/geometry/geometryRateTravel';
import { createControlNode } from '../../src/services/parameterSources/controlOperators';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import { createDefaultWeaveGraph, geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';

const key = (effectId: string, param: string, time: number, value: number): Keyframe =>
  ({ id: `${param}-${time}`, clipId: 'clip', property: `effect.${effectId}.${param}` as Keyframe['property'], time, value, easing: 'linear' });

/** Flat and regular Weave (Wind Cloth and Handmade bypassed): the yarn radius shows the Weave In progress. */
const flatWeave = () => {
  const graph = createDefaultWeaveGraph();
  for (const group of graph.groups!) if (group.id === 'wind-cloth' || group.id === 'handmade') group.bypassed = true;
  return graph;
};
const radiusAt = (graph: ReturnType<typeof flatWeave>, simulationTime: number, weave: number) =>
  Array.from(evaluateGeometryProgram(compileGeometryGraph(graph, geometryParameterReader({ weave_value: weave }), undefined, { simulationTime })).radius!);

describe('integrated rates in geometry graphs', () => {
  // Perspective Grid's Speed integrates (rows travelled); the helper only reads that declaration.
  const grid = { id: 'grid', type: 'perspective-grid' };
  const clocks = { clipClockAt: (local: number) => 2 + local, timelineStart: 10 };

  it('travels exactly rate × clock for a rate keyed at one value, so the first key moves nothing', () => {
    const travel = geometryRateTravel(grid, [key('grid', 'speed', 0, 3), key('grid', 'speed', 4, 3)], 1.5, clocks)!;
    expect(travel('speed', 'timeline')).toBeCloseTo(3 * (10 + 1.5), 10);
    expect(travel('speed', 'clip')).toBeCloseTo(3 * (2 + 1.5), 10);
  });

  it('integrates a ramp instead of multiplying the current value, also on a faster clip clock', () => {
    // 0 → 4 over two seconds: ∫ 2t dt from 0 to 1 = 1, where rate × time would jump to 2.
    const keys = [key('grid', 'speed', 0, 0), key('grid', 'speed', 2, 4)];
    expect(geometryRateTravel(grid, keys, 1, { clipClockAt: local => local, timelineStart: 0 })!('speed', 'clip')).toBeCloseTo(1, 10);
    // A clip at double speed runs its clock twice as fast: twice the distance.
    expect(geometryRateTravel(grid, keys, 1, { clipClockAt: local => 2 * local, timelineStart: 0 })!('speed', 'clip')).toBeCloseTo(2, 10);
    // Unkeyed or not integrating: no travel, the program keeps rate × time.
    expect(geometryRateTravel(grid, keys, 1, clocks)!('offset', 'clip')).toBeUndefined();
    expect(geometryRateTravel({ id: 'blur', type: 'gaussian-blur' }, keys, 1, clocks)).toBeUndefined();
  });

  it('leaves out the keyframes a node or the Constant mode replaces, and logs a keyed rate once', async () => {
    const { vi } = await import('vitest');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const keys = [key('grid', 'speed', 0, 0), key('grid', 'speed', 2, 4), key('grid', 'offset', 0, 1)];
      const driven = { 'effect.grid.speed': { source: { nodeId: 'lfo', portId: 'value' }, enabled: true } } as never;
      const left = keyframesBindingsLeave({ ...grid, name: 'Grid' }, keys, driven);
      expect(left.map(keyframe => keyframe.property)).toEqual(['effect.grid.offset']);
      expect(geometryRateTravel(grid, left, 1, clocks)).toBeDefined();
      expect(geometryRateTravel(grid, left, 1, clocks)!('speed', 'clip')).toBeUndefined();
      keyframesBindingsLeave({ ...grid, name: 'Grid' }, keys, driven);
      expect(warn.mock.calls.filter(call => call.join(' ').includes('Grid speed is driven by a source')).length).toBe(1);
      // A disabled source leaves the keyframes in charge; the Constant mode replaces them.
      const off = { 'effect.grid.speed': { source: { nodeId: 'lfo', portId: 'value' }, enabled: false } } as never;
      expect(keyframesBindingsLeave(grid, keys, off)).toHaveLength(3);
      expect(keyframesBindingsLeave(grid, keys, { 'effect.grid.speed': { localMode: 'constant' } } as never)).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });

  it('weaves at the value a node or the Constant mode gives a keyed Weave Speed, not at its keyframes', async () => {
    const { vi } = await import('vitest');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const definition = getEffect('weave')! as { params: Record<string, EffectParam> };
    const params = definition.params;
    definition.params = { ...params, weave_value: { type: 'number', label: 'Weave Speed', default: 1, min: 0, max: 10, step: 0.05, integratedAs: 'weaveTravel' } };
    try {
      const graph = flatWeave();
      // Keys 0 → 0.4 over two seconds read 0.2 at one second; the binding says 0.3.
      const keys = [key('fx', 'weave_value', 0, 0), key('fx', 'weave_value', 2, 0.4)];
      const strands = (targets: Record<string, unknown>, nodes: unknown[] = []) => {
        const effect: Effect = { id: 'fx', type: 'weave', name: 'Weave', enabled: true, operatorGraph: graph, params: { weave_value: 0.3 } };
        const clip = { id: 'clip', effects: [effect], startTime: 0, nodeGraph: { version: 1 as const, nodes: [], parameterSources: {
          version: 1 as const, clipTimeOffset: 0, graph: { version: 1 as const, nodes, edges: [], layout: {} }, targets } } };
        return Array.from(evaluateGeometryProgram(buildStrandsLayerSources(clip as never, 1, keys)[0].source.strands.program).radius!);
      };
      expect(strands({ 'effect.fx.weave_value': { localMode: 'constant' } })).toEqual(radiusAt(graph, 1, 0.3));
      const node = createControlNode('values.number', 'level');
      node.constants = { value: 0.6 };
      expect(strands({ 'effect.fx.weave_value': { source: { nodeId: 'level', portId: 'value' } } }, [node])).toEqual(radiusAt(graph, 1, 0.6));
      expect(radiusAt(graph, 1, 0.3)).not.toEqual(radiusAt(graph, 1, 0.2));
    } finally { definition.params = params; warn.mockRestore(); }
  });

  it('lowers Clip Time × a travelling rate in the Weave In progress to the travelled distance', () => {
    const graph = flatWeave();
    const withTravel = evaluateGeometryProgram(compileGeometryGraph(graph, geometryParameterReader({ weave_value: 9 }), undefined,
      { simulationTime: 1, rateTravel: (rate, clock) => (rate === 'weave_value' && clock === 'clip' ? 2 : undefined) })).radius!;
    // Travel 2 is where Weave Speed 1 is after two seconds, whatever the current speed (9) says.
    expect(Array.from(withTravel)).toEqual(radiusAt(graph, 2, 1));
    expect(Array.from(withTravel)).not.toEqual(radiusAt(graph, 1, 9));
  });

  it('weaves smoothly under a keyframed Weave Speed when it integrates (as Weave on its own branch declares)', () => {
    const definition = getEffect('weave')! as { params: Record<string, EffectParam> };
    const params = definition.params;
    definition.params = { ...params, weave_value: { type: 'number', label: 'Weave Speed', default: 1, min: 0, max: 10, step: 0.05, integratedAs: 'weaveTravel' } };
    try {
      const graph = flatWeave();
      const effect: Effect = { id: 'fx', type: 'weave', name: 'Weave', enabled: true, operatorGraph: graph, params: { weave_value: 1 } };
      const clip = { id: 'clip', effects: [effect], startTime: 0 };
      const keys = [key('fx', 'weave_value', 0, 0), key('fx', 'weave_value', 2, 4)];
      const [source] = buildStrandsLayerSources(clip, 1, keys);
      // At one second the ramp has travelled 1 (Weave Speed 1 for one second), not 2 × 1.
      expect(Array.from(evaluateGeometryProgram(source.source.strands.program).radius!)).toEqual(radiusAt(graph, 1, 1));
    } finally { definition.params = params; }
  });
});
