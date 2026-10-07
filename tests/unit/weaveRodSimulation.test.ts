import { describe, expect, it } from 'vitest';
import { knotCurves, KNOT_SHAPES } from '../../src/services/operators/geometry/knotCurves';
import { buildRodRest, rodCurvePositions, type RodRest } from '../../src/services/operators/geometry/rodRest';
import { RodSimulation } from '../../src/services/operators/geometry/rodSolver';
import type { RodSpec } from '../../src/services/operators/geometry/rodProgram';
import { evaluateGeometryProgram, type CurveSet } from '../../src/services/operators/geometry/geometryEvaluation';
import { compileGeometryGraph, type GeometryStage } from '../../src/services/operators/geometry/geometryProgram';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const RADIUS = 0.03;
const spec = (extra: Partial<RodSpec> = {}): RodSpec => ({ nodeId: 'rod', radius: RADIUS, segmentLength: 0, stretch: 0.9, bend: 0.5,
  friction: 0.5, damping: 0.5, substeps: 16, preroll: 0, pin: 2, pull: 0, pullTime: 2, floor: false, floorHeight: 0, start: 0, formEase: 0.5,
  gravity: 0, drag: 0, winds: [], turbulence: [], ...extra });

function lines(...paths: Array<(t: number) => [number, number, number]>): CurveSet {
  const points = 61, positions = new Float32Array(paths.length * points * 3);
  paths.forEach((path, strand) => {
    for (let k = 0; k < points; k++) positions.set(path(k / (points - 1)), (strand * points + k) * 3);
  });
  return { positions, starts: Uint32Array.from(paths, (_, strand) => strand * points), counts: Uint32Array.from(paths, () => points) };
}

function segmentDistance(p: Float64Array, a0: number, a1: number, b0: number, b1: number) {
  const d1 = [0, 1, 2].map(axis => p[a1 * 3 + axis] - p[a0 * 3 + axis]), d2 = [0, 1, 2].map(axis => p[b1 * 3 + axis] - p[b0 * 3 + axis]);
  const r = [0, 1, 2].map(axis => p[a0 * 3 + axis] - p[b0 * 3 + axis]);
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], clamp = (v: number) => Math.min(1, Math.max(0, v));
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
  let s = den > 0 ? clamp((b * f - c * e) / den) : 0, t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
  return Math.hypot(...[0, 1, 2].map(axis => r[axis] + d1[axis] * s - d2[axis] * t));
}

/** Smallest distance between segments that are not neighbours along one rod (the contact rule). */
function closestApproach(rest: RodRest, p: Float64Array) {
  const segments: Array<{ a: number; b: number; rod: number; arc: number; length: number; total: number; ring: boolean }> = [];
  for (let rod = 0; rod < rest.counts.length; rod++) {
    const start = rest.starts[rod], count = rest.counts[rod], ring = rest.closed[rod] === 1, links = ring ? count : count - 1;
    const local: typeof segments = [];
    let arc = 0;
    for (let k = 0; k < links; k++) {
      const a = start + k, b = start + (k + 1) % count;
      const length = Math.hypot(...[0, 1, 2].map(axis => rest.positions[b * 3 + axis] - rest.positions[a * 3 + axis]));
      local.push({ a, b, rod, arc: arc + length / 2, length, total: 0, ring }); arc += length;
    }
    local.forEach(item => { item.total = arc; });
    segments.push(...local);
  }
  let closest = Infinity;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const c = segments[i], d = segments[j];
      if (c.rod === d.rod) {
        let gap = Math.abs(c.arc - d.arc);
        if (c.ring) gap = Math.min(gap, c.total - gap);
        if (gap - (c.length + d.length) / 2 < 2.2 * RADIUS) continue;
      }
      closest = Math.min(closest, segmentDistance(p, c.a, c.b, d.a, d.b));
    }
  }
  return closest;
}

const rodLength = (rest: RodRest, p: Float64Array, rod: number) => {
  let total = 0;
  for (let k = 1; k < rest.counts[rod]; k++) {
    const a = rest.starts[rod] + k - 1, b = a + 1;
    total += Math.hypot(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]);
  }
  return total;
};

describe('Rod simulation', () => {
  it('tightens a reef knot by its pulled ends without the ropes passing through each other', () => {
    const curves = knotCurves({ shape: KNOT_SHAPES.indexOf('reef'), p: 2, q: 3, size: 0.6, depth: 0.12, points: 280 });
    const rest = buildRodRest(curves, RADIUS, 2), simulation = new RodSimulation(spec({ pull: 0.3, pullTime: 2, friction: 0.3 }), rest);
    const lengths = [0, 1].map(rod => rodLength(rest, rest.positions, rod));
    const middle = (p: Float64Array, rod: number, pick: (values: number[]) => number) => {
      const start = rest.starts[rod], count = rest.counts[rod];
      return pick(Array.from({ length: Math.floor(count / 2) }, (_, k) => p[(start + Math.floor(count / 4) + k) * 3]));
    };
    // Rope A's bight reaches right, rope B's left: the knot is as wide as their overlap.
    const width = (p: Float64Array) => middle(p, 0, values => Math.max(...values)) - middle(p, 1, values => Math.min(...values));
    const before = width(rest.positions);
    // The generated rest shape may overlap slightly where the ropes pass close; the first steps separate it.
    let closest = Infinity;
    for (let step = 6; step <= 240; step += 3) closest = Math.min(closest, closestApproach(rest, simulation.positionsAt(step)));
    const after = simulation.positionsAt(240);
    expect(closest).toBeGreaterThan(0.9 * 2 * RADIUS);
    expect(width(after)).toBeLessThan(before * 0.6);
    // The ends sit where the pull took them, and the ropes barely stretch.
    const end = rest.starts[0];
    expect(Math.hypot(...[0, 1, 2].map(axis => after[end * 3 + axis] - rest.positions[end * 3 + axis]))).toBeCloseTo(0.3, 6);
    [0, 1].forEach(rod => expect(Math.abs(rodLength(rest, after, rod) / lengths[rod] - 1)).toBeLessThan(0.03));
  });

  it('drops loose threads onto the floor and onto each other, where they come to rest', () => {
    const curves = lines(t => [t * 1.2 - 0.6, 0.2, 0], t => [0, 0.45, t * 1.2 - 0.6]);
    const rest = buildRodRest(curves, 0, 0), simulation = new RodSimulation(spec({ pin: 0, floor: true, gravity: 9.8, friction: 0.6 }), rest);
    let closest = Infinity;
    for (let step = 3; step <= 180; step += 3) closest = Math.min(closest, closestApproach(rest, simulation.positionsAt(step)));
    const end = Float64Array.from(simulation.positionsAt(180)), next = simulation.positionsAt(181);
    expect(closest).toBeGreaterThan(0.9 * 2 * RADIUS);
    const height = (node: number) => end[node * 3 + 1];
    // The lower thread lies on the floor; the upper one rests across it and drapes down to the floor.
    for (let node = 0; node < 61; node++) expect(height(node)).toBeCloseTo(RADIUS, 2);
    expect(height(61 + 30)).toBeGreaterThan(2.7 * RADIUS);
    expect(height(61 + 30)).toBeLessThan(3.3 * RADIUS);
    expect(height(61)).toBeCloseTo(RADIUS, 2);
    expect(height(121)).toBeCloseTo(RADIUS, 2);
    let fastest = 0;
    for (let node = 0; node < 122; node++) fastest = Math.max(fastest, Math.hypot(...[0, 1, 2].map(axis => next[node * 3 + axis] - end[node * 3 + axis])) * 60);
    expect(fastest).toBeLessThan(0.05);
  });

  it('reaches the same state by playback, by checkpoint and when scrubbing back', () => {
    const curves = lines(t => [t - 0.5, 0.2, 0], t => [0, 0.4, t - 0.5], t => [t - 0.5, 0.6, t - 0.5]);
    const make = () => new RodSimulation(spec({ pin: 0, floor: true, gravity: 9.8, winds: [{ direction: [1, 0, 0], strength: 0.5, gust: 0.3 }] }),
      buildRodRest(curves, 0.04, 0));
    const fresh = Float64Array.from(make().positionsAt(95));
    const scrubbed = make();
    for (let step = 0; step <= 95; step++) scrubbed.positionsAt(step);
    scrubbed.positionsAt(140); scrubbed.positionsAt(12);
    expect(Float64Array.from(scrubbed.positionsAt(95))).toEqual(fresh);
  });

  it('coarsens rods and writes the result back onto every input point', () => {
    const curves = lines(t => [t, Math.sin(t * 40) * 0.002, 0]);
    const rest = buildRodRest(curves, 0.1, 1);
    expect(rest.counts[0]).toBe(11);
    expect(rest.pinned[0]).toBe(1);
    expect(rest.pinned[10]).toBe(0);
    // At rest, the output reproduces the input points, including detail finer than the rod.
    const out = rodCurvePositions(rest, rest.positions, curves);
    out.forEach((value, index) => expect(value).toBeCloseTo(curves.positions[index], 6));
    const ring = knotCurves({ shape: KNOT_SHAPES.indexOf('trefoil'), p: 2, q: 3, size: 0.5, depth: 0.1, points: 120 });
    const loop = buildRodRest(ring, 0, 2);
    expect(loop.closed[0]).toBe(1);
    expect(loop.counts[0]).toBe(120);
    expect(Array.from(loop.pinned).some(Boolean)).toBe(false);
  });

  it('compiles, validates and evaluates a rod simulation graph', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
      { id: 'knot', operator: 'geometry.knot', operatorVersion: 1, bindings: {}, constants: { shape: 'reef', points: 140, size: 0.6 } },
      { id: 'rod', operator: 'geometry.rod-simulation', operatorVersion: 1, bindings: {}, constants: { pull: 0.2, pullTime: 1, segmentLength: 0.05 } },
      { id: 'yarn', operator: 'geometry.yarn-profile', operatorVersion: 1, bindings: {} },
      { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
    ], edges: [
      { id: 'a', from: 'knot', output: 'curves', to: 'rod', input: 'curves' },
      { id: 'b', from: 'rod', output: 'curves', to: 'yarn', input: 'curves' },
      { id: 'c', from: 'yarn', output: 'curves', to: 'render', input: 'curves' },
      { id: 'd', from: 'render', output: 'scene', to: 'output', input: 'scene' },
    ] };
    const program = compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: 1.5 });
    expect(program.stages.map(stage => stage.kind)).toEqual(['knot', 'rod-simulation', 'yarn-profile']);
    expect(isGeometryProgram(structuredClone(program))).toBe(true);
    const start = evaluateGeometryProgram(compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: 0 }));
    const curves = evaluateGeometryProgram(program);
    expect(curves.positions.length / 3).toBe(program.pointCount);
    // Past Pull Time the first end has moved 0.2 outward.
    expect(Math.hypot(...[0, 1, 2].map(axis => curves.positions[axis] - start.positions[axis]))).toBeCloseTo(0.2, 3);
    // A Pin field of 1 holds every point: the curves keep their rest shape.
    const held = structuredClone(graph);
    held.nodes[1].constants = { segmentLength: 0.05 };
    held.nodes.push({ id: 'one', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 1 } });
    held.edges.push({ id: 'p', from: 'one', output: 'value', to: 'rod', input: 'pin' });
    const heldProgram = compileGeometryGraph(held, geometryParameterReader({}), undefined, { simulationTime: 1.5 });
    expect(isGeometryProgram(structuredClone(heldProgram))).toBe(true);
    const still = evaluateGeometryProgram(heldProgram), shape = evaluateGeometryProgram({ ...heldProgram, stages: heldProgram.stages.slice(0, 1) });
    still.positions.forEach((value, index) => expect(value).toBeCloseTo(shape.positions[index], 5));
    const tampered = structuredClone(program);
    (tampered.stages[1] as Extract<GeometryStage, { kind: 'rod-simulation' }>).rod.substeps = 0;
    expect(isGeometryProgram(tampered)).toBe(false);
    const late = structuredClone(graph);
    late.nodes.push({ id: 'sheet', operator: 'geometry.cloth-sheet', operatorVersion: 1, bindings: {} },
      { id: 'bind', operator: 'geometry.surface-bind', operatorVersion: 1, bindings: {} });
    late.edges = [{ id: 'a', from: 'knot', output: 'curves', to: 'bind', input: 'curves' }, { id: 's', from: 'sheet', output: 'surface', to: 'bind', input: 'surface' },
      { id: 'e', from: 'bind', output: 'curves', to: 'rod', input: 'curves' }, ...graph.edges.slice(1)];
    expect(() => compileGeometryGraph(late, geometryParameterReader({}))).toThrow('Rod Simulation needs a static rest shape');
  });
});
