import { describe, expect, it } from 'vitest';
import { celticKnotCurves, celticLoops, knotCurves, KNOT_SHAPES } from '../../src/services/operators/geometry/knotCurves';
import { threadAlong } from '../../src/services/operators/geometry/threadAlong';
import { evaluateGeometryProgram, type CurveSet } from '../../src/services/operators/geometry/geometryEvaluation';
import { compileGeometryGraph, knotPointCount, type GeometryStage } from '../../src/services/operators/geometry/geometryProgram';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const point = (curves: CurveSet, index: number) => Array.from(curves.positions.subarray(index * 3, index * 3 + 3));
const knot = (shape: typeof KNOT_SHAPES[number], extra: Partial<Parameters<typeof knotCurves>[0]> = {}) =>
  knotCurves({ shape: KNOT_SHAPES.indexOf(shape), p: 2, q: 3, size: 1, depth: 0.1, points: 280, ...extra });

/** Signed 2D crossings between two polylines (XY), with both curves' heights there. */
function crossings(a: number[][], b: number[][], same: boolean) {
  const found: Array<{ za: number; zb: number }> = [];
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = same ? i + 2 : 0; j + 1 < b.length; j++) {
      const [p, r] = [a[i], [a[i + 1][0] - a[i][0], a[i + 1][1] - a[i][1]]];
      const [q, s] = [b[j], [b[j + 1][0] - b[j][0], b[j + 1][1] - b[j][1]]];
      const denominator = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(denominator) < 1e-12) continue;
      const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / denominator, u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / denominator;
      if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
      found.push({ za: a[i][2] + t * (a[i + 1][2] - a[i][2]), zb: b[j][2] + u * (b[j + 1][2] - b[j][2]) });
    }
  }
  return found;
}
const strand = (curves: CurveSet, index: number) => Array.from({ length: curves.counts[index] }, (_, k) => point(curves, curves.starts[index] + k));

describe('Weave knots and threading', () => {
  it('closes parametric knots and lifts every crossing clear of the other strand', () => {
    for (const shape of ['trefoil', 'figure-eight', 'torus'] as const) {
      const curves = knot(shape);
      expect(curves.counts.length).toBe(1);
      expect(curves.counts[0]).toBe(281);
      expect(point(curves, 280)).toEqual(point(curves, 0));
      const path = strand(curves, 0), hits = crossings(path, path, true);
      expect(hits.length).toBeGreaterThanOrEqual(3);
      for (const hit of hits) expect(Math.abs(hit.za - hit.zb)).toBeGreaterThan(0.05);
    }
  });

  it('locks the two reef ropes with six crossings that alternate along each rope', () => {
    const curves = knot('reef');
    expect(curves.counts.length).toBe(2);
    expect(curves.positions.length / 3).toBe(knotPointCount({ shape: KNOT_SHAPES.indexOf('reef'), points: 280 }));
    const a = strand(curves, 0), b = strand(curves, 1);
    expect(crossings(a, a, true)).toHaveLength(0);
    const hits = crossings(a, b, false);
    expect(hits).toHaveLength(6);
    // Along rope A the crossings alternate under/over, and rope B always takes the other side.
    const signs = hits.map(hit => Math.sign(hit.za - hit.zb));
    signs.forEach((sign, index) => { if (index) expect(sign).toBe(-signs[index - 1]); });
    // Both ends of each rope leave on the same side, side by side.
    expect(Math.sign(a[0][0])).toBe(Math.sign(a[a.length - 1][0]));
    expect(Math.sign(b[0][0])).toBe(-Math.sign(a[0][0]));
  });

  it('traces Celtic plait loops whose crossings alternate and are consistent', () => {
    for (const [columns, rows] of [[1, 1], [3, 2], [4, 4], [5, 3]]) {
      const loops = celticLoops(columns, rows);
      const visits = new Map<string, number[]>();
      for (const loop of loops) {
        const signs = loop.filter(step => step.z !== 0).map(step => step.z);
        // Alternation holds around the whole loop, across border turns.
        signs.forEach((sign, index) => expect(sign).toBe(-signs[(index + 1) % signs.length]));
        for (const step of loop) if (step.z !== 0) visits.set(`${step.x},${step.y}`, [...visits.get(`${step.x},${step.y}`) ?? [], step.z]);
      }
      // Every interior lattice crossing is passed twice, once over and once under.
      expect(visits.size).toBe(Math.floor((2 * columns - 1) * (2 * rows - 1) / 2));
      for (const passes of visits.values()) expect(passes.toSorted()).toEqual([-1, 1]);
    }
    const curves = celticKnotCurves({ columns: 3, rows: 2, size: 0.3, height: 0.03, resolution: 6, roundness: 0.6 });
    for (let index = 0; index < curves.counts.length; index++) {
      const path = strand(curves, index);
      expect(path[path.length - 1]).toEqual(path[0]);
    }
  });

  it('pulls threads in behind a lifted tip and settles them flat', () => {
    const line: CurveSet = { positions: Float32Array.from({ length: 101 * 3 }, (_, i) => i % 3 === 0 ? Math.floor(i / 3) / 100 : 0),
      starts: Uint32Array.of(0), counts: Uint32Array.of(101) };
    const stage = { value: 0.5, stagger: 0, lift: 0.1, liftLength: 0.2, settle: 1.2 };
    const half = threadAlong(stage, line);
    // Tip at arc 0.5 · (1 + 4 · 0.2) = 0.9: visible up to it, lifted most at the tip.
    expect(half.radius![89]).toBe(1);
    expect(half.radius![91]).toBe(0);
    expect(half.positions[89 * 3 + 2]).toBeCloseTo(0.1 * Math.exp(-1.2 * 0.05) * Math.cos(Math.PI * 0.025), 3);
    expect(half.positions[70 * 3 + 2]).toBeCloseTo(0, 6);
    expect(Math.abs(half.positions[30 * 3 + 2])).toBeLessThan(0.01);
    const done = threadAlong({ ...stage, value: 1 }, line);
    expect(Array.from(done.radius!).every(value => value === 1)).toBe(true);
    expect(Math.max(...Array.from(done.positions.filter((_, index) => index % 3 === 2), Math.abs))).toBeLessThan(0.001);
    expect(Array.from(threadAlong({ ...stage, value: 0 }, line).radius!).every(value => value === 0)).toBe(true);
    // Stagger: the second of two curves starts only after the first.
    const pair: CurveSet = { positions: Float32Array.from([...line.positions, ...line.positions]), starts: Uint32Array.of(0, 101), counts: Uint32Array.of(101, 101) };
    const staggered = threadAlong({ ...stage, value: 0.3, stagger: 0.6 }, pair);
    expect(staggered.radius![0]).toBe(1);
    expect(staggered.radius![101]).toBe(0);
  });

  it('compiles, validates and evaluates knot and threading graphs', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
      { id: 'knot', operator: 'geometry.knot', operatorVersion: 1, bindings: {}, constants: { shape: 'reef', points: 140 } },
      { id: 'thread', operator: 'geometry.thread-along', operatorVersion: 1, bindings: {}, constants: { progress: 0.4 } },
      { id: 'yarn', operator: 'geometry.yarn-profile', operatorVersion: 1, bindings: {} },
      { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
    ], edges: [
      { id: 'a', from: 'knot', output: 'curves', to: 'thread', input: 'curves' },
      { id: 'b', from: 'thread', output: 'curves', to: 'yarn', input: 'curves' },
      { id: 'c', from: 'yarn', output: 'curves', to: 'render', input: 'curves' },
      { id: 'd', from: 'render', output: 'scene', to: 'output', input: 'scene' },
    ] };
    const program = compileGeometryGraph(graph, geometryParameterReader({}));
    expect(program.stages.map(stage => stage.kind)).toEqual(['knot', 'thread-along', 'yarn-profile']);
    expect(isGeometryProgram(structuredClone(program))).toBe(true);
    const curves = evaluateGeometryProgram(program);
    expect(curves.positions.length / 3).toBe(program.pointCount);
    // Yarn Profile keeps the thread hidden ahead of its tip.
    expect(Array.from(curves.radius!).some(value => value === 0)).toBe(true);
    expect(Array.from(curves.radius!).some(value => value > 0)).toBe(true);
    const celtic = structuredClone(graph);
    celtic.nodes[0] = { id: 'knot', operator: 'geometry.celtic-knot', operatorVersion: 1, bindings: {}, constants: { columns: 4, rows: 3 } };
    const plait = compileGeometryGraph(celtic, geometryParameterReader({}));
    expect(isGeometryProgram(structuredClone(plait))).toBe(true);
    expect(evaluateGeometryProgram(plait).positions.length / 3).toBe(plait.pointCount);
    const torus = structuredClone(graph);
    torus.nodes[0].constants = { shape: 'torus', p: 2, q: 4 };
    expect(() => compileGeometryGraph(torus, geometryParameterReader({}))).toThrow('common divisor');
    const tampered = structuredClone(program);
    (tampered.stages[0] as Extract<GeometryStage, { kind: 'knot' }>).points = 10;
    expect(isGeometryProgram(tampered)).toBe(false);
  });
});
