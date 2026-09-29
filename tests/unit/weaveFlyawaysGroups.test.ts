import { describe, expect, it } from 'vitest';
import { createDefaultWeaveGraph, createWaveStrandsGraph, geometryParameterReader, validateWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { isGeometryProgram } from '../../src/services/operators/geometry/geometryProgramValidation';
import { operatorGroupBypassRoutes } from '../../src/services/operators/operatorGroupBypass';
import { exposedGraphValueSections } from '../../src/services/operators/exposedGraphValues';
import { packStrandPoints, STRAND_POINT_FLOATS } from '../../src/engine/native3d/passes/strandFrames';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const compile = (graph: EffectOperatorGraph, params: Record<string, unknown> = {}) => compileGeometryGraph(graph, geometryParameterReader(params));
const bypass = (graph: EffectOperatorGraph, groupId: string) => {
  graph.groups!.find(group => group.id === groupId)!.bypassed = true;
  return graph;
};

describe('Weave flyaways and node groups', () => {
  it('draws flyaways from the yarn profile of the default graph', () => {
    const graph = createDefaultWeaveGraph();
    expect(validateWeaveGraph(graph)).toEqual([]);
    const program = compile(graph);
    expect(program.render).toMatchObject({ profile: { plies: 3, fibers: 5 }, flyaways: { density: 3, length: 0.08, lift: 2.5, hair: 0.35, seed: 0 } });
    expect(program.stages.map(stage => stage.kind)).toEqual(['weave-pattern', 'yarn-profile']);
    expect(isGeometryProgram(structuredClone(program))).toBe(true);
  });

  it('rejects tampered flyaways and flyaways without a yarn to leave', () => {
    const program = structuredClone(compile(createDefaultWeaveGraph())) as any;
    program.render.flyaways.hair = 2;
    expect(isGeometryProgram(program)).toBe(false);
    const orphan = structuredClone(compile(createDefaultWeaveGraph())) as any;
    delete orphan.render.profile;
    expect(isGeometryProgram(orphan)).toBe(false);
    const graph = createDefaultWeaveGraph();
    graph.nodes.find(node => node.id === 'yarn')!.bypassed = true;
    expect(compile(graph).render).not.toHaveProperty('flyaways');
    graph.nodes.find(node => node.id === 'yarn')!.bypassed = false;
    graph.nodes.find(node => node.id === 'flyaways')!.constants!.density = 0;
    expect(compile(graph).render).not.toHaveProperty('flyaways');
  });

  it('packs the strand index for per-yarn flyaway hashing', () => {
    const curves = evaluateGeometryProgram(compile(createDefaultWeaveGraph()));
    const packed = packStrandPoints(curves);
    for (const strand of [0, 7, 39]) {
      const first = curves.starts[strand], last = first + curves.counts[strand] - 1;
      expect(packed[first * STRAND_POINT_FLOATS + 11]).toBe(strand);
      expect(packed[last * STRAND_POINT_FLOATS + 11]).toBe(strand);
    }
  });

  it('bypasses a field group by returning its consumers to their defaults', () => {
    const graph = createDefaultWeaveGraph();
    expect(operatorGroupBypassRoutes(graph, graph.groups![0])?.get('reveal-ramp-value-yarn-radius')).toBeNull();
    const program = compile(bypass(graph, 'reveal-by-shape'), { reveal_value: 0 });
    expect(program.stages.find(stage => stage.kind === 'yarn-profile')).toEqual({ kind: 'yarn-profile', nodeId: 'yarn' });
    expect(evaluateGeometryProgram(program).radius).toBeUndefined();
    // The saved graph keeps its wiring; only the compiled view changes.
    expect(graph.edges.some(edge => edge.id === 'reveal-ramp-value-yarn-radius')).toBe(true);
  });

  it('bypasses a curves group by passing the incoming curves through', () => {
    const graph = createDefaultWeaveGraph();
    expect(operatorGroupBypassRoutes(graph, graph.groups![1])?.get('flyaways-curves-render-curves')).toEqual({ from: 'pattern', output: 'curves' });
    const program = compile(bypass(graph, 'yarn'));
    expect(program.stages.map(stage => stage.kind)).toEqual(['weave-pattern']);
    expect(program.render).not.toHaveProperty('profile');
    expect(program.render).not.toHaveProperty('flyaways');
    expect(isGeometryProgram(structuredClone(program))).toBe(true);
  });

  it('disconnects a generated vector field so Set Position keeps the points', () => {
    const graph = bypass(createWaveStrandsGraph(), 'wave-offset');
    const curves = evaluateGeometryProgram(compile(graph));
    expect(Math.max(...Array.from(curves.positions.filter((_, index) => index % 3 !== 0), Math.abs))).toBeCloseTo(3.5 * 0.12, 6);
    expect(curves.positions.filter((_, index) => index % 3 === 2).every(value => value === 0)).toBe(true);
  });

  it('sections exposed values by their node group', () => {
    const graph = createDefaultWeaveGraph();
    expect(exposedGraphValueSections(graph)).toMatchObject([{ groupId: 'reveal-by-shape', label: 'Reveal by Shape', values: [{ key: 'reveal_value' }] }]);
    graph.groups = [];
    expect(exposedGraphValueSections(graph)).toEqual([{ label: 'Graph values', values: [expect.objectContaining({ key: 'reveal_value' })] }]);
  });
});
