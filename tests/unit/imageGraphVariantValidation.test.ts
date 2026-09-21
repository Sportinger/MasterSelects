import { describe, expect, it } from 'vitest';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import { connectEffectGraph, validateEffectGraph } from '../../src/services/operators/effectGraph';

describe('incomplete vector graph integrity', () => {
  it('rejects newly introduced incompatible connections even while preserving older repairable edges', () => {
    const graph = createDefaultInvertImageGraph();
    expect(() => connectEffectGraph(graph, { id: 'bad', from: 'one', output: 'value', to: 'output', input: 'image' })).toThrow('No supported variant preserves the connected signal types');
    graph.nodes.find(node => node.id === 'combine')!.operator = 'vector.combine.vec2';
    graph.incomplete = 'Repair connections after dimension change';
    expect(() => connectEffectGraph(graph, { id: 'replacement', from: 'one', output: 'value', to: 'invert-r', input: 'a' })).not.toThrow();
  });
  it('retains repairable ports after a dimension change but never accepts duplicate input edges', () => {
    const graph = createDefaultInvertImageGraph();
    graph.nodes.find(node => node.id === 'combine')!.operator = 'vector.combine.vec2';
    graph.incomplete = 'Repair connections after dimension change';
    expect(validateEffectGraph(graph, true)).toEqual([]);
    graph.edges.push({ ...graph.edges.find(edge => edge.to === 'combine' && edge.input === 'z')!, id: 'duplicate-invalid-port' });
    expect(validateEffectGraph(graph, true)).toContain('Invalid connection: duplicate-invalid-port.');
  });
});
