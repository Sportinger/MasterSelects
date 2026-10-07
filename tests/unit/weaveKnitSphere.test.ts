import { describe, expect, it } from 'vitest';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { knitSphereCurves, type KnitSphereSpec } from '../../src/services/operators/geometry/knitSphereCurves';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { geometryParameterReader, validateWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';

const spec: KnitSphereSpec = { rows: 28, stitches: 32, resolution: 24, radius: 0.8, height: 0.052,
  depth: 0.016, lean: 1.5, phase: 0, zoneCenter: -0.38, zoneHeight: 0.6, zoneWidth: 90, feather: 0.65, bandSpan: 0.94 };
const graph = (): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'geometry', layout: {}, nodes: [
  { id: 'sphere', operator: 'geometry.knit-sphere', operatorVersion: 1, bindings: {} },
  { id: 'yarn', operator: 'geometry.yarn-profile', operatorVersion: 1, bindings: {}, constants: { radius: 0.008 } },
  { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {} },
  { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
], edges: [
  { id: 'a', from: 'sphere', output: 'curves', to: 'yarn', input: 'curves' },
  { id: 'b', from: 'yarn', output: 'curves', to: 'render', input: 'curves' },
  { id: 'c', from: 'render', output: 'scene', to: 'output', input: 'scene' },
] });

describe('Knit Sphere', () => {
  it('knits every row of a narrow band while leaving its back parallel', () => {
    const band = { ...spec, rows: 8, bandSpan: 0.58, zoneCenter: 0, zoneHeight: 1.8, feather: 0.3 };
    const c = knitSphereCurves(band);
    for (let row = 0; row < band.rows; row++) {
      const restY = band.radius * band.bandSpan * (-1 + 2 * row / (band.rows - 1));
      const front = c.starts[row] * 3;
      const back = (c.starts[row] + band.stitches * band.resolution / 2) * 3;
      expect(c.positions[front + 1] - restY).toBeCloseTo(band.height, 5);
      expect(c.positions[back + 1]).toBeCloseTo(restY, 5);
    }
  });
  it('keeps every ring closed and finite across time, including reverse motion', () => {
    for (const phase of [0, 0.137, 0.99999, -0.23, 12345]) {
      const c = knitSphereCurves({ ...spec, phase });
      expect(c.counts.length).toBe(spec.rows);
      expect(c.positions.every(Number.isFinite)).toBe(true);
      for (let row = 0; row < spec.rows; row++) {
        const first = c.starts[row] * 3, last = (c.starts[row] + c.counts[row] - 1) * 3;
        expect(c.positions.slice(first, first + 3)).toEqual(c.positions.slice(last, last + 3));
      }
    }
  });

  it('keeps the knitting footprint below the equator and at the front while material moves', () => {
    for (const phase of [0, 0.123, 0.29, 0.71]) {
      const c = knitSphereCurves({ ...spec, phase });
      let deformed = 0;
      for (let row = 0; row < spec.rows; row++) {
        const restY = spec.radius * (-0.94 + 1.88 * row / (spec.rows - 1));
        for (let i = c.starts[row]; i < c.starts[row] + c.counts[row]; i++) {
          const [x, y, z] = c.positions.slice(i * 3, i * 3 + 3);
          if (Math.abs(y - restY) > 0.00001) {
            deformed++;
            expect(y).toBeLessThan(0);
            expect(z).toBeGreaterThan(0);
            expect(Math.abs(x)).toBeLessThan(spec.radius * 0.8);
            expect(restY / spec.radius).toBeGreaterThan(-0.69);
            expect(restY / spec.radius).toBeLessThan(-0.07);
          } else if (row >= spec.rows / 2) {
            expect(Math.hypot(x, y, z)).toBeCloseTo(spec.radius, 5);
          }
        }
      }
      expect(deformed).toBeGreaterThan(500);
    }
    const a = knitSphereCurves(spec), b = knitSphereCurves({ ...spec, phase: 0.123 });
    expect(a.positions).not.toEqual(b.positions);
  });

  it('loops exactly and crosses the time seam continuously without topology changes', () => {
    const a = knitSphereCurves(spec), b = knitSphereCurves({ ...spec, phase: 1 });
    expect(a.positions).toEqual(b.positions);
    const before = knitSphereCurves({ ...spec, phase: 1 - 0.000001 });
    const after = knitSphereCurves({ ...spec, phase: 0.000001 });
    let jump = 0;
    for (let i = 0; i < before.positions.length; i++) jump = Math.max(jump, Math.abs(before.positions[i] - after.positions[i]));
    expect(jump).toBeLessThan(0.0001);
    expect(before.counts).toEqual(after.counts);
  });

  it('compiles, validates transport and renders the registered node through Yarn Profile', () => {
    const g = graph();
    expect(validateWeaveGraph(g)).toEqual([]);
    const compile = (time: number) => compileGeometryGraph(g, geometryParameterReader({}), undefined, { simulationTime: time });
    const p = compile(2.3);
    expect(isGeometryProgram(structuredClone(p))).toBe(true);
    expect(p.stages[0]).toMatchObject({ kind: 'knit-sphere', phase: expect.closeTo(0.115) });
    expect(evaluateGeometryProgram(p).positions.length / 3).toBe(p.pointCount);
    expect(evaluateGeometryProgram(compile(20)).positions).toEqual(evaluateGeometryProgram(compile(0)).positions);
    g.nodes[0].constants = { speed: 0 };
    expect(compile(1)).toEqual(compile(19));
    g.nodes[0].constants = { speed: -0.05 };
    expect(compile(5).stages[0]).toMatchObject({ phase: 0.75 });
  });

  it('retains source phase after a trim, including clip speed and reverse', () => {
    const clip = { id: 'clip', startTime: 0, inPoint: 0, outPoint: 40, duration: 20, speed: 2,
      effects: [{ id: 'weave', name: 'Weave', type: 'weave', enabled: true, params: {}, operatorGraph: graph() }] };
    const phaseAt = (c: typeof clip & { reversed?: boolean }, time: number) => buildStrandsLayerSources(c, time, [])[0].source.strands.program.stages[0];
    expect(phaseAt(clip, 3)).toEqual(phaseAt({ ...clip, inPoint: 4, duration: 18 }, 1));
    expect(phaseAt({ ...clip, reversed: true }, 3)).toMatchObject({ phase: expect.closeTo(0.7) });
  });

  it('rejects invalid or oversized transported geometry before evaluation', () => {
    const p = compileGeometryGraph(graph(), geometryParameterReader({}));
    for (const change of [{ rows: 1 }, { rows: 2.5 }, { radius: 0 }, { feather: 0 }, { phase: Infinity },
      { zoneWidth: 361 }, { bandSpan: 0 }, { bandSpan: 1 }, { rows: 512, stitches: 512, resolution: 128 }, { unknown: true }]) {
      const bad = structuredClone(p);
      Object.assign(bad.stages[0], change);
      expect(isGeometryProgram(bad)).toBe(false);
    }
    const g = graph();
    g.nodes[0].constants = { rows: 512, stitches: 512, resolution: 128 };
    expect(() => compileGeometryGraph(g, geometryParameterReader({}))).toThrow(/exceeds/);
  });
});
