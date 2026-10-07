import { describe, expect, it } from 'vitest';
import { separateCurveContacts } from '../../src/services/operators/geometry/curveContacts';
import { RodContacts, type RodSegments } from '../../src/services/operators/geometry/rodContacts';
import { createWaveStrandsGraph, geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import type { CurveSet } from '../../src/services/operators/geometry/geometryEvaluation';
import { flowClosedCurves } from '../../src/services/operators/geometry/curveFlow';
import { pointFieldChain } from '../../src/engine/native3d/passes/strandGpuChains';

const spec = { radius: 0.02, iterations: 64, smoothing: 0.35 };
const crossing = (): CurveSet => ({ positions: Float32Array.of(-1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0),
  starts: Uint32Array.of(0, 2), counts: Uint32Array.of(2, 2) });

describe('frame-local curve contacts', () => {
  it('fades corrections without altering the input and bypasses zero strength exactly', () => {
    const input = crossing(), full = separateCurveContacts(input, spec);
    const half = separateCurveContacts(input, { ...spec, strength: .5 });
    expect(separateCurveContacts(input, { ...spec, strength: 0 })).toBe(input);
    full.positions.forEach((value, i) => expect(half.positions[i]).toBeCloseTo((input.positions[i] + value) / 2, 6));
    expect(() => separateCurveContacts(input, { ...spec, strength: NaN })).toThrow('strength');
  });

  it('accepts clock envelopes, restores GPU deformations at zero, and rejects per-point strength', () => {
    const graph = createWaveStrandsGraph();
    graph.nodes.push({ id: 'contact', operator: 'geometry.curve-contact', operatorVersion: 1, bindings: {}, constants: spec },
      { id: 'clock', operator: 'geometry.clip-time', operatorVersion: 1, bindings: {} });
    graph.edges.find(edge => edge.to === 'render' && edge.input === 'curves')!.from = 'contact';
    graph.edges.push({ id: 'to-contact', from: 'set-position', output: 'curves', to: 'contact', input: 'curves' },
      { id: 'strength', from: 'clock', output: 'time', to: 'contact', input: 'strength' });
    const zero = compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: 0 });
    expect(zero.stages.some(stage => stage.kind === 'curve-contact')).toBe(false);
    expect(pointFieldChain(zero.stages)).not.toBeNull();
    const half = compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: .5 });
    expect(half.stages.at(-1)).toMatchObject({ kind: 'curve-contact', strength: .5 });
    expect(isGeometryProgram(half)).toBe(true);
    Object.assign(half.stages.at(-1)!, { strength: 2 });
    expect(isGeometryProgram(half)).toBe(false);
    Object.assign(graph.edges.at(-1)!, { from: 'info', output: 'u' });
    expect(() => compileGeometryGraph(graph, geometryParameterReader({}))).toThrow('must be uniform');
  });
  it('flows material around a closed path with a seamless wrap and preserves radius coordinates', () => {
    const input = { positions: Float32Array.of(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0),
      starts: Uint32Array.of(0), counts: Uint32Array.of(5), radius: Float32Array.of(0.2, 0.4, 0.6, 0.8, 0.2) };
    const moved = flowClosedCurves(input, 0.25);
    expect(Array.from(moved.positions.slice(0, 3))).toEqual([1, 0, 0]);
    expect(moved.radius![0]).toBeCloseTo(0.4);
    expect(moved.positions.slice(0, 3)).toEqual(moved.positions.slice(-3));
    expect(flowClosedCurves(input, 1).positions).toEqual(input.positions);
    expect(flowClosedCurves(input, -0.75)).toEqual(moved);
    expect(Array.from(flowClosedCurves(input, 0.125).positions.slice(0, 3))).toEqual([0.5, 0, 0]);
    expect(() => flowClosedCurves(crossing(), 0.1)).toThrow(/closed/);
  });
  it('separates intersecting yarn capsules without changing point IDs or mutating the source', () => {
    const input = crossing(), before = input.positions.slice(), output = separateCurveContacts(input, spec);
    expect(Math.abs(output.positions[2] - output.positions[8])).toBeCloseTo(0.04, 5);
    expect(output.positions[2]).toBe(output.positions[5]);
    expect(output.positions[8]).toBe(output.positions[11]);
    expect(input.positions).toEqual(before);
    expect(output.starts).toBe(input.starts); expect(output.counts).toBe(input.counts);
    expect(separateCurveContacts(input, spec).positions).toEqual(output.positions);
  });

  it('honors varying yarn thickness and leaves already separated curves unchanged', () => {
    const input = { ...crossing(), radius: Float32Array.of(0.5, 0.5, 1, 1) };
    const output = separateCurveContacts(input, spec);
    expect(Math.abs(output.positions[2] - output.positions[8])).toBeCloseTo(0.03, 5);
    expect(output.radius).toBe(input.radius);
    const distant = crossing(); distant.positions[8] = distant.positions[11] = 0.1;
    expect(separateCurveContacts(distant, spec).positions).toEqual(distant.positions);
  });

  it('welds the repeated ends of closed curves while keeping neighboring segments connected', () => {
    const count = 65, positions = new Float32Array(count * 2 * 3);
    for (let ring = 0; ring < 2; ring++) for (let i = 0; i < count; i++) {
      const angle = i / (count - 1) * 2 * Math.PI;
      positions.set([Math.cos(angle), Math.sin(angle), ring * 0.01], (ring * count + i) * 3);
    }
    const output = separateCurveContacts({ positions, starts: Uint32Array.of(0, count), counts: Uint32Array.of(count, count) }, spec);
    for (let ring = 0; ring < 2; ring++) {
      const start = ring * count * 3, end = start + (count - 1) * 3;
      expect(output.positions.slice(start, start + 3)).toEqual(output.positions.slice(end, end + 3));
    }
    for (let i = 0; i < count; i++) expect(output.positions[(count + i) * 3 + 2] - output.positions[i * 3 + 2]).toBeGreaterThan(0.0399);
  });

  it('does not miss contacts after segments stretch beyond the rod solver rest bounds', () => {
    const segments: RodSegments = { a: Uint32Array.of(0, 2), b: Uint32Array.of(1, 3), rest: Float64Array.of(0.01, 0.01),
      arc: Float64Array.of(0, 0), rod: Uint32Array.of(0, 1), rodLength: Float64Array.of(0.01, 0.01), rodClosed: Uint8Array.of(0, 0) };
    const p = Float64Array.of(-2, 0, 0, 2, 0, 0, 1.5, -1, 0, 1.5, 1, 0);
    const contacts = new RodContacts(segments, 0.02, { deforming: true });
    contacts.update(p);
    expect(contacts.solve(p, p.slice(), new Float64Array(4).fill(1), 0)).toBeGreaterThan(0.039);
    expect(p.some((value, i) => i % 3 === 2 && Math.abs(value) > 0)).toBe(true);
  });

  it('compiles, transports and bypasses the modifier and rejects unbounded solver work', () => {
    const graph = createWaveStrandsGraph();
    graph.nodes.push({ id: 'contact', operator: 'geometry.curve-contact', operatorVersion: 1, bindings: {}, constants: spec });
    graph.edges.find(edge => edge.to === 'render' && edge.input === 'curves')!.from = 'contact';
    graph.edges.push({ id: 'to-contact', from: 'set-position', output: 'curves', to: 'contact', input: 'curves' });
    const program = compileGeometryGraph(graph, geometryParameterReader({}));
    expect(program.stages.at(-1)?.kind).toBe('curve-contact');
    expect(isGeometryProgram(structuredClone(program))).toBe(true);
    const invalid = structuredClone(program);
    Object.assign(invalid.stages.at(-1)!, { iterations: 100000 });
    expect(isGeometryProgram(invalid)).toBe(false);
    graph.nodes.find(node => node.id === 'contact')!.bypassed = true;
    expect(compileGeometryGraph(graph, geometryParameterReader({})).stages.some(stage => stage.kind === 'curve-contact')).toBe(false);
    graph.nodes.find(node => node.id === 'contact')!.bypassed = false;
    graph.nodes.find(node => node.id === 'line')!.constants!.points = 3000;
    expect(() => compileGeometryGraph(graph, geometryParameterReader({}))).toThrow(/limits/);
  });

  it('compiles material flow against clip source time and validates its transported phase', () => {
    const graph = createWaveStrandsGraph();
    graph.nodes.push({ id: 'flow', operator: 'geometry.curve-flow', operatorVersion: 1, bindings: {}, constants: { speed: 0.1, phase: 0.2 } });
    graph.edges.find(edge => edge.to === 'render' && edge.input === 'curves')!.from = 'flow';
    graph.edges.push({ id: 'to-flow', from: 'set-position', output: 'curves', to: 'flow', input: 'curves' });
    const program = compileGeometryGraph(graph, geometryParameterReader({}), undefined, { time: 99, simulationTime: 3 });
    expect(program.stages.at(-1)).toEqual({ kind: 'curve-flow', nodeId: 'flow', phase: 0.5 });
    expect(isGeometryProgram(program)).toBe(true);
    Object.assign(program.stages.at(-1)!, { phase: Infinity });
    expect(isGeometryProgram(program)).toBe(false);
  });
});
