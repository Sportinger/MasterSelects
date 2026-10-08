import { describe, expect, it } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { motionTime } from '../../src/services/operators/geometry/motionTime';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { geometryParameterReader, validateWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';

const graph = (): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
  { id: 'clock', operator: 'geometry.motion-time', operatorVersion: 1, bindings: {}, constants: { duration: 59, attack: 5, release: 5 } },
  { id: 'sphere', operator: 'geometry.knit-sphere', operatorVersion: 1, bindings: {} },
  { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {} },
  { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
], edges: [
  { id: 'time', from: 'clock', output: 'value', to: 'sphere', input: 'time' },
  { id: 'curves', from: 'sphere', output: 'curves', to: 'render', input: 'curves' },
  { id: 'scene', from: 'render', output: 'scene', to: 'output', input: 'scene' },
] });
const at = (time: number) => motionTime(time, 59, 5, 5);
const speed = (time: number) => (at(time + 0.0001) - at(time - 0.0001)) / 0.0002;

describe('independent integrated motion clock', () => {
  it('starts and ends at rest, reaches normal speed at five seconds and never reverses', () => {
    expect(speed(0)).toBeCloseTo(0, 7);
    expect(speed(59)).toBeCloseTo(0, 7);
    expect(speed(2.5)).toBeCloseTo(0.5, 7);
    for (const t of [5, 20, 40, 54]) expect(speed(t)).toBeCloseTo(1, 7);
    expect(speed(56.5)).toBeCloseTo(0.5, 7);
    for (let t = 0; t < 59; t += 0.1) expect(at(t + 0.1)).toBeGreaterThanOrEqual(at(t));
    expect(at(-10)).toBe(0);
    expect(at(59)).toBe(54);
    expect(at(600)).toBe(54);
  });
  it('preserves integrated distance, handles instant ramps and rejects invalid intervals', () => {
    expect(motionTime(10, 10, 0, 0)).toBe(10);
    expect(motionTime(5, 10, 5, 5)).toBe(2.5);
    expect(motionTime(10, 10, 5, 5)).toBe(5);
    for (const args of [[0, 0, 0, 0], [0, 10, -1, 1], [0, 4, 3, 3], [NaN, 10, 1, 1]])
      expect(() => motionTime(...args as [number, number, number, number])).toThrow(/Motion Time/);
  });
  it('drives a generator without changing the source clock or depending on seek order', () => {
    const g = graph();
    expect(validateWeaveGraph(g)).toEqual([]);
    const compile = (time: number) => compileGeometryGraph(g, geometryParameterReader({}), undefined, { simulationTime: time });
    const stage = (time: number) => compile(time).stages[0];
    for (const t of [59, 0, 23, 5, 58, 1, 5])
      expect(stage(t)).toMatchObject({ kind: 'knit-sphere', phase: expect.closeTo((at(t) * 0.05) % 1) });
    g.edges = g.edges.filter(e => e.id !== 'time');
    expect(stage(5)).toMatchObject({ phase: 0.25 });
  });
  it('also supplies an independent clock to closed curve flow', () => {
    const g = graph();
    g.nodes.push({ id: 'flow', operator: 'geometry.curve-flow', operatorVersion: 1, bindings: {}, constants: { speed: 0.1 } });
    g.edges.find(e => e.id === 'curves')!.to = 'flow';
    g.edges.push({ id: 'flow-output', from: 'flow', output: 'curves', to: 'render', input: 'curves' },
      { id: 'flow-clock', from: 'clock', output: 'value', to: 'flow', input: 'time' });
    const compile = () => compileGeometryGraph(g, geometryParameterReader({}), undefined, { simulationTime: 5 });
    expect(compile().stages.find(s => s.kind === 'curve-flow')).toMatchObject({ phase: 0.25 });
    g.edges = g.edges.filter(e => e.id !== 'flow-clock');
    expect(compile().stages.find(s => s.kind === 'curve-flow')).toMatchObject({ phase: 0.5 });
  });
  it('rejects per-point generator clocks instead of silently ignoring them', () => {
    const g = graph();
    g.nodes[0] = { id: 'clock', operator: 'geometry.curve-info', operatorVersion: 1, bindings: {} };
    g.edges[0].output = 'u';
    expect(() => compileGeometryGraph(g, geometryParameterReader({}))).toThrow(/must be uniform/);
  });
});
