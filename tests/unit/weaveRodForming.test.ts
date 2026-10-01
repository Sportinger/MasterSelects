import { describe, expect, it } from 'vitest';
import { knitCurves } from '../../src/services/operators/geometry/knitCurves';
import { extendCurves } from '../../src/services/operators/geometry/extendCurves';
import { buildRodRest, type RodRest } from '../../src/services/operators/geometry/rodRest';
import { RodSimulation, ROD_STEP_RATE } from '../../src/services/operators/geometry/rodSolver';
import type { RodSpec } from '../../src/services/operators/geometry/rodProgram';
import { evaluateGeometryProgram, type CurveSet } from '../../src/services/operators/geometry/geometryEvaluation';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { rodChain } from '../../src/engine/native3d/passes/strandGpuChains';
import { RodSimulationDeferred } from '../../src/services/operators/geometry/rodCurves';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const RADIUS = 0.03;
const spec = (extra: Partial<RodSpec> = {}): RodSpec => ({ nodeId: 'rod', radius: RADIUS, segmentLength: 0, stretch: 0.9, bend: 0.5,
  friction: 0.1, damping: 0.5, substeps: 16, preroll: 0, pin: 0, pull: 0, pullTime: 2, floor: false, floorHeight: 0, start: 1, formEase: 0.3,
  gravity: 0, drag: 0, winds: [], turbulence: [], ...extra });
/** A knit with room for rods of RADIUS between its loops (the default knit scaled up). */
const KNIT = knitCurves({ stitches: 3, rows: 2, width: 0.264, height: 0.198, spacing: 0.2376, depth: 0.066, lean: 1.5, resolution: 32 });
const distanceOf = (curves: CurveSet) => (index: number) => Math.hypot(curves.positions[index * 3], curves.positions[index * 3 + 1]);

function segmentDistance(p: Float64Array, a0: number, a1: number, b0: number, b1: number) {
  const d1 = [0, 1, 2].map(axis => p[a1 * 3 + axis] - p[a0 * 3 + axis]), d2 = [0, 1, 2].map(axis => p[b1 * 3 + axis] - p[b0 * 3 + axis]);
  const r = [0, 1, 2].map(axis => p[a0 * 3 + axis] - p[b0 * 3 + axis]);
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], clamp = (v: number) => Math.min(1, Math.max(0, v));
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
  let s = den > 0 ? clamp((b * f - c * e) / den) : 0, t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
  return Math.hypot(...[0, 1, 2].map(axis => r[axis] + d1[axis] * s - d2[axis] * t));
}

/** Smallest distance between segments of different rods. */
function closestBetweenRods(rest: RodRest, p: Float64Array) {
  let closest = Infinity;
  for (let a = 0; a < rest.counts.length; a++) for (let b = a + 1; b < rest.counts.length; b++) {
    for (let i = rest.starts[a]; i + 1 < rest.starts[a] + rest.counts[a]; i++) {
      for (let j = rest.starts[b]; j + 1 < rest.starts[b] + rest.counts[b]; j++) closest = Math.min(closest, segmentDistance(p, i, i + 1, j, j + 1));
    }
  }
  return closest;
}

describe('Rod Simulation forming and unravelling', () => {
  it('lays open rods out straight with their segment lengths and interpolates form times', () => {
    const rest = buildRodRest(KNIT, RADIUS, 0, { straight: true, formValue: distanceOf(KNIT) });
    for (let rod = 0; rod < rest.counts.length; rod++) {
      const start = rest.starts[rod], count = rest.counts[rod];
      const node = (array: Float64Array, index: number) => Array.from(array.subarray((start + index) * 3, (start + index) * 3 + 3));
      const first = node(rest.start, 0), last = node(rest.start, count - 1), length = Math.hypot(...last.map((v, axis) => v - first[axis]));
      let restLength = 0;
      for (let index = 1; index < count; index++) {
        const a = node(rest.positions, index - 1), b = node(rest.positions, index), s0 = node(rest.start, index - 1), s1 = node(rest.start, index);
        const segment = Math.hypot(...b.map((v, axis) => v - a[axis]));
        restLength += segment;
        expect(Math.hypot(...s1.map((v, axis) => v - s0[axis]))).toBeCloseTo(segment, 9);
      }
      // One straight thread along the row (the chord is +X) as long as the knitted row.
      expect(length).toBeCloseTo(restLength, 9);
      expect(Math.abs(last[1] - first[1]) + Math.abs(last[2] - first[2])).toBeLessThan(1e-9);
      expect(length).toBeGreaterThan(2.5 * (last[0] - first[0] > 0 ? 3 * 0.264 : Infinity));
      // Form times follow the distance of each node's place from the centre.
      for (let index = 0; index < count; index++) {
        const target = node(rest.positions, index);
        expect(rest.form[start + index]).toBeCloseTo(Math.hypot(target[0], target[1]), 2);
      }
    }
    // Rings and unformed rods keep the incoming curves.
    expect(Array.from(buildRodRest(KNIT, RADIUS, 0).start)).toEqual(Array.from(buildRodRest(KNIT, RADIUS, 0).positions));
    expect(buildRodRest(KNIT, RADIUS, 0).form.every(value => value === Infinity)).toBe(true);
  });

  it('folds straight threads into a knit from the centre out without passing through each other', () => {
    // Points form three seconds per unit of distance from the centre: the middle first, the loose ends last.
    const form = distanceOf(KNIT);
    const rest = buildRodRest(KNIT, RADIUS, 0, { straight: true, formValue: index => 0.2 + 3 * form(index) });
    const simulation = new RodSimulation(spec(), rest);
    let closest = Infinity;
    for (let step = 0; step <= 4 * ROD_STEP_RATE; step += 2) closest = Math.min(closest, closestBetweenRods(rest, simulation.positionsAt(step)));
    // Soft (averaged) contacts let folding threads press a fifth of a radius into each other, far from passing through.
    expect(closest).toBeGreaterThan(1.5 * RADIUS);
    const nodes = simulation.positionsAt(4 * ROD_STEP_RATE);
    let error = 0;
    for (let index = 0; index < nodes.length; index += 3) {
      error = Math.max(error, Math.hypot(nodes[index] - rest.positions[index], nodes[index + 1] - rest.positions[index + 1], nodes[index + 2] - rest.positions[index + 2]));
    }
    // Every node reached its place: the threads went through the loops instead of snagging.
    expect(error).toBeLessThan(0.25 * RADIUS);
  });

  it('compiles Form Time and Start and keeps the formed rods on the GPU chain', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
      { id: 'knit', operator: 'geometry.knit', operatorVersion: 1, bindings: {}, constants: { stitches: 3, rows: 2 } },
      { id: 'where', operator: 'geometry.position', operatorVersion: 1, bindings: {} },
      { id: 'reach', operator: 'field.shape-distance', operatorVersion: 1, bindings: {}, constants: { shape: 'sphere', center: [0, 0, 0], size: 0 } },
      { id: 'rod', operator: 'geometry.rod-simulation', operatorVersion: 1, bindings: {}, constants: { radius: 0.014, start: 'straight', pin: 'none', formEase: 0.4 } },
      { id: 'yarn', operator: 'geometry.yarn-profile', operatorVersion: 1, bindings: {} },
      { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
    ], edges: [
      { id: 'a', from: 'knit', output: 'curves', to: 'rod', input: 'curves' },
      { id: 'p', from: 'where', output: 'position', to: 'reach', input: 'position' },
      { id: 'f', from: 'reach', output: 'value', to: 'rod', input: 'form' },
      { id: 'b', from: 'rod', output: 'curves', to: 'yarn', input: 'curves' },
      { id: 'c', from: 'yarn', output: 'curves', to: 'render', input: 'curves' },
      { id: 'd', from: 'render', output: 'scene', to: 'output', input: 'scene' },
    ] };
    const program = compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: 1 });
    const rod = program.stages[1];
    expect(rod).toMatchObject({ kind: 'rod-simulation', rod: { start: 1, formEase: 0.4, pin: 0 } });
    expect(rod.kind === 'rod-simulation' && rod.form).toBeTruthy();
    expect(isGeometryProgram(structuredClone(program))).toBe(true);
    expect(rodChain(program.stages)?.rod.form).toEqual(rod.kind === 'rod-simulation' ? rod.form : null);
  });
  it('extends curves straight beyond both ends along their end tangent', () => {
    const line: CurveSet = { positions: Float32Array.from({ length: 11 * 3 }, (_, i) => i % 3 === 0 ? Math.floor(i / 3) / 10 : 0),
      starts: Uint32Array.of(0), counts: Uint32Array.of(11), radius: Float32Array.from({ length: 11 }, (_, i) => 1 + i) };
    const longer = extendCurves({ length: 0.5, points: 5 }, line);
    expect(Array.from(longer.counts)).toEqual([21]);
    expect(longer.positions[0]).toBeCloseTo(-0.5, 6);
    expect(longer.positions[20 * 3]).toBeCloseTo(1.5, 6);
    expect(Array.from(longer.positions.subarray(15, 48))).toEqual(Array.from(line.positions));
    expect([longer.radius![0], longer.radius![20]]).toEqual([1, 11]);
    // A knit row ends on a loop head: its tails leave level (within a degree), not along the tilted last segment.
    const row = extendCurves({ length: 1, points: 4 }, KNIT), first = row.starts[0];
    expect(Math.abs(row.positions[first * 3 + 1] - KNIT.positions[1])).toBeLessThan(0.015);
    expect(Math.abs(row.positions[first * 3 + 2] - KNIT.positions[2])).toBeLessThan(0.015);
  });

  it('unravels a knit row by row from the top without threads passing through each other', () => {
    const rows = 3, knit = knitCurves({ stitches: 3, rows, width: 0.264, height: 0.198, spacing: 0.2376, depth: 0.066, lean: 1.5, resolution: 32 });
    const curves = extendCurves({ length: 1, points: 16 }, knit), strandOf = (index: number) => curves.counts.findIndex((count, strand) => index < curves.starts[strand] + count);
    // The top row is pulled first; each row 1.2 s later than the one above.
    const rest = buildRodRest(curves, RADIUS, 2, { pullStartValue: index => (rows - 1 - strandOf(index)) * 1.2 });
    const length = (positions: Float64Array, rod: number) => {
      let sum = 0;
      for (let node = rest.starts[rod] + 1; node < rest.starts[rod] + rest.counts[rod]; node++) {
        sum += Math.hypot(...[0, 1, 2].map(axis => positions[node * 3 + axis] - positions[(node - 1) * 3 + axis]));
      }
      return sum;
    };
    const span = (positions: Float64Array, rod: number) => Math.hypot(...[0, 1, 2].map(axis =>
      positions[(rest.starts[rod] + rest.counts[rod] - 1) * 3 + axis] - positions[rest.starts[rod] * 3 + axis]));
    // Pull each end out by half the slack, a little more so the rows end straight.
    const pull = (length(rest.positions, 0) - span(rest.positions, 0)) / 2 + 0.07, end = Math.ceil((2 * 1.2 + 1.6 + 0.5) * ROD_STEP_RATE);
    const simulation = new RodSimulation(spec({ start: 0, pin: 2, pull, pullTime: 1.6, damping: 1 }), rest);
    let closest = Infinity;
    for (let step = 0; step <= end; step += 6) closest = Math.min(closest, closestBetweenRods(rest, simulation.positionsAt(step)));
    expect(closest).toBeGreaterThan(0.95 * 2 * RADIUS);
    const nodes = simulation.positionsAt(end);
    // Every row came out: its ends are a row length apart, with only a little crimp left in the yarn.
    for (let rod = 0; rod < rows; rod++) expect(span(nodes, rod) / length(nodes, rod)).toBeGreaterThan(0.985);
  });

  it('compiles Extend and Pull Start', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
      { id: 'knit', operator: 'geometry.knit', operatorVersion: 1, bindings: {}, constants: { stitches: 3, rows: 2 } },
      { id: 'extend', operator: 'geometry.extend', operatorVersion: 1, bindings: {}, constants: { length: 2, points: 8 } },
      { id: 'info', operator: 'geometry.curve-info', operatorVersion: 1, bindings: {} },
      { id: 'rod', operator: 'geometry.rod-simulation', operatorVersion: 1, bindings: {}, constants: { radius: 0.014, pull: 1, pullTime: 1 } },
      { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
    ], edges: [
      { id: 'a', from: 'knit', output: 'curves', to: 'extend', input: 'curves' },
      { id: 'b', from: 'extend', output: 'curves', to: 'rod', input: 'curves' },
      { id: 's', from: 'info', output: 'strand', to: 'rod', input: 'pullStart' },
      { id: 'c', from: 'rod', output: 'curves', to: 'render', input: 'curves' },
      { id: 'd', from: 'render', output: 'scene', to: 'output', input: 'scene' },
    ] };
    const program = compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: 0.5 });
    expect(program.stages.map(stage => stage.kind)).toEqual(['knit', 'extend', 'rod-simulation']);
    expect(program.pointCount).toBe(2 * (3 * 24 + 1) + 2 * 2 * 8);
    expect(program.stages[2].kind === 'rod-simulation' && program.stages[2].pullStart).toBeTruthy();
    expect(isGeometryProgram(structuredClone(program))).toBe(true);
    expect(evaluateGeometryProgram(program).positions.length / 3).toBe(program.pointCount);
  });
  it('defers rod simulations beyond a work budget without simulating', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
      { id: 'knit', operator: 'geometry.knit', operatorVersion: 1, bindings: {}, constants: { stitches: 2, rows: 2, depth: 0.031 } },
      { id: 'rod', operator: 'geometry.rod-simulation', operatorVersion: 1, bindings: {}, constants: { radius: 0.014, pin: 'ends', pull: 0.2, preroll: 0 } },
      { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
    ], edges: [
      { id: 'a', from: 'knit', output: 'curves', to: 'rod', input: 'curves' },
      { id: 'c', from: 'rod', output: 'curves', to: 'render', input: 'curves' },
      { id: 'd', from: 'render', output: 'scene', to: 'output', input: 'scene' },
    ] };
    const at = (time: number) => compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: time });
    const rest = evaluateGeometryProgram(at(0));
    // 1.5 s from scratch is far beyond the budget: the rest curves come back, quickly.
    const started = performance.now();
    let deferred: unknown;
    try { evaluateGeometryProgram(at(1.5), { rodBudget: 40_000 }); } catch (error) { deferred = error; }
    expect(deferred).toBeInstanceOf(RodSimulationDeferred);
    expect((deferred as RodSimulationDeferred).curves.positions.length / 3).toBe(at(1.5).pointCount);
    expect(performance.now() - started).toBeLessThan(200);
    // Once the simulation stands close by, the next frames fit the budget.
    const full = evaluateGeometryProgram(at(1.5)).positions;
    expect(evaluateGeometryProgram(at(1.5 + 1 / 60), { rodBudget: 40_000 }).positions.length).toBe(full.length);
    expect(rest.positions.length).toBe(full.length);
  });
});
