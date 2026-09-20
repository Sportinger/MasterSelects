import { describe, expect, it } from 'vitest';
import { compileCableOperatorGraph, defaultCableOperatorGraph } from '../../src/services/faceCables/cableOperatorGraph';
import { connectEffectGraph, evaluateGraphForces, readEffectGraph, validateEffectGraph } from '../../src/services/operators/effectGraph';
import { sharedCableWind } from '../../src/services/faceCables/cableWind';
import { createMockKeyframe } from '../helpers/mockData';

describe('reusable cable operator execution', () => {
  it('migrates old parameters without changing their animated wind', () => {
    const params = { sharedWind: true, globalWindStrength: 6, globalWindYaw: 23, globalWindPitch: 11, globalWindGusts: 0.4 };
    const keys = [createMockKeyframe({ property: 'effect.fx.globalWindStrength', value: 2, time: 0 }),
      createMockKeyframe({ property: 'effect.fx.globalWindStrength', value: 8, time: 2 })];
    const compiled = compileCableOperatorGraph(params);
    expect(validateEffectGraph(compiled.graph)).toEqual([]);
    for (const time of [0, 0.3, 1, 2]) {
      const old = sharedCableWind(params, 'fx', keys, time)!;
      const next = compiled.forces('fx', keys, time);
      expect(next.force[0]).toBeCloseTo(old.windX, 12);
      expect(-next.force[1]).toBeCloseTo(old.windY, 12);
      expect(next.force[2]).toBeCloseTo(old.windZ, 12);
      expect(next.replacesCableWind).toBe(true);
    }
  });

  it('evaluates only connected forces and scalar inputs, with bypass and drag', () => {
    const graph = defaultCableOperatorGraph();
    graph.nodes.push({ id: 'value', operator: 'values.number', bindings: { value: 'inputStrength' } },
      { id: 'gravity', operator: 'forces.gravity', bindings: { strength: 'gravity' } },
      { id: 'drag', operator: 'forces.drag', bindings: { amount: 'damping' } },
      { id: 'unused', operator: 'forces.gravity', bindings: { strength: 'unused' } });
    graph.edges.push({ id: 'scalar', from: 'value', output: 'value', to: 'wind', input: 'strength' },
      { id: 'gravity', from: 'gravity', output: 'force', to: 'simulation', input: 'forces' },
      { id: 'drag', from: 'drag', output: 'drag', to: 'simulation', input: 'drag' });
    const params = { sharedWind: true, globalWindGusts: 0, inputStrength: 9, gravity: 3, damping: 2, unused: 100 };
    expect(evaluateGraphForces(graph, 'simulation', params, '', [], 0)).toEqual({ force: [0, -3, 9], damping: 2, replacesCableWind: true });
    graph.nodes.find(n => n.id === 'wind')!.bypassed = true;
    expect(evaluateGraphForces(graph, 'simulation', params, '', [], 0)).toEqual({ force: [0, -3, 0], damping: 2, replacesCableWind: false });
    graph.edges = graph.edges.filter(e => e.id !== 'gravity');
    expect(evaluateGraphForces(graph, 'simulation', params, '', [], 0).force).toEqual([0, 0, 0]);
  });

  it('rejects incompatible ports, missing core inputs, cycles and malformed saved data', () => {
    const graph = defaultCableOperatorGraph();
    expect(() => connectEffectGraph(graph, { id: 'bad', from: 'depth', output: 'depth', to: 'simulation', input: 'forces' })).toThrow('Invalid connection');
    const missing = structuredClone(graph); missing.edges = missing.edges.filter(e => e.to !== 'anchors');
    expect(validateEffectGraph(missing).join(' ')).toContain('connect Landmarks');
    const cyclic = structuredClone(graph);
    cyclic.nodes.push({ id: 'transform2', operator: 'scene.transform', bindings: {} });
    cyclic.edges = cyclic.edges.filter(e => e.to !== 'transform');
    cyclic.edges.push({ id: 'a', from: 'transform', output: 'scene', to: 'transform2', input: 'scene' },
      { id: 'b', from: 'transform2', output: 'scene', to: 'transform', input: 'scene' });
    expect(validateEffectGraph(cyclic)).toContain('Cycles are not supported.');
    for (const value of ['{', 'null', JSON.stringify({ ...graph, nodes: [null] })]) expect(() => readEffectGraph(value, defaultCableOperatorGraph)).toThrow();
    expect(() => compileCableOperatorGraph({ operatorGraph: JSON.stringify({ ...graph, edges: graph.edges.map(e => e.id === 'surface-depth-contact' ? { ...e, from: 'face-contact' } : e) }) })).toThrow('surface.hybrid');
  });

  it('keeps saved depth and reads the same effect toggle bindings after serialization', () => {
    const graph = defaultCableOperatorGraph();
    const params = { operatorGraph: JSON.stringify(graph), sceneData: 'existing-depth', sceneDepth: true, sceneDepthCollision: false, faceCollision: true };
    expect(compileCableOperatorGraph(params).params).toMatchObject({ sceneData: 'existing-depth', sceneDepth: true, sceneDepthCollision: false, faceCollision: true });
    graph.edges = graph.edges.filter(e => e.from !== 'depth' || e.to !== 'surface');
    expect(compileCableOperatorGraph({ ...params, operatorGraph: JSON.stringify(graph) }).params.sceneDepth).toBe(false);
  });
});
