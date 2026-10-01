import { describe, expect, it } from 'vitest';
import { rodChain, surfaceBindChain } from '../../src/engine/native3d/passes/strandGpuChains';
import { strandRadiusFieldCode } from '../../src/engine/native3d/passes/strandFieldShader';
import { colorConstraints, buildRodTopology } from '../../src/services/operators/geometry/rodTopology';
import { buildRodRest } from '../../src/services/operators/geometry/rodRest';
import { knotCurves, KNOT_SHAPES } from '../../src/services/operators/geometry/knotCurves';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { createDefaultWeaveGraph, geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const weaveAt = (time: number) => {
  const effect: Effect = { id: 'fx', name: 'Weave', type: 'weave', enabled: true, params: {}, operatorGraph: createDefaultWeaveGraph() };
  return buildStrandsLayerSources({ id: 'clip', effects: [effect], startTime: 0, inPoint: 0, outPoint: 10, duration: 10 }, time, [])[0].source.strands.program;
};

describe('GPU tails of geometry programs', () => {
  it('runs Thread Along and the yarn radius of the default weave on the GPU, keeping the rest curves fixed', () => {
    const early = surfaceBindChain(weaveAt(1.5).stages)!, later = surfaceBindChain(weaveAt(1.6).stages)!;
    expect(early.restStages.map(stage => stage.kind)).toEqual(['weave-pattern', 'set-position']);
    expect(JSON.stringify(early.restStages)).toBe(JSON.stringify(later.restStages));
    expect(early.thread!.progress).toBeLessThan(later.thread!.progress);
    expect(early.fields!.code).toContain('fn strandRadiusScale');
    expect(early.fields!.code).toContain('fieldNoise(');
    // Constants are values, not code: the pipeline survives an animated Reveal or Irregularity.
    expect(early.fields!.code).toBe(later.fields!.code);
    expect(early.fields!.constants.length).toBeGreaterThan(0);
  });

  it('simulates a Rod Simulation followed by Yarn Profiles on the GPU, with a topology that ignores time', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
      { id: 'knot', operator: 'geometry.knot', operatorVersion: 1, bindings: {}, constants: { shape: 'reef', points: 140 } },
      { id: 'rod', operator: 'geometry.rod-simulation', operatorVersion: 1, bindings: {}, constants: { pull: 0.2 } },
      { id: 'yarn', operator: 'geometry.yarn-profile', operatorVersion: 1, bindings: {} },
      { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
    ], edges: [
      { id: 'a', from: 'knot', output: 'curves', to: 'rod', input: 'curves' },
      { id: 'b', from: 'rod', output: 'curves', to: 'yarn', input: 'curves' },
      { id: 'c', from: 'yarn', output: 'curves', to: 'render', input: 'curves' },
      { id: 'd', from: 'render', output: 'scene', to: 'output', input: 'scene' },
    ] };
    const at = (time: number) => rodChain(compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: time }).stages)!;
    expect(at(0.5).restStages.map(stage => stage.kind)).toEqual(['knot']);
    expect(at(0.5).topology).toBe(at(2).topology);
    expect(at(0.5).rod.time).toBe(0.5);
    expect(surfaceBindChain(at(0.5).restStages)).toBeNull();
    expect(rodChain(weaveAt(1).stages)).toBeNull();
  });

  it('colours constraints so that no two of one colour share a node', () => {
    const check = (count: number, nodes: number, nodesOf: (index: number) => number[]) => {
      const colors = colorConstraints(count, nodes, nodesOf);
      for (const list of colors) {
        const used = new Set<number>();
        for (const index of list) for (const node of nodesOf(index)) { expect(used.has(node)).toBe(false); used.add(node); }
      }
      expect(colors.reduce((sum, list) => sum + list.length, 0)).toBe(count);
      return colors.length;
    };
    expect(check(9, 10, k => [k, k + 1])).toBe(2);
    expect(check(9, 9, k => [k, (k + 1) % 9])).toBe(3);
    const ring = buildRodTopology(buildRodRest(knotCurves({ shape: KNOT_SHAPES.indexOf('trefoil'), p: 2, q: 3, size: 0.5, depth: 0.1, points: 121 }), 0, 0));
    expect(ring.stretchColors.length).toBeLessThanOrEqual(3);
    expect(ring.bendColors.length).toBeLessThanOrEqual(4);
    expect(ring.mass.every(value => value > 0)).toBe(true);
  });

  it('compiles radius fields to WGSL and rejects operations without a GPU form', () => {
    const field = { instructions: [
      { nodeId: 'u', operation: 'curve-u', type: 'scalar' as const, inputs: [] },
      { nodeId: 'k', operation: 'constant', type: 'scalar' as const, inputs: [], value: 2 },
      { nodeId: 'm', operation: 'multiply-scalar', type: 'scalar' as const, inputs: [0, 1] },
    ], output: 2 };
    const code = strandRadiusFieldCode([field]);
    expect(code.constants).toEqual([2]);
    expect(code.code).toContain('let r2 = r0 * r1;');
    expect(code.code).toContain('max(0.0, radiusField0(ctx))');
    expect(strandRadiusFieldCode([]).code).toContain('return 1.0;');
    expect(() => strandRadiusFieldCode([{ instructions: [{ nodeId: 'x', operation: 'no-such-operation', type: 'scalar', inputs: [] }], output: 0 }]))
      .toThrow('No GPU curve field operation');
  });
});
