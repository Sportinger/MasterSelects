import { describe, expect, it } from 'vitest';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { createDefaultContourGraph } from '../../src/services/operators/contourEffectGraph';

describe('Contour canonical graph', () => {
  it('uses one bounded topology primitive with four explicit Rec.709 corner loads', () => {
    const graph = createDefaultContourGraph();
    expect(graph.domain).toBe('compute-image');
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(graph.nodes.filter(node => /^((tl|tr|br|bl)-sample)$/.test(node.id)).map(node => node.operator))
      .toEqual(Array(4).fill('image.load-pixel-clamped'));
    expect(graph.nodes.filter(node => /^((tl|tr|br|bl)-tone)$/.test(node.id)).map(node => node.operator))
      .toEqual(Array(4).fill('color.luminance-rec709.image'));
    expect(graph.nodes.filter(node => node.operator === 'geometry.marching-squares-topology')).toHaveLength(1);
    expect(graph.nodes.filter(node => node.operator === 'image.load-pixel-clamped')).toHaveLength(5);
    expect(graph.nodes.find(node => node.id === 'origin')?.operator).toBe('coordinates.integer-cell-origin.vec2');
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'pixel', output: 'value', to: 'origin', input: 'pixel' }),
      expect.objectContaining({ from: 'cell-size', output: 'value', to: 'origin', input: 'size' }),
    ]));
    expect(graph.nodes.some(node => ['pixel-cell', 'cell'].includes(node.id))).toBe(false);
  });

  it('keeps owner bindings, topology ports, generic distance math, and original alpha explicit', () => {
    const graph = createDefaultContourGraph();
    for (const id of ['scale', 'threshold', 'amount']) expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
    expect(graph.nodes.find(node => node.id === 'color-a')?.bindings).toEqual({ value: 'colorA' });
    expect(graph.nodes.find(node => node.id === 'color-b')?.bindings).toEqual({ value: 'colorB' });
    for (const input of ['tl', 'tr', 'br', 'bl', 'top', 'right', 'bottom', 'left']) {
      expect(graph.edges).toContainEqual(expect.objectContaining({ to: 'topology', input }));
    }
    for (const output of ['a', 'b', 'c', 'd', 'count']) {
      expect(graph.edges.some(edge => edge.from === 'topology' && edge.output === output)).toBe(true);
    }
    expect(graph.nodes.filter(node => node.operator === 'vector.dot.vec2')).toHaveLength(4);
    expect(graph.nodes.filter(node => node.operator === 'vector.length.vec2')).toHaveLength(2);
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'original-color', output: 'alpha', to: 'combined', input: 'alpha' }));
  });
});
