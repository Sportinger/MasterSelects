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
    expect(program.stages.map(stage => stage.kind)).toEqual(['weave-pattern', 'set-position', 'thread-along', 'yarn-profile', 'surface-bind']);
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

  it('bypasses a field group by returning its consumers to their defaults', { timeout: 60_000 }, () => {
    const graph = createDefaultWeaveGraph();
    expect(operatorGroupBypassRoutes(graph, graph.groups!.find(group => group.id === 'reveal-by-shape')!)?.get('reveal-ramp-value-yarn-radius-a')).toBeNull();
    bypass(graph, 'reveal-by-shape');
    // Multiply reads 1 through the disconnected operand, so a hidden reveal no longer hides anything;
    // only the Handmade slubs still swell the yarn.
    const woven = evaluateGeometryProgram(compileGeometryGraph(graph, geometryParameterReader({ reveal_value: 0 }), undefined, { simulationTime: 100 })).radius!;
    expect(Math.min(...woven)).toBe(1);
    // With Handmade bypassed as well, both operands fall back to 1. Graphs are immutable snapshots
    // (their bypassed view is cached), so this uses a new one.
    const both = bypass(bypass(createDefaultWeaveGraph(), 'reveal-by-shape'), 'handmade');
    const plain = evaluateGeometryProgram(compileGeometryGraph(both, geometryParameterReader({ reveal_value: 0 }), undefined, { simulationTime: 100 })).radius!;
    expect(Math.min(...plain)).toBe(1);
    expect(Math.max(...plain)).toBe(1);
    // The saved graph keeps its wiring; only the compiled view changes.
    expect(graph.edges.some(edge => edge.id === 'reveal-ramp-value-yarn-radius-a')).toBe(true);
  });

  it('bypasses a curves group by passing the incoming curves through', () => {
    const graph = createDefaultWeaveGraph();
    expect(operatorGroupBypassRoutes(graph, graph.groups!.find(group => group.id === 'yarn')!)?.get('fiber-curves-bind-curves')).toEqual({ from: 'thread', output: 'curves' });
    const program = compile(bypass(graph, 'yarn'));
    expect(program.stages.map(stage => stage.kind)).toEqual(['weave-pattern', 'set-position', 'thread-along', 'surface-bind']);
    expect(program.render).not.toHaveProperty('profile');
    expect(program.render).not.toHaveProperty('flyaways');
    expect(program.render).not.toHaveProperty('materials');
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
    expect(exposedGraphValueSections(graph)).toMatchObject([{ groupId: 'reveal-by-shape', label: 'Reveal by Shape', values: [{ key: 'reveal_value' }] },
      { groupId: 'weave-in', label: 'Weave In', values: [{ key: 'weave_value' }] },
      { groupId: 'handmade', label: 'Handmade', values: [{ key: 'irregularity_value' }] }]);
    graph.groups = [];
    expect(exposedGraphValueSections(graph)).toEqual([{ label: 'Graph values', values: [expect.objectContaining({ key: 'reveal_value' }),
      expect.objectContaining({ key: 'weave_value' }), expect.objectContaining({ key: 'irregularity_value' })] }]);
  });
});
