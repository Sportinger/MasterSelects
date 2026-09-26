import { describe, expect, it } from 'vitest';
import { compileParticleDisintegrateGraph, createDefaultParticleDisintegrateGraph, validateParticleDisintegrateGraph } from '../../src/services/operators/particleDisintegrateGraph';
import { addableEffectOperators, effectOperatorGraph, hasEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { operatorCategoryId } from '../../src/services/operators/operatorTaxonomy';
import { PARTICLE_DISINTEGRATE_OPERATORS } from '../../src/services/operators/particleDisintegrateOperators';

const params = { progress: 0.5, cellSize: 8, spread: 0.55, depth: 0.45, spin: 0.7, gravity: 0.35, curlStrength: 0.35, turbulence: 0.2, directionX: 0, directionY: -0.25, gustStrength: 0.75 };

describe('Pixel Particle Disintegrate node graph', () => {
  it('exposes a valid default graph bound to the existing effect parameters', () => {
    const graph = createDefaultParticleDisintegrateGraph();
    expect(validateParticleDisintegrateGraph(graph)).toEqual([]);
    expect(hasEffectOperatorGraph('pixel-particle-disintegrate')).toBe(true);
    expect(effectOperatorGraph({ type: 'pixel-particle-disintegrate', params: {} }).nodes).toHaveLength(graph.nodes.length);
    const plan = compileParticleDisintegrateGraph(graph, params);
    expect(plan.passthrough).toBe(false);
    expect(plan.params).toMatchObject(params);
  });

  it('removes muted forces and releases nothing without a release stage', () => {
    const graph = createDefaultParticleDisintegrateGraph();
    graph.nodes.find(node => node.id === 'gravity')!.bypassed = true;
    graph.edges = graph.edges.filter(edge => edge.from !== 'curl');
    expect(compileParticleDisintegrateGraph(graph, params).params).toMatchObject({ gravity: 0, curlStrength: 0, turbulence: 0, spread: 0.55 });
    graph.nodes.find(node => node.id === 'release')!.bypassed = true;
    expect(compileParticleDisintegrateGraph(graph, params).params.progress).toBe(0);
  });

  it('sums duplicate forces and passes the input through when the render node is muted', () => {
    const graph = createDefaultParticleDisintegrateGraph();
    graph.nodes.push({ id: 'gravity2', operator: 'forces.gravity', bindings: { strength: 'gravity2_strength' } });
    graph.layout.gravity2 = { x: 0, y: 0 };
    graph.edges.push({ id: 'g2', from: 'gravity2', output: 'force', to: 'motion', input: 'forces' });
    expect(validateParticleDisintegrateGraph(graph)).toEqual([]);
    expect(compileParticleDisintegrateGraph(graph, { ...params, gravity2_strength: 1 }).params.gravity).toBeCloseTo(1.35);
    graph.nodes.find(node => node.id === 'render')!.bypassed = true;
    expect(compileParticleDisintegrateGraph(graph, params).passthrough).toBe(true);
  });

  it('files its nodes under the shared node taxonomy', () => {
    for (const operator of PARTICLE_DISINTEGRATE_OPERATORS) expect(operatorCategoryId(operator)).toBeDefined();
    expect(addableEffectOperators('pixel-particle-disintegrate').map(operator => operator.id)).toContain('forces.gravity');
  });
});
