import { describe, expect, it } from 'vitest';
import { addableEffectOperators, effectOperatorGraph, hasEffectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { assertWeaveGraph, createDefaultWeaveGraph, createWaveStrandsGraph, geometryParameterReader, validateWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { applyGraphValueExposure } from '../../src/services/operators/exposedGraphValues';
import { curveWireframe } from '../../src/services/nodePreview/geometryPreviews';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { isCurveOperator } from '../../src/services/operators/geometry/curveOperators';
import type { Effect } from '../../src/types/effects';

const weaveEffect = (overrides: Partial<Effect> = {}): Effect => ({ id: 'fx-weave', name: 'Weave', type: 'weave', enabled: true, params: {}, ...overrides });
const evaluate = (graph = createWaveStrandsGraph(), params: Record<string, unknown> = {}) =>
  evaluateGeometryProgram(compileGeometryGraph(graph, geometryParameterReader(params)));

describe('Weave geometry graph', () => {
  it('owns a valid default graph built from general curve and math nodes', () => {
    const graph = createDefaultWeaveGraph();
    expect(hasEffectOperatorGraph('weave')).toBe(true);
    expect(validateWeaveGraph(graph)).toEqual([]);
    expect(() => assertWeaveGraph(graph, {})).not.toThrow();
    expect(effectOperatorGraph(weaveEffect()).nodes.map(node => node.id)).toEqual(graph.nodes.map(node => node.id));
    expect(graph.nodes.slice(0, 4).map(node => node.operator)).toEqual(['weave.pattern', 'geometry.yarn-profile', 'render.strands', 'scene.output']);
    expect(graph.groups?.[0]).toMatchObject({ id: 'reveal-by-shape', label: 'Reveal by Shape' });
    const wave = createWaveStrandsGraph();
    expect(validateWeaveGraph(wave)).toEqual([]);
    expect(wave.nodes.filter(node => node.operator.startsWith('math.')).length).toBeGreaterThan(5);
  });

  it('evaluates the alternating over/under wave per curve point', () => {
    const program = compileGeometryGraph(createWaveStrandsGraph(), geometryParameterReader({}));
    expect(program.stages.map(stage => stage.kind)).toEqual(['curve-line', 'strand-array', 'set-position']);
    expect(program).toMatchObject({ pointCount: 16_000, strandCount: 8, render: { width: 0.004 } });
    const curves = evaluateGeometryProgram(program);
    expect(curves.counts.length).toBe(8);
    for (const [strand, point] of [[0, 0], [0, 731], [3, 1200], [4, 1999], [7, 555]]) {
      const u = point / 1999, sign = strand % 2 === 0 ? 1 : -1;
      const base = (curves.starts[strand] + point) * 3;
      expect(curves.positions[base]).toBeCloseTo((u - 0.5) * 2, 5);
      expect(curves.positions[base + 1]).toBeCloseTo((strand - 3.5) * 0.12 + Math.sin(u * 40) * 0.035 * sign, 5);
      expect(curves.positions[base + 2]).toBeCloseTo(Math.sin(u * 20) * 0.015, 5);
    }
  });

  it('passes curves through a bypassed modifier', () => {
    const graph = createWaveStrandsGraph();
    graph.nodes.find(node => node.id === 'set-position')!.bypassed = true;
    const curves = evaluate(graph);
    expect(Math.max(...Array.from(curves.positions.filter((_, index) => index % 3 === 2), Math.abs))).toBe(0);
  });

  it('reads exposed values from effect parameters and bakes them back when unexposed', () => {
    const graph = createWaveStrandsGraph(), params: Record<string, unknown> = {};
    applyGraphValueExposure(graph, params, 'amplitude', true, 'Amplitude');
    const amplitude = graph.nodes.find(node => node.id === 'amplitude')!;
    expect(amplitude.bindings.value).toBe('amplitude_value');
    expect(params.amplitude_value).toBe(0.035);
    params.amplitude_value = 0;
    const flat = evaluate(graph, params);
    expect(flat.positions[flat.starts[5] * 3 + 1 + 3 * 700]).toBeCloseTo(1.5 * 0.12, 5);
    expect(applyGraphValueExposure(graph, params, 'amplitude', false)).toEqual({ releasedKey: 'amplitude_value' });
    expect(amplitude.constants?.value).toBe(0);
  });

  it('offers shared per-point operators and keeps other graphs unchanged', () => {
    const offered = new Set(addableEffectOperators('weave').map(operator => operator.id));
    for (const id of ['math.add.scalar', 'math.sin.scalar', 'math.clamp.scalar', 'vector.combine.vec3', 'vector.split.vec3', 'values.number',
      'geometry.curve-line', 'geometry.strand-array', 'geometry.set-position', 'geometry.curve-info', 'render.strands']) expect(offered.has(id), id).toBe(true);
    for (const id of ['math.add.rgb', 'image.frame', 'forces.scatter', 'image.sample', 'math.gaussian.scalar']) expect(offered.has(id), id).toBe(false);
    for (const owner of ['face-cables', 'voxel-relief', 'invert', 'splat-exploration']) {
      expect(addableEffectOperators(owner).some(operator => isCurveOperator(operator.id)), owner).toBe(false);
    }
  });

  it('rejects operators without a curve-point executor', () => {
    const graph = createWaveStrandsGraph();
    graph.nodes.push({ id: 'frame', operator: 'image.frame', bindings: {}, operatorVersion: 1 });
    expect(validateWeaveGraph(graph)).toContain('Unsupported Weave operator graph.');
  });

  it('allows free-standing nodes that do not feed the output', () => {
    const graph = createWaveStrandsGraph();
    graph.nodes.push({ id: 'loose', operator: 'math.add.scalar', bindings: {}, operatorVersion: 1 });
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(() => assertWeaveGraph(graph, {})).not.toThrow();
  });

  it('persists the canonical graph on the effect', () => {
    const migrated = migratePersistedEffectOperatorGraph(weaveEffect());
    expect(migrated.operatorGraph).toMatchObject({ domain: 'geometry', schemaVersion: 1 });
    expect(migrated.operatorGraph!.nodes.every(node => node.operatorVersion === 1)).toBe(true);
    expect(effectOperatorGraph(migrated).edges.length).toBe(createDefaultWeaveGraph().edges.length);
  });

  it('draws a bounded per-strand wireframe', () => {
    const curves = evaluate(createWaveStrandsGraph());
    const { points, edges } = curveWireframe(curves);
    const drawn = points.length / 3;
    expect(drawn).toBeLessThanOrEqual(4000 + 8);
    expect(edges.length / 2).toBe(drawn - 8);
    expect(points.slice(0, 3)).toEqual(Array.from(curves.positions.slice(0, 3)));
  });
});
