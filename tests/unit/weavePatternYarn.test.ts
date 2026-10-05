import { describe, expect, it } from 'vitest';
import { createDefaultWeaveGraph, geometryParameterReader, validateWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { warpOver } from '../../src/services/operators/geometry/weaveOperators';
import { packStrandPoints, STRAND_POINT_FLOATS } from '../../src/engine/native3d/passes/strandFrames';

/** The flat, regular sheet: Wind Cloth and Handmade bypassed, so positions are the analytic draft. */
const flatWeave = () => {
  const graph = createDefaultWeaveGraph();
  for (const group of graph.groups!) if (group.id === 'wind-cloth' || group.id === 'handmade') group.bypassed = true;
  return graph;
};
/** Long after the weave-in, so every yarn is fully grown. */
const compile = (graph = flatWeave()) => compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: 100 });
const z = (curves: ReturnType<typeof evaluateGeometryProgram>, strand: number, point: number) => curves.positions[(curves.starts[strand] + point) * 3 + 2];

describe('Weave pattern and yarn profile', () => {
  it('feeds fiber detail on the source clock while preserving the centerline', () => {
    const graph = flatWeave();
    const yarn = graph.nodes.find(node => node.operator === 'geometry.yarn-profile')!;
    yarn.constants = { ...yarn.constants, feedSpeed: 0.5 };
    const at = (time: number) => compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: time });
    const first = at(12), later = at(14);
    expect(first.render?.profile?.materialOffset).toBe(-6);
    expect(later.render?.profile?.materialOffset).toBe(-7);
    expect(evaluateGeometryProgram(first).positions).toEqual(evaluateGeometryProgram(later).positions);
    expect(isGeometryProgram(structuredClone(later))).toBe(true);
    expect(isGeometryProgram({ ...later, render: { ...later.render, profile: { ...later.render!.profile, materialOffset: NaN } } })).toBe(false);
    yarn.constants.feedSpeed = -0.5;
    expect(at(12).render?.profile?.materialOffset).toBe(6);
    yarn.constants.feedSpeed = 0;
    expect(at(12).render?.profile?.materialOffset).toBeUndefined();
  });

  it('interlaces warp and weft according to the draft', () => {
    const program = compile();
    expect(program).toMatchObject({ strandCount: 40, pointCount: 24 * (16 * 16 + 1) + 16 * (24 * 16 + 1),
      render: { profile: { plies: 3, fibers: 5, radius: 0.028 } } });
    const curves = evaluateGeometryProgram(program);
    // Plain weave: warp 0 lies in front at weft 0 and behind at weft 1; weft 0 does the opposite.
    expect(z(curves, 0, 8)).toBeCloseTo(0.03, 6);
    expect(z(curves, 0, 24)).toBeCloseTo(-0.03, 6);
    expect(z(curves, 24, 8)).toBeCloseTo(-0.03, 6);
    expect(z(curves, 24, 24)).toBeCloseTo(0.03, 6);
    // Halfway between crossings the cosine crimp passes through zero.
    expect(z(curves, 0, 16)).toBeCloseTo(0, 6);
    // Warp 0 runs vertically at the first column; weft 0 horizontally at the first row.
    expect(curves.positions[curves.starts[0] * 3]).toBeCloseTo((0.5 / 24 - 0.5) * 2.4, 6);
    expect(curves.positions[curves.starts[24] * 3 + 1]).toBeCloseTo((0.5 / 16 - 0.5) * 1.6, 6);
  });

  it('shifts twill diagonally and floats satin', () => {
    expect([0, 1, 2, 3].map(j => warpOver(1, 0, j))).toEqual([true, true, false, false]);
    expect([0, 1, 2, 3].map(j => warpOver(1, 1, j))).toEqual([true, false, false, true]);
    expect([0, 1, 2, 3, 4].filter(j => warpOver(3, 0, j))).toEqual([0]);
  });

  it('evaluates a per-point radius field', () => {
    const graph = flatWeave();
    graph.edges = graph.edges.filter(edge => !(edge.to === 'yarn' && edge.input === 'radius'));
    graph.nodes.push({ id: 'half', operator: 'values.number', bindings: {}, operatorVersion: 1, constants: { value: 0.5 } });
    graph.edges.push({ id: 'half-radius', from: 'half', output: 'value', to: 'yarn', input: 'radius' });
    expect(validateWeaveGraph(graph)).toEqual([]);
    const program = compile(graph);
    expect(isGeometryProgram(structuredClone(program))).toBe(true);
    const curves = evaluateGeometryProgram(program);
    expect(curves.radius?.length).toBe(program.pointCount);
    expect(new Set(curves.radius)).toEqual(new Set([0.5]));
  });

  it('rejects tampered yarn programs', () => {
    const program = structuredClone(compile()) as any;
    expect(isGeometryProgram(program)).toBe(true);
    program.render.profile.plies = 64;
    expect(isGeometryProgram(program)).toBe(false);
    const counts = structuredClone(compile()) as any;
    counts.stages[0].warps = 25;
    expect(isGeometryProgram(counts)).toBe(false);
  });

  it('packs rotation-minimizing frames and arc length', () => {
    const curves = evaluateGeometryProgram(compile());
    const packed = packStrandPoints(curves);
    expect(packed.length).toBe((curves.positions.length / 3) * STRAND_POINT_FLOATS);
    for (const index of [1, 5, 60, 3000]) {
      const base = index * STRAND_POINT_FLOATS, next = (index + 1) * STRAND_POINT_FLOATS, previous = (index - 1) * STRAND_POINT_FLOATS;
      const tangent = [packed[next] - packed[previous], packed[next + 1] - packed[previous + 1], packed[next + 2] - packed[previous + 2]];
      const length = Math.hypot(...tangent), normal = [packed[base + 4], packed[base + 5], packed[base + 6]];
      expect(Math.hypot(...normal)).toBeCloseTo(1, 5);
      expect(Math.abs(normal[0] * tangent[0] + normal[1] * tangent[1] + normal[2] * tangent[2]) / length).toBeLessThan(1e-3);
      expect(packed[base + 7]).toBe(1);
    }
    const warpEnd = (curves.starts[0] + curves.counts[0] - 1) * STRAND_POINT_FLOATS;
    expect(packed[warpEnd + 3]).toBeGreaterThan(1.6);
  });
});
