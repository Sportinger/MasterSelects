import { describe, expect, it } from 'vitest';
import { createWaveStrandsGraph, geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { compileGeometryGraph, type GeometryField } from '../../src/services/operators/geometry/geometryProgram';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { packStrandColors, strandColorNeedsPositions } from '../../src/engine/native3d/passes/strandColors';

function coloredGraph() {
  const graph = createWaveStrandsGraph();
  graph.nodes.push(
    { id: 'info-color', operator: 'geometry.curve-info', operatorVersion: 1, bindings: {} },
    { id: 'rgb-color', operator: 'vector.combine.vec3', operatorVersion: 1, bindings: {} },
  );
  graph.edges.push(
    ...(['x', 'y', 'z'] as const).map(input => ({ id: `color-${input}`, from: 'info-color', output: 'u', to: 'rgb-color', input })),
    { id: 'render-color', from: 'rgb-color', output: 'value', to: 'render', input: 'color' },
  );
  return graph;
}

describe('strand color fields', () => {
  it('keeps material colors identical on rest and deformed curves while spatial colors follow deformation', () => {
    const program = compileGeometryGraph(coloredGraph(), geometryParameterReader({}));
    const rest = evaluateGeometryProgram(program);
    const moved = { ...rest, positions: rest.positions.map(value => value + 0.7) };
    const material = program.render!.colorField!;
    expect(strandColorNeedsPositions(material)).toBe(false);
    expect(packStrandColors(rest, material)).toEqual(packStrandColors(moved, material));
    const spatial: GeometryField = { instructions: [{ nodeId: 'p', operation: 'position', type: 'vec3', inputs: [] }], output: 0 };
    expect(strandColorNeedsPositions(spatial)).toBe(true);
    expect(packStrandColors(rest, spatial)).not.toEqual(packStrandColors(moved, spatial));
  });
  it('compiles and transports a color field independently of the uniform fallback', () => {
    const p = compileGeometryGraph(coloredGraph(), geometryParameterReader({}));
    expect(p.render?.colorField).toBeDefined();
    expect(isGeometryProgram(structuredClone(p))).toBe(true);
    const curves = evaluateGeometryProgram(p);
    const colors = packStrandColors(curves, p.render!.colorField!);
    for (let strand = 0; strand < curves.counts.length; strand++) {
      const start = curves.starts[strand], end = start + curves.counts[strand] - 1;
      expect(Array.from(colors.slice(start * 4, start * 4 + 4))).toEqual([0, 0, 0, 1]);
      expect(Array.from(colors.slice(end * 4, end * 4 + 4))).toEqual([1, 1, 1, 1]);
    }
    const invalid = structuredClone(p);
    invalid.render!.colorField!.instructions[invalid.render!.colorField!.output].type = 'scalar';
    expect(isGeometryProgram(invalid)).toBe(false);
    expect(compileGeometryGraph(createWaveStrandsGraph(), geometryParameterReader({})).render?.colorField).toBeUndefined();
  });

  it('uses final positions for colors and clamps out-of-range channels', () => {
    const color: GeometryField = { instructions: [{ nodeId: 'position', operation: 'position', type: 'vec3', inputs: [] }], output: 0 };
    const colors = packStrandColors({ positions: Float32Array.of(-2, 0.4, 3, 0.7, 0.5, 0.2),
      starts: Uint32Array.of(0), counts: Uint32Array.of(2) }, color);
    expect(colors[0]).toBe(0); expect(colors[1]).toBeCloseTo(0.4); expect(colors[2]).toBe(1);
    expect(colors[4]).toBeCloseTo(0.7); expect(colors[7]).toBe(1);
  });

  it('keeps four alternating regions closed at the seam with different offsets per yarn', () => {
    const graph = coloredGraph();
    graph.nodes.push(
      { id: 'phase-step', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0.137508 } },
      { id: 'phase-row', operator: 'math.multiply.scalar', operatorVersion: 1, bindings: {} },
      { id: 'band-phase', operator: 'math.add.scalar', operatorVersion: 1, bindings: {} },
      { id: 'band-cycles', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 4 * Math.PI } },
      { id: 'band-angle', operator: 'math.multiply.scalar', operatorVersion: 1, bindings: {} },
      { id: 'band-wave', operator: 'math.cos.scalar', operatorVersion: 1, bindings: {} },
      { id: 'ramp', operator: 'field.ramp', operatorVersion: 1, bindings: {},
        constants: { x0: -0.25, y0: 1, x1: 0, y1: 0.5, x2: 0.25, y2: 0 } },
    );
    graph.edges = graph.edges.filter(edge => edge.to !== 'rgb-color');
    for (const [from, output, to, input] of [
      ['info-color', 'strand', 'phase-row', 'a'], ['phase-step', 'value', 'phase-row', 'b'],
      ['info-color', 'u', 'band-phase', 'a'], ['phase-row', 'value', 'band-phase', 'b'],
      ['band-phase', 'value', 'band-angle', 'a'], ['band-cycles', 'value', 'band-angle', 'b'], ['band-angle', 'value', 'band-wave', 'value'],
      ['band-wave', 'value', 'ramp', 'value'], ...['x', 'y', 'z'].map(axis => ['ramp', 'value', 'rgb-color', axis]),
    ]) graph.edges.push({ id: `${to}-${input}`, from, output, to, input });
    const p = compileGeometryGraph(graph, geometryParameterReader({}));
    const curves = evaluateGeometryProgram(p), colors = packStrandColors(curves, p.render!.colorField!);
    const midpoints: number[] = [];
    for (let strand = 0; strand < curves.counts.length; strand++) {
      const start = curves.starts[strand], count = curves.counts[strand];
      expect(colors[start * 4]).toBeCloseTo(colors[(start + count - 1) * 4], 5);
      let transitions = 0;
      for (let i = start + 1; i < start + count; i++) {
        if ((colors[i * 4] >= 0.5) !== (colors[(i - 1) * 4] >= 0.5)) transitions++;
      }
      expect(transitions).toBe(4);
      midpoints.push(colors[(start + Math.floor(count / 3)) * 4]);
    }
    expect(new Set(midpoints).size).toBeGreaterThan(1);
  });
});
