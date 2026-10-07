import { describe, expect, it } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { rodChain } from '../../src/engine/native3d/passes/strandGpuChains';

function graph(timeScale?: number, timeOffset?: number): EffectOperatorGraph {
  return { version: 1, domain: 'geometry', layout: {}, nodes: [
    { id: 'line', operator: 'geometry.curve-line', bindings: {}, constants: { points: 16, length: 1, axis: 'x' } },
    { id: 'rod', operator: 'geometry.rod-simulation', bindings: {}, constants: { preroll: 0, pin: 'ends', pull: .1,
      ...(timeScale === undefined ? {} : { timeScale }), ...(timeOffset === undefined ? {} : { timeOffset }) } },
    { id: 'render', operator: 'render.strands', bindings: {} },
    { id: 'out', operator: 'scene.output', bindings: {} },
  ], edges: [
    { id: 'a', from: 'line', output: 'curves', to: 'rod', input: 'curves' },
    { id: 'b', from: 'rod', output: 'curves', to: 'render', input: 'curves' },
    { id: 'c', from: 'render', output: 'scene', to: 'out', input: 'scene' },
  ] };
}
const at = (g: EffectOperatorGraph, time: number) => compileGeometryGraph(g, geometryParameterReader({}), undefined, { simulationTime: time });

describe('Rod Simulation clock remapping', () => {
  it('replays exactly the same trajectory in reverse without changing its rest/cache identity', () => {
    const forward = graph(), backward = graph(-1, 2);
    for (const time of [0, .35, 1, 1.9, 2]) {
      const a = at(forward, 2 - time), b = at(backward, time);
      expect(isGeometryProgram(b)).toBe(true);
      expect(b.stages).toEqual(a.stages);
      expect(rodChain(b.stages)?.topology).toBe(rodChain(at(backward, 0).stages)?.topology);
      expect(evaluateGeometryProgram(b).positions).toEqual(evaluateGeometryProgram(a).positions);
    }
  });

  it('holds the initial state after reverse playback reaches zero and supports a frozen clock', () => {
    expect(at(graph(-1, 2), 3).stages).toEqual(at(graph(), 0).stages);
    expect(at(graph(0, .75), 100).stages).toEqual(at(graph(), .75).stages);
    expect(at(graph(2, -.5), .5).stages).toEqual(at(graph(), .5).stages);
    expect(() => at(graph(NaN), 1)).toThrow('Rod time scale');
    expect(() => at(graph(1, Infinity), 1)).toThrow('Rod time offset');
  });
});
