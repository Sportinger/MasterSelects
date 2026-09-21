import { describe, expect, it } from 'vitest';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { createDefaultQuadtreeGraph } from '../../src/services/operators/quadtreeEffectGraph';

describe('Quadtree Zoom canonical graph', () => {
  it('registers one non-addable bounded shared partition contract', () => {
    expect(getEffectOperator('image.quadtree-partition')).toMatchObject({ addable: false, implementation: 'shared',
      family: 'image.spatial-partition', variant: 'quadtree-6',
      inputs: [{ id: 'image', type: 'image' }, { id: 'scale', type: 'number' }, { id: 'threshold', type: 'number' },
        { id: 'time', type: 'number' }, { id: 'speed', type: 'number' }],
      outputs: [{ id: 'origin', type: 'vec2' }, { id: 'size', type: 'number' }] });
  });

  it('keeps catalog bindings and the explicit legacy resolve topology', () => {
    const graph = createDefaultQuadtreeGraph();
    expect(graph.domain).toBe('compute-image');
    expect(graph.nodes.find(node => node.id === 'partition')).toMatchObject({ operator: 'image.quadtree-partition', bindings: {} });
    expect(graph.nodes.filter(node => node.operator === 'image.load-pixel-clamped').map(node => node.id)).toEqual(['center-sample', 'original-sample']);
    expect(graph.nodes.find(node => node.id === 'time')?.operator).toBe('image.timeline-time');
    for (const id of ['scale', 'threshold', 'speed', 'amount']) {
      expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
    }
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'partition', output: 'origin', to: 'center', input: 'a' }),
      expect.objectContaining({ from: 'partition', output: 'size', to: 'half-size-product', input: 'a' }),
      expect.objectContaining({ from: 'original-color', output: 'alpha', to: 'combined', input: 'alpha' }),
    ]));
  });

  it('returns isolated graph state on every construction', () => {
    const first = createDefaultQuadtreeGraph(), second = createDefaultQuadtreeGraph();
    first.nodes[0]!.bindings.changed = 'changed'; first.edges[0]!.from = 'changed'; first.layout.frame!.x = 999;
    expect(second.nodes[0]!.bindings).not.toHaveProperty('changed');
    expect(second.edges[0]!.from).not.toBe('changed');
    expect(second.layout.frame!.x).not.toBe(999);
  });
});
