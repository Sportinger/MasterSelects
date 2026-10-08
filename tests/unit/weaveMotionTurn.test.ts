import { describe, expect, it } from 'vitest';
import { motionPhase, motionTime } from '../../src/services/operators/geometry/motionTime';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const smooth = (x: number) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };

describe('smooth motion direction turn', () => {
  it('integrates direction, rather than multiplying elapsed time by a sign', () => {
    const at = (t: number) => motionTime(t, 10, 0, 0, 1, 3, 2);
    expect(at(3)).toBe(3);
    expect(at(4)).toBeCloseTo(3.625, 12);
    expect(at(5)).toBeCloseTo(3, 12);
    expect(at(10)).toBeCloseTo(-2, 12);
    expect(at(100)).toBe(at(10));
    expect(at(-10)).toBe(0);
    for (const t of [2, 3, 3.5, 4, 4.5, 5, 8]) {
      const velocity = (at(t + .0001) - at(t - .0001)) / .0002;
      expect(velocity).toBeCloseTo(1 - 2 * smooth((t - 3) / 2), 7);
    }
  });

  it('preserves the old clock before turning, and reverses gently at 54 seconds during the quiet tail', () => {
    const base = (t: number) => motionTime(t, 59, 5, 12, 3);
    const at = (t: number) => motionTime(t, 59, 5, 12, 3, 53, 2);
    for (const t of [0, 1, 5, 20, 47, 53]) expect(at(t)).toBe(base(t));
    for (const t of [53, 53.5, 54, 54.5, 55, 57, 58, 59]) {
      const velocity = (at(t + .001) - at(t - .001)) / .002;
      const expected = ((base(t + .001) - base(t - .001)) / .002) * (1 - 2 * smooth((t - 53) / 2));
      expect(velocity).toBeCloseTo(expected, 7);
    }
    expect(at(55)).toBeLessThan(at(54));
    expect(at(58)).toBeGreaterThan(at(59));
    expect(Math.abs(at(59) - at(58))).toBeLessThan(.00001);
    expect(motionPhase(0, 59, 5, 12, 3)).toBe(0);
    expect(motionPhase(59, 59, 5, 12, 3)).toBe(1);
  });

  it('handles turns crossing attack, cruise and deceleration boundaries at all stillness powers', () => {
    // Independent midpoint quadrature of the signed velocity, including all envelope boundaries.
    for (const power of [1, 2, 3, 4]) for (const [start, length] of [[0, 4], [1, 7], [6, 4], [8, 2]]) {
      for (const time of [start, start + length / 2, start + length, 10]) {
        const n = 20000, dt = time / n;
        let reference = 0;
        for (let i = 0; i < n; i++) {
          const t = (i + .5) * dt;
          const speed = t < 3 ? smooth(t / 3) : t > 7 ? smooth((10 - t) / 3) ** power : 1;
          reference += dt * speed * (1 - 2 * smooth((t - start) / length));
        }
        expect(motionTime(time, 10, 3, 3, power, start, length)).toBeCloseTo(reference, 7);
      }
    }
  });

  it('rejects invalid turns explicitly and leaves omitted settings backward compatible', () => {
    for (const start of [-2, -.5, NaN, Infinity])
      expect(() => motionTime(2, 10, 1, 1, 1, start)).toThrow(/Turn Start/);
    for (const length of [0, -1, NaN, Infinity, 11])
      expect(() => motionTime(2, 10, 1, 1, 1, 0, length)).toThrow(/Direction Turn/);
    for (const t of [0, 2, 5, 9, 10])
      expect(motionTime(t, 10, 1, 1)).toBe(motionTime(t, 10, 1, 1, 1, -1, 2));
  });

  it('compiles reversed seconds and independent forward phase deterministically on separate branches', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
      { id: 'clock', operator: 'geometry.motion-time', operatorVersion: 1, bindings: {},
        constants: { duration: 10, attack: 0, release: 0, turnStart: 3, turnDuration: 2 } },
      { id: 'knit', operator: 'geometry.knit-sphere', operatorVersion: 1, bindings: {} },
      { id: 'profile', operator: 'geometry.yarn-profile', operatorVersion: 1, bindings: {} },
      { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {} },
      { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
    ], edges: [
      { id: 'seconds', from: 'clock', output: 'value', to: 'knit', input: 'time' },
      { id: 'phase', from: 'clock', output: 'phase', to: 'profile', input: 'radius' },
      { id: 'knit', from: 'knit', output: 'curves', to: 'profile', input: 'curves' },
      { id: 'profile', from: 'profile', output: 'curves', to: 'render', input: 'curves' },
      { id: 'scene', from: 'render', output: 'scene', to: 'output', input: 'scene' },
    ] };
    for (const time of [9, 0, 4, 8, 4]) {
      const p = compileGeometryGraph(graph, geometryParameterReader({}), undefined, { simulationTime: time });
      const expected = motionTime(time, 10, 0, 0, 1, 3, 2) * .05;
      expect(p.stages[0]).toMatchObject({ kind: 'knit-sphere', phase: expect.closeTo((expected % 1 + 1) % 1, 12) });
      const radius = p.stages.find(s => s.kind === 'yarn-profile')?.radius;
      expect(radius?.instructions[radius.output].value).toBe(time / 10);
    }
  });
});
