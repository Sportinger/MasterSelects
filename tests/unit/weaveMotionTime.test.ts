import { describe, expect, it } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { motionPhase, motionTime } from '../../src/services/operators/geometry/motionTime';
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
  it('retains matching tiny endpoint velocities while closing its normalized loop', () => {
    const at = (t: number) => motionTime(t, 59, 5, 12, 3, -1, 1, .005);
    const phase = (t: number) => motionPhase(t, 59, 5, 12, 3, .005);
    const h = .001;
    expect((at(h) - at(0)) / h).toBeCloseTo(.005, 6);
    expect((at(59) - at(59 - h)) / h).toBeCloseTo(.005, 6);
    expect((at(5 + h) - at(5 - h)) / (2 * h)).toBeCloseTo(1, 6);
    expect(phase(0)).toBe(0); expect(phase(59)).toBe(1);
    expect((phase(h) - phase(0)) / h).toBeCloseTo((phase(59) - phase(59 - h)) / h, 8);
    for (const t of [0, 5, 40, 58, 59]) {
      expect(motionTime(t, 59, 5, 12, 3, -1, 1, 1)).toBe(t);
      expect(motionTime(t, 59, 5, 12, 3, -1, 1, 0)).toBe(motionTime(t, 59, 5, 12, 3));
    }
    for (const invalid of [-.1, 1.1, NaN, Infinity])
      expect(() => motionTime(1, 59, 5, 12, 3, -1, 1, invalid)).toThrow(/Minimum Speed/);
  });
  it('retains the speed floor when an optional direction turn reverses motion seconds', () => {
    const h = .001, at = (t: number) => motionTime(t, 59, 5, 12, 3, 53, 2, .005);
    expect((at(59) - at(59 - h)) / h).toBeCloseTo(-.005, 6);
  });
  it('compiles the minimum-speed control and uses the zero default for older graphs', () => {
    const g = graph();
    g.nodes[0].constants = { duration: 59, attack: 5, release: 12, stopPower: 3, minimumSpeed: .005 };
    const program = compileGeometryGraph(g, geometryParameterReader({}), undefined, { simulationTime: 58 });
    expect(program.stages[0]).toMatchObject({ kind: 'knit-sphere',
      phase: expect.closeTo((motionTime(58, 59, 5, 12, 3, -1, 1, .005) * .05) % 1) });
  });
  it('can linger almost motionless during the final seconds without retiming the beginning', () => {
    const at = (t: number, power: number) => motionTime(t, 59, 5, 12, power);
    const velocity = (t: number, power: number) => (at(t + .001, power) - at(t - .001, power)) / .002;
    for (let power = 1; power <= 4; power++) {
      for (const t of [0, 1, 5, 20, 47]) expect(at(t, power)).toBe(at(t, 1));
      expect(velocity(47, power)).toBeCloseTo(1, 6);
      for (let i = 0; i < 1200; i++) expect(at(47 + (i + 1) / 100, power)).toBeGreaterThanOrEqual(at(47 + i / 100, power));
      expect(motionPhase(59, 59, 5, 12, power)).toBe(1);
      expect(velocity(59, power)).toBeCloseTo(0, 7);
    }
    expect(velocity(57, 3)).toBeLessThan(.0005);
    expect(velocity(58, 3)).toBeLessThan(.00001);
    for (const p of [0, 1.5, 5, NaN]) expect(() => at(58, p)).toThrow(/Final Stillness/);
  });
  it('closes a periodic path by completing a forward turn, never rewinding the elapsed clock', () => {
    const phase = (t: number) => motionPhase(t, 59, 5, 5);
    expect(phase(-1)).toBe(0); expect(phase(60)).toBe(1);
    for (let t = 0; t < 59; t += .1) expect(phase(t + .1)).toBeGreaterThanOrEqual(phase(t));
    for (const t of [0, 59]) expect(Math.abs(phase(t + .001) - phase(t - .001)) / .002).toBeLessThan(1e-8);
    const path = (u: number, t: number) => [Math.cos((u + phase(t)) * Math.PI * 6 + .7), Math.sin((u + phase(t)) * Math.PI * 4 + .7)];
    for (let i = 0; i < 100; i++) {
      const a = path(i / 100, 0), b = path(i / 100, 59);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-13);
    }
  });
  it('compiles the normalized phase and seconds as separate animated outputs', () => {
    const g = graph();
    g.edges[0].output = 'phase';
    g.nodes.push({ id: 'radius', operator: 'geometry.yarn-profile', operatorVersion: 1, bindings: {} });
    g.edges.find(e => e.id === 'curves')!.to = 'radius';
    g.edges.push({ id: 'profile', from: 'radius', output: 'curves', to: 'render', input: 'curves' },
      { id: 'seconds', from: 'clock', output: 'value', to: 'radius', input: 'radius' });
    expect(validateWeaveGraph(g)).toEqual([]);
    const p = compileGeometryGraph(g, geometryParameterReader({}), undefined, { simulationTime: 59 });
    expect(p.stages[0]).toMatchObject({ kind: 'knit-sphere', phase: expect.closeTo(.05, 12) });
    const field = p.stages.find(s => s.kind === 'yarn-profile')?.radius;
    expect(field?.instructions[field.output].value).toBe(54);
  });
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
