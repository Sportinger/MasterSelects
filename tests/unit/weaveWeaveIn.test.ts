import { describe, expect, it } from 'vitest';
import { createDefaultWeaveGraph, geometryParameterReader, validateWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const flat = () => {
  const graph = createDefaultWeaveGraph();
  graph.groups!.find(group => group.id === 'wind-cloth')!.bypassed = true;
  return graph;
};
const compileAt = (graph: EffectOperatorGraph, simulationTime: number, params: Record<string, unknown> = {}) =>
  compileGeometryGraph(graph, geometryParameterReader(params), undefined, { simulationTime });
const visibleShare = (radius: Float32Array) => radius.filter(value => value > 0).length / radius.length;

describe('Weave In', () => {
  it('weaves the threads in over the first four seconds of the clip', () => {
    const graph = flat();
    expect(validateWeaveGraph(graph)).toEqual([]);
    const at = (time: number) => evaluateGeometryProgram(compileAt(graph, time)).radius!;
    expect(visibleShare(at(0))).toBeLessThan(0.01);
    const early = visibleShare(at(1)), middle = visibleShare(at(2.5));
    expect(early).toBeGreaterThan(0.02);
    expect(middle).toBeGreaterThan(early);
    expect(middle).toBeLessThan(0.99);
    const done = at(4);
    expect(Math.min(...done)).toBe(1);
    expect(Math.max(...done)).toBe(1);
    // A growing thread carries a swollen tip.
    expect(Math.max(...at(1))).toBeGreaterThan(1.2);
  });

  it('follows Weave Speed and settles into one program once woven', () => {
    const graph = flat();
    expect(visibleShare(evaluateGeometryProgram(compileAt(graph, 1, { weave_value: 4 })).radius!)).toBe(1);
    const later = JSON.stringify(compileAt(graph, 10)), latest = JSON.stringify(compileAt(graph, 30));
    expect(later).toBe(latest);
    expect(later).not.toContain('"value":10');
    expect(isGeometryProgram(JSON.parse(later))).toBe(true);
  });

  it('shows the finished weave at once when bypassed', () => {
    const graph = flat();
    graph.groups!.find(group => group.id === 'weave-in')!.bypassed = true;
    const radius = evaluateGeometryProgram(compileAt(graph, 0)).radius!;
    expect(Math.min(...radius)).toBe(1);
  });
});
