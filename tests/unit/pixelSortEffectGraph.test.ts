import { describe, expect, it } from 'vitest';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { createDefaultPixelSortGraph } from '../../src/services/operators/pixelSortEffectGraph';

describe('default Pixel Sort operator graph', () => {
  it('declares the bounded stable segment primitive without exposing it as addable', () => {
    const definition = getEffectOperator('image.segment-sort-luma');
    expect(definition).toMatchObject({ family: 'image.segment-sort', variant: 'stable-rec709-16', addable: false,
      state: 'stateless', fusion: 'inline', bypass: 'passthrough' });
    expect(definition?.description).toMatch(/16.*Rec\.709.*strict greater-than|Rec\.709.*strict greater-than.*16/i);
    expect(definition?.inputs.map(port => [port.id, port.type])).toEqual([['image', 'image'], ['scale', 'number']]);
    expect(definition?.outputs.map(port => [port.id, port.type])).toEqual([['image', 'image']]);
  });

  it('wires catalog bindings, strict validation, RGB eligibility, and original alpha explicitly', () => {
    const graph = createDefaultPixelSortGraph();
    expect(graph.domain).toBe('compute-image');
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(graph.nodes.find(node => node.id === 'scale')?.bindings).toEqual({ value: 'scale' });
    expect(graph.nodes.find(node => node.id === 'threshold')?.bindings).toEqual({ value: 'threshold' });
    expect(graph.nodes.find(node => node.id === 'amount')?.bindings).toEqual({ value: 'amount' });
    expect(graph.nodes.find(node => node.id === 'sorted')?.operator).toBe('image.segment-sort-luma');
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'luminance', output: 'value', to: 'eligible', input: 'value' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'threshold', output: 'value', to: 'eligible', input: 'edge' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'amount', output: 'value', to: 'mix-amount', input: 'a' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'eligible', output: 'value', to: 'mix-amount', input: 'b' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'original-color', output: 'alpha', to: 'combined', input: 'alpha' }));
  });
});
