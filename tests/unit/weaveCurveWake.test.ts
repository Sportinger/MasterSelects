import { describe, expect, it } from 'vitest';
import { createWaveStrandsGraph, geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { readCurveWake, isCurveWake } from '../../src/services/operators/geometry/curveWake';

function graphWithWake() {
  const graph = createWaveStrandsGraph();
  const input = graph.edges.find(edge => edge.to === 'render' && edge.input === 'curves')!;
  input.to = 'wake';
  graph.nodes.push({ id: 'wake', operator: 'geometry.curve-wake', operatorVersion: 1, bindings: {}, constants: { count: 12000 } });
  graph.edges.push({ id: 'wake-render', from: 'wake', output: 'curves', to: 'render', input: 'curves' });
  return graph;
}

describe('Curve Particle Wake', () => {
  it('adds render metadata without adding geometry work and bypasses independently', () => {
    const graph = graphWithWake(), reader = geometryParameterReader({});
    const baseline = compileGeometryGraph(createWaveStrandsGraph(), reader);
    const program = compileGeometryGraph(graph, reader);
    expect(program.stages).toEqual(baseline.stages);
    expect(program.render?.wake?.count).toBe(12000);
    expect(isGeometryProgram(program)).toBe(true);
    graph.nodes.find(node => node.id === 'wake')!.bypassed = true;
    expect(compileGeometryGraph(graph, reader)).toEqual(baseline);
  });

  it('accepts a source clock as phase but rejects a varying point field', () => {
    const graph = graphWithWake();
    graph.nodes.push({ id: 'clock', operator: 'geometry.clip-time', operatorVersion: 1, bindings: {} });
    const edge = { id: 'phase', from: 'clock', output: 'value', to: 'wake', input: 'pulsePhase' };
    graph.edges.push(edge);
    const program = compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: 3.25 });
    expect(program.render?.wake?.pulsePhase).toBe(3.25);
    edge.from = 'info'; edge.output = 'u';
    expect(() => compileGeometryGraph(graph, geometryParameterReader({}))).toThrow(/must be uniform/);
  });

  it('validates transport and rejects invalid limits instead of silently clamping', () => {
    const spec = readCurveWake(() => undefined);
    expect(isCurveWake(spec)).toBe(true);
    for (const patch of [{ count: 1.5 }, { count: 65537 }, { pulseRate: -1 }, { drag: 0 }, { opacity: NaN }, { color: 'red' }, { gpuBuffer: {} }])
      expect(isCurveWake({ ...spec, ...patch })).toBe(false);
  });
});
