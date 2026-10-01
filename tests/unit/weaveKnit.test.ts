import { describe, expect, it } from 'vitest';
import { knitCurves, knitPointCount } from '../../src/services/operators/geometry/knitCurves';
import { threadAlong } from '../../src/services/operators/geometry/threadAlong';
import { evaluateGeometryProgram, type CurveSet } from '../../src/services/operators/geometry/geometryEvaluation';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { surfaceBindChain } from '../../src/engine/native3d/passes/strandGpuChains';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const KNIT = { stitches: 3, rows: 2, width: 0.12, height: 0.09, spacing: 0.108, depth: 0.03, lean: 1.5, resolution: 32 };
const strand = (curves: CurveSet, index: number) =>
  Array.from({ length: curves.counts[index] }, (_, k) => Array.from(curves.positions.subarray((curves.starts[index] + k) * 3, (curves.starts[index] + k) * 3 + 3)));

/** Smallest distance between two polylines, and the depth order at their crossings seen from the front. */
function compare(a: number[][], b: number[][]) {
  let closest = Infinity;
  const order: number[] = [];
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      const p0 = a[i], d1 = a[i + 1].map((v, k) => v - p0[k]), q0 = b[j], d2 = b[j + 1].map((v, k) => v - q0[k]), r = p0.map((v, k) => v - q0[k]);
      const dot = (x: number[], y: number[]) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2], clamp = (v: number) => Math.min(1, Math.max(0, v));
      const aa = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), bb = dot(d1, d2), den = aa * e - bb * bb;
      let s = den > 0 ? clamp((bb * f - c * e) / den) : 0, t = (bb * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / aa); } else if (t > 1) { t = 1; s = clamp((bb - c) / aa); }
      closest = Math.min(closest, Math.hypot(...[0, 1, 2].map(k => r[k] + d1[k] * s - d2[k] * t)));
      const cross = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(cross) < 1e-15) continue;
      const u = ((q0[0] - p0[0]) * d2[1] - (q0[1] - p0[1]) * d2[0]) / cross, v = ((q0[0] - p0[0]) * d1[1] - (q0[1] - p0[1]) * d1[0]) / cross;
      if (u >= 0 && u < 1 && v >= 0 && v < 1) order.push(Math.sign(p0[2] + d1[2] * u - (q0[2] + d2[2] * v)));
    }
  }
  return { closest, order };
}

describe('Knit and trailing threads', () => {
  it('stacks knit rows whose loops interlock without touching', () => {
    const curves = knitCurves(KNIT);
    expect(curves.positions.length / 3).toBe(knitPointCount(KNIT));
    expect(curves.counts.length).toBe(2);
    const { closest, order } = compare(strand(curves, 0), strand(curves, 1));
    // Every stitch crosses the row above four times: its head in front of both legs above,
    // its legs behind that row's sinker loops — the loops reach through each other.
    expect(order).toHaveLength(4 * KNIT.stitches);
    for (let stitch = 0; stitch < KNIT.stitches; stitch++) {
      const [a, b, c, d] = order.slice(stitch * 4, stitch * 4 + 4);
      expect(b).toBe(c);
      expect(a).toBe(d);
      expect(a).toBe(-b);
    }
    // Room for a yarn of radius 0.014 between rows and between the loops of one row.
    expect(closest).toBeGreaterThan(0.028);
    const row = strand(curves, 0);
    let self = Infinity;
    for (let i = 0; i < row.length; i++) for (let j = i + 13; j < row.length; j++) self = Math.min(self, Math.hypot(...[0, 1, 2].map(k => row[i][k] - row[j][k])));
    expect(self).toBeGreaterThan(0.028);
  });

  it('lets the thread ahead of the tip trail from it instead of hiding', () => {
    const line: CurveSet = { positions: Float32Array.from({ length: 101 * 3 }, (_, i) => i % 3 === 0 ? Math.floor(i / 3) / 100 : 0),
      starts: Uint32Array.of(0), counts: Uint32Array.of(101) };
    const stage = { value: 0.3, stagger: 0, lift: 0.05, liftLength: 0.1, settle: 1.2 };
    const trailing = threadAlong({ ...stage, trail: [0, 1, 0] }, line);
    // Tip at arc 0.3 · (1 + 4 · 0.1) = 0.42: the rest leaves the lifted tip straight up, keeping its length.
    expect(Array.from(trailing.radius!).every(value => value === 1)).toBe(true);
    const at = (index: number) => Array.from(trailing.positions.subarray(index * 3, index * 3 + 3));
    expect(at(100)[0]).toBeCloseTo(0.42, 5);
    expect(at(100)[1]).toBeCloseTo(1 - 0.42, 5);
    expect(at(100)[2]).toBeCloseTo(0.05, 5);
    expect(at(30)).toEqual(Array.from(threadAlong(stage, line).positions.subarray(90, 93)));
    // Finished threads look the same in both modes.
    expect(threadAlong({ ...stage, value: 1, trail: [0, 1, 0] }, line).positions).toEqual(threadAlong({ ...stage, value: 1 }, line).positions);
  });

  it('compiles a knit with trailing threads, keeping trailing on the CPU', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
      { id: 'knit', operator: 'geometry.knit', operatorVersion: 1, bindings: {}, constants: { stitches: 4, rows: 3 } },
      { id: 'thread', operator: 'geometry.thread-along', operatorVersion: 1, bindings: {}, constants: { progress: 0.4, ahead: 'trail', trail: [0, 2, 0] } },
      { id: 'yarn', operator: 'geometry.yarn-profile', operatorVersion: 1, bindings: {} },
      { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
    ], edges: [
      { id: 'a', from: 'knit', output: 'curves', to: 'thread', input: 'curves' },
      { id: 'b', from: 'thread', output: 'curves', to: 'yarn', input: 'curves' },
      { id: 'c', from: 'yarn', output: 'curves', to: 'render', input: 'curves' },
      { id: 'd', from: 'render', output: 'scene', to: 'output', input: 'scene' },
    ] };
    const program = compileGeometryGraph(graph, geometryParameterReader({}));
    expect(program.stages.map(stage => stage.kind)).toEqual(['knit', 'thread-along', 'yarn-profile']);
    expect(program.stages[1]).toMatchObject({ trail: [0, 1, 0] });
    expect(program.strandCount).toBe(3);
    expect(isGeometryProgram(structuredClone(program))).toBe(true);
    expect(evaluateGeometryProgram(program).positions.length / 3).toBe(program.pointCount);
    const bound = surfaceBindChain([...program.stages, { kind: 'surface-bind', nodeId: 'bind', height: 1, time: 0,
      cloth: { nodeId: 'cloth', columns: 4, rows: 4, width: 2, height: 2, pin: 0, stretch: 0.9, bend: 0.5, damping: 0.3, substeps: 2, preroll: 0,
        gravity: 0, drag: 0, winds: [], turbulence: [] } }])!;
    expect(bound.thread).toBeNull();
    expect(bound.restStages.map(stage => stage.kind)).toEqual(['knit', 'thread-along']);
  });
});
