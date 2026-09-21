import { describe, expect, it } from 'vitest';
import { connectEffectGraph, validateEffectGraph } from '../../src/services/operators/effectGraph';
import { createDefaultVoronoiGraph } from '../../src/services/operators/voronoiEffectGraph';

describe('default Voronoi operator graph', () => {
  it('uses canonical staged fields and an explicit generic resolve', () => {
    const graph = createDefaultVoronoiGraph();
    expect(graph.domain).toBe('compute-image');
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(graph.nodes.filter(node => node.operator === 'field.read-nearest-seed').map(node => node.id))
      .toEqual(['current-seed', 'right-seed', 'down-seed']);
    expect(graph.nodes.find(node => node.id === 'seeds')?.bindings).toEqual({ scale: 'scale', speed: 'speed' });
    expect(graph.nodes.find(node => node.id === 'amount')?.bindings).toEqual({ value: 'amount' });
    expect(graph.nodes.some(node => Object.values(node.bindings).includes('threshold'))).toBe(false);
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'seeds', output: 'field', to: 'jump-flood', input: 'field' }));
    for (const id of ['current-seed', 'right-seed', 'down-seed']) {
      expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'jump-flood', output: 'field', to: id, input: 'field' }));
    }
    expect(graph.nodes.some(node => node.operator === 'math.max.scalar')).toBe(true);
    expect(graph.nodes.some(node => node.operator === 'image.load-pixel-clamped')).toBe(true);
    expect(graph.nodes.find(node => node.id === 'combined')).toBeTruthy();
  });

  it('supports a real typed output rewire without changing the persisted model', () => {
    const graph = createDefaultVoronoiGraph();
    const rewired = connectEffectGraph(graph, { id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' });
    expect(validateEffectGraph(rewired)).toEqual([]);
    expect(rewired.edges).toContainEqual({ id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' });
    expect(rewired.edges.some(edge => edge.id === 'combined-output-image')).toBe(false);
  });
});
