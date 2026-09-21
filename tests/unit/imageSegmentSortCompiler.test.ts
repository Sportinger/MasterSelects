import { describe, expect, it } from 'vitest';
import { compileComputeImageGraph } from '../../src/services/operators/computeImageGraph';
import { createImageOperatorEvaluator } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultPixelSortGraph } from '../../src/services/operators/pixelSortEffectGraph';

describe('image.segment-sort-luma compiler', () => {
  it('lowers one bounded lexical pixel-load scope with the shared stable WGSL sort', () => {
    const program = compileComputeImageGraph(createDefaultPixelSortGraph(), { scale: 4, threshold: 0, amount: 1 }).imageProgram!;
    expect(program.capabilities).toEqual(expect.arrayContaining(['resolution', 'pixel-load']));
    expect(program.segmentSortScopes).toHaveLength(1);
    expect(program.wgsl).toContain('fn imageStableSort16ByRec709');
    expect(program.wgsl).toContain('i32(round(scale))');
    expect(program.wgsl).toContain('colors[index] = evaluateImageScope');
  });

  it('evaluates stable whole-RGBA sorting from exact integer loads', () => {
    const program = compileComputeImageGraph(createDefaultPixelSortGraph(), { scale: 4, threshold: 0, amount: 1 }).imageProgram!;
    const source = [[.1, .1, .1, .2], [.3, .3, .3, .4], [.3, .3, .3, .7], [.8, .8, .8, .9]] as const;
    const evaluate = createImageOperatorEvaluator(program);
    const result = evaluate([...source[1]] as [number, number, number, number], { uv: [.375, .5], resolution: [4, 1], pixelCoordinate: [1, 0],
      loadImage: ([x]) => [...source[x]!] as [number, number, number, number] });
    expect(result).toEqual([.3, .3, .3, .4]);
  });

  it('rejects a segment sort nested as another sort source', () => {
    const graph = createDefaultPixelSortGraph();
    graph.nodes.push({ id: 'nested-sort', operator: 'image.segment-sort-luma', operatorVersion: 1, bindings: {} });
    graph.edges.push({ id: 'sorted-nested-image', from: 'sorted', output: 'image', to: 'nested-sort', input: 'image' },
      { id: 'scale-nested-scale', from: 'scale', output: 'value', to: 'nested-sort', input: 'scale' });
    const edge = graph.edges.find(item => item.to === 'sorted-color' && item.input === 'image')!;
    edge.from = 'nested-sort'; edge.id = 'nested-sort-color';
    expect(() => compileComputeImageGraph(graph, { scale: 4, threshold: 0, amount: 1 })).toThrow(/cannot be nested/);
  });
});
